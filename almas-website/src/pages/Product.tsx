import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { site } from '@/config/site';
import { t } from '@/i18n';
import { cx, discountPercent, formatIQD } from '@/lib/format';
import { gsap } from '@/lib/motion';
import { productMessage, waLink } from '@/lib/whatsapp';
import { useScrollFx } from '@/hooks/useScrollFx';
import { useTilt } from '@/hooks/useTilt';
import { useCart } from '@/store/cart';
import { useProducts } from '@/store/catalog';
import { Icon } from '@/components/ui/Icon';
import { ProductCard } from '@/components/ui/ProductCard';
import { ProductMedia } from '@/components/ui/ProductMedia';
import { Seo } from '@/components/ui/Seo';

export default function ProductPage() {
  const { slug = '' } = useParams();
  const { products, status } = useProducts();
  const product = products.find((p) => p.slug === decodeURIComponent(slug));
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const tilt = useTilt<HTMLDivElement>(10);
  const add = useCart((s) => s.add);
  const [img, setImg] = useState(0);
  const [color, setColor] = useState<string | undefined>();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setImg(0);
    setQty(1);
    setColor(product?.colors[0]);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (stage.current) gsap.fromTo(stage.current, { opacity: 0.4, scale: 0.94, rotateY: -10 }, { opacity: 1, scale: 1, rotateY: 0, duration: 0.9, ease: 'expo.out' });
  }, [img, color]);

  useScrollFx(ref, [product?.id]);

  if (!product) {
    if (status !== 'ready' && status !== 'error') return <div className="min-h-screen pt-40 text-center text-slate-500">{t.common.loading}</div>;
    return (
      <div className="container flex min-h-[80vh] flex-col items-center justify-center gap-6 pt-28 text-center">
        <Seo title={t.product.notFound} noindex />
        <h1 className="text-3xl font-bold">{t.product.notFound}</h1>
        <Link to="/store" className="btn-primary">{t.product.back}</Link>
      </div>
    );
  }

  const off = discountPercent(product.price, product.oldPrice);
  const stockLabel = product.stock <= 0 ? t.product.outOfStock : product.stock <= 3 ? t.product.lowStock : t.product.inStock;
  const related = products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4);
  const imageCount = Math.max(1, product.images.length);

  const onAdd = () => {
    add(product, qty, color);
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  };

  return (
    <div ref={ref}>
      <Seo
        title={product.name}
        path={`/product/${product.slug}`}
        description={`${product.name} — ${product.description}`.slice(0, 160)}
        image={product.images[0]}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          brand: { '@type': 'Brand', name: product.brand },
          description: product.description,
          image: product.images,
          sku: product.id,
          offers: {
            '@type': 'Offer',
            priceCurrency: 'IQD',
            price: product.price,
            availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${site.siteUrl}/product/${product.slug}`,
            seller: { '@type': 'Organization', name: site.nameAr },
          },
        }}
      />

      <section className="relative overflow-hidden pb-20 pt-32 md:pt-40">
        <div className="grid-bg absolute inset-0 -z-10" />
        <div className="container">
          <nav className="mb-8 flex items-center gap-2 text-sm text-slate-500" aria-label="مسار التنقل">
            <Link to="/" className="hover:text-white">{t.nav.home}</Link>/
            <Link to={`/store?c=${product.category}`} className="hover:text-white">{t.categories[product.category]}</Link>/
            <span className="line-clamp-1 text-slate-300">{product.name}</span>
          </nav>

          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            {/* المعرض */}
            <div data-reveal="scale" className="lg:sticky lg:top-28 lg:self-start">
              <div
                ref={tilt.ref}
                onPointerMove={tilt.onPointerMove}
                onPointerLeave={tilt.onPointerLeave}
                className="card group relative aspect-square transition-transform duration-300 ease-out"
                style={{ transformStyle: 'preserve-3d' }}
              >
                <span className="glare" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(47,123,255,.18),transparent_60%)]" />
                <div ref={stage} className="absolute inset-0" style={{ perspective: 1000 }}>
                  <ProductMedia product={product} index={img} color={color} priority className="h-full w-full p-10 sm:p-16" />
                </div>
                {off > 0 && <span className="absolute start-5 top-5 rounded-full bg-volt-500 px-3 py-1.5 text-sm font-bold text-white shadow-glow">-{off}%</span>}
              </div>
              {imageCount > 1 && (
                <div className="no-scrollbar mt-4 flex gap-3 overflow-x-auto">
                  {product.images.map((src, i) => (
                    <button
                      key={src + i}
                      onClick={() => setImg(i)}
                      className={cx('h-20 w-20 shrink-0 overflow-hidden rounded-2xl border bg-ink-850 p-2 transition', i === img ? 'border-volt-500 shadow-glow' : 'border-white/10 hover:border-white/30')}
                      aria-label={`صورة ${i + 1}`}
                    >
                      <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* التفاصيل */}
            <div>
              <span data-reveal className="block text-sm font-semibold uppercase tracking-[.25em] text-volt-300">{product.brand}</span>
              <h1 data-reveal className="mt-3 text-4xl font-bold leading-tight md:text-5xl">{product.name}</h1>
              <div data-reveal className="mt-6 flex flex-wrap items-end gap-4">
                <span className="font-display text-3xl font-bold text-white md:text-4xl">{formatIQD(product.price)}</span>
                {off > 0 && <span className="pb-1 text-lg text-slate-500 line-through">{formatIQD(product.oldPrice!)}</span>}
                <span className={cx('mb-1 rounded-full px-3 py-1 text-xs font-semibold', product.stock > 0 ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30')}>
                  {stockLabel}
                </span>
              </div>
              <p data-reveal className="mt-6 text-lg leading-9 text-slate-400">{product.description}</p>

              {product.colors.length > 0 && (
                <div data-reveal className="mt-8">
                  <span className="label">{t.product.colors}</span>
                  <div className="flex flex-wrap gap-3">
                    {product.colors.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={cx('h-11 w-11 rounded-full ring-2 ring-offset-4 ring-offset-ink-950 transition hover:scale-110', color === c ? 'ring-volt-500' : 'ring-white/10')}
                        style={{ background: `radial-gradient(circle at 30% 30%, #ffffff55, transparent 45%), ${c}` }}
                        aria-label={`اللون ${c}`}
                        aria-pressed={color === c}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div data-reveal className="mt-8 flex flex-wrap items-center gap-3">
                <div className="flex h-14 items-center rounded-full border border-white/10 bg-white/[.03]">
                  <button className="grid h-14 w-12 place-items-center text-slate-300 hover:text-white" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="زيادة"><Icon name="plus" /></button>
                  <span className="ltr w-8 text-center font-display text-lg font-semibold">{qty}</span>
                  <button className="grid h-14 w-12 place-items-center text-slate-300 hover:text-white" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="إنقاص"><Icon name="minus" /></button>
                </div>
                <button className="btn-primary btn-shine h-14 flex-1 text-base" disabled={product.stock <= 0} onClick={onAdd}>
                  <Icon name={added ? 'check' : 'cart'} />
                  {added ? t.product.added : t.product.addToCart}
                </button>
              </div>
              <a data-reveal href={waLink(productMessage(product, qty, color))} target="_blank" rel="noopener noreferrer" className="btn-wa mt-3 h-14 w-full text-base">
                <Icon name="whatsapp" />
                {t.product.orderWhatsapp}
              </a>

              <div data-reveal className="mt-8 grid grid-cols-3 gap-3">
                {[
                  { i: 'shield' as const, l: t.product.original },
                  { i: 'badge' as const, l: t.product.warranty },
                  { i: 'truck' as const, l: t.product.delivery },
                ].map((f) => (
                  <div key={f.l} className="flex flex-col items-center gap-2 rounded-2xl border border-white/[.06] bg-white/[.02] p-4 text-center text-xs text-slate-300 sm:text-sm">
                    <Icon name={f.i} className="text-volt-400" />
                    {f.l}
                  </div>
                ))}
              </div>

              {product.specs.length > 0 && (
                <div data-reveal className="card mt-8 p-6">
                  <h2 className="mb-4 text-xl font-semibold">{t.product.specs}</h2>
                  <dl className="divide-y divide-white/[.06]">
                    {product.specs.map((s) => (
                      <div key={s.label} className="flex justify-between gap-6 py-3.5">
                        <dt className="text-slate-500">{s.label}</dt>
                        <dd className="text-end font-medium text-white">{s.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {related.length > 0 && (
        <section className="pb-28">
          <div className="container">
            <h2 data-reveal className="mb-8 text-3xl font-bold">{t.product.related}</h2>
            <div data-stagger className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
              {related.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
