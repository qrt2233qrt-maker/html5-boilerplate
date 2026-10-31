import { useState } from 'react';
import type { Product } from '@/types';
import { cx } from '@/lib/format';
import { DeviceArt } from './DeviceArt';

/** صورة المنتج الرسمية مع توهج وانعكاس — أو رسم مولّد عند عدم توفر صورة */
export function ProductMedia({
  product,
  index = 0,
  color,
  className,
  priority = false,
  reflect = true,
}: {
  product: Pick<Product, 'images' | 'category' | 'name' | 'colors'>;
  index?: number;
  color?: string;
  className?: string;
  priority?: boolean;
  reflect?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = product.images[index];
  const c = color ?? product.colors[0];

  return (
    <div className={cx('relative flex items-center justify-center', className)}>
      <div
        aria-hidden
        className="absolute inset-[18%] rounded-full opacity-70 blur-3xl transition-opacity duration-700 group-hover:opacity-100"
        style={{ background: `radial-gradient(circle, rgba(47,123,255,.55), ${c ?? '#2f7bff'}22 55%, transparent 70%)` }}
      />
      {src && !failed ? (
        <img
          src={src}
          alt={product.name}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className={cx(
            'relative z-[1] h-full w-full object-contain drop-shadow-[0_30px_40px_rgba(0,0,0,.65)] transition-transform duration-700 ease-out group-hover:-translate-y-2 group-hover:scale-[1.04]',
            reflect && 'reflect',
          )}
        />
      ) : (
        <DeviceArt
          category={product.category}
          name={product.name}
          color={c}
          className={cx(
            'relative z-[1] h-full w-full drop-shadow-[0_30px_40px_rgba(0,0,0,.6)] transition-transform duration-700 ease-out group-hover:-translate-y-2 group-hover:scale-[1.04]',
            reflect && 'reflect',
          )}
        />
      )}
    </div>
  );
}
