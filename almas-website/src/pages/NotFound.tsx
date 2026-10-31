import { Link } from 'react-router-dom';
import { t } from '@/i18n';
import { Seo } from '@/components/ui/Seo';

export default function NotFound() {
  return (
    <section className="relative flex min-h-[85vh] items-center justify-center overflow-hidden pt-24 text-center">
      <Seo title={t.common.notFoundTitle} noindex />
      <div className="grid-bg absolute inset-0 -z-10" />
      <div className="container">
        <p className="ltr text-gradient font-display text-[9rem] font-bold leading-none md:text-[14rem]">404</p>
        <h1 className="mt-4 text-3xl font-bold">{t.common.notFoundTitle}</h1>
        <p className="mt-3 text-slate-400">{t.common.notFoundDesc}</p>
        <Link to="/" className="btn-primary mt-8">{t.common.goHome}</Link>
      </div>
    </section>
  );
}
