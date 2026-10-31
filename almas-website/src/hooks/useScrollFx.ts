import { useLayoutEffect, type RefObject } from 'react';
import { gsap, prefersReducedMotion, ScrollTrigger } from '@/lib/motion';

/**
 * يفعّل حركات التمرير داخل نطاق معيّن:
 *  - [data-reveal]            ظهور تدريجي (fade-up / blur)
 *  - [data-reveal="scale"]    ظهور مع تكبير
 *  - [data-stagger] > *       ظهور متتابع للعناصر الأبناء
 *  - [data-speed="0.2"]       Parallax
 *  - [data-split]             ظهور الكلمات بشكل سينمائي
 */
export function useScrollFx(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const root = scope.current;
    if (!root) return;
    const reduce = prefersReducedMotion();

    const ctx = gsap.context(() => {
      const reveal = gsap.utils.toArray<HTMLElement>('[data-reveal]', root);
      if (reduce) {
        if (reveal.length) gsap.set(reveal, { opacity: 1 });
        return;
      }

      reveal.forEach((el) => {
        if (el.dataset.revealed) {
          gsap.set(el, { opacity: 1 });
          return;
        }
        const type = el.dataset.reveal;
        const from: gsap.TweenVars =
          type === 'scale'
            ? { opacity: 0, scale: 0.92, y: 40, filter: 'blur(12px)' }
            : type === 'side'
              ? { opacity: 0, x: 60 }
              : { opacity: 0, y: 48, filter: 'blur(8px)' };
        gsap.fromTo(el, from, {
          opacity: 1, y: 0, x: 0, scale: 1, filter: 'blur(0px)',
          duration: 1.1,
          ease: 'expo.out',
          delay: Number(el.dataset.delay ?? 0),
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
          onComplete: () => { el.dataset.revealed = '1'; gsap.set(el, { clearProps: 'filter' }); },
        });
      });

      gsap.utils.toArray<HTMLElement>('[data-stagger]', root).forEach((group) => {
        const items = Array.from(group.children) as HTMLElement[];
        if (!items.length) return;
        gsap.fromTo(
          items,
          { opacity: 0, y: 60, rotateX: -12, transformPerspective: 900 },
          {
            opacity: 1, y: 0, rotateX: 0,
            duration: 1, ease: 'expo.out', stagger: 0.08,
            scrollTrigger: { trigger: group, start: 'top 88%', once: true },
            clearProps: 'transform',
          },
        );
      });

      gsap.utils.toArray<HTMLElement>('[data-speed]', root).forEach((el) => {
        const speed = Number(el.dataset.speed);
        gsap.to(el, {
          yPercent: speed * -100,
          ease: 'none',
          scrollTrigger: { trigger: el.closest('section') ?? el, start: 'top bottom', end: 'bottom top', scrub: true },
        });
      });

      gsap.utils.toArray<HTMLElement>('[data-split]', root).forEach((el) => {
        const words = el.querySelectorAll('.w');
        if (!words.length) return;
        gsap.fromTo(
          words,
          { yPercent: 110, opacity: 0, rotate: 4 },
          {
            yPercent: 0, opacity: 1, rotate: 0, duration: 1.2, ease: 'expo.out', stagger: 0.06,
            scrollTrigger: { trigger: el, start: 'top 90%', once: true },
          },
        );
      });

      // انتقال سينمائي بين الأقسام: يتلاشى القسم السابق قليلاً عند المغادرة
      gsap.utils.toArray<HTMLElement>('[data-cinematic]', root).forEach((sec) => {
        gsap.fromTo(
          sec,
          { opacity: 1, scale: 1 },
          {
            opacity: 0.35, scale: 0.96, ease: 'none',
            scrollTrigger: { trigger: sec, start: 'bottom 70%', end: 'bottom top', scrub: true },
          },
        );
      });
    }, root);

    const id = window.setTimeout(() => ScrollTrigger.refresh(), 200);
    return () => {
      window.clearTimeout(id);
      ctx.revert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
