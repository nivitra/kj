'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2 } from 'lucide-react';
import { billingApi, portalApi } from '@/lib/api';
import Modal from '@/components/Modal';

export default function CouponsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['coupons'],
    queryFn: () => billingApi.listCoupons().then((r) => r.data),
  });
  const { data: pkgData } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
  });
  const coupons = data?.coupons || [];
  const packages = pkgData?.packages || [];

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [discountValue, setDiscountValue] = useState('10');
  const [minOrder, setMinOrder] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [packageIds, setPackageIds] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      billingApi.createCoupon({
        code: code.trim().toUpperCase(),
        description: description || undefined,
        discountType,
        discountValue: Number(discountValue),
        minOrderAmount: minOrder ? Number(minOrder) : undefined,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
        expiresAt: expiresAt || undefined,
        packageIds,
        active: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coupons'] });
      toast.success('Coupon created — customers can apply it in the app');
      setOpen(false);
      setCode('');
      setDescription('');
      setDiscountValue('10');
      setMinOrder('');
      setMaxRedemptions('');
      setExpiresAt('');
      setPackageIds([]);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Failed'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      billingApi.updateCoupon(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });

  const del = useMutation({
    mutationFn: (id: string) => billingApi.deleteCoupon(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coupons'] });
      toast.success('Deleted');
    },
  });

  const money = (n: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Billing</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>
            Coupons
          </h1>
          <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>
            Create codes customers can apply in the app. Use the same codes when creating invoices.
          </p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-2 px-4 py-2.5" onClick={() => setOpen(true)}>
          <Plus size={16} /> New coupon
        </button>
      </div>

      <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
        {isLoading && (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>
        )}
        {coupons.map((c: any) => (
          <div key={c.id} className="px-5 py-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-mono font-semibold text-[15px]" style={{ color: 'var(--ink)' }}>
                {c.code}
              </div>
              <div className="text-[13px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
                {c.discountType === 'PERCENT'
                  ? `${c.discountValue}% off`
                  : `${money(c.discountValue)} off`}
                {c.description ? ` · ${c.description}` : ''}
              </div>
              <div className="text-[12px] mt-1" style={{ color: 'var(--ink-3)' }}>
                Used {c.redemptionCount}
                {c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}
                {c.expiresAt ? ` · expires ${new Date(c.expiresAt).toLocaleDateString()}` : ''}
                {(c.packageIds || []).length
                  ? ` · ${c.packageIds.length} package(s)`
                  : ' · all packages'}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => toggle.mutate({ id: c.id, active: !c.active })}
              >
                {c.active ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button"
                className="p-2"
                style={{ color: 'var(--ink-3)' }}
                onClick={() => {
                  if (confirm(`Delete coupon ${c.code}?`)) del.mutate(c.id);
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!isLoading && coupons.length === 0 && (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
            No coupons yet — create one for both customer app and invoices.
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => !create.isPending && setOpen(false)}
        title="New coupon"
        preventClose={create.isPending}
        size="md"
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" onClick={() => setOpen(false)} disabled={create.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={code.trim().length < 2 || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Saving…' : 'Create'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <input
            className="input font-mono uppercase"
            placeholder="CODE *"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <input
            className="input"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              className="input"
              value={discountType}
              onChange={(e) => setDiscountType(e.target.value as 'PERCENT' | 'FIXED')}
            >
              <option value="PERCENT">Percent %</option>
              <option value="FIXED">Fixed amount</option>
            </select>
            <input
              className="input"
              type="number"
              placeholder="Value"
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              className="input"
              type="number"
              placeholder="Min order (optional)"
              value={minOrder}
              onChange={(e) => setMinOrder(e.target.value)}
            />
            <input
              className="input"
              type="number"
              placeholder="Max uses (optional)"
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
            />
          </div>
          <input
            className="input"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <div>
            <div className="text-[12px] font-medium mb-2" style={{ color: 'var(--ink-2)' }}>
              Limit to packages (empty = all)
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {packages.map((p: any) => (
                <label key={p.id} className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
                  <input
                    type="checkbox"
                    checked={packageIds.includes(p.id)}
                    onChange={(e) => {
                      setPackageIds((prev) =>
                        e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id),
                      );
                    }}
                  />
                  {p.title}
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
