import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { repo } from '@/lib/repo';
import { cx } from '@/lib/format';
import { useProducts } from '@/store/catalog';
import { AdminLogin } from '@/components/admin/AdminLogin';
import { ProductsPanel } from '@/components/admin/ProductsPanel';
import { BookingsPanel, OrdersPanel } from '@/components/admin/RequestsPanel';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';
import { Seo } from '@/components/ui/Seo';

type Tab = 'products' | 'bookings' | 'orders';
const tabs: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'products', label: 'المنتجات', icon: 'box' },
  { id: 'bookings', label: 'حجوزات الصيانة', icon: 'calendar' },
  { id: 'orders', label: 'الطلبات', icon: 'receipt' },
];

export default function Admin() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking');
  const [tab, setTab] = useState<Tab>('products');
  const { products } = useProducts();

  useEffect(() => {
    repo.isAdmin().then((ok) => setAuth(ok ? 'in' : 'out')).catch(() => setAuth('out'));
  }, []);

  if (auth === 'checking') return <div className="grid min-h-screen place-items-center text-slate-500"><Seo title="لوحة التحكم" noindex />جارِ التحقق…</div>;
  if (auth === 'out') return <><Seo title="لوحة التحكم" noindex /><AdminLogin onDone={() => setAuth('in')} /></>;

  return (
    <div className="min-h-screen">
      <Seo title="لوحة التحكم" noindex />
      <header className="sticky top-0 z-30 border-b border-white/[.06] bg-ink-950/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-4">
          <Link to="/" aria-label="الموقع"><Logo /></Link>
          <div className="flex items-center gap-3">
            {repo.mode === 'demo' && <span className="hidden rounded-full bg-amber-400/10 px-3 py-1 text-xs text-amber-200 ring-1 ring-amber-400/30 sm:inline">وضع تجريبي</span>}
            <button
              className="btn-ghost btn-sm"
              onClick={async () => { await repo.signOut(); setAuth('out'); }}
            >
              <Icon name="logout" size={18} />
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="mb-8 grid grid-cols-3 gap-3">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              onClick={() => setTab(tb.id)}
              className={cx('card flex flex-col items-start gap-2 p-4 text-start transition sm:flex-row sm:items-center sm:gap-3 sm:p-5', tab === tb.id ? 'border-volt-500/60 shadow-glow' : 'hover:border-white/20')}
            >
              <span className={cx('grid h-10 w-10 place-items-center rounded-xl', tab === tb.id ? 'bg-volt-500 text-white' : 'bg-white/5 text-slate-400')}>
                <Icon name={tb.icon} size={20} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-white sm:text-base">{tb.label}</span>
                {tb.id === 'products' && <span className="text-xs text-slate-500">{products.length} منتج</span>}
              </span>
            </button>
          ))}
        </div>
        {tab === 'products' && <ProductsPanel />}
        {tab === 'bookings' && <BookingsPanel />}
        {tab === 'orders' && <OrdersPanel />}
      </main>
    </div>
  );
}
