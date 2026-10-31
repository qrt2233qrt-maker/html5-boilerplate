import type { ReactNode } from 'react';
import { cx } from '@/lib/format';

export function SplitWords({ text, className }: { text: string; className?: string }) {
  return (
    <span data-split className={className}>
      {text.split(' ').map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[.12em] align-bottom">
          <span className="w inline-block">{w}</span>
          {' '}
        </span>
      ))}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  desc,
  action,
  center = false,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  action?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cx('mb-12 flex flex-col gap-6 md:mb-16', center ? 'items-center text-center' : 'md:flex-row md:items-end md:justify-between')}>
      <div className={cx('max-w-2xl', center && 'mx-auto')}>
        <span data-reveal className="eyebrow">{eyebrow}</span>
        <h2 className="mt-5 text-3xl font-bold leading-[1.2] sm:text-4xl md:text-5xl">
          <SplitWords text={title} />
        </h2>
        {desc && <p data-reveal data-delay="0.15" className="mt-4 text-base leading-8 text-slate-400 md:text-lg">{desc}</p>}
      </div>
      {action && <div data-reveal data-delay="0.2" className="shrink-0">{action}</div>}
    </div>
  );
}
