import { useState, type FormEvent } from 'react';
import { DEMO_ADMIN, repo } from '@/lib/repo';
import { LogoMark } from '@/components/ui/Logo';

export function AdminLogin({ onDone }: { onDone: () => void }) {
  const demo = repo.mode === 'demo';
  const [email, setEmail] = useState(demo ? DEMO_ADMIN.email : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await repo.signIn(email, password);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <div className="grid-bg absolute inset-0 -z-10" />
      <div className="absolute left-1/2 top-1/3 -z-10 h-96 w-96 -translate-x-1/2 rounded-full bg-volt-600/25 blur-[120px]" />
      <form onSubmit={submit} className="card w-full max-w-md space-y-5 p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <LogoMark size={56} />
          <h1 className="text-2xl font-bold">لوحة تحكم الماس</h1>
          <p className="text-sm text-slate-400">سجّل الدخول لإدارة المنتجات والطلبات والحجوزات</p>
        </div>
        {demo && (
          <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm leading-7 text-amber-100">
            <strong>الوضع التجريبي:</strong> البيانات تُحفظ في هذا المتصفح فقط. لتفعيل الحفظ الحقيقي اربط Supabase (راجع README).
            <br />
            كلمة المرور التجريبية: <code className="ltr rounded bg-black/30 px-1.5">{DEMO_ADMIN.password}</code>
          </div>
        )}
        <div>
          <label className="label" htmlFor="a-email">البريد الإلكتروني</label>
          <input id="a-email" className="field ltr" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="a-pass">كلمة المرور</label>
          <input id="a-pass" className="field ltr" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'جارِ الدخول…' : 'دخول'}</button>
      </form>
    </div>
  );
}
