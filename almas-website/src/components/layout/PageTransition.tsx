import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { gsap, prefersReducedMotion, ScrollTrigger, scrollToTop } from '@/lib/motion';

/** انتقال سينمائي بين الصفحات: ستارة ضوئية + ظهور المحتوى بضبابية */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const content = useRef<HTMLDivElement>(null);
  const curtain = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    scrollToTop(true);
    if (prefersReducedMotion()) return;
    const tl = gsap.timeline({ onComplete: () => ScrollTrigger.refresh() });
    if (!first.current && curtain.current) {
      tl.fromTo(curtain.current, { scaleY: 1, transformOrigin: 'top' }, { scaleY: 0, duration: 0.9, ease: 'expo.inOut' }, 0);
    }
    tl.fromTo(
      content.current,
      { opacity: 0, y: 30, filter: 'blur(10px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1, ease: 'expo.out', clearProps: 'filter,transform' },
      first.current ? 0 : 0.35,
    );
    first.current = false;
    return () => {
      tl.kill();
    };
  }, [pathname]);

  return (
    <>
      <div
        ref={curtain}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[70] origin-top scale-y-0 bg-ink-950"
        style={{ background: 'linear-gradient(180deg,#030408 0%,#030408 92%,#2f7bff 100%)' }}
      />
      <div ref={content}>{children}</div>
    </>
  );
}
