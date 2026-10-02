// All settings come from environment variables so secrets never live in the
// repository. See .env.example for the full list.

function bool(v, fallback) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const config = {
    env: env.NODE_ENV || 'development',
    production,
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    appUrl: (env.APP_URL || 'http://localhost:3000').replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5432/workforce_dev',
    trustProxy: bool(env.TRUST_PROXY, false),
    // 32-byte key, base64. Encrypts 2FA secrets and sensitive profile fields.
    encryptionKey: env.APP_ENCRYPTION_KEY || '',
    allowBusinessSignup: bool(env.ALLOW_BUSINESS_SIGNUP, true),
    cookieSecure: bool(env.COOKIE_SECURE, production),
    session: {
      idleDays: int(env.SESSION_IDLE_DAYS, 14),
      absoluteDays: int(env.SESSION_ABSOLUTE_DAYS, 60),
    },
    invitationDays: int(env.INVITATION_DAYS, 7),
    // Private files (receipts, documents, exports). Never inside web/.
    uploadDir: env.UPLOAD_DIR || new URL('../data/uploads', import.meta.url).pathname,
    maxUploadBytes: int(env.MAX_UPLOAD_MB, 10) * 1024 * 1024,
    // Background jobs (recurring expenses, alerts, report exports) run in this process.
    jobs: bool(env.RUN_JOBS, true),
    messaging: {
      // 'log' prints messages to the server log (development only).
      email: env.EMAIL_TRANSPORT || 'log',
      sms: env.SMS_TRANSPORT || 'log',
      emailFrom: env.EMAIL_FROM || 'Workforce <no-reply@localhost>',
      smtpUrl: env.SMTP_URL || '',
      twilioSid: env.TWILIO_ACCOUNT_SID || '',
      twilioToken: env.TWILIO_AUTH_TOKEN || '',
      twilioFrom: env.TWILIO_FROM || '',
    },
    logLevel: env.LOG_LEVEL || (production ? 'info' : 'warn'),
  };

  if (production) {
    if (Buffer.from(config.encryptionKey, 'base64').length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be 32 random bytes encoded as base64');
    }
    if (config.messaging.email === 'log' || config.messaging.sms === 'log') {
      throw new Error('Configure real EMAIL_TRANSPORT and SMS_TRANSPORT in production');
    }
  }
  if (!config.encryptionKey) {
    // Development fallback only. Production refuses to start without a key.
    config.encryptionKey = Buffer.alloc(32, 7).toString('base64');
  }
  return config;
}
