import { request } from 'node:http';
import { spawnSync } from 'node:child_process';

const frontendUrl = process.env.CYPRESS_BASE_URL ?? 'http://127.0.0.1:3001';

function checkUrl(url) {
  return new Promise((resolve) => {
    const req = request(url, { method: 'GET', timeout: 2000 }, (res) => {
      resolve(res.statusCode != null && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

const isReachable = await checkUrl(frontendUrl);
if (!isReachable) {
  console.error(
    `Frontend is not reachable at ${frontendUrl}. Start the app first (for example: npm run dev).`,
  );
  process.exit(1);
}

const result = spawnSync(
  'npx',
  ['cypress', 'open', '--config-file', 'tests/e2e/cypress.config.mjs'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      CYPRESS_BASE_URL: frontendUrl,
    },
  },
);

process.exit(result.status ?? 1);
