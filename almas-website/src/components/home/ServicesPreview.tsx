import { Link } from 'react-router-dom';
import { repairServices } from '@/data/seed';
import { t } from '@/i18n';
import { formatIQD } from '@/lib/format';
import { useTilt } from '@/hooks/useTilt';
import type { RepairService } from '@/types';
import { Icon } from '@/components/ui/Icon';
import { SectionHeading } from '@/components/ui/SectionHeading';

export function ServiceCard({ s, index }: { s: RepairService; index: number }) {
  const tilt = useTilt<HTMLElement>(6);
  return (
    <article
      ref={tilt.ref}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      className="card group flex h-full flex-col p-6 transition-[transform,border-color] duration-300 hover:border-volt-500/40 sm:p-7"
    >
      <span className="glare" />
      <div className="flex items-start justify-between">
        <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-volt-400/25 to-volt-700/10 text-volt-200 ring-1 ring-volt-500/30 transition group-hover:shadow-glow">
          <Icon name={s.icon} size={26} />
        </span>
        <span className="ltr font-display text-5xl font-bold text-white/[.05] transition-colors group-hover:text-volt-500/20">0{index + 1}</span>
      </div>
      <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
      <p className="mt-3 leading-7 text-slate-400">{s.description}</p>
      <ul className="mt-5 space-y-2 text-sm text-slate-300">
        {s.points.map((p) => (
          <li key={p} className="flex items-center gap-2">
            <Icon name="check" size={16} className="text-volt-400" />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex items-end justify-between border-t border-white/[.06] pt-5">
        <div>
          <span className="block text-xs text-slate-500">{t.maintenance.from}</span>
          <span className="font-display text-lg font-bold text-white">{formatIQD(s.startingPrice)}</span>
        </div>
        <span className="flex items-center gap-1.5 text-sm text-slate-400">
          <Icon name="clock" size={16} className="text-volt-400" />
          {s.duration}
        </span>
      </div>
    </article>
  );
}

export function ServicesPreview() {
  return (
    <section className="section" data-cinematic>
      <div className="container">
        <SectionHeading
          eyebrow={t.sections.services.eyebrow}
          title={t.sections.services.title}
          desc={t.sections.services.desc}
          action={
            <Link to="/maintenance#booking" className="btn-primary btn-shine">
              {t.sections.services.cta}
              <Icon name="calendar" size={18} />
            </Link>
          }
        />
        <div data-stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {repairServices.slice(0, 6).map((s, i) => <ServiceCard key={s.id} s={s} index={i} />)}
        </div>
      </div>
    </section>
  );
}
