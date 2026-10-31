import { site } from '@/config/site';
import { formatIQD } from './format';
import type { BookingInput, OrderInput, Product } from '@/types';

export const waLink = (message?: string) =>
  `https://wa.me/${site.whatsapp}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

export const openWhatsApp = (message?: string) => {
  window.open(waLink(message), '_blank', 'noopener,noreferrer');
};

export const productMessage = (p: Product, qty = 1, color?: string) =>
  [
    `مرحباً ${site.nameAr} 👋`,
    `أرغب بطلب المنتج التالي:`,
    `• ${p.name}${color ? ` (اللون: ${color})` : ''}`,
    `• الكمية: ${qty}`,
    `• السعر: ${formatIQD(p.price * qty)}`,
    `${site.siteUrl}/product/${p.slug}`,
  ].join('\n');

export const orderMessage = (o: OrderInput, ref: string) =>
  [
    `🛒 طلب جديد من موقع ${site.nameAr}`,
    `رقم الطلب: ${ref}`,
    '',
    ...o.items.map((i) => `• ${i.name}${i.color ? ` (${i.color})` : ''} × ${i.qty} = ${formatIQD(i.price * i.qty)}`),
    '',
    `💰 المجموع: ${formatIQD(o.total)}`,
    '',
    `👤 الاسم: ${o.customerName}`,
    `📞 الهاتف: ${o.phone}`,
    `📍 العنوان: ${o.address}`,
    o.notes ? `📝 ملاحظات: ${o.notes}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');

export const bookingMessage = (b: BookingInput, ref: string) =>
  [
    `🔧 حجز موعد صيانة — ${site.nameAr}`,
    `رقم الحجز: ${ref}`,
    `👤 الاسم: ${b.name}`,
    `📞 الهاتف: ${b.phone}`,
    `📱 الجهاز: ${b.device}`,
    `🛠 الخدمة: ${b.service}`,
    `📅 الموعد: ${b.date} – ${b.time}`,
    b.issue ? `📝 المشكلة: ${b.issue}` : '',
  ]
    .filter(Boolean)
    .join('\n');
