import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { t } from '@/i18n';
import { cx } from '@/lib/format';
import { gsap, lockScroll } from '@/lib/motion';
import { cartCount, useCart } from '@/store/cart';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';

const links = [
  { to: '/', label: t.nav.home },
  { to: '/store', label: t.nav.store },
  { to: '/maintenance', label: t.nav.maintenance },
  { to: '/contact', label: t.nav.contact },
];

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const count = useCart((s) => cartCount(s.lines));
  const setOpen = useCart((s) => s.setOpen);
  const loc = useLocation();
  const panel = useRef<HTMLDivElement>(null);
  const badge = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => setMenu(false), [loc.pathname]);

  useEffect(() => {
    lockScroll(menu);
    if (menu && panel.current) {
      gsap.fromTo(panel.current, { clipPath: 'circle(0% at 90% 4%)' }, { clipPath: 'circle(150% at 90% 4%)', duration: 0.9, ease: 'expo.inOut' });
      gsap.fromTo(panel.current.querySelectorAll('[data-m]'), { y: 50, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.07, delay: 0.25, duration: 0.8, ease: 'expo.out' });
    }
  }, [menu]);

  useEffect(() => {
    if (count && badge.current) gsap.fromTo(badge.current, { scale: 1.8 }, { scale: 1, duration: 0.6, ease: 'elastic.out(1,.4)' });
  }, [count]);

  return (
    <>
      <header
        className={cx(
          'fixed inset-x-0 top-0 z-50 transition-all duration-500',
          scrolled ? 'py-2.5' : 'py-4 md:py-6',
        )}
      >
        <div className="container">
          <div
            className={cx(
              'flex items-center justify-between rounded-full px-3 py-2 transition-all duration-500 sm:px-5',
              scrolled ? 'glass shadow-[0_10px_40px_-15px_rgba(0,0,0,.9)]' : 'border border-transparent',
            )}
          >
            <Link to="/" aria-label="الماس — الرئيسية" className="shrink-0">
              <Logo />
            </Link>

            <nav className="hidden items-center gap-1 md:flex" aria-label="التنقل الرئيسي">
              {links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.to === '/'}
                  className={({ isActive }) =>
                    cx(
                      'relative rounded-full px-4 py-2 text-[15px] transition-colors duration-300',
                      isActive ? 'text-white' : 'text-slate-400 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-0 -z-10 rounded-full bg-white/[.06] ring-1 ring-white/10" />}
                      {l.label}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="relative grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[.03] text-white transition hover:border-volt-400/60 hover:bg-volt-500/10"
                aria-label={`${t.nav.cart} (${count})`}
              >
                <Icon name="cart" />
                {count > 0 && (
                  <span ref={badge} className="absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-volt-500 px-1 text-[11px] font-bold text-white shadow-glow">
                    {count}
                  </span>
                )}
              </button>
              <Link to="/store" className="btn-primary btn-sm btn-shine hidden lg:inline-flex">
                {t.hero.shop}
              </Link>
              <button
                type="button"
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[.03] text-white md:hidden"
                onClick={() => setMenu((m) => !m)}
                aria-expanded={menu}
                aria-label={menu ? t.nav.close : t.nav.menu}
              >
                <Icon name={menu ? 'close' : 'menu'} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {menu && (
        <div ref={panel} className="fixed inset-0 z-40 bg-ink-950/95 backdrop-blur-xl md:hidden" data-lenis-prevent>
          <div className="grid-bg absolute inset-0 opacity-60" />
          <div className="absolute -end-20 top-10 h-72 w-72 rounded-full bg-volt-500/30 blur-[100px]" />
          <nav className="container relative flex h-full flex-col justify-center gap-2 pt-20">
            {links.map((l, i) => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                data-m
                className={({ isActive }) =>
                  cx('flex items-baseline gap-4 py-3 font-display text-4xl font-bold', isActive ? 'text-white' : 'text-slate-500')
                }
              >
                <span className="ltr text-sm font-medium text-volt-400">0{i + 1}</span>
                {l.label}
              </NavLink>
            ))}
            <div data-m className="mt-8 flex gap-3">
              <Link to="/store" className="btn-primary flex-1">{t.hero.shop}</Link>
              <Link to="/maintenance" className="btn-ghost flex-1">{t.maintenance.book}</Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
