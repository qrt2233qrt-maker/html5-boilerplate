import type { ReactNode } from 'react';
import { SplitWords } from './SectionHeading';

export function PageHeader({ eyebrow, title, desc, children }: { eyebrow: string; title: string; desc?: string; children?: ReactNode }) {
  return (
    <header className="noise relative overflow-hidden pb-12 pt-36 md:pb-16 md:pt-44">
      <div className="grid-bg absolute inset-0 -z-10" />
      <div className="pointer-events-none absolute end-[10%] top-10 -z-10 h-80 w-80 rounded-full bg-volt-600/25 blur-[120px]" data-speed="0.3" />
      <div className="container">
        <span data-reveal className="eyebrow">{eyebrow}</span>
        <h1 className="mt-5 text-4xl font-bold sm:text-5xl md:text-6xl">
          <SplitWords text={title} />
        </h1>
        {desc && <p data-reveal data-delay="0.15" className="mt-5 max-w-2xl text-lg leading-8 text-slate-400">{desc}</p>}
        {children}
      </div>
    </header>
  );
}
