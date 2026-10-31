import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { categoryIds } from '@/data/seed';
import { t } from '@/i18n';
import { cx } from '@/lib/format';
import { repo } from '@/lib/repo';
import type { Product, ProductInput, Spec } from '@/types';
import { Icon } from '@/components/ui/Icon';
import { ProductMedia } from '@/components/ui/ProductMedia';

const empty: ProductInput = {
  name: '', brand: '', category: 'phones', price: 0, oldPrice: null, description: '',
  specs: [], colors: [], images: [], stock: 10, featured: false, isNew: true,
};

export function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: () => void }) {
  const [p, setP] = useState<ProductInput>(() => (product ? { ...product } : { ...empty }));
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setP((s) => ({ ...s, [k]: v }));

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setError('');
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        const url = await repo.uploadImage(f);
        setP((s) => ({ ...s, images: [...s.images, url] }));
      } catch (e) {
        setError(`فشل رفع ${f.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void upload(e.dataTransfer.files);
  };

  const moveImage = (i: number, dir: -1 | 1) =>
    setP((s) => {
      const imgs = [...s.images];
      const j = i + dir;
      if (j < 0 || j >= imgs.length) return s;
      [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
      return { ...s, images: imgs };
    });

  const setSpec = (i: number, k: keyof Spec, v: string) =>
    setP((s) => ({ ...s, specs: s.specs.map((sp, idx) => (idx === i ? { ...sp, [k]: v } : sp)) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await repo.saveProduct(
        { ...p, specs: p.specs.filter((s) => s.label.trim() && s.value.trim()), price: Number(p.price), oldPrice: p.oldPrice ? Number(p.oldPrice) : null, stock: Number(p.stock) },
        product?.id,
      );
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-end bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        data-lenis-prevent
        className="flex h-full w-full max-w-3xl flex-col border-s border-white/10 bg-ink-900"
      >
        <div className="flex items-center justify-between border-b border-white/[.06] p-5">
          <h2 className="text-xl font-bold">{product ? 'تعديل المنتج' : 'إضافة منتج جديد'}</h2>
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border border-white/10" aria-label="إغلاق">
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5 sm:p-7">
          {/* الصور */}
          <section>
            <span className="label">صور المنتج (الصورة الأولى هي الرئيسية)</span>
            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={cx(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition',
                drag ? 'border-volt-400 bg-volt-500/10' : 'border-white/15 hover:border-volt-500/50 hover:bg-white/[.02]',
              )}
            >
              <Icon name="upload" size={30} className="text-volt-400" />
              <span className="font-medium">اسحب الصور هنا أو اضغط للاختيار</span>
              <span className="text-xs text-slate-500">PNG, JPG, WEBP — تُضغط تلقائياً لتسريع الموقع. يُفضّل صور بخلفية شفافة أو داكنة.</span>
              {uploading > 0 && <span className="text-sm text-volt-300">جارِ رفع {uploading} صورة…</span>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }} />
            {p.images.length > 0 ? (
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">
                {p.images.map((src, i) => (
                  <div key={src + i} className={cx('group relative aspect-square overflow-hidden rounded-xl border bg-ink-800 p-2', i === 0 ? 'border-volt-500' : 'border-white/10')}>
                    <img src={src} alt="" className="h-full w-full object-contain" />
                    <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition group-hover:opacity-100">
                      <button type="button" onClick={() => moveImage(i, -1)} className="grid h-7 w-7 place-items-center rounded-full bg-black/70 text-xs" aria-label="تقديم">→</button>
                      <button type="button" onClick={() => set('images', p.images.filter((_, j) => j !== i))} className="grid h-7 w-7 place-items-center rounded-full bg-rose-600/90" aria-label="حذف"><Icon name="trash" size={14} /></button>
                      <button type="button" onClick={() => moveImage(i, 1)} className="grid h-7 w-7 place-items-center rounded-full bg-black/70 text-xs" aria-label="تأخير">←</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-4 rounded-2xl bg-white/[.02] p-3 text-sm text-slate-500">
                <ProductMedia product={{ ...p, images: [] }} className="h-20 w-20 shrink-0" reflect={false} />
                بدون صورة: سيظهر المنتج برسم ثلاثي الأبعاد مولّد تلقائياً حسب الفئة واللون.
              </div>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="pf-name">اسم المنتج *</label>
              <input id="pf-name" className="field" required value={p.name} onChange={(e) => set('name', e.target.value)} placeholder="مثال: iPhone 17 Pro Max 256GB" />
            </div>
            <div>
              <label className="label" htmlFor="pf-brand">الماركة</label>
              <input id="pf-brand" className="field" value={p.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Apple / Samsung …" list="brand-list" />
              <datalist id="brand-list">{['Apple', 'Samsung', 'Xiaomi', 'Huawei', 'Honor', 'Anker', 'Baseus', 'JBL'].map((b) => <option key={b} value={b} />)}</datalist>
            </div>
            <div>
              <label className="label" htmlFor="pf-cat">الفئة *</label>
              <select id="pf-cat" className="field" value={p.category} onChange={(e) => set('category', e.target.value as ProductInput['category'])}>
                {categoryIds.map((c) => <option key={c} value={c}>{t.categories[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="pf-price">السعر (د.ع) *</label>
              <input id="pf-price" className="field ltr" type="number" min={0} step={250} required value={p.price || ''} onChange={(e) => set('price', Number(e.target.value))} />
            </div>
            <div>
              <label className="label" htmlFor="pf-old">السعر قبل الخصم (اختياري)</label>
              <input id="pf-old" className="field ltr" type="number" min={0} step={250} value={p.oldPrice ?? ''} onChange={(e) => set('oldPrice', e.target.value ? Number(e.target.value) : null)} />
            </div>
            <div>
              <label className="label" htmlFor="pf-stock">الكمية المتوفرة</label>
              <input id="pf-stock" className="field ltr" type="number" min={0} value={p.stock} onChange={(e) => set('stock', Number(e.target.value))} />
            </div>
            <div className="flex items-end gap-5 pb-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-volt-500" checked={p.featured} onChange={(e) => set('featured', e.target.checked)} />
                مميز في الرئيسية
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-5 w-5 accent-volt-500" checked={p.isNew} onChange={(e) => set('isNew', e.target.checked)} />
                شارة «جديد»
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="pf-desc">الوصف</label>
              <textarea id="pf-desc" className="field min-h-28" value={p.description} onChange={(e) => set('description', e.target.value)} />
            </div>
          </section>

          <section>
            <span className="label">الألوان المتاحة</span>
            <div className="flex flex-wrap items-center gap-2">
              {p.colors.map((c, i) => (
                <button key={c + i} type="button" onClick={() => set('colors', p.colors.filter((_, j) => j !== i))} className="group relative h-10 w-10 rounded-full ring-1 ring-white/20" style={{ background: c }} title="حذف اللون">
                  <span className="absolute inset-0 hidden place-items-center rounded-full bg-black/60 group-hover:grid"><Icon name="close" size={14} /></span>
                </button>
              ))}
              <button type="button" onClick={() => colorRef.current?.click()} className="grid h-10 w-10 place-items-center rounded-full border border-dashed border-white/30 text-slate-400 hover:border-volt-400 hover:text-white" aria-label="إضافة لون">
                <Icon name="plus" size={18} />
              </button>
              <input ref={colorRef} type="color" className="sr-only" onChange={(e) => set('colors', [...p.colors, e.target.value])} />
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="label mb-0">المواصفات</span>
              <button type="button" className="text-sm text-volt-300 hover:text-white" onClick={() => set('specs', [...p.specs, { label: '', value: '' }])}>+ إضافة مواصفة</button>
            </div>
            <div className="space-y-2">
              {p.specs.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input className="field py-2.5" placeholder="مثال: الشاشة" value={s.label} onChange={(e) => setSpec(i, 'label', e.target.value)} />
                  <input className="field py-2.5" placeholder="6.7 بوصة" value={s.value} onChange={(e) => setSpec(i, 'value', e.target.value)} />
                  <button type="button" onClick={() => set('specs', p.specs.filter((_, j) => j !== i))} className="shrink-0 px-2 text-slate-500 hover:text-rose-400" aria-label="حذف"><Icon name="trash" size={18} /></button>
                </div>
              ))}
            </div>
          </section>
          {error && <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        </div>

        <div className="pb-safe flex gap-3 border-t border-white/[.06] p-5">
          <button className="btn-primary flex-1" disabled={busy || uploading > 0}>{busy ? 'جارِ الحفظ…' : t.common.save}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>{t.common.cancel}</button>
        </div>
      </form>
    </div>
  );
}
