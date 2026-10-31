import { useEffect, useState } from 'react';
import { formatDate, formatIQD } from '@/lib/format';
import { repo, shortRef } from '@/lib/repo';
import type { Booking, BookingStatus, Order, OrderStatus } from '@/types';
import { Icon } from '@/components/ui/Icon';

const bookingStatus: Record<BookingStatus, string> = { new: 'جديد', confirmed: 'مؤكد', in_progress: 'قيد الإصلاح', done: 'مكتمل', cancelled: 'ملغي' };
const orderStatus: Record<OrderStatus, string> = { new: 'جديد', confirmed: 'مؤكد', delivered: 'تم التسليم', cancelled: 'ملغي' };
const badge = (s: string) =>
  s === 'new' ? 'bg-volt-500/15 text-volt-200 ring-volt-500/40'
  : s === 'done' || s === 'delivered' ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
  : s === 'cancelled' ? 'bg-rose-500/10 text-rose-300 ring-rose-500/30'
  : 'bg-amber-500/10 text-amber-200 ring-amber-500/30';

const waTo = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '964')}`;

function useList<T>(loader: () => Promise<T[]>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  const reload = () => loader().then(setItems).catch((e: Error) => setError(e.message));
  useEffect(() => {
    void reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { items, error, reload, setItems };
}

export function BookingsPanel() {
  const { items, error, reload } = useList<Booking>(() => repo.listBookings());
  if (error) return <p className="text-rose-300">{error}</p>;
  if (!items) return <p className="text-slate-500">جارِ التحميل…</p>;
  if (!items.length) return <Empty text="لا توجد حجوزات صيانة بعد" />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((b) => (
        <article key={b.id} className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">{b.name}</h3>
                <span className="ltr text-xs text-slate-500">#{shortRef(b.id)}</span>
              </div>
              <a href={waTo(b.phone)} target="_blank" rel="noreferrer" className="ltr mt-1 inline-flex items-center gap-1 text-sm text-emerald-300 hover:underline">
                <Icon name="whatsapp" size={14} /> {b.phone}
              </a>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs ring-1 ${badge(b.status)}`}>{bookingStatus[b.status]}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">الجهاز</dt><dd className="text-white">{b.device}</dd></div>
            <div><dt className="text-slate-500">الخدمة</dt><dd className="text-white">{b.service}</dd></div>
            <div><dt className="text-slate-500">الموعد</dt><dd className="ltr text-end text-white">{b.date} • {b.time}</dd></div>
            <div><dt className="text-slate-500">أُنشئ</dt><dd className="text-slate-300">{formatDate(b.createdAt)}</dd></div>
          </dl>
          {b.issue && <p className="mt-3 rounded-xl bg-white/[.03] p-3 text-sm text-slate-300">{b.issue}</p>}
          <div className="mt-4 flex items-center gap-2">
            <select
              className="field py-2 text-sm"
              value={b.status}
              onChange={async (e) => { await repo.setBookingStatus(b.id, e.target.value as BookingStatus); void reload(); }}
            >
              {Object.entries(bookingStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
              onClick={async () => { if (confirm('حذف الحجز؟')) { await repo.deleteBooking(b.id); void reload(); } }}
              aria-label="حذف"
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function OrdersPanel() {
  const { items, error, reload } = useList<Order>(() => repo.listOrders());
  if (error) return <p className="text-rose-300">{error}</p>;
  if (!items) return <p className="text-slate-500">جارِ التحميل…</p>;
  if (!items.length) return <Empty text="لا توجد طلبات بعد" />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {items.map((o) => (
        <article key={o.id} className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-white">{o.customerName}</h3>
                <span className="ltr text-xs text-slate-500">#{shortRef(o.id)}</span>
              </div>
              <a href={waTo(o.phone)} target="_blank" rel="noreferrer" className="ltr mt-1 inline-flex items-center gap-1 text-sm text-emerald-300 hover:underline">
                <Icon name="whatsapp" size={14} /> {o.phone}
              </a>
              <p className="mt-1 text-sm text-slate-400">{o.address}</p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-xs ring-1 ${badge(o.status)}`}>{orderStatus[o.status]}</span>
          </div>
          <ul className="mt-4 space-y-1.5 rounded-xl bg-white/[.03] p-3 text-sm">
            {o.items.map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3">
                <span className="text-slate-300">{i.name} × {i.qty}</span>
                <span className="text-white">{formatIQD(i.price * i.qty)}</span>
              </li>
            ))}
          </ul>
          {o.notes && <p className="mt-2 text-sm text-slate-400">📝 {o.notes}</p>}
          <div className="mt-3 flex justify-between text-sm">
            <span className="text-slate-500">{formatDate(o.createdAt)}</span>
            <span className="font-display font-bold text-white">{formatIQD(o.total)}</span>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <select
              className="field py-2 text-sm"
              value={o.status}
              onChange={async (e) => { await repo.setOrderStatus(o.id, e.target.value as OrderStatus); void reload(); }}
            >
              {Object.entries(orderStatus).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
              onClick={async () => { if (confirm('حذف الطلب؟')) { await repo.deleteOrder(o.id); void reload(); } }}
              aria-label="حذف"
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="card flex flex-col items-center gap-3 p-14 text-center text-slate-500">
      <Icon name="box" size={36} className="text-volt-400" />
      {text}
    </div>
  );
}
