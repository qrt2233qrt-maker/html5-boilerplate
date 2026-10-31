import { useEffect, useState } from 'react';
import { Icon } from './Icon';

/** زر حذف بخطوتين داخل الصفحة (بديل confirm() الذي لا يعمل في كل المتصفحات المضمّنة) */
export function ConfirmButton({ onConfirm, label = 'حذف' }: { onConfirm: () => void | Promise<void>; label?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(id);
  }, [armed]);

  return armed ? (
    <button
      type="button"
      onClick={async () => { setArmed(false); await onConfirm(); }}
      className="h-9 shrink-0 rounded-full bg-rose-600 px-3 text-xs font-semibold text-white transition hover:bg-rose-500"
    >
      تأكيد الحذف
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setArmed(true)}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
      aria-label={label}
      title={label}
    >
      <Icon name="trash" size={17} />
    </button>
  );
}
