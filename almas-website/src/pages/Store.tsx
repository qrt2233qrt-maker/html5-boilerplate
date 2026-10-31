import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { categoryIds } from '@/data/seed';
import { t } from '@/i18n';
import { cx, formatIQD } from '@/lib/format';
import { gsap, prefersReducedMotion } from '@/lib/motion';
import { useScrollFx } from '@/hooks/useScrollFx';
import { useProducts } from '@/store/catalog';
import type { CategoryId } from '@/types';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProductCard, ProductCardSkeleton } from '@/components/ui/ProductCard';
import { Seo } from '@/components/ui/Seo';

type Sort = 'new' | 'low' | 'high';

const normalize = (s: string) =>
  s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();

export default function Store() {
  const ref = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const { products, status } = useProducts();
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);

  const category = (params.get('c') as CategoryId | null) ?? null;
  const q = params.get('q') ?? '';
  const brand = params.get('b') ?? '';
  const min = params.get('min') ?? '';
  const max = params.get('max') ?? '';
  const sort = (params.get('s') as Sort | null) ?? 'new';
  const dq = useDeferredValue(q);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const brands = useMemo(() => [...new Set(products.map((p) => p.brand).filter(Boolean))].sort(), [products]);
  const priceCeil = useMemo(() => Math.max(0, ...products.map((p) => p.price)), [products]);

  const filtered = useMemo(() => {
    const nq = normalize(dq);
    const lo = Number(min) || 0;
    const hi = Number(max) || Infinity;
    const list = products.filter(
      (p) =>
        (!category || p.category === category) &&
        (!brand || p.brand === brand) &&
        p.price >= lo &&
        p.price <= hi &&
        (!nq || normalize(`${p.name} ${p.brand} ${p.description} ${t.categories[p.category]}`).includes(nq)),
    );
    return list.sort((a, b) =>
      sort === 'low' ? a.price - b.price : sort === 'high' ? b.price - a.price : b.createdAt.localeCompare(a.createdAt),
    );
  }, [products, category, brand, min, max, sort, dq]);

  useScrollFx(ref, []);

  useLayoutEffect(() => {
    if (!grid.current || prefersReducedMotion()) return;
    const tween = gsap.fromTo(
      grid.current.children,
      { opacity: 0, y: 24, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'expo.out', stagger: 0.035, clearProps: 'transform' },
    );
    return () => {
      tween.kill();
    };
  }, [filtered]);

  const hasFilters = Boolean(category || q || brand || min || max || sort !== 'new');
  const presets = [
    { label: 'أقل من 50 ألف', min: '', max: '50000' },
    { label: '50 – 500 ألف', min: '50000', max: '500000' },
    { label: '500 ألف – مليون', min: '500000', max: '1000000' },
    { label: 'أكثر من مليون', min: '1000000', max: '' },
  ];

  return (
    <div ref={ref}>
      <Seo
        title={category ? `${t.categories[category]} — ${t.store.title}` : t.store.title}
        path={`/store${category ? `?c=${category}` : ''}`}
        description="تسوّق الهواتف الذكية، التابلت، السماعات، الشواحن، الكفرات والإكسسوارات الأصلية بأفضل الأسعار بالدينار العراقي في الناصرية."
      />
      <PageHeader eyebrow={t.nav.store} title={t.store.subtitle}>
        <div data-reveal data-delay="0.25" className="relative mt-10 max-w-2xl">
          <Icon name="search" className="pointer-events-none absolute start-5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            className="field h-16 rounded-full ps-14 text-base"
            placeholder={t.store.search}
            value={q}
            onChange={(e) => update('q', e.target.value)}
            aria-label={t.store.search}
          />
        </div>
      </PageHeader>

      <div className="container pb-28">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-2" data-lenis-prevent>
          <button className={cx('chip', !category && 'chip-active')} onClick={() => update('c', '')}>{t.categories.all}</button>
          {categoryIds.map((c) => (
            <button key={c} className={cx('chip', category === c && 'chip-active')} onClick={() => update('c', c)}>
              {t.categories[c]}
            </button>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <button className="btn-ghost btn-sm mb-4 w-full lg:hidden" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
              <Icon name="filter" size={18} />
              {t.store.filters}
            </button>
            <div className={cx('card space-y-7 p-6', !showFilters && 'hidden lg:block')}>
              <div>
                <label className="label" htmlFor="sort">{t.store.sort}</label>
                <select id="sort" className="field" value={sort} onChange={(e) => update('s', e.target.value === 'new' ? '' : e.target.value)}>
                  <option value="new">{t.store.sortNew}</option>
                  <option value="low">{t.store.sortLow}</option>
                  <option value="high">{t.store.sortHigh}</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="brand">{t.store.brand}</label>
                <select id="brand" className="field" value={brand} onChange={(e) => update('b', e.target.value)}>
                  <option value="">{t.store.allBrands}</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <span className="label">{t.store.price}</span>
                <div className="grid grid-cols-2 gap-2">
                  <input className="field ltr" inputMode="numeric" type="number" min={0} placeholder={t.store.min} value={min} onChange={(e) => update('min', e.target.value)} aria-label={t.store.min} />
                  <input className="field ltr" inputMode="numeric" type="number" min={0} placeholder={t.store.max} value={max} onChange={(e) => update('max', e.target.value)} aria-label={t.store.max} />
                </div>
                {priceCeil > 0 && (
                  <input
                    type="range"
                    min={0}
                    max={priceCeil}
                    step={5000}
                    value={Number(max) || priceCeil}
                    onChange={(e) => update('max', Number(e.target.value) >= priceCeil ? '' : e.target.value)}
                    className="mt-4 w-full accent-volt-500"
                    aria-label="الحد الأعلى للسعر"
                  />
                )}
                <div className="mt-1 flex justify-between text-xs text-slate-500">
                  <span>{formatIQD(0)}</span>
                  <span>{formatIQD(Number(max) || priceCeil)}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {presets.map((p) => (
                    <button
                      key={p.label}
                      className={cx('chip px-3 py-1.5 text-xs', min === p.min && max === p.max && 'chip-active')}
                      onClick={() => {
                        const next = new URLSearchParams(params);
                        p.min ? next.set('min', p.min) : next.delete('min');
                        p.max ? next.set('max', p.max) : next.delete('max');
                        setParams(next, { replace: true });
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {hasFilters && (
                <button className="w-full text-sm text-volt-300 hover:text-white" onClick={() => setParams({}, { replace: true })}>
                  {t.store.reset}
                </button>
              )}
            </div>
          </aside>

          <div>
            <p className="mb-4 text-sm text-slate-500"><span className="ltr">{filtered.length}</span> {t.store.results}</p>
            {status === 'loading' ? (
              <div className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-3">
                {Array.from({ length: 6 }, (_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="card flex flex-col items-center gap-4 p-16 text-center">
                <Icon name="search" size={40} className="text-volt-400" />
                <p className="text-slate-400">{t.store.empty}</p>
                <button className="btn-ghost btn-sm" onClick={() => setParams({}, { replace: true })}>{t.store.reset}</button>
              </div>
            ) : (
              <div ref={grid} className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-3">
                {filtered.map((p) => <ProductCard key={p.id} product={p} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
