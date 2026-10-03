// Prints a one-time password reset link for an account, for when the owner
// forgot their password and the server sends no email or SMS. Needs access to
// the server (it reads DATABASE_URL), so only whoever runs it can use it.
//   npm run reset-link -- 07701234567      (or an email address)
import pg from 'pg';
import { loadConfig } from '../server/config.js';
import { issueResetLink } from '../server/services/auth.js';
import { normalizeEmail, normalizePhone } from '../server/lib/identity.js';

const who = process.argv[2];
if (!who) {
  console.error('Usage: npm run reset-link -- <email or phone>');
  process.exit(1);
}
const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl });
try {
  const email = who.includes('@') ? normalizeEmail(who) : null;
  const phone = email ? null : normalizePhone(who);
  const { rows: [user] } = await pool.query('SELECT id, name FROM users WHERE email = $1 OR phone = $2', [email, phone]);
  if (!user) {
    console.error('No account with that email or phone.');
    process.exitCode = 1;
  } else {
    const { link, expiresAt } = await issueResetLink({ config }, pool, user.id);
    await pool.query(
      'INSERT INTO audit_logs (actor_user_id, action, target_type, target_id) VALUES ($1::uuid, \'auth.reset_link_from_server\', \'user\', $1::text)', [user.id]);
    console.log(`Password reset link for ${user.name} (works once, until ${expiresAt}):\n${link}`);
  }
} finally {
  await pool.end();
}
