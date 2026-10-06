import pg from 'pg';

// int8 (bigint, count(*)) comes back as a string by default. Money is stored
// in int8 minor units, so parse it and refuse values that lose precision.
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 value out of safe range: ${value}`);
  return n;
});

// A calendar date (DATE) stays the 'YYYY-MM-DD' string it is. The default
// turns it into a Date at the server's local midnight, which shifts a day
// when serialised on any server not running in UTC.
pg.types.setTypeParser(1082, (value) => value);

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

// Runs fn inside a transaction. fn receives a client with the same query API.
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
