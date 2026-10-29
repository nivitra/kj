'use client';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Search, Plus, Phone, ChevronRight, Copy, Check, X, Images, UserRound, Users } from 'lucide-react';
import { adminApi, galleryApi, portalApi } from '@/lib/api';
import Link from 'next/link';
import Modal from '@/components/Modal';

type CreateForm = {
  name: string;
  phone: string;
  notes: string;
  status: string;
  loginId: string;
  password: string;
  agreementTitle: string;
  packageId: string;
};

type KindFilter = 'clients' | 'guests' | 'all';

/** Toggle chip: empty string = off */
type ChipValue = string;

export default function ClientsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<KindFilter>('clients');
  const [gallery, setGallery] = useState<ChipValue>('');
  const [login, setLogin] = useState<ChipValue>('');
  const [account, setAccount] = useState<ChipValue>('');
  const [pkgFilter, setPkgFilter] = useState<ChipValue>('');
  const [packageIdFilter, setPackageIdFilter] = useState('');
  const [phoneFilter, setPhoneFilter] = useState<ChipValue>('');
  const [experience, setExperience] = useState<ChipValue>('');
  const [showModal, setShowModal] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('new') === '1';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const url = new URL(window.location.href);
    let dirty = false;
    if (params.get('new') === '1') {
      url.searchParams.delete('new');
      dirty = true;
    }
    if (params.get('package') === 'none') {
      setPkgFilter('none');
      url.searchParams.delete('package');
      dirty = true;
    }
    if (dirty) window.history.replaceState({}, '', url.pathname + url.search);
  }, []);
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<string[]>([]);
  const [createdCreds, setCreatedCreds] = useState<{ loginId: string; password: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { register, handleSubmit, reset } = useForm<CreateForm>({
    defaultValues: { agreementTitle: 'Client agreement', packageId: '', status: '' },
  });

  const listParams = useMemo(() => {
    const p: Record<string, string | number> = { kind, limit: 100 };
    if (search.trim()) p.search = search.trim();
    if (gallery) p.gallery = gallery;
    if (login) p.login = login;
    if (account) p.account = account;
    if (packageIdFilter) p.packageId = packageIdFilter;
    else if (pkgFilter) p.package = pkgFilter;
    if (phoneFilter) p.phone = phoneFilter;
    if (experience) p.experience = experience;
    return p;
  }, [kind, search, gallery, login, account, pkgFilter, packageIdFilter, phoneFilter, experience]);

  const activeChipCount = [gallery, login, account, pkgFilter, packageIdFilter, phoneFilter, experience].filter(Boolean).length;

  const clearFilters = () => {
    setGallery('');
    setLogin('');
    setAccount('');
    setPkgFilter('');
    setPackageIdFilter('');
    setPhoneFilter('');
    setExperience('');
    setSearch('');
    setKind('clients');
  };

  const toggleChip = (current: ChipValue, value: string, set: (v: ChipValue) => void) => {
    set(current === value ? '' : value);
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['customers', listParams],
    queryFn: () => adminApi.customers(listParams).then((r) => r.data),
    staleTime: 10000,
  });

  const { data: packagesData } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
    staleTime: 60000,
  });
  const packages = (packagesData?.packages || []).filter((p: any) => p.active !== false);

  const { data: galleriesData } = useQuery({
    queryKey: ['galleries-all'],
    queryFn: () => galleryApi.list({ limit: 100 }).then((r) => r.data),
    staleTime: 60000,
  });
  const allGalleries = galleriesData?.galleries || [];

  const createMutation = useMutation({
    mutationFn: async (d: CreateForm) => {
      const payload: any = {
        name: d.name.trim(),
        phone: d.phone?.trim(),
        notes: d.notes?.trim() || undefined,
        status: d.status?.trim() || undefined,
      };
      if (d.loginId?.trim()) payload.loginId = d.loginId.trim();
      if (d.password?.trim()) payload.password = d.password.trim();
      if (selectedGalleryIds.length) payload.galleryIds = selectedGalleryIds;

      const res = await adminApi.createCustomer(payload);
      const body = res.data;
      const customerId = body.id;
      const credentials = body.credentials || {
        loginId: body.loginId || d.phone?.trim(),
        password: d.password,
        phone: body.phone || d.phone?.trim(),
      };

      // Assign unified package (same list as Packages page)
      if (d.packageId?.trim() && customerId) {
        await adminApi.assignPackagePricing(customerId, {
          servicePackageId: d.packageId.trim(),
        });
      }

      if (agreementFile && customerId) {
        await adminApi.uploadContract({
          customerId,
          title: d.agreementTitle?.trim() || 'Client agreement',
          file: agreementFile,
        });
      }

      return { body, credentials, name: d.name.trim() };
    },
    onSuccess: ({ credentials, name }) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setShowModal(false);
      reset({ agreementTitle: 'Client agreement', packageId: '', status: '' });
      setAgreementFile(null);
      setSelectedGalleryIds([]);
      setCreatedCreds({ ...credentials, name });
      toast.success('Client created');
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Failed to create'),
  });

  const toggleGallery = (gid: string) => {
    setSelectedGalleryIds((prev) =>
      prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid],
    );
  };

  const copyCreds = async () => {
    if (!createdCreds) return;
    const phone = (createdCreds as any).phone || createdCreds.loginId;
    const text = `Phone: ${phone}\nPassword: ${createdCreds.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy');
    }
  };

  const facets = data?.facets || { clients: 0, guests: 0, all: 0 };
  const kindTabs: { id: KindFilter; label: string; count: number; icon: React.ElementType }[] = [
    { id: 'clients', label: 'Clients', count: facets.clients ?? 0, icon: UserRound },
    { id: 'guests', label: 'Guests', count: facets.guests ?? 0, icon: Users },
    { id: 'all', label: 'Everyone', count: facets.all ?? 0, icon: Users },
  ];

  const chips: { key: string; label: string; value: string; active: string; set: (v: ChipValue) => void; tone?: string }[] = [
    { key: 'gal-has', label: 'Has gallery', value: 'has', active: gallery, set: setGallery },
    { key: 'gal-none', label: 'No gallery', value: 'none', active: gallery, set: setGallery },
    { key: 'login-never', label: 'Never signed in', value: 'never', active: login, set: setLogin },
    { key: 'login-ok', label: 'Signed in', value: 'signed_in', active: login, set: setLogin },
    { key: 'pkg-has', label: 'Has package', value: 'has', active: pkgFilter, set: setPkgFilter },
    { key: 'pkg-none', label: 'No package', value: 'none', active: pkgFilter, set: setPkgFilter },
    { key: 'exp-wedding', label: 'Wedding', value: 'wedding', active: experience, set: setExperience },
    { key: 'exp-custom', label: 'Custom', value: 'custom', active: experience, set: setExperience },
    { key: 'phone-none', label: 'No phone', value: 'none', active: phoneFilter, set: setPhoneFilter },
    { key: 'acct-off', label: 'Disabled', value: 'disabled', active: account, set: setAccount },
  ];

  return (
    <div className="animate-fade-up">
      <div className="flex items-end justify-between mb-7 gap-4 flex-wrap">
        <div>
          <p className="kicker mb-2">Clients &amp; workflow</p>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--ink)' }}>Clients</h1>
          <p className="text-[14px] mt-1.5" style={{ color: 'var(--ink-2)' }}>
            {isLoading ? 'Loading…' : (
              <>
                <strong style={{ color: 'var(--ink)' }}>{data?.total ?? 0}</strong>
                {kind === 'guests' ? ' guests' : kind === 'all' ? ' people' : ' clients'}
                {activeChipCount > 0 || search.trim() ? ' matching filters' : ' in this view'}
                {isFetching && !isLoading ? ' · updating…' : ''}
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => { setShowModal(true); setAgreementFile(null); setSelectedGalleryIds([]); }}
          className="btn-primary flex items-center gap-2 px-4 py-2.5"
        >
          <Plus size={16} /> New client
        </button>
      </div>

      {/* Kind tabs: Clients / Guests / Everyone */}
      <div
        className="flex flex-wrap gap-1 p-1 mb-4 rounded-2xl w-full sm:w-fit"
        style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line)' }}
        role="tablist"
        aria-label="Customer type"
      >
        {kindTabs.map((t) => {
          const on = kind === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setKind(t.id)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[13px] font-medium transition-colors"
              style={{
                background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--ink)' : 'var(--ink-2)',
                boxShadow: on ? '0 1px 2px rgba(0,0,0,0.06), inset 0 0 0 1px var(--line)' : undefined,
              }}
            >
              <Icon size={15} strokeWidth={on ? 2.2 : 1.8} />
              {t.label}
              <span
                className="text-[11px] font-semibold min-w-[1.25rem] text-center px-1.5 py-0.5 rounded-full"
                style={{
                  background: on ? 'var(--surface-sunken)' : 'var(--surface)',
                  color: 'var(--ink-3)',
                }}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone, or email…"
          className="input pl-10"
          type="search"
          autoComplete="off"
        />
      </div>

      {/* Quick filter chips */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex items-center gap-1.5 flex-nowrap min-w-0">
          {chips.map((c) => {
            const on = c.active === c.value;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleChip(c.active, c.value, c.set)}
                className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                style={{
                  background: on ? 'var(--nav-active-bg)' : 'var(--surface)',
                  color: on ? 'var(--ink)' : 'var(--ink-2)',
                  border: `1px solid ${on ? 'var(--nav-active-ring)' : 'var(--line)'}`,
                  boxShadow: on ? 'inset 0 0 0 1px var(--nav-active-ring)' : undefined,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {(activeChipCount > 0 || search.trim() || kind !== 'clients') && (
          <button
            type="button"
            onClick={clearFilters}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] font-medium"
            style={{ color: 'var(--ink-2)', border: '1px dashed var(--line)' }}
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {packages.length > 0 && (
        <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
            Package
          </span>
          {packages.map((p: any) => {
            const on = packageIdFilter === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setPackageIdFilter(on ? '' : p.id);
                  if (!on) setPkgFilter('');
                }}
                className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                style={{
                  background: on ? 'var(--nav-active-bg)' : 'var(--surface)',
                  color: on ? 'var(--ink)' : 'var(--ink-2)',
                  border: `1px solid ${on ? 'var(--nav-active-ring)' : 'var(--line)'}`,
                  boxShadow: on ? 'inset 0 0 0 1px var(--nav-active-ring)' : undefined,
                }}
              >
                {p.title || p.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
        {isLoading && <div className="text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>}
        {data?.customers?.map((c: any) => {
          const gCount = c.galleryCount ?? c._count?.accessGrants ?? 0;
          return (
            <Link
              key={c.id}
              href={`/dashboard/clients/${c.id}`}
              className="flex items-center justify-between px-5 py-4 transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-[var(--surface-sunken)]"
              style={{ borderColor: 'var(--line-2)', opacity: c.accountStatus === 'DISABLED' ? 0.55 : 1 }}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm shrink-0"
                  style={{ background: 'var(--surface-sunken)', color: 'var(--ink)' }}
                >
                  {c.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-2 flex-wrap" style={{ color: 'var(--ink)' }}>
                    {c.name}
                    {c.isGuest && <span className="badge badge-blue text-[10px]">guest</span>}
                    {c.accountStatus === 'DISABLED' && <span className="badge badge-rose text-[10px]">disabled</span>}
                    {gCount === 0 && !c.isGuest && (
                      <span className="badge badge-neutral text-[10px]">no gallery</span>
                    )}
                  </div>
                  <div className="text-[13px] flex items-center gap-3 mt-0.5 flex-wrap" style={{ color: 'var(--ink-2)' }}>
                    {c.phone ? (
                      <span className="flex items-center gap-1 truncate"><Phone size={12} />{c.phone}</span>
                    ) : (
                      <span className="badge badge-amber text-[10px]">no phone</span>
                    )}
                    {!c.phone && c.email && (
                      <span className="truncate text-[12px]" style={{ color: 'var(--ink-3)' }}>{c.email}</span>
                    )}
                    {c.status && <span className="badge badge-amber text-[11px]">{c.status}</span>}
                    {c.package?.name && <span className="badge badge-neutral text-[11px]">{c.package.name}</span>}
                  </div>
                  <div className="text-[11px] mt-1 flex items-center gap-2 flex-wrap" style={{ color: 'var(--ink-3)' }}>
                    <span>Joined {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—'}</span>
                    <span>·</span>
                    <span>{c.lastLoginAt ? `Last login ${new Date(c.lastLoginAt).toLocaleDateString()}` : 'Never signed in'}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Images size={11} />
                      {gCount} {gCount === 1 ? 'gallery' : 'galleries'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0" style={{ color: 'var(--ink-3)' }}>
                <ChevronRight size={16} />
              </div>
            </Link>
          );
        })}
        {data?.customers?.length === 0 && !isLoading && (
          <div className="text-center py-14 px-4">
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>
              {activeChipCount || search.trim() || kind !== 'clients'
                ? 'No one matches these filters'
                : 'No clients yet'}
            </p>
            <p className="text-[13px] mb-3" style={{ color: 'var(--ink-3)' }}>
              {activeChipCount || search.trim() || kind !== 'clients'
                ? 'Try another tab or clear filters.'
                : 'Add your first client to get started.'}
            </p>
            {(activeChipCount > 0 || search.trim() || kind !== 'clients') && (
              <button type="button" className="btn-ghost px-3 py-2 text-sm" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <Modal
        open={showModal}
        onClose={() => !createMutation.isPending && setShowModal(false)}
        title="New client"
        description="Name + phone are required. Client signs in with phone and password."
        preventClose={createMutation.isPending}
        size="md"
        footer={
          <>
            <button type="button" form="create-client-form" onClick={() => setShowModal(false)} className="btn-ghost flex-1 py-2.5" disabled={createMutation.isPending}>Cancel</button>
            <button type="submit" form="create-client-form" disabled={createMutation.isPending} className="btn-primary flex-1 py-2.5">
              {createMutation.isPending ? 'Creating…' : 'Create client'}
            </button>
          </>
        }
      >
        <form id="create-client-form" onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
          <input {...register('name', { required: true })} placeholder="Full name *" className="input" />
          <input {...register('phone', { required: true })} placeholder="Phone number * (e.g. 98765… or 9198…)" className="input" type="tel" />

          <div className="pt-1">
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>Status (shown to client)</p>
            <input
              {...register('status')}
              placeholder="e.g. Selection in progress · Payment pending · Ready for delivery"
              className="input"
              list="client-status-suggestions"
            />
            <datalist id="client-status-suggestions">
              <option value="Welcome — galleries coming soon" />
              <option value="Photos ready — please select your favorites" />
              <option value="Selection received — editing in progress" />
              <option value="Payment pending" />
              <option value="Ready for delivery" />
              <option value="Completed" />
            </datalist>
          </div>

          <div className="pt-1">
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>Package</p>
            <select {...register('packageId')} className="input">
              <option value="">No package (assign later)</option>
              {packages.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.title || p.name}
                  {p.includedPhotos != null ? ` · ${p.includedPhotos} photos` : ''}
                  {p.pricePerExtraPhoto != null ? ` · ₹${p.pricePerExtraPhoto}/extra` : ''}
                  {(p.discountPrice ?? p.price) != null ? ` · ₹${p.discountPrice ?? p.price}` : ''}
                </option>
              ))}
            </select>
            {packages.length === 0 && (
              <p className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>
                Create packages under Packages first — that is the only list.
              </p>
            )}
          </div>

          <div className="pt-1">
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>
              Galleries ({selectedGalleryIds.length} selected)
            </p>
            <p className="text-[12px] mb-2" style={{ color: 'var(--ink-3)' }}>
              Grant one or more galleries now — client only sees these after you publish them.
            </p>
            <div className="max-h-40 overflow-y-auto rounded-xl border p-2 space-y-1" style={{ borderColor: 'var(--line)' }}>
              {allGalleries.length === 0 && (
                <p className="text-[12px] p-2" style={{ color: 'var(--ink-3)' }}>No galleries yet.</p>
              )}
              {allGalleries.map((g: any) => {
                const on = selectedGalleryIds.includes(g.id);
                return (
                  <label
                    key={g.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[13px]"
                    style={{ background: on ? 'var(--surface-sunken)' : 'transparent', color: 'var(--ink)' }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleGallery(g.id)} />
                    <span className="truncate flex-1">{g.name}</span>
                    <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>{g.status}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="pt-1">
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>Password</p>
            <p className="text-[12px] mb-2" style={{ color: 'var(--ink-3)' }}>
              Client signs in with their <strong>phone number</strong>. Leave password blank to auto-generate.
            </p>
            <input {...register('password')} type="text" placeholder="Password (optional — auto if blank)" className="input font-mono text-sm" autoComplete="new-password" />
          </div>

          <div className="pt-1">
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>Notes</p>
            <textarea {...register('notes')} placeholder="Internal notes about this client…" rows={3} className="input resize-none" />
          </div>

          <div className="pt-1">
            <p className="text-[12px] font-semibold mb-2" style={{ color: 'var(--ink)' }}>Agreement (PDF)</p>
            <input {...register('agreementTitle')} placeholder="Agreement title" className="input mb-2" />
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="block w-full text-[13px]"
              style={{ color: 'var(--ink-2)' }}
              onChange={(e) => setAgreementFile(e.target.files?.[0] || null)}
            />
            {agreementFile && (
              <p className="text-[12px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
                {agreementFile.name} ({Math.round(agreementFile.size / 1024)} KB)
              </p>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={!!createdCreds}
        onClose={() => setCreatedCreds(null)}
        title="Share these credentials"
        description={createdCreds ? `Shown once. Send them securely to ${createdCreds.name}.` : undefined}
        size="sm"
        footer={
          <>
            <button type="button" onClick={copyCreds} className="btn-ghost flex-1 py-2.5 flex items-center justify-center gap-2">
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => setCreatedCreds(null)} className="btn-primary flex-1 py-2.5">Done</button>
          </>
        }
      >
        {createdCreds && (
          <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line)' }}>
            <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>Phone (sign-in)</div>
            <div className="font-mono text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {(createdCreds as any).phone || createdCreds.loginId}
            </div>
            <div className="text-[12px] pt-2" style={{ color: 'var(--ink-3)' }}>Password</div>
            <div className="font-mono text-sm font-semibold" style={{ color: 'var(--ink)' }}>{createdCreds.password}</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
