import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';
import { pruneRateLimits } from './lib/rate-limit.js';

const config = loadConfig();
const app = await buildApp(config);
await migrate(app.db);

// Background work: retry undelivered messages and clean up old counters.
const timers = [
  setInterval(() => app.outbox.flush().catch((err) => app.log.error({ err }, 'outbox')), 30_000),
  setInterval(() => pruneRateLimits(app.db).catch((err) => app.log.error({ err }, 'rate limit prune')), 3_600_000),
];

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    timers.forEach(clearInterval);
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
