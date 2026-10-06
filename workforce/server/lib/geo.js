// Distance on the earth and the rotating door codes for the clock-in zone.
import { createHmac } from 'node:crypto';

const R = 6371000; // metres
const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance in metres between two points.
export function distanceM(lat1, lng1, lat2, lng2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// A 6-digit code for a location and time window. Screen codes change every
// minute (a photo of the door is useless a minute later); daily codes, for
// a printed sheet, change at midnight in the business's time zone.
export const SCREEN_WINDOW_S = 60;

function codeFor(secret, locationId, window) {
  const h = createHmac('sha256', secret).update(`${locationId}:${window}`).digest();
  return String(h.readUInt32BE(0) % 1000000).padStart(6, '0');
}

const localDay = (tz, ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ms));

export function currentDoorCode(location, timezone, now = Date.now()) {
  if (location.door_mode === 'daily') {
    const day = localDay(timezone, now);
    return { code: codeFor(location.door_secret, location.id, day), validUntil: null, day };
  }
  const w = Math.floor(now / 1000 / SCREEN_WINDOW_S);
  return { code: codeFor(location.door_secret, location.id, w), validUntil: new Date((w + 1) * SCREEN_WINDOW_S * 1000).toISOString() };
}

// Accepts the current code, and for screen codes the previous one too, so
// someone who scans just before the code changes isn't refused.
export function doorCodeValid(location, timezone, code, now = Date.now()) {
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  if (location.door_mode === 'daily') return c === codeFor(location.door_secret, location.id, localDay(timezone, now));
  const w = Math.floor(now / 1000 / SCREEN_WINDOW_S);
  return [w, w - 1].some((x) => codeFor(location.door_secret, location.id, x) === c);
}
