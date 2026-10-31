import { Link } from 'react-router-dom';
import { site } from '@/config/site';
import { t } from '@/i18n';
import { waLink } from '@/lib/whatsapp';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden border-t border-white/[.06] bg-ink-950 pt-20">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-volt-500/60 to-transparent" />
      <div className="pointer-events-none absolute -bottom-40 left-1/2 h-80 w-[60rem] -translate-x-1/2 rounded-full bg-volt-600/20 blur-[120px]" />

      <div className="container relative">
        <div className="grid gap-12 pb-16 md:grid-cols-12">
          <div className="md:col-span-5">
            <Logo />
            <p className="mt-5 max-w-sm leading-8 text-slate-400">{t.footer.about}</p>
            <div className="mt-6 flex gap-2">
              {(['instagram', 'facebook', 'tiktok'] as const).map((s) => (
                <a
                  key={s}
                  href={site.social[s]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s}
                  className="grid h-11 w-11 place-items-center rounded-full border border-white/10 text-slate-300 transition hover:-translate-y-1 hover:border-volt-400/60 hover:text-white hover:shadow-glow"
                >
                  <Icon name={s} />
                </a>
              ))}
              <a
                href={waLink()}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="WhatsApp"
                className="grid h-11 w-11 place-items-center rounded-full border border-white/10 text-slate-300 transition hover:-translate-y-1 hover:border-emerald-400/60 hover:text-emerald-300"
              >
                <Icon name="whatsapp" />
              </a>
            </div>
          </div>

          <div className="md:col-span-3">
            <h3 className="text-base font-semibold">{t.footer.links}</h3>
            <ul className="mt-5 space-y-3 text-slate-400">
              <li><Link className="transition hover:text-white" to="/store">{t.nav.store}</Link></li>
              <li><Link className="transition hover:text-white" to="/maintenance">{t.nav.maintenance}</Link></li>
              <li><Link className="transition hover:text-white" to="/contact">{t.nav.contact}</Link></li>
              <li><Link className="transition hover:text-white" to="/cart">{t.nav.cart}</Link></li>
            </ul>
          </div>

          <div className="md:col-span-4">
            <h3 className="text-base font-semibold">{t.nav.contact}</h3>
            <ul className="mt-5 space-y-4 text-slate-400">
              <li className="flex items-start gap-3"><Icon name="pin" className="mt-0.5 shrink-0 text-volt-400" />{site.addressLine}</li>
              <li className="flex items-start gap-3"><Icon name="phone" className="mt-0.5 shrink-0 text-volt-400" /><a className="ltr hover:text-white" href={`tel:${site.phoneIntl}`}>{site.phoneDisplay}</a></li>
              <li className="flex items-start gap-3"><Icon name="clock" className="mt-0.5 shrink-0 text-volt-400" /><span>{site.hours}<br />{site.hoursFriday}</span></li>
            </ul>
          </div>
        </div>

        <div aria-hidden className="select-none text-center font-display text-[22vw] font-bold leading-none text-white/[.025] md:text-[16vw]">
          {site.nameAr}
        </div>

        <div className="flex flex-col items-center justify-between gap-3 border-t border-white/[.06] py-6 text-sm text-slate-500 sm:flex-row">
          <span>© {year} {site.nameAr} — {t.footer.rights}</span>
          <span className="ltr">{site.nameEn} • {site.city}, Iraq</span>
        </div>
      </div>
    </footer>
  );
}
