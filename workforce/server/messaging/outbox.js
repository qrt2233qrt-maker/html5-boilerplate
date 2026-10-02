// Emails and SMS go into outbound_messages inside the same transaction as the
// action that caused them, then a worker delivers them. A provider outage
// delays a message instead of losing it.

const MAX_ATTEMPTS = 5;

export async function queueMessage(db, { channel, to, subject = null, body, sensitive = false }) {
  await db.query(
    'INSERT INTO outbound_messages (channel, recipient, subject, body, sensitive) VALUES ($1, $2, $3, $4, $5)',
    [channel, to, subject, body, sensitive],
  );
}

export function createTransports(config, log) {
  const m = config.messaging;
  const logTransport = async (msg) => log.warn({ channel: msg.channel, to: msg.recipient, subject: msg.subject, body: msg.body }, 'DEV MESSAGE (not delivered)');
  let smtp;
  const email = m.email === 'smtp'
    ? async (msg) => {
      if (!smtp) {
        const nodemailer = (await import('nodemailer')).default;
        smtp = nodemailer.createTransport(m.smtpUrl);
      }
      await smtp.sendMail({ from: m.emailFrom, to: msg.recipient, subject: msg.subject, text: msg.body });
    }
    : logTransport;
  const sms = m.sms === 'twilio'
    ? async (msg) => {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${m.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${m.twilioSid}:${m.twilioToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: msg.recipient, From: m.twilioFrom, Body: msg.body }),
      });
      if (!res.ok) throw new Error(`Twilio responded ${res.status}`);
    }
    : logTransport;
  return { email, sms };
}

export function createOutbox(pool, transports, log) {
  let running = null;

  async function deliverBatch() {
    const client = await pool.connect();
    let count = 0;
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM outbound_messages WHERE status = 'queued' AND attempts < $1 AND next_attempt_at <= now()
         ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED`, [MAX_ATTEMPTS]);
      for (const msg of rows) {
        try {
          await transports[msg.channel](msg);
          await client.query(
            `UPDATE outbound_messages SET status = 'sent', sent_at = now(), attempts = attempts + 1,
               body = CASE WHEN sensitive THEN '[redacted]' ELSE body END WHERE id = $1`, [msg.id]);
        } catch (err) {
          log.error({ err, messageId: msg.id }, 'Message delivery failed');
          await client.query(
            `UPDATE outbound_messages SET attempts = attempts + 1, last_error = $2,
               next_attempt_at = now() + (power(attempts + 1, 2) || ' minutes')::interval,
               status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'queued' END WHERE id = $1`,
            [msg.id, String(err.message).slice(0, 500), MAX_ATTEMPTS]);
        }
        count++;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return count;
  }

  // Delivers everything queued. Calls that overlap share one run.
  function flush() {
    running ??= (async () => {
      try {
        while ((await deliverBatch()) > 0) { /* keep going */ }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { flush };
}
