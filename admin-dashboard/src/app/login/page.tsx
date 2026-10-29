'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [loading, setLoading] = useState(false);
  const { register, handleSubmit } = useForm<{ email: string; password: string }>();

  const onSubmit = async (data: { email: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authApi.login(data.email, data.password);
      // Backend envelope: { data: { token, admin }, request_id }
      const body = res.data?.data ?? res.data;
      if (!body?.token || !body?.admin) throw new Error('Invalid login response');
      setAuth(body.token, body.admin);
      router.push('/dashboard');
    } catch (err: any) {
      const msg =
        err.response?.data?.error?.message ||
        err.response?.data?.error ||
        err.message ||
        'Invalid credentials';
      toast.error(typeof msg === 'string' ? msg : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const features = [
    ['Bulk delivery', 'Upload hundreds of frames at once — thumbnails render automatically.'],
    ['Private by default', 'Every gallery is gated. Clients see only what you grant them.'],
    ['Fast previews', 'CDN-backed images load instantly, anywhere in the world.'],
    ['Your brand', 'A calm, elegant client experience on web and mobile.'],
  ];

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--canvas)' }}>
      {/* Left — editorial */}
      <div
        className="hidden lg:flex w-[52%] flex-col justify-between p-14"
        style={{ borderRight: '1px solid var(--line)' }}
      >
        {/* logo.png is 300×215 — keep native aspect ratio */}
        <img
          src="/logo.png"
          alt="SJ Clicks and Films"
          width={300}
          height={215}
          className="h-12 w-auto max-w-none shrink-0 object-contain"
          style={{ aspectRatio: '300 / 215' }}
        />

        <div className="max-w-md">
          <p className="kicker mb-5">The studio workspace</p>
          <h1 className="font-display text-[44px] leading-[1.05] mb-5" style={{ color: 'var(--ink)' }}>
            Deliver galleries your clients will remember.
          </h1>
          <p className="text-[15px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            One quiet place to manage clients, curate collections, and hand over
            every photograph beautifully.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-6 max-w-lg">
          {features.map(([title, desc]) => (
            <div key={title}>
              <div className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>{title}</div>
              <div className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — form */}
      <div className="w-full lg:w-[48%] flex items-center justify-center p-8" style={{ background: 'var(--surface)' }}>
        <div className="w-full max-w-sm animate-fade-up">
          <img
            src="/logo.png"
            alt="SJ Clicks and Films"
            width={300}
            height={215}
            className="lg:hidden h-11 w-auto max-w-none shrink-0 object-contain mb-10"
            style={{ aspectRatio: '300 / 215' }}
          />

          <h2 className="font-display text-3xl mb-2" style={{ color: 'var(--ink)' }}>Welcome back</h2>
          <p className="text-sm mb-8" style={{ color: 'var(--ink-2)' }}>Sign in to your studio dashboard.</p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium mb-2" style={{ color: 'var(--ink)' }}>Email</label>
              <input {...register('email', { required: true })} type="email" className="input" placeholder="admin@yourstudio.com" />
            </div>
            <div>
              <label className="block text-[13px] font-medium mb-2" style={{ color: 'var(--ink)' }}>Password</label>
              <input {...register('password', { required: true })} type="password" className="input" placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full py-3.5 mt-1">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                  Signing in…
                </span>
              ) : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 text-xs text-center" style={{ color: 'var(--ink-3)' }}>
            Protected by JWT authentication
          </p>
        </div>
      </div>
    </div>
  );
}
