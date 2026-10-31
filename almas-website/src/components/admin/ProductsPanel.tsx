import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { t } from '@/i18n';
import { formatIQD } from '@/lib/format';
import { repo } from '@/lib/repo';
import { useCatalog } from '@/store/catalog';
import type { Product } from '@/types';
import { ConfirmButton } from '@/components/ui/ConfirmButton';
import { Icon } from '@/components/ui/Icon';
import { ProductMedia } from '@/components/ui/ProductMedia';
import { ProductForm } from './ProductForm';

export function ProductsPanel() {
  const { products, load } = useCatalog();
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const list = useMemo(
    () => products.filter((p) => `${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase())),
    [products, q],
  );

  const remove = async (p: Product) => {
    setError('');
    try {
      await repo.deleteProduct(p.id);
      await load(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Icon name="search" className="absolute start-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input className="field ps-11" placeholder="بحث في المنتجات…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} />
          إضافة منتج
        </button>
      </div>

      {error && <p className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto" data-lenis-prevent>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-white/[.03] text-slate-400">
              <tr>
                <th className="p-4 text-start font-medium">المنتج</th>
                <th className="p-4 text-start font-medium">الفئة</th>
                <th className="p-4 text-start font-medium">السعر</th>
                <th className="p-4 text-start font-medium">المخزون</th>
                <th className="p-4 text-start font-medium">الصور</th>
                <th className="p-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.05]">
              {list.map((p) => (
                <tr key={p.id} className="transition hover:bg-white/[.02]">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-14 w-14 shrink-0 rounded-xl bg-ink-800">
                        <ProductMedia product={p} className="h-full w-full p-1" reflect={false} />
                      </div>
                      <div className="min-w-0">
                        <div className="line-clamp-1 font-semibold text-white">{p.name}</div>
                        <div className="text-xs text-slate-500">
                          {p.brand}
                          {p.featured && <span className="ms-2 text-volt-300">• مميز</span>}
                          {p.isNew && <span className="ms-2 text-volt-300">• جديد</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-slate-300">{t.categories[p.category]}</td>
                  <td className="p-3 font-semibold text-white">{formatIQD(p.price)}</td>
                  <td className="p-3">
                    <span className={p.stock > 0 ? 'text-emerald-300' : 'text-rose-300'}>{p.stock}</span>
                  </td>
                  <td className="p-3 text-slate-400">{p.images.length || <span className="text-amber-300/80">بدون صورة</span>}</td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <Link to={`/product/${p.slug}`} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-white/5 hover:text-white" aria-label="عرض"><Icon name="external" size={17} /></Link>
                      <button onClick={() => setEditing(p)} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 hover:bg-white/5 hover:text-white" aria-label={t.common.edit}><Icon name="edit" size={17} /></button>
                      <ConfirmButton onConfirm={() => remove(p)} label={t.common.delete} />
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={6} className="p-10 text-center text-slate-500">لا توجد منتجات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ProductForm
          product={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load(true);
          }}
        />
      )}
    </div>
  );
}
