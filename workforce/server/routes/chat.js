import * as chat from '../services/chat.js';
import { idParams, int, obj, oneOf, params, str, uuid } from '../lib/schema.js';

const ok = { ok: true };

export default async function chatRoutes(app) {
  app.get('/chat/threads', async (req) => chat.listThreads(app, req));
  app.get('/chat/unread', async (req) => chat.unreadCount(app, req));
  app.get('/chat/people', async (req) => chat.chatPeople(app, req));
  app.post('/chat/direct', { schema: { params: params(), body: obj({ membershipId: uuid }, ['membershipId']) } },
    async (req) => chat.openDirect(app, req, req.body));
  app.post('/chat/discuss', { schema: { params: params(), body: obj({ requestId: uuid }, ['requestId']) } },
    async (req) => chat.discuss(app, req, req.body.requestId));
  app.get('/chat/threads/:id/messages', {
    schema: { params: idParams, querystring: obj({ before: int(1), after: int(0), limit: int(1, 100) }) },
  }, async (req) => chat.messages(app, req, req.params.id, req.query));
  app.post('/chat/threads/:id/messages', {
    schema: { params: idParams, body: obj({ body: str(2000), refType: oneOf('shift_request'), refId: uuid }, ['body']) },
  }, async (req, reply) => reply.code(201).send(await chat.send(app, req, req.params.id, req.body)));
  app.delete('/chat/threads/:id/messages/:messageId', { schema: { params: params({ id: uuid, messageId: int(1) }) } },
    async (req) => { await chat.removeMessage(app, req, req.params.id, req.params.messageId); return ok; });
}
