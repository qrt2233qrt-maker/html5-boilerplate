import { testimonials } from '@/data/seed';
import { t } from '@/i18n';
import { Icon } from '@/components/ui/Icon';
import { SectionHeading } from '@/components/ui/SectionHeading';

export function Testimonials() {
  return (
    <section className="section overflow-hidden" data-cinematic>
      <div className="container">
        <SectionHeading center eyebrow={t.sections.testimonials.eyebrow} title={t.sections.testimonials.title} desc={t.sections.testimonials.desc} />
        <div data-stagger className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4">
          {testimonials.map((r) => (
            <figure key={r.name} className="card break-inside-avoid p-7 transition-colors duration-500 hover:border-volt-500/30">
              <div className="flex gap-0.5 text-volt-400" aria-label={`${r.rating} من 5`}>
                {Array.from({ length: 5 }, (_, i) => (
                  <Icon key={i} name="star" size={16} className={i < r.rating ? '' : 'opacity-20'} />
                ))}
              </div>
              <blockquote className="mt-4 text-[17px] leading-8 text-slate-200">“{r.text}”</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-volt-400 to-volt-700 font-display font-bold text-white">
                  {r.name.charAt(0)}
                </span>
                <span>
                  <span className="block font-semibold text-white">{r.name}</span>
                  <span className="text-sm text-slate-500">{r.role}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
