import { Link } from 'react-router-dom';
import { accessoryCategories } from '@/data/seed';
import { t } from '@/i18n';
import { useProducts } from '@/store/catalog';
import { useTilt } from '@/hooks/useTilt';
import type { CategoryId } from '@/types';
import { DeviceArt } from '@/components/ui/DeviceArt';
import { Icon } from '@/components/ui/Icon';
import { ProductCard } from '@/components/ui/ProductCard';
import { SectionHeading } from '@/components/ui/SectionHeading';

const tileColor: Record<string, string> = { headphones: '#e9edf5', chargers: '#1d1f24', cases: '#2f7bff', accessories: '#1c1d21' };

function CategoryTile({ id, count }: { id: CategoryId; count: number }) {
  const tilt = useTilt<HTMLAnchorElement>(10);
  return (
    <Link
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      to={`/store?c=${id}`}
      className="card group flex aspect-[4/5] flex-col justify-between p-5 transition-[transform,border-color] duration-300 hover:border-volt-500/40 sm:aspect-[4/4.4]"
    >
      <span className="glare" />
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-semibold text-white sm:text-xl">{t.categories[id]}</span>
        <span className="grid h-9 w-9 place-items-center rounded-full border border-white/10 text-slate-400 transition group-hover:rotate-45 group-hover:border-volt-400 group-hover:bg-volt-500 group-hover:text-white">
          <Icon name="arrowUpLeft" size={16} />
        </span>
      </div>
      <DeviceArt category={id} name={id === 'accessories' ? 'watch' : ''} color={tileColor[id]} className="mx-auto h-[62%] w-[62%] transition-transform duration-700 group-hover:-translate-y-2 group-hover:scale-110" />
      <span className="text-sm text-slate-500"><span className="ltr">{count}</span> {t.store.results}</span>
    </Link>
  );
}

export function Accessories() {
  const { products } = useProducts();
  const items = products.filter((p) => accessoryCategories.includes(p.category));
  const featured = items.filter((p) => p.featured).slice(0, 4);

  return (
    <section className="section overflow-hidden" data-cinematic>
      <div className="pointer-events-none absolute start-0 top-0 h-[30rem] w-[30rem] rounded-full bg-volt-700/10 blur-[140px]" data-speed="-0.15" />
      <div className="container">
        <SectionHeading
          eyebrow={t.sections.accessories.eyebrow}
          title={t.sections.accessories.title}
          desc={t.sections.accessories.desc}
          action={
            <Link to="/store?c=headphones" className="btn-ghost">
              {t.sections.accessories.cta}
              <Icon name="arrow" size={18} />
            </Link>
          }
        />
        <div data-stagger className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {accessoryCategories.map((c) => (
            <CategoryTile key={c} id={c} count={items.filter((p) => p.category === c).length} />
          ))}
        </div>
        {featured.length > 0 && (
          <div data-stagger className="mt-5 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
            {featured.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </div>
    </section>
  );
}
