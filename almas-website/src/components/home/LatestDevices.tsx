import { Link } from 'react-router-dom';
import { t } from '@/i18n';
import { useProducts } from '@/store/catalog';
import { Icon } from '@/components/ui/Icon';
import { ProductCard, ProductCardSkeleton } from '@/components/ui/ProductCard';
import { SectionHeading } from '@/components/ui/SectionHeading';

export function LatestDevices() {
  const { products, status } = useProducts();
  const devices = products
    .filter((p) => p.category === 'phones' || p.category === 'tablets')
    .sort((a, b) => Number(b.featured) - Number(a.featured) || Number(b.isNew) - Number(a.isNew) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);

  return (
    <section id="latest" className="section" data-cinematic>
      <div className="pointer-events-none absolute end-0 top-1/3 h-96 w-96 rounded-full bg-volt-600/10 blur-[120px]" data-speed="0.2" />
      <div className="container">
        <SectionHeading
          eyebrow={t.sections.latest.eyebrow}
          title={t.sections.latest.title}
          desc={t.sections.latest.desc}
          action={
            <Link to="/store?c=phones" className="btn-ghost">
              {t.sections.latest.cta}
              <Icon name="arrow" size={18} />
            </Link>
          }
        />
        <div data-stagger className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {status === 'loading'
            ? Array.from({ length: 4 }, (_, i) => <ProductCardSkeleton key={i} />)
            : devices.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </div>
    </section>
  );
}
