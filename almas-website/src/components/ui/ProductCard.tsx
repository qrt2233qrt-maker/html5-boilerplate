import { Link } from 'react-router-dom';
import type { Product } from '@/types';
import { t } from '@/i18n';
import { discountPercent, formatIQD } from '@/lib/format';
import { useCart } from '@/store/cart';
import { useTilt } from '@/hooks/useTilt';
import { Icon } from './Icon';
import { ProductMedia } from './ProductMedia';

export function ProductCard({ product }: { product: Product }) {
  const tilt = useTilt<HTMLElement>(7);
  const add = useCart((s) => s.add);
  const off = discountPercent(product.price, product.oldPrice);
  const out = product.stock <= 0;

  return (
    <article
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      className="card group flex h-full flex-col p-4 transition-[transform,border-color,box-shadow] duration-300 ease-out hover:border-volt-500/40 hover:shadow-glow sm:p-5"
      style={{ transformStyle: 'preserve-3d' }}
    >
      <span className="glare" />
      <div className="absolute start-4 top-4 z-[2] flex gap-1.5">
        {product.isNew && <span className="rounded-full bg-volt-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-glow">{t.product.new}</span>}
        {off > 0 && <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-volt-100 backdrop-blur">-{off}%</span>}
      </div>

      <Link to={`/product/${product.slug}`} className="relative block" aria-label={product.name}>
        <div className="relative mx-auto aspect-square w-full overflow-hidden rounded-2xl bg-[radial-gradient(ellipse_at_top,rgba(47,123,255,.12),transparent_65%)]">
          <ProductMedia product={product} className="h-full w-full p-6" reflect={false} />
        </div>
      </Link>

      <div className="mt-4 flex flex-1 flex-col" style={{ transform: 'translateZ(30px)' }}>
        <span className="text-xs font-medium uppercase tracking-[.2em] text-volt-300/80">{product.brand}</span>
        <Link to={`/product/${product.slug}`} className="mt-1.5 line-clamp-1 font-display text-lg font-semibold text-white transition-colors hover:text-volt-200">
          {product.name}
        </Link>
        {product.colors.length > 0 && (
          <div className="mt-2.5 flex gap-1.5">
            {product.colors.slice(0, 5).map((c) => (
              <span key={c} className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20" style={{ background: c }} />
            ))}
          </div>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <div className="flex flex-col">
            {off > 0 && <span className="text-xs text-slate-500 line-through">{formatIQD(product.oldPrice!)}</span>}
            <span className="font-display text-lg font-bold text-white">{formatIQD(product.price)}</span>
          </div>
          <button
            type="button"
            disabled={out}
            onClick={() => add(product, 1, product.colors[0])}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-volt-500/15 text-volt-200 ring-1 ring-volt-500/40 transition-all duration-300 hover:scale-110 hover:bg-volt-500 hover:text-white hover:shadow-glow active:scale-95 disabled:opacity-40"
            aria-label={`${t.product.addToCart}: ${product.name}`}
            title={out ? t.product.outOfStock : t.product.addToCart}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="card h-[420px] p-5">
      <div className="aspect-square w-full animate-pulse rounded-2xl bg-white/[.04]" />
      <div className="mt-5 h-3 w-16 animate-pulse rounded bg-white/[.06]" />
      <div className="mt-3 h-5 w-40 animate-pulse rounded bg-white/[.06]" />
      <div className="mt-6 h-5 w-24 animate-pulse rounded bg-white/[.06]" />
    </div>
  );
}
