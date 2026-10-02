import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPool } from './db/pool.js';
import { AppError } from './lib/errors.js';
import { sessionPlugin } from './auth/session.js';
import { createOutbox, createTransports } from './messaging/outbox.js';
import authRoutes from './routes/auth.js';
import businessRoutes from './routes/business.js';

const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Builds the app without listening, so tests can drive it with inject().
// options.transports replaces email/SMS delivery (tests capture messages).
export async function buildApp(config, options = {}) {
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: config.trustProxy,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', allErrors: false } },
  });

  app.decorate('config', config);
  app.decorate('db', options.pool ?? createPool(config.databaseUrl));
  app.decorate('outbox', createOutbox(app.db, options.transports ?? createTransports(config, app.log), app.log));

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ['\'self\''],
        scriptSrc: ['\'self\''],
        styleSrc: ['\'self\'', 'https://fonts.googleapis.com'],
        fontSrc: ['\'self\'', 'https://fonts.gstatic.com'],
        imgSrc: ['\'self\'', 'data:', 'blob:'],
        connectSrc: ['\'self\''],
        frameAncestors: ['\'none\''],
        formAction: ['\'self\''],
        objectSrc: ['\'none\''],
        baseUri: ['\'self\''],
        upgradeInsecureRequests: config.production ? [] : null,
      },
    },
    strictTransportSecurity: config.production,
  });

  sessionPlugin(app);

  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // Users get a clear message and a request ID; the full error goes to the log.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    }
    if (err.validation) {
      return reply.code(400).send({ error: { code: 'invalid_input', message: 'Some of the information entered isn\'t valid. Check it and try again.', details: err.validation.map((v) => ({ field: v.instancePath || v.params?.missingProperty, rule: v.keyword })), requestId: req.id } });
    }
    if (err.statusCode === 415 || err.statusCode === 413 || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return reply.code(err.statusCode || 400).send({ error: { code: 'bad_request', message: 'The request couldn\'t be read.', requestId: req.id } });
    }
    req.log.error({ err }, 'Unhandled error');
    return reply.code(500).send({ error: { code: 'server_error', message: 'Something went wrong on our side. Please try again.', requestId: req.id } });
  });

  await app.register(authRoutes);
  await app.register(businessRoutes, { prefix: '/api/b/:businessId' });

  app.get('/api/health', async () => {
    await app.db.query('SELECT 1');
    return { ok: true };
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'not_found', message: 'This item could not be found.', requestId: req.id } });
    }
    return reply.sendFile('index.html');
  });
  await app.register(fastifyStatic, { root: webRoot, index: 'index.html', cacheControl: true, maxAge: 0 });

  app.addHook('onClose', async () => {
    if (!options.pool) await app.db.end();
  });
  return app;
}
