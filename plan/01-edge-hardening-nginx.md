# Edge hardening: close the port-80 API bypass, add security headers

**Type:** security, small and self-contained, so it ships first
**Touches:** `nginx.conf`, `docker-compose.yml` (frontend `BACKEND_URL`, nginx ports), `frontend/next.config.mjs`, `services/*/src/main.ts`
**Depends on:** nothing

## Problem

1. **The public HTTP server proxies the whole API with no rate limit.** `nginx.conf:31-98`: the port-80 server has `location /api/v1/*` blocks so the frontend's SSR can reach the backends (`BACKEND_URL: http://nginx:80`, `docker-compose.yml:192,195`). Port 80 is published to the internet (`docker-compose.yml:220-222`), and it's the only server on 80, so it also answers any `Host`. Anyone can call `http://trackthemetro.com/api/v1/stops?...` in plaintext and skip the `limit_req zone=api` that protects the 443 block (`:114-169`).
2. **SSR pages have no rate limit.** The 443 `location /` (`:187-198`) has no `limit_req`. Each `/stops/<id>` render makes 2 backend calls (`frontend/src/app/stops/[stopId]/page.tsx:14-17`), and random IDs miss the cache, so a flood of random stop IDs becomes Postgres load.
3. **No security headers.** There's no HSTS, CSP, `X-Content-Type-Options`, `frame-ancestors`/`X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy` (the app uses geolocation). `server_tokens` is on by default, and Express and Next both send `X-Powered-By`.
4. **Static upstreams in the 443 block** (`proxy_pass http://stops:3003` etc.) are resolved once, at nginx startup. If a backend container is recreated without an nginx restart, requests fail with 502 until nginx restarts. `nginx.dev.conf` already uses the variable form.

## Changes

1. **Split internal and public traffic.**
   - Add `server { listen 8080; ... }`, which is *not* published in compose, with the `/api/v1/*` locations for SSR. Point the frontend's `BACKEND_URL` at `http://nginx:8080`.
   - Reduce the public `listen 80` server to `/.well-known/acme-challenge/` plus `return 301 https://…`.
   - Add a catch-all `server { listen 80 default_server; listen 443 ssl default_server; return 444; }` (443 needs a cert, or use `ssl_reject_handshake on;` on nginx ≥1.19.4). This drops requests whose Host isn't ours.
2. **Rate-limit pages:** add `limit_req_zone $binary_remote_addr zone=pages:10m rate=5r/s;` and `limit_req zone=pages burst=20 nodelay;` on `location /`. Exempt `/_next/static/`, which can also get long `expires` caching.
3. **Headers** (443 server, `always`):
   ```nginx
   server_tokens off;
   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
   add_header X-Content-Type-Options nosniff always;
   add_header Referrer-Policy strict-origin-when-cross-origin always;
   add_header Permissions-Policy "geolocation=(self), camera=(), microphone=()" always;
   add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" always;
   ```
   Check the map tile host in `VehicleMap.tsx` before adding it to `img-src`. Start the CSP with `Content-Security-Policy-Report-Only` for one deploy. Note that `add_header` in a `location` block overrides the server-level headers, so use an `include` snippet.
4. **Hide `X-Powered-By`:** set `poweredByHeader: false` in `next.config.mjs` and `app.disable('x-powered-by')` (or `helmet()`) in each Nest `main.ts`.
5. **TLS details:** `listen 443 ssl; http2 on;`, `ssl_session_cache shared:SSL:10m;`, and drop `ssl_prefer_server_ciphers on` (it has no effect with only modern protocols).
6. **Re-resolve upstreams:** use the variable form `set $stops_upstream http://stops:3003; proxy_pass $stops_upstream;` in every location, to match the dev config. With a variable, `proxy_pass` doesn't append the URI automatically, so the locations need `$request_uri`.
7. **Reduce duplication:** move the `proxy_set_header` lines into `nginx/snippets/proxy_common.conf`, and the security headers from item 3 into `nginx/snippets/security_headers.conf`. Reference them by absolute container path: `include /etc/nginx/snippets/proxy_common.conf;`. Mount the directory read-only **everywhere nginx runs**, at that same path:
   - `docker-compose.yml` nginx service: add `- ./nginx/snippets:/etc/nginx/snippets:ro` next to the existing `./nginx.conf:/etc/nginx/nginx.conf:ro` (`docker-compose.yml:209`);
   - `docker-compose.dev.yml`, if `nginx.dev.conf` uses the snippets;
   - the CI `nginx -t` command below;
   - the deploy `scp` source list (PR 11), so the snippets reach the server.

## Verify

- From outside: `curl -i http://trackthemetro.com/api/v1/agencies` returns 301, not JSON.
- From inside the frontend container, `wget -qO- http://nginx:8080/api/v1/agencies` works.
- `curl -I https://www.trackthemetro.com` shows the new headers and no `Server: nginx/x.y` version.
- The SSR stop page still renders; the map still loads tiles (CSP).
- The nginx config passes `nginx -t` in CI (add this step). The config references `/etc/letsencrypt/live/...` certs and upstream hostnames, and neither exists in CI, so don't `exec` into a compose service there. Instead, generate a throwaway self-signed cert at that path and run `docker run --rm -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" -v "$PWD/nginx/snippets:/etc/nginx/snippets:ro" -v "$PWD/ci-certs:/etc/letsencrypt:ro" --add-host stops:127.0.0.1 … nginx:<pinned> nginx -t`, adding one `--add-host` per upstream. On the server, use `docker compose exec -T nginx nginx -t` before `nginx -s reload`. `-T` is needed because there's no TTY over SSH.
