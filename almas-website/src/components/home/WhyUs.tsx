import { whyUs } from '@/data/seed';
import { t } from '@/i18n';
import { Icon } from '@/components/ui/Icon';
import { SectionHeading } from '@/components/ui/SectionHeading';

export function WhyUs() {
  return (
    <section className="section overflow-hidden" data-cinematic>
      <div className="grid-bg absolute inset-0 opacity-50" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[40rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-volt-600/10 blur-[150px]" />
      <div className="container relative">
        <SectionHeading center eyebrow={t.sections.why.eyebrow} title={t.sections.why.title} desc={t.sections.why.desc} />
        <div data-stagger className="grid gap-px overflow-hidden rounded-3xl border border-white/[.07] bg-white/[.07] sm:grid-cols-2 lg:grid-cols-3">
          {whyUs.map((w) => (
            <div key={w.title} className="group relative bg-ink-900 p-8 transition-colors duration-500 hover:bg-ink-850">
              <div className="absolute inset-x-0 top-0 h-px scale-x-0 bg-gradient-to-r from-transparent via-volt-400 to-transparent transition-transform duration-700 group-hover:scale-x-100" />
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-volt-500/10 text-volt-300 ring-1 ring-volt-500/25 transition duration-500 group-hover:scale-110 group-hover:bg-volt-500 group-hover:text-white group-hover:shadow-glow">
                <Icon name={w.icon} size={22} />
              </span>
              <h3 className="mt-6 text-lg font-semibold">{w.title}</h3>
              <p className="mt-2 leading-7 text-slate-400">{w.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
