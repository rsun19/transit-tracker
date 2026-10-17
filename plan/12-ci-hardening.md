# CI and deploy workflow hardening

**Type:** security (supply chain)
**Touches:** `.github/workflows/ci.yml`, `.github/dependabot.yml`
**Depends on:** nothing (can be merged any time; trivially small)

## Problem

1. **No top-level `permissions:` block** (`ci.yml:1-11`), so every job gets the repository's default `GITHUB_TOKEN` scope.
2. **Third-party actions are pinned by tag, not SHA**, including the ones that receive `SSH_PRIVATE_KEY`: `appleboy/scp-action@v0.1.7` (`:358`) and `appleboy/ssh-action@v1` (`:367`). Anyone who can retag those releases gets the deploy key.
3. **No SSH host-key verification**: the `fingerprint` input isn't set, so the deploy connection can be intercepted (MITM).
4. **The deploy job uses `cancel-in-progress: true`** (`:251`). Two quick pushes to main can kill a deploy between `docker compose pull` and `up`, leaving prod half-updated.
5. **`docker/init-db.sql` isn't copied to the server** (`:363`). Whether it already exists there is unverified. The container name `transit-tracker-db-1` is hard-coded (`:421`).
6. **No dependency scanning.**

## Changes

1. Add top-level `permissions: { contents: read }`, and grant `packages: write` and similar only on the jobs that push images.
2. Pin every `uses:` to a full commit SHA with a `# vX.Y.Z` comment (let Dependabot's github-actions ecosystem keep them updated).
3. Add `fingerprint: ${{ secrets.DEPLOY_HOST_FINGERPRINT }}` to both appleboy steps. **Take the value from a trusted channel, not from `ssh-keyscan` over the network** (a MITM would just hand you its own key). For example, run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server through the hosting provider's web console, or read it from the provider's metadata or API. Store the exact `SHA256:…` value that the appleboy actions expect. If the host key is ever rotated, re-verify the same way.
4. Deploy concurrency: `group: deploy-prod`, `cancel-in-progress: false`.
5. Add `docker/init-db.sql` and `nginx/snippets/` (PR 01) to the scp source list so a fresh server bootstraps the same way as local. `init-db.sql` only runs on first volume creation, so don't rely on it for schema, role or grant changes on the existing DB: those go through migrations (PR 08) and the role script (PR 10). Use `docker compose exec -T db …` instead of the hard-coded container name. **Every** `docker compose exec` in the deploy script and in CI needs `-T`, because there's no TTY over SSH or in Actions.
6. Add a `nginx -t` config-check step (from PR 01), and the `npm audit` job plus Dependabot (from PR 11) if PR 11 hasn't landed.
7. Use a GitHub `environment: production` with required reviewers on the deploy job (optional).
