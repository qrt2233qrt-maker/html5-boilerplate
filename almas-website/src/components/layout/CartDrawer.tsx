import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@/i18n';
import { cx, formatIQD } from '@/lib/format';
import { lockScroll } from '@/lib/motion';
import { cartTotal, useCart, type CartLine } from '@/store/cart';
import { Icon } from '@/components/ui/Icon';
import { ProductMedia } from '@/components/ui/ProductMedia';

export function CartLineRow({ line }: { line: CartLine }) {
  const setQty = useCart((s) => s.setQty);
  const remove = useCart((s) => s.remove);
  return (
    <div className="group flex gap-4 rounded-2xl border border-white/[.06] bg-white/[.02] p-3">
      <Link to={`/product/${line.slug}`} className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-ink-800">
        <ProductMedia
          product={{ images: line.image ? [line.image] : [], category: line.category, name: line.name, colors: line.color ? [line.color] : [] }}
          className="h-full w-full p-1.5"
          reflect={false}
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <Link to={`/product/${line.slug}`} className="line-clamp-1 font-semibold text-white hover:text-volt-200">{line.name}</Link>
          <button onClick={() => remove(line.key)} className="text-slate-500 transition hover:text-rose-400" aria-label={t.cart.remove}>
            <Icon name="trash" size={18} />
          </button>
        </div>
        {line.color && (
          <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-3 w-3 rounded-full ring-1 ring-white/20" style={{ background: line.color }} />
            {t.product.colors}
          </span>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <div className="flex items-center rounded-full border border-white/10">
            <button className="grid h-8 w-8 place-items-center text-slate-300 hover:text-white" onClick={() => setQty(line.key, line.qty + 1)} aria-label="زيادة">
              <Icon name="plus" size={16} />
            </button>
            <span className="ltr w-6 text-center text-sm font-semibold">{line.qty}</span>
            <button className="grid h-8 w-8 place-items-center text-slate-300 hover:text-white" onClick={() => setQty(line.key, line.qty - 1)} aria-label="إنقاص">
              <Icon name="minus" size={16} />
            </button>
          </div>
          <span className="font-display font-semibold text-white">{formatIQD(line.price * line.qty)}</span>
        </div>
      </div>
    </div>
  );
}

export function CartDrawer() {
  const { open, setOpen, lines } = useCart();
  const total = cartTotal(lines);

  useEffect(() => {
    lockScroll(open);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <div className={cx('fixed inset-0 z-[60]', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open}>
      <div
        className={cx('absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-500', open ? 'opacity-100' : 'opacity-0')}
        onClick={() => setOpen(false)}
      />
      <aside
        role="dialog"
        aria-label={t.cart.title}
        data-lenis-prevent
        className={cx(
          'absolute inset-y-0 end-0 flex w-full max-w-md flex-col border-s border-white/10 bg-ink-900/95 backdrop-blur-2xl transition-transform duration-[650ms] ease-[cubic-bezier(.16,1,.3,1)]',
          open ? 'translate-x-0' : 'ltr:translate-x-full rtl:-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between border-b border-white/[.06] p-5">
          <h2 className="text-xl font-bold">{t.cart.title}</h2>
          <button onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 hover:border-volt-400/60" aria-label={t.nav.close}>
            <Icon name="close" />
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
            <div className="grid h-24 w-24 place-items-center rounded-full bg-volt-500/10 text-volt-300 ring-1 ring-volt-500/30">
              <Icon name="cart" size={40} />
            </div>
            <p className="text-slate-400">{t.cart.empty}</p>
            <Link to="/store" onClick={() => setOpen(false)} className="btn-primary">{t.cart.emptyCta}</Link>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {lines.map((l) => <CartLineRow key={l.key} line={l} />)}
            </div>
            <div className="pb-safe space-y-3 border-t border-white/[.06] p-5">
              <div className="flex items-center justify-between text-lg">
                <span className="text-slate-400">{t.cart.subtotal}</span>
                <span className="font-display font-bold text-white">{formatIQD(total)}</span>
              </div>
              <p className="text-xs text-slate-500">{t.cart.deliveryNote}</p>
              <Link to="/cart" onClick={() => setOpen(false)} className="btn-primary btn-shine w-full">
                {t.cart.checkout}
              </Link>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
