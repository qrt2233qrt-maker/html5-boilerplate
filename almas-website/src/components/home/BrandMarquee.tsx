const brands = ['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Anker', 'Honor', 'OnePlus', 'Google Pixel', 'JBL', 'Baseus'];

export function BrandMarquee() {
  const row = [...brands, ...brands];
  return (
    <div className="relative overflow-hidden border-y border-white/[.06] bg-ink-900/60 py-6" aria-label="الماركات المتوفرة">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-ink-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-ink-950 to-transparent" />
      <div className="ltr flex w-max animate-marquee gap-16" style={{ direction: 'ltr' }}>
        {row.map((b, i) => (
          <span key={i} className="whitespace-nowrap font-display text-2xl font-semibold tracking-wide text-white/25 transition-colors hover:text-white/70">
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}
