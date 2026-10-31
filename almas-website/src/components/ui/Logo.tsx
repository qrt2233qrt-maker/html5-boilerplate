import { site } from '@/config/site';

export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d4e5ff" />
          <stop offset=".45" stopColor="#4d8fff" />
          <stop offset="1" stopColor="#123c8c" />
        </linearGradient>
        <filter id="lg-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <path d="M20 16h24l12 14-24 24L8 30z" fill="#2f7bff" opacity=".5" filter="url(#lg-glow)" />
      <path d="M20 16h24l12 14-24 24L8 30z" fill="url(#lg-a)" />
      <path d="M20 16l12 38 12-38M8 30h48M26 16l6 14 6-14" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-xl font-bold text-white">{site.nameAr}</span>
        <span className="ltr mt-1 text-[10px] font-medium uppercase tracking-[.32em] text-volt-300">{site.nameEn}</span>
      </span>
    </span>
  );
}
