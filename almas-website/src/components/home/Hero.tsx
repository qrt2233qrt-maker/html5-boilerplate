import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@/i18n';
import { gsap, prefersReducedMotion, ScrollTrigger } from '@/lib/motion';
import { useInView } from '@/hooks/useInView';
import { useMagnetic } from '@/hooks/useTilt';
import { DeviceArt } from '@/components/ui/DeviceArt';
import { Icon } from '@/components/ui/Icon';

const HeroPhone = lazy(() => import('@/components/three/HeroPhone'));

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function Hero() {
  const section = useRef<HTMLElement>(null);
  const scroll = useRef(0);
  const { ref: stage, inView } = useInView<HTMLDivElement>('0px');
  const [webgl, setWebgl] = useState(false);
  const shop = useMagnetic<HTMLAnchorElement>(0.3);
  const svc = useMagnetic<HTMLAnchorElement>(0.3);

  useEffect(() => setWebgl(supportsWebGL()), []);

  useLayoutEffect(() => {
    const el = section.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    const ctx = gsap.context(() => {
      if (!reduce) {
        const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
        tl.fromTo('[data-h="eyebrow"]', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1 }, 0.2)
          .fromTo('[data-h="line"] .w', { yPercent: 120, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 1.4, stagger: 0.08 }, 0.3)
          .fromTo('[data-h="sub"]', { opacity: 0, y: 30, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2 }, 0.75)
          .fromTo('[data-h="cta"] > *', { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 1, stagger: 0.1 }, 0.9)
          .fromTo('[data-h="stat"]', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1, stagger: 0.08 }, 1.05)
          .fromTo('[data-h="stage"]', { opacity: 0, scale: 0.85 }, { opacity: 1, scale: 1, duration: 2 }, 0.1);
      } else {
        gsap.set('[data-h]', { opacity: 1 });
      }

      ScrollTrigger.create({
        trigger: el,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        onUpdate: (st) => {
          scroll.current = st.progress;
        },
      });
      if (!reduce) {
        gsap.to('[data-h="copy"]', {
          yPercent: -18, opacity: 0, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top top', end: 'bottom 20%', scrub: true },
        });
        gsap.to('[data-h="aurora"]', {
          yPercent: 30, scale: 1.2, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top top', end: 'bottom top', scrub: true },
        });
      }
    }, el);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={section} className="noise relative isolate flex min-h-[100svh] items-center overflow-hidden pb-16 pt-28 md:pt-24">
      {/* خلفية سينمائية */}
      <div className="grid-bg absolute inset-0 -z-10" />
      <div data-h="aurora" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute end-[8%] top-[18%] h-[38rem] w-[38rem] rounded-full bg-volt-600/30 blur-[140px]" />
        <div className="absolute start-[-10%] top-[45%] h-[28rem] w-[28rem] rounded-full bg-volt-800/40 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 h-px w-[80%] -translate-x-1/2 bg-gradient-to-r from-transparent via-volt-500/50 to-transparent" />
      </div>

      <div className="container grid items-center gap-6 lg:grid-cols-2 lg:gap-10">
        <div data-h="copy" className="relative z-10 order-2 text-center lg:order-1 lg:text-start">
          <span data-h="eyebrow" className="eyebrow opacity-0">{t.hero.eyebrow}</span>
          <h1 className="mt-6 text-[2.75rem] font-bold leading-[1.12] sm:text-6xl xl:text-7xl">
            <span data-h="line" className="block overflow-hidden pb-2">
              {t.hero.titleA.split(' ').map((w, i) => (
                <span key={i} className="w inline-block">{w}&nbsp;</span>
              ))}
            </span>
            <span data-h="line" className="block overflow-hidden pb-3">
              {t.hero.titleB.split(' ').map((w, i) => (
                <span key={i} className="w text-gradient inline-block">{w}&nbsp;</span>
              ))}
            </span>
          </h1>
          <p data-h="sub" className="mx-auto mt-6 max-w-xl text-base leading-8 text-slate-400 opacity-0 sm:text-lg lg:mx-0">
            {t.hero.subtitle}
          </p>
          <div data-h="cta" className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Link ref={shop.ref} onPointerMove={shop.onPointerMove} onPointerLeave={shop.onPointerLeave} to="/store" className="btn-primary btn-shine w-full px-8 py-4 text-base sm:w-auto">
              {t.hero.shop}
              <Icon name="arrow" size={18} />
            </Link>
            <Link ref={svc.ref} onPointerMove={svc.onPointerMove} onPointerLeave={svc.onPointerLeave} to="/maintenance" className="btn-ghost w-full px-8 py-4 text-base sm:w-auto">
              {t.hero.services}
            </Link>
          </div>
          <dl className="mx-auto mt-12 grid max-w-md grid-cols-3 gap-4 lg:mx-0">
            {t.hero.stats.map((s) => (
              <div key={s.label} data-h="stat" className="opacity-0">
                <dt className="sr-only">{s.label}</dt>
                <dd className="ltr font-display text-2xl font-bold text-white sm:text-3xl">{s.value}</dd>
                <dd className="mt-1 text-xs text-slate-500 sm:text-sm">{s.label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div ref={stage} data-h="stage" className="relative order-1 mx-auto aspect-square w-full max-w-[560px] opacity-0 lg:order-2 lg:max-w-none">
          <div className="absolute inset-[12%] rounded-full border border-volt-500/10" />
          <div className="absolute inset-[24%] rounded-full border border-volt-500/[.08]" />
          <div className="animate-pulse-glow absolute inset-[30%] rounded-full bg-volt-500/25 blur-[80px]" />
          {webgl ? (
            <Suspense fallback={<PhoneFallback />}>
              <HeroPhone scroll={scroll} active={inView} />
            </Suspense>
          ) : (
            <PhoneFallback />
          )}
        </div>
      </div>

      <div className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-xs text-slate-500 md:flex">
        {t.hero.scroll}
        <span className="relative h-10 w-6 rounded-full border border-white/20">
          <span className="absolute left-1/2 top-2 h-2 w-1 -translate-x-1/2 animate-bounce rounded-full bg-volt-400" />
        </span>
      </div>
    </section>
  );
}

function PhoneFallback() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <DeviceArt category="phones" name="iPhone" color="#2b3a55" className="h-[80%] w-[80%] animate-pulse-glow" />
    </div>
  );
}
