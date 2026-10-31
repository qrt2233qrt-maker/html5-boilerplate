const nf = new Intl.NumberFormat('en-US');

/** 1950000 → "1,950,000 د.ع" — أرقام لاتينية لوضوح الأسعار */
export const formatIQD = (value: number) => `${nf.format(Math.round(value))} د.ع`;

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export const discountPercent = (price: number, oldPrice?: number | null) =>
  oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : 0;

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .trim()
    .replace(/["'’`]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `p-${Date.now().toString(36)}`;

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
