// In-app notification. Phase 12 adds preferences and email/SMS fan-out.
export async function notify(db, { businessId = null, userId, type, data = {} }) {
  await db.query(
    'INSERT INTO notifications (business_id, user_id, type, data) VALUES ($1, $2, $3, $4)',
    [businessId, userId, type, JSON.stringify(data)],
  );
}
