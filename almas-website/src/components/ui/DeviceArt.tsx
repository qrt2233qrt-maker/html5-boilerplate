import { useId } from 'react';
import type { CategoryId } from '@/types';

/**
 * رسم منتجات مولّد بالكود (SVG) مع إضاءة وانعكاسات —
 * يظهر تلقائياً للمنتجات التي لم تُرفع لها صورة رسمية بعد.
 */

const clamp = (n: number) => Math.max(0, Math.min(255, n));
function shade(hex: string, amt: number) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const num = parseInt(full, 16);
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

type Variant = 'phone' | 'tablet' | 'buds' | 'charger' | 'case' | 'watch' | 'powerbank' | 'glass';

export function variantFor(category: CategoryId, name = ''): Variant {
  const n = name.toLowerCase();
  if (category === 'phones') return 'phone';
  if (category === 'tablets') return 'tablet';
  if (category === 'headphones') return 'buds';
  if (category === 'chargers') return 'charger';
  if (category === 'cases') return 'case';
  if (n.includes('باور') || n.includes('power')) return 'powerbank';
  if (n.includes('حماية') || n.includes('glass')) return 'glass';
  return 'watch';
}

export function DeviceArt({
  category,
  name,
  color = '#3a4152',
  className,
}: {
  category: CategoryId;
  name?: string;
  color?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const v = variantFor(category, name);
  const c1 = shade(color, 55);
  const c2 = color;
  const c3 = shade(color, -45);

  const defs = (
    <defs>
      <linearGradient id={`m${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={c1} />
        <stop offset=".45" stopColor={c2} />
        <stop offset="1" stopColor={c3} />
      </linearGradient>
      <linearGradient id={`e${id}`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity=".55" />
        <stop offset=".12" stopColor="#fff" stopOpacity=".05" />
        <stop offset=".88" stopColor="#fff" stopOpacity=".05" />
        <stop offset="1" stopColor="#fff" stopOpacity=".35" />
      </linearGradient>
      <linearGradient id={`s${id}`} x1="0" y1="0" x2=".6" y2="1">
        <stop offset="0" stopColor="#0b1a3d" />
        <stop offset=".55" stopColor="#081026" />
        <stop offset="1" stopColor="#02040a" />
      </linearGradient>
      <radialGradient id={`g${id}`} cx=".3" cy=".25" r=".8">
        <stop offset="0" stopColor="#4d8fff" stopOpacity=".95" />
        <stop offset=".4" stopColor="#2f7bff" stopOpacity=".35" />
        <stop offset="1" stopColor="#2f7bff" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`g2${id}`} cx=".8" cy=".85" r=".6">
        <stop offset="0" stopColor="#7aaeff" stopOpacity=".6" />
        <stop offset="1" stopColor="#7aaeff" stopOpacity="0" />
      </radialGradient>
      <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".28" />
        <stop offset=".35" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <radialGradient id={`sh${id}`} cx=".5" cy=".5" r=".5">
        <stop offset="0" stopColor="#000" stopOpacity=".7" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`lens${id}`} cx=".35" cy=".35" r=".7">
        <stop offset="0" stopColor="#3b5a9a" />
        <stop offset=".35" stopColor="#0b1222" />
        <stop offset="1" stopColor="#000" />
      </radialGradient>
    </defs>
  );

  const shadow = <ellipse cx="150" cy="278" rx="92" ry="10" fill={`url(#sh${id})`} />;

  const screen = (x: number, y: number, w: number, h: number, rx: number) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#s${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#g${id})`} />
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={`url(#g2${id})`} />
      <path d={`M${x + 8} ${y + h * 0.62} C ${x + w * 0.35} ${y + h * 0.45}, ${x + w * 0.6} ${y + h * 0.8}, ${x + w - 8} ${y + h * 0.58}`} stroke="#7aaeff" strokeOpacity=".35" strokeWidth="1.2" fill="none" />
    </g>
  );

  const gloss = (d: string) => <path d={d} fill={`url(#r${id})`} />;

  let art: React.ReactNode;
  switch (v) {
    case 'phone':
      art = (
        <>
          {/* ظهر الهاتف مع الكاميرات */}
          <g transform="rotate(-10 120 150)">
            <rect x="62" y="38" width="112" height="226" rx="26" fill={`url(#m${id})`} />
            <rect x="62" y="38" width="112" height="226" rx="26" fill={`url(#e${id})`} opacity=".7" />
            <rect x="74" y="50" width="56" height="60" rx="16" fill={shade(color, -20)} stroke="#fff" strokeOpacity=".15" />
            <circle cx="90" cy="67" r="10" fill={`url(#lens${id})`} stroke="#9aa6bd" strokeOpacity=".6" />
            <circle cx="90" cy="93" r="10" fill={`url(#lens${id})`} stroke="#9aa6bd" strokeOpacity=".6" />
            <circle cx="114" cy="80" r="10" fill={`url(#lens${id})`} stroke="#9aa6bd" strokeOpacity=".6" />
            <circle cx="114" cy="62" r="3" fill="#fff7d6" opacity=".8" />
            {gloss('M62 64 Q62 38 88 38 L130 38 L62 160 Z')}
          </g>
          {/* واجهة الهاتف */}
          <g transform="rotate(6 190 150)">
            <rect x="128" y="30" width="114" height="232" rx="27" fill="#0a0c12" stroke={c1} strokeWidth="2.5" />
            {screen(134, 36, 102, 220, 22)}
            <rect x="168" y="44" width="34" height="10" rx="5" fill="#000" />
            <text x="185" y="96" textAnchor="middle" fill="#e8f0ff" fontSize="22" fontFamily="Readex Pro, sans-serif" fontWeight="600">9:41</text>
            {gloss('M134 58 Q134 36 156 36 L210 36 L134 170 Z')}
          </g>
        </>
      );
      break;
    case 'tablet':
      art = (
        <>
          <rect x="40" y="58" width="220" height="168" rx="20" fill="#0a0c12" stroke={c1} strokeWidth="3" />
          {screen(48, 66, 204, 152, 13)}
          <circle cx="150" cy="61.5" r="2" fill="#1d2433" />
          <rect x="70" y="180" width="60" height="22" rx="8" fill="#fff" opacity=".06" />
          <rect x="140" y="180" width="90" height="22" rx="8" fill="#fff" opacity=".06" />
          {gloss('M48 80 Q48 66 62 66 L170 66 L48 200 Z')}
        </>
      );
      break;
    case 'buds':
      art = (
        <>
          <rect x="88" y="128" width="124" height="118" rx="44" fill={`url(#m${id})`} />
          <rect x="88" y="128" width="124" height="118" rx="44" fill={`url(#e${id})`} opacity=".6" />
          <path d="M90 160 H210" stroke={c3} strokeOpacity=".6" strokeWidth="1.5" />
          <circle cx="150" cy="200" r="3" fill="#2f7bff" />
          <circle cx="150" cy="200" r="8" fill="#2f7bff" opacity=".25" />
          <g transform="rotate(-18 112 92)">
            <ellipse cx="112" cy="82" rx="20" ry="24" fill={`url(#m${id})`} />
            <rect x="104" y="96" width="16" height="44" rx="8" fill={`url(#m${id})`} />
            <ellipse cx="106" cy="76" rx="7" ry="9" fill="#11151f" />
          </g>
          <g transform="rotate(18 188 92)">
            <ellipse cx="188" cy="82" rx="20" ry="24" fill={`url(#m${id})`} />
            <rect x="180" y="96" width="16" height="44" rx="8" fill={`url(#m${id})`} />
            <ellipse cx="194" cy="76" rx="7" ry="9" fill="#11151f" />
          </g>
          {gloss('M100 150 Q100 128 140 128 L180 128 L100 220 Z')}
        </>
      );
      break;
    case 'charger':
      art = (
        <>
          <path d="M150 210 C 150 250, 70 240, 60 270" stroke={c3} strokeWidth="9" fill="none" strokeLinecap="round" />
          <path d="M150 210 C 150 250, 70 240, 60 270" stroke={c1} strokeOpacity=".4" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="128" y="52" width="9" height="34" rx="3" fill="#b7bfcc" />
          <rect x="163" y="52" width="9" height="34" rx="3" fill="#b7bfcc" />
          <rect x="92" y="80" width="116" height="132" rx="26" fill={`url(#m${id})`} />
          <rect x="92" y="80" width="116" height="132" rx="26" fill={`url(#e${id})`} opacity=".6" />
          <rect x="128" y="186" width="44" height="10" rx="5" fill="#0b0d12" />
          <rect x="132" y="168" width="36" height="9" rx="4.5" fill="#0b0d12" />
          <text x="150" y="140" textAnchor="middle" fill={shade(color, color === '#f0f0f0' || color === '#f4f4f4' ? -120 : 120)} opacity=".6" fontSize="16" fontFamily="Readex Pro, sans-serif" fontWeight="700">GaN</text>
          <circle cx="150" cy="104" r="3" fill="#2f7bff" />
          {gloss('M92 106 Q92 80 118 80 L170 80 L92 180 Z')}
        </>
      );
      break;
    case 'case':
      art = (
        <>
          <g transform="rotate(-8 150 150)">
            <rect x="88" y="26" width="124" height="248" rx="32" fill={c2} opacity={parseInt(c2.slice(1), 16) > 0xcccccc ? 0.35 : 0.95} />
            <rect x="88" y="26" width="124" height="248" rx="32" fill={`url(#e${id})`} opacity=".7" />
            <rect x="98" y="36" width="104" height="228" rx="24" fill="none" stroke="#fff" strokeOpacity=".18" />
            <rect x="100" y="40" width="62" height="66" rx="18" fill="#05070c" opacity=".85" />
            <circle cx="150" cy="170" r="34" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="3" />
            <circle cx="150" cy="170" r="22" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="2" />
            {gloss('M88 60 Q88 26 122 26 L180 26 L88 190 Z')}
          </g>
        </>
      );
      break;
    case 'powerbank':
      art = (
        <>
          <rect x="70" y="50" width="160" height="210" rx="30" fill={`url(#m${id})`} transform="rotate(-6 150 150)" />
          <rect x="70" y="50" width="160" height="210" rx="30" fill={`url(#e${id})`} opacity=".5" transform="rotate(-6 150 150)" />
          <g transform="rotate(-6 150 150)">
            <rect x="110" y="90" width="80" height="44" rx="12" fill="#03050a" />
            <text x="150" y="120" textAnchor="middle" fill="#7aaeff" fontSize="20" fontFamily="Readex Pro, sans-serif" fontWeight="600">100%</text>
            <rect x="128" y="236" width="44" height="10" rx="5" fill="#03050a" />
            {gloss('M70 80 Q70 50 100 50 L170 50 L70 200 Z')}
          </g>
        </>
      );
      break;
    case 'glass':
      art = (
        <>
          <g transform="rotate(-12 150 150) translate(-14 6)">
            <rect x="90" y="30" width="120" height="240" rx="28" fill="#0a0c12" stroke="#2c3346" strokeWidth="2" />
            {screen(96, 36, 108, 228, 23)}
          </g>
          <g transform="rotate(4 150 150) translate(22 -10)">
            <rect x="92" y="32" width="120" height="240" rx="28" fill="#cfe0ff" opacity=".14" stroke="#cfe0ff" strokeOpacity=".7" strokeWidth="1.5" />
            <path d="M100 60 L200 40" stroke="#fff" strokeOpacity=".7" strokeWidth="2" />
            <path d="M96 240 L210 120" stroke="#fff" strokeOpacity=".25" strokeWidth="10" />
          </g>
        </>
      );
      break;
    default:
      art = (
        <>
          <rect x="118" y="20" width="64" height="70" rx="14" fill={shade(color, -10)} />
          <rect x="118" y="210" width="64" height="70" rx="14" fill={shade(color, -10)} />
          <rect x="92" y="72" width="116" height="152" rx="36" fill={`url(#m${id})`} />
          <rect x="208" y="122" width="10" height="26" rx="4" fill={c1} />
          {screen(102, 82, 96, 132, 28)}
          <circle cx="150" cy="148" r="36" fill="none" stroke="#2f7bff" strokeWidth="6" strokeDasharray="160 80" strokeLinecap="round" />
          <circle cx="150" cy="148" r="24" fill="none" stroke="#7aaeff" strokeWidth="5" strokeDasharray="90 60" strokeLinecap="round" />
          <text x="150" y="154" textAnchor="middle" fill="#fff" fontSize="14" fontFamily="Readex Pro, sans-serif" fontWeight="600">10:09</text>
          {gloss('M102 110 Q102 82 130 82 L170 82 L102 190 Z')}
        </>
      );
  }

  return (
    <svg viewBox="0 0 300 300" className={className} role="img" aria-label={name}>
      {defs}
      {shadow}
      {art}
    </svg>
  );
}
