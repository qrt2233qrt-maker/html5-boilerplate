// Writes one append-only audit entry. Pass the transaction client so the
// entry commits or rolls back together with the change it describes.
export async function audit(db, req, { businessId = null, action, targetType = null, targetId = null, before = null, after = null, actorId }) {
  await db.query(
    `INSERT INTO audit_logs
       (business_id, actor_user_id, action, target_type, target_id, before, after, ip, user_agent, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      businessId,
      actorId ?? req?.auth?.user?.id ?? null,
      action,
      targetType,
      targetId === null ? null : String(targetId),
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after),
      req?.ip ?? null,
      req?.headers?.['user-agent']?.slice(0, 300) ?? null,
      req?.id ?? null,
    ],
  );
}
