import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { randomToken } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { can } from '../auth/session.js';
import { auditB, inScope } from '../lib/context.js';
import { rateLimit } from '../lib/rate-limit.js';

// Allowed uploads, recognised by their first bytes (the declared type and
// file name are not trusted).
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString() === '%PDF-' },
];

export function sniff(buf) {
  return SIGNATURES.find((s) => buf.length > 12 && s.test(buf)) || null;
}

const safeName = (name, ext) => {
  const base = String(name || 'file').replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/\.[^.]*$/, '').slice(0, 80).trim() || 'file';
  return `${base}.${ext}`;
};

async function store(app, buf) {
  const key = randomToken();
  const dir = path.join(app.config.uploadDir, key.slice(0, 2));
  await mkdir(dir, { recursive: true });
  // Writing an uploaded file is the point here. What makes it safe: the
  // name is random (never from the client), callers check the type from the
  // contents and the size first, and the folder is outside the web root.
  await writeFile(path.join(dir, key), buf, { mode: 0o600 });
  return key;
}

// Saves an uploaded file (base64) after checking its real type and size.
export async function saveUpload(app, req, db, { data, filename, kind, membershipId = null }) {
  // Keeps one account from filling the disk: 100 files an hour each.
  await rateLimit(app.db, `upload:${req.auth.user.id}`, 100, 3600);
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) throw badRequest('empty_file', 'The file is empty.');
  if (buf.length > app.config.maxUploadBytes) throw badRequest('file_too_large', 'The file is too large.');
  const type = sniff(buf);
  if (!type) throw badRequest('file_type', 'Upload a photo (JPEG, PNG, WebP) or a PDF.');
  const key = await store(app, buf);
  const { rows: [doc] } = await db.query(
    `INSERT INTO documents (business_id, membership_id, kind, filename, mime, size, sha256, storage_key, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, filename, mime, size, kind, created_at`,
    [req.member.businessId, membershipId, kind, safeName(filename, type.ext), type.mime, buf.length,
      createHash('sha256').update(buf).digest('hex'), key, req.auth.user.id]);
  await auditB(db, req, { action: 'document.uploaded', targetType: 'document', targetId: doc.id, after: { kind, filename: doc.filename, size: doc.size } });
  return doc;
}

// Internal files we generate ourselves (report exports).
export async function saveGenerated(app, db, { businessId, userId, filename, mime, buf }) {
  const key = await store(app, buf);
  const { rows: [doc] } = await db.query(
    `INSERT INTO documents (business_id, kind, filename, mime, size, sha256, storage_key, uploaded_by)
     VALUES ($1, 'export', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [businessId, filename, mime, buf.length, createHash('sha256').update(buf).digest('hex'), key, userId]);
  return doc.id;
}

// Who may open a file depends on what it's attached to.
async function mayRead(req, doc) {
  if (req.member.role === 'owner' || doc.uploaded_by === req.auth.user.id) return true;
  if (doc.membership_id && doc.membership_id === req.member.id) return true;
  const db = req.server.db;
  if (doc.kind === 'export') return false;
  const exp = await db.query('SELECT membership_id FROM employee_expenses WHERE receipt_document_id = $1', [doc.id]);
  if (exp.rows[0]) {
    if (exp.rows[0].membership_id === req.member.id) return true;
    return can(req, 'employee_expenses.review') && (await inScope(req, exp.rows[0].membership_id));
  }
  const biz = await db.query('SELECT 1 FROM business_expenses WHERE document_id = $1', [doc.id]);
  if (biz.rows[0]) return can(req, 'business_expenses.view');
  if (doc.membership_id) return can(req, 'members.view_sensitive') && (await inScope(req, doc.membership_id));
  return false;
}

export async function readDocument(app, req, id) {
  const { rows: [doc] } = await app.db.query(
    'SELECT * FROM documents WHERE id = $1 AND business_id = $2 AND archived_at IS NULL', [id, req.member.businessId]);
  if (!doc) throw notFound();
  if (!(await mayRead(req, doc))) throw forbidden();
  const buf = await readFile(path.join(app.config.uploadDir, doc.storage_key.slice(0, 2), doc.storage_key));
  return { doc, buf };
}

export async function listMemberDocuments(app, req, membershipId) {
  const { rows } = await app.db.query(
    `SELECT id, kind, filename, mime, size, created_at FROM documents
      WHERE business_id = $1 AND membership_id = $2 AND kind IN ('contract', 'document') AND archived_at IS NULL
      ORDER BY created_at DESC`, [req.member.businessId, membershipId]);
  return rows;
}

export async function archiveDocument(app, req, id) {
  const { rows: [doc] } = await app.db.query('SELECT * FROM documents WHERE id = $1 AND business_id = $2', [id, req.member.businessId]);
  if (!doc) throw notFound();
  if (req.member.role !== 'owner' && doc.uploaded_by !== req.auth.user.id) throw forbidden();
  await app.db.query('UPDATE documents SET archived_at = now() WHERE id = $1', [id]);
  await auditB(app.db, req, { action: 'document.archived', targetType: 'document', targetId: id, before: { filename: doc.filename } });
}
