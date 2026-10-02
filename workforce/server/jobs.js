// In-process background work. Each job is safe to run on several servers at
// once (row locks / unique keys), so scaling out needs no coordinator.
import { generateDue } from './services/finance.js';
import { scanAlerts } from './services/analytics.js';
import { processReportJobs } from './services/reports.js';
import { pruneRateLimits } from './lib/rate-limit.js';

export function startJobs(app) {
  const run = (name, fn) => () => fn().catch((err) => app.log.error({ err }, `job ${name} failed`));
  const jobs = [
    [30_000, 'outbox', () => app.outbox.flush()],
    [10 * 60_000, 'recurring', () => generateDue(app.db)],
    [60 * 60_000, 'alerts', () => scanAlerts(app.db)],
    [60_000, 'reports', () => processReportJobs(app)],
    [60 * 60_000, 'rate-limits', () => pruneRateLimits(app.db)],
    [24 * 60 * 60_000, 'cleanup', () => app.db.query('DELETE FROM idempotency_keys WHERE created_at < now() - interval \'2 days\'')],
  ];
  const timers = jobs.map(([ms, name, fn]) => setInterval(run(name, fn), ms));
  // Catch up once at start-up.
  setTimeout(run('recurring', () => generateDue(app.db)), 5_000);
  return () => timers.forEach(clearInterval);
}
