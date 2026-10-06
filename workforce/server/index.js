import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';
import { seedAll } from './services/settings.js';
import { startJobs } from './jobs.js';

const config = loadConfig();
const app = await buildApp(config);
await migrate(app.db);

await seedAll(app.db);
const stopJobs = config.jobs ? startJobs(app) : () => {};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    stopJobs();
    await app.close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
