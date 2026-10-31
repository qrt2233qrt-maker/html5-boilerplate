import { useEffect, useState } from 'react';
import { site } from '@/config/site';
import { t } from '@/i18n';
import { waLink } from '@/lib/whatsapp';
import { useInView } from '@/hooks/useInView';
import { Icon } from '@/components/ui/Icon';
import { SectionHeading } from '@/components/ui/SectionHeading';

export function ContactSection({ standalone = false }: { standalone?: boolean }) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const map = useInView<HTMLDivElement>('400px');
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (map.inView) setMapReady(true);
  }, [map.inView]);

  const href = waLink(`مرحباً ${site.nameAr}، معك ${name.trim() || 'زبون'}:\n${msg.trim()}`);

  const info = [
    { icon: 'pin' as const, label: t.contact.address, value: site.addressLine, href: site.mapsUrl },
    { icon: 'phone' as const, label: t.contact.phone, value: site.phoneDisplay, href: `tel:${site.phoneIntl}`, ltr: true },
    { icon: 'whatsapp' as const, label: t.contact.whatsapp, value: site.phoneDisplay, href: waLink(), ltr: true },
    { icon: 'clock' as const, label: t.contact.hours, value: `${site.hours} • ${site.hoursFriday}` },
  ];

  return (
    <section id="contact" className={standalone ? 'relative pb-24 pt-36 md:pb-32 md:pt-44' : 'section'}>
      <div className="container">
        <SectionHeading eyebrow={t.sections.contact.eyebrow} title={t.sections.contact.title} desc={t.sections.contact.desc} />
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="space-y-5 lg:col-span-2">
            <div data-stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {info.map((i) => {
                const body = (
                  <>
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-volt-500/10 text-volt-300 ring-1 ring-volt-500/25 transition group-hover:bg-volt-500 group-hover:text-white">
                      <Icon name={i.icon} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-500">{i.label}</span>
                      <span className={`block font-medium text-white ${i.ltr ? 'ltr text-start' : ''}`}>{i.value}</span>
                    </span>
                  </>
                );
                return i.href ? (
                  <a key={i.label} href={i.href} target={i.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" className="card group flex items-center gap-4 p-5 transition hover:border-volt-500/40">
                    {body}
                  </a>
                ) : (
                  <div key={i.label} className="card group flex items-center gap-4 p-5">{body}</div>
                );
              })}
            </div>

            <form data-reveal onSubmit={(e) => e.preventDefault()} className="card space-y-4 p-6">
              <h3 className="text-lg font-semibold">{t.contact.formTitle}</h3>
              <input id="c-name" className="field" placeholder={t.contact.name} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              <textarea id="c-msg" className="field min-h-28 resize-none" placeholder={t.contact.message} value={msg} onChange={(e) => setMsg(e.target.value)} />
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!msg.trim()}
                onClick={(e) => { if (!msg.trim()) e.preventDefault(); }}
                className={`btn-wa w-full ${msg.trim() ? '' : 'pointer-events-none opacity-50'}`}
              >
                <Icon name="whatsapp" />
                {t.contact.send}
              </a>
            </form>
          </div>

          <div ref={map.ref} data-reveal="scale" className="card relative min-h-[420px] overflow-hidden lg:col-span-3">
            {mapReady && !import.meta.env.VITE_PREVIEW ? (
              <iframe
                title={`موقع ${site.nameAr} على الخريطة`}
                src={site.mapsEmbed}
                className="absolute inset-0 h-full w-full border-0 [filter:invert(.92)_hue-rotate(185deg)_saturate(.7)_brightness(.9)]"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center">
                <div className="grid-bg absolute inset-0" />
                <div className="relative flex flex-col items-center gap-3 text-center">
                  <span className="relative grid h-16 w-16 place-items-center rounded-full bg-volt-500 text-white shadow-glow-lg">
                    <span className="absolute inset-0 animate-ping rounded-full bg-volt-500/40" />
                    <Icon name="pin" size={28} className="relative" />
                  </span>
                  <span className="font-display text-xl font-semibold text-white">{site.city}، {site.region}</span>
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-volt-500/20" />
            <a href={site.mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-primary btn-sm absolute bottom-4 start-4">
              <Icon name="pin" size={18} />
              {t.contact.directions}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
