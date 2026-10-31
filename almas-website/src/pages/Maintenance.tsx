import { useRef, useState, type FormEvent } from 'react';
import { repairServices } from '@/data/seed';
import { site } from '@/config/site';
import { t } from '@/i18n';
import { repo, shortRef } from '@/lib/repo';
import { bookingMessage, waLink } from '@/lib/whatsapp';
import { useScrollFx } from '@/hooks/useScrollFx';
import type { BookingInput } from '@/types';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { Seo } from '@/components/ui/Seo';
import { ServiceCard } from '@/components/home/ServicesPreview';

const times = ['10:00 – 12:00', '12:00 – 2:00', '2:00 – 4:00', '4:00 – 6:00', '6:00 – 8:00', '8:00 – 10:00'];

export default function Maintenance() {
  const ref = useRef<HTMLDivElement>(null);
  useScrollFx(ref);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<BookingInput>({ name: '', phone: '', device: '', service: repairServices[0].title, issue: '', date: today, time: times[0] });
  const [status, setStatus] = useState<'idle' | 'busy' | 'done'>('idle');
  const [waHref, setWaHref] = useState('');
  const set = (k: keyof BookingInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('busy');
    let refCode = Date.now().toString(36).slice(-6).toUpperCase();
    try {
      const b = await repo.createBooking({ ...form, name: form.name.trim(), phone: form.phone.trim(), device: form.device.trim(), issue: form.issue.trim() });
      refCode = shortRef(b.id);
    } catch {
      /* الحجز عبر WhatsApp يبقى متاحاً */
    }
    setWaHref(waLink(bookingMessage(form, refCode)));
    setStatus('done');
  };

  return (
    <div ref={ref}>
      <Seo
        title="مركز الصيانة"
        path="/maintenance"
        description="صيانة الشاشات، البطاريات، مداخل الشحن والبرمجيات في الناصرية بقطع أصلية وضمان. احجز موعدك أونلاين أو عبر WhatsApp."
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Service',
          serviceType: 'Mobile phone repair',
          provider: { '@type': 'LocalBusiness', name: site.nameAr, telephone: site.phoneIntl, address: { '@type': 'PostalAddress', addressLocality: site.city, addressRegion: site.region, addressCountry: 'IQ' } },
          areaServed: site.region,
          hasOfferCatalog: {
            '@type': 'OfferCatalog',
            name: 'خدمات الصيانة',
            itemListElement: repairServices.map((s) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.title }, price: s.startingPrice, priceCurrency: 'IQD' })),
          },
        }}
      />
      <PageHeader eyebrow={t.sections.services.eyebrow} title={t.maintenance.title} desc={t.maintenance.subtitle}>
        <div data-reveal data-delay="0.3" className="mt-9 flex flex-col gap-3 sm:flex-row">
          <a href="#booking" className="btn-primary btn-shine">
            <Icon name="calendar" size={18} />
            {t.maintenance.book}
          </a>
          <a href={waLink(`مرحباً ${site.nameAr}، أحتاج استشارة صيانة لجهازي`)} target="_blank" rel="noopener noreferrer" className="btn-wa">
            <Icon name="whatsapp" />
            {t.maintenance.whatsapp}
          </a>
        </div>
      </PageHeader>

      <section className="pb-24">
        <div className="container">
          <div data-stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {repairServices.map((s, i) => <ServiceCard key={s.id} s={s} index={i} />)}
          </div>
        </div>
      </section>

      <section className="section border-y border-white/[.06] bg-ink-900/50">
        <div className="container">
          <h2 data-reveal className="text-center text-3xl font-bold md:text-4xl">{t.maintenance.process}</h2>
          <ol data-stagger className="relative mt-14 grid gap-8 md:grid-cols-4">
            <div className="absolute inset-x-[12%] top-7 hidden h-px bg-gradient-to-l from-volt-500/0 via-volt-500/60 to-volt-500/0 md:block" />
            {t.maintenance.steps.map((s, i) => (
              <li key={s.title} className="relative text-center">
                <span className="ltr relative mx-auto grid h-14 w-14 place-items-center rounded-full bg-ink-950 font-display text-lg font-bold text-white ring-1 ring-volt-500/50 shadow-glow">
                  {i + 1}
                </span>
                <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-slate-400">{s.desc}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="booking" className="section scroll-mt-24">
        <div className="pointer-events-none absolute start-1/4 top-1/3 h-96 w-96 rounded-full bg-volt-600/15 blur-[130px]" />
        <div className="container relative">
          <div className="mx-auto max-w-3xl">
            <div data-reveal className="mb-10 text-center">
              <span className="eyebrow">{t.maintenance.book}</span>
              <h2 className="mt-5 text-3xl font-bold md:text-4xl">{t.maintenance.form.title}</h2>
            </div>
            {status === 'done' ? (
              <div data-reveal="scale" className="card flex flex-col items-center gap-5 p-12 text-center">
                <span className="grid h-20 w-20 place-items-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40">
                  <Icon name="check" size={36} />
                </span>
                <p className="text-lg">{t.maintenance.form.success}</p>
                <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-wa h-14 w-full text-base">
                  <Icon name="whatsapp" />
                  {t.maintenance.form.sendNow}
                </a>
                <button className="text-sm text-volt-300 hover:text-white" onClick={() => setStatus('idle')}>حجز موعد آخر</button>
              </div>
            ) : (
              <form data-reveal="scale" onSubmit={submit} className="card grid gap-5 p-6 sm:grid-cols-2 sm:p-10">
                <div>
                  <label className="label" htmlFor="b-name">{t.maintenance.form.name} *</label>
                  <input id="b-name" className="field" required minLength={2} value={form.name} onChange={set('name')} autoComplete="name" />
                </div>
                <div>
                  <label className="label" htmlFor="b-phone">{t.maintenance.form.phone} *</label>
                  <input id="b-phone" className="field ltr text-end" required type="tel" inputMode="tel" pattern="[0-9+ ]{7,20}" placeholder="07XX XXX XXXX" value={form.phone} onChange={set('phone')} autoComplete="tel" />
                </div>
                <div>
                  <label className="label" htmlFor="b-device">{t.maintenance.form.device} *</label>
                  <input id="b-device" className="field" required placeholder={t.maintenance.form.devicePh} value={form.device} onChange={set('device')} />
                </div>
                <div>
                  <label className="label" htmlFor="b-service">{t.maintenance.form.service}</label>
                  <select id="b-service" className="field" value={form.service} onChange={set('service')}>
                    {repairServices.map((s) => <option key={s.id}>{s.title}</option>)}
                    <option>أخرى / غير متأكد</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="b-date">{t.maintenance.form.date}</label>
                  <input id="b-date" className="field" type="date" min={today} required value={form.date} onChange={set('date')} />
                </div>
                <div>
                  <label className="label" htmlFor="b-time">{t.maintenance.form.time}</label>
                  <select id="b-time" className="field ltr text-end" value={form.time} onChange={set('time')}>
                    {times.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="label" htmlFor="b-issue">{t.maintenance.form.issue}</label>
                  <textarea id="b-issue" className="field min-h-28 resize-none" placeholder={t.maintenance.form.issuePh} value={form.issue} onChange={set('issue')} />
                </div>
                <button className="btn-primary btn-shine h-14 text-base sm:col-span-2" disabled={status === 'busy'}>
                  <Icon name="calendar" />
                  {status === 'busy' ? t.common.loading : t.maintenance.form.submit}
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
