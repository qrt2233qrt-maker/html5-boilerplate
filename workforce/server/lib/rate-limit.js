import { tooMany } from './errors.js';

// Fixed-window counter stored in Postgres, so the limit holds across every
// server instance. Throws 429 once `limit` hits in `windowSeconds` is passed.
export async function rateLimit(db, key, limit, windowSeconds) {
  const { rows } = await db.query(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowSeconds],
  );
  if (rows[0].count > limit) throw tooMany();
}

export async function pruneRateLimits(db) {
  await db.query('DELETE FROM rate_limits WHERE window_start < now() - interval \'2 days\'');
}
