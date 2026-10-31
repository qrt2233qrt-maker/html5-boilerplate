import { useCallback, useRef, type PointerEvent } from 'react';

/** إمالة ثلاثية الأبعاد + توهج يتبع المؤشر (Micro-interaction) */
export function useTilt<T extends HTMLElement>(max = 8) {
  const ref = useRef<T>(null);
  const frame = useRef(0);

  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      if (e.pointerType !== 'mouse') return;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        el.style.setProperty('--gx', `${x * 100}%`);
        el.style.setProperty('--gy', `${y * 100}%`);
        el.style.transform = `perspective(1000px) rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) translateZ(0)`;
      });
    },
    [max],
  );

  const onPointerLeave = useCallback(() => {
    cancelAnimationFrame(frame.current);
    if (ref.current) ref.current.style.transform = '';
  }, []);

  return { ref, onPointerMove, onPointerLeave };
}

/** زر مغناطيسي يتبع المؤشر قليلاً */
export function useMagnetic<T extends HTMLElement>(strength = 0.25) {
  const ref = useRef<T>(null);
  const onPointerMove = useCallback(
    (e: PointerEvent<T>) => {
      if (e.pointerType !== 'mouse' || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      ref.current.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
    },
    [strength],
  );
  const onPointerLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = '';
  }, []);
  return { ref, onPointerMove, onPointerLeave };
}
