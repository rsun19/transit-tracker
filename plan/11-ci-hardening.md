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
3. Add `fingerprint: ${{ secrets.DEPLOY_HOST_FINGERPRINT }}` to both appleboy steps (`ssh-keyscan -t ed25519 host | ssh-keygen -lf -`).
4. Deploy concurrency: `group: deploy-prod`, `cancel-in-progress: false`.
5. Add `docker/init-db.sql` to the scp source list. Use `docker compose exec db …` instead of the hard-coded container name.
6. Add a `nginx -t` config-check step (from PR 01), and the `npm audit` job plus Dependabot (from PR 10) if PR 10 hasn't landed.
7. Use a GitHub `environment: production` with required reviewers on the deploy job (optional).
