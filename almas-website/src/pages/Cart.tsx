import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@/i18n';
import { formatIQD } from '@/lib/format';
import { repo, shortRef } from '@/lib/repo';
import { orderMessage, waLink } from '@/lib/whatsapp';
import { useScrollFx } from '@/hooks/useScrollFx';
import { cartTotal, useCart } from '@/store/cart';
import type { OrderInput } from '@/types';
import { CartLineRow } from '@/components/layout/CartDrawer';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { Seo } from '@/components/ui/Seo';

export default function Cart() {
  const ref = useRef<HTMLDivElement>(null);
  const { lines, clear } = useCart();
  const total = cartTotal(lines);
  const [form, setForm] = useState({ name: '', phone: '', address: '', notes: '' });
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useScrollFx(ref, [lines.length === 0]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!lines.length) return;
    setBusy(true);
    const order: OrderInput = {
      customerName: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      notes: form.notes.trim(),
      items: lines.map((l) => ({ productId: l.productId, name: l.name, price: l.price, qty: l.qty, color: l.color })),
      total,
    };
    let refCode = Date.now().toString(36).slice(-6).toUpperCase();
    try {
      const saved = await repo.createOrder(order);
      refCode = shortRef(saved.id);
    } catch {
      /* حتى لو فشل الحفظ، يبقى الطلب عبر WhatsApp متاحاً */
    }
    // رابط حقيقي بدل النوافذ المنبثقة — يعمل حتى مع مانعات النوافذ
    setSent(waLink(orderMessage(order, refCode)));
    setBusy(false);
    clear();
  };

  return (
    <div ref={ref}>
      <Seo title={t.cart.title} path="/cart" noindex />
      <PageHeader eyebrow={t.nav.cart} title={t.cart.title} />
      <div className="container pb-28">
        {sent ? (
          <div data-reveal="scale" className="card mx-auto flex max-w-xl flex-col items-center gap-5 p-12 text-center">
            <span className="grid h-20 w-20 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40">
              <Icon name="check" size={36} />
            </span>
            <p className="text-lg text-slate-200">{t.cart.sent}</p>
            <a href={sent} target="_blank" rel="noopener noreferrer" className="btn-wa h-14 w-full text-base">
              <Icon name="whatsapp" />
              {t.cart.sendNow}
            </a>
            <Link to="/store" className="text-sm text-volt-300 hover:text-white">{t.cart.emptyCta}</Link>
          </div>
        ) : lines.length === 0 ? (
          <div data-reveal className="card mx-auto flex max-w-xl flex-col items-center gap-5 p-12 text-center">
            <Icon name="cart" size={44} className="text-volt-400" />
            <p className="text-slate-400">{t.cart.empty}</p>
            <Link to="/store" className="btn-primary">{t.cart.emptyCta}</Link>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <div data-reveal className="space-y-3">
              {lines.map((l) => <CartLineRow key={l.key} line={l} />)}
            </div>
            <form data-reveal onSubmit={submit} className="card space-y-4 p-6 lg:sticky lg:top-28 lg:self-start">
              <h2 className="text-xl font-semibold">{t.cart.customer}</h2>
              <input className="field" required minLength={2} placeholder={t.cart.name} value={form.name} onChange={set('name')} autoComplete="name" />
              <input className="field ltr text-end" required type="tel" inputMode="tel" pattern="[0-9+ ]{7,20}" placeholder={t.cart.phone} value={form.phone} onChange={set('phone')} autoComplete="tel" />
              <input className="field" required placeholder={t.cart.address} value={form.address} onChange={set('address')} autoComplete="street-address" />
              <textarea className="field min-h-20 resize-none" placeholder={t.cart.notes} value={form.notes} onChange={set('notes')} />
              <div className="flex items-center justify-between border-t border-white/[.06] pt-4 text-lg">
                <span className="text-slate-400">{t.cart.subtotal}</span>
                <span className="font-display text-2xl font-bold text-white">{formatIQD(total)}</span>
              </div>
              <p className="text-xs text-slate-500">{t.cart.deliveryNote}</p>
              <button className="btn-wa h-14 w-full text-base" disabled={busy}>
                <Icon name="whatsapp" />
                {t.cart.checkout}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
