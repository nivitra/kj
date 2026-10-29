'use client';
import ShareLinkButton from '@/components/ShareLinkButton';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { use, useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, Plus, X, Images, FileText, KeyRound, CheckSquare, Copy, Package, ShieldOff, ShieldCheck, Trash2, Info, Download, Eye, Pencil, ExternalLink, Receipt } from 'lucide-react';
import Link from 'next/link';
import { adminApi, galleryApi, portalApi, billingApi } from '@/lib/api';
import Modal from '@/components/Modal';
import ImageCropModal from '@/components/ImageCropModal';

const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    PUBLISHED: 'badge-green',
    DRAFT: 'badge-neutral',
    ARCHIVED: 'badge-amber',
    EXPIRED: 'badge-rose',
    SUBMITTED: 'badge-green',
    UNLOCKED: 'badge-amber',
    OPEN: 'badge-neutral',
    SENT: 'badge-neutral',
    VIEWED: 'badge-amber',
    ACCEPTED: 'badge-green',
    FINALIZED: 'badge-neutral',
    PAID: 'badge-green',
    PARTIALLY_PAID: 'badge-amber',
    VOID: 'badge-rose',
    WRITTEN_OFF: 'badge-green',
  };
  const label = s === 'WRITTEN_OFF' ? 'paid' : s.toLowerCase().replace(/_/g, ' ');
  return <span className={`badge ${map[s] || 'badge-neutral'}`}>{label}</span>;
};

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<string[]>([]);
  const [showAgreement, setShowAgreement] = useState(false);
  const [agreementTitle, setAgreementTitle] = useState('Client agreement');
  const [agreementFile, setAgreementFile] = useState<File | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [issuedPassword, setIssuedPassword] = useState<{ loginId: string; password: string } | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<string | null>(null);
  const [packageDraft, setPackageDraft] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [paymentTermsDraft, setPaymentTermsDraft] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<any>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [payMethod, setPayMethod] = useState('CASH');
  const [payReference, setPayReference] = useState('');
  const [payKey, setPayKey] = useState('');
  const [pdfViewer, setPdfViewer] = useState<{ url: string; title: string } | null>(null);
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'galleries' | 'agreements' | 'selections' | 'invoices' | 'notes'>('overview');
  const [weddingOn, setWeddingOn] = useState(false);
  const [brideName, setBrideName] = useState('');
  const [groomName, setGroomName] = useState('');
  const [weddingDate, setWeddingDate] = useState('');
  const [weddingVenue, setWeddingVenue] = useState('');

  const [albumStatus, setAlbumStatus] = useState('');
  const [deliveryStatusW, setDeliveryStatusW] = useState('');
  const [photographerName, setPhotographerName] = useState('');
  const [cinematographerName, setCinematographerName] = useState('');
  const [weddingNotes, setWeddingNotes] = useState('');
  const [weddingHydrated, setWeddingHydrated] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizTierId, setWizTierId] = useState('');
  const [wizServicePkgId, setWizServicePkgId] = useState('');
  const [wizGalleryId, setWizGalleryId] = useState('');
  const [wizLimit, setWizLimit] = useState('');
  const [wizExtra, setWizExtra] = useState('350');
  const [wizApplyGal, setWizApplyGal] = useState(false);
  const [wizPreview, setWizPreview] = useState<any>(null);
  const [keyCrop, setKeyCrop] = useState<{ slot: 'couple' | 'cover' | 'booking'; src: string } | null>(null);

  const { data: customer } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => adminApi.getCustomer(id).then((r) => r.data),
  });

  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['invoices', id],
    queryFn: () => billingApi.listInvoices({ customerId: id }).then((r) => r.data),
    enabled: !!id,
  });
  const invoices = invoicesData?.invoices || [];

  useEffect(() => {
    if (!customer || weddingHydrated) return;
    setWeddingHydrated(true);
    setWeddingOn(!!customer.weddingExperience);
    setBrideName(customer.brideName || '');
    setGroomName(customer.groomName || '');
    setWeddingDate(customer.weddingDate ? String(customer.weddingDate).slice(0, 10) : '');
    setWeddingVenue(customer.weddingVenue || '');
    setAlbumStatus(customer.albumStatus || '');
    setDeliveryStatusW(customer.deliveryStatus || '');
    setPhotographerName(customer.photographerName || '');
    setCinematographerName(customer.cinematographerName || '');
    setWeddingNotes(customer.weddingNotes || '');
  }, [customer, weddingHydrated]);

  const weddingMutation = useMutation({
    mutationFn: (payload?: { weddingExperience?: boolean }) => {
      const on = payload?.weddingExperience ?? weddingOn;
      return adminApi.updateCustomer(id, {
        weddingExperience: on,
        brideName: brideName || null,
        groomName: groomName || null,
        weddingDate: weddingDate || null,
        weddingVenue: weddingVenue || null,
        albumStatus: albumStatus || null,
        deliveryStatus: deliveryStatusW || null,
        photographerName: photographerName || null,
        cinematographerName: cinematographerName || null,
        weddingNotes: weddingNotes || null,
      });
    },
    onSuccess: (_res, vars) => {
      const on = vars?.weddingExperience ?? weddingOn;
      qc.invalidateQueries({ queryKey: ['customer', id] });
      toast.success(
        on
          ? 'Wedding experience ON — client sees luxury wedding app after refresh'
          : 'Wedding experience OFF — client back to standard app',
      );
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Save failed'),
  });
  const { data: weddingListData, refetch: refetchWedding } = useQuery({
    queryKey: ['wedding-agreements', id],
    queryFn: () => adminApi.listWeddingAgreements(id).then((r) => r.data),
    enabled: !!id,
  });
  const { data: galleriesData } = useQuery({
    queryKey: ['galleries-all'],
    queryFn: () => galleryApi.list({ limit: 100 }).then((r) => r.data),
  });
  /** Unified packages list (same as Packages page / client app). */
  const { data: servicePkgData } = useQuery({
    queryKey: ['portal-packages'],
    queryFn: () => portalApi.packages().then((r) => r.data),
    staleTime: 60000,
  });
  const packages = servicePkgData?.packages || [];

  const assignWizard = useMutation({
    mutationFn: () =>
      adminApi.assignPackagePricing(id, {
        servicePackageId: wizTierId,
        galleryId: wizGalleryId || null,
        selectionLimit: wizApplyGal && wizLimit !== '' ? Number(wizLimit) : null,
        extraPhotoPrice: wizApplyGal && wizExtra !== '' ? Number(wizExtra) : null,
        applyGalleryOverride: wizApplyGal,
      }),
    onSuccess: (res: any) => {
      const body = res?.data || res;
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setWizPreview(body?.preview || null);
      toast.success('Package assigned — client app, booking & selection use this package');
      setWizardOpen(false);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Could not save'),
  });

  const grantMutation = useMutation({
    mutationFn: () => adminApi.grantAccessBulk(id, selectedGalleryIds),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery'] });
      const n = res.data?.granted ?? selectedGalleryIds.length;
      toast.success(`${n} galler${n === 1 ? 'y' : 'ies'} granted`);
      setShowGrantModal(false);
      setSelectedGalleryIds([]);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const revokeMutation = useMutation({
    mutationFn: (galleryId: string) => adminApi.revokeAccess(id, galleryId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['galleries'] });
      qc.invalidateQueries({ queryKey: ['gallery'] });
      toast.success('Access revoked');
    },
  });

  const notesMutation = useMutation({
    mutationFn: (notes: string) => adminApi.updateCustomer(id, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      toast.success('Notes saved');
      setNotesDraft(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save notes'),
  });

  const contactMutation = useMutation({
    mutationFn: (payload: { name?: string; phone?: string | null }) =>
      adminApi.updateCustomer(id, payload),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      const body = res?.data || res;
      toast.success(
        body?.loginId && body?.phone && body.loginId === body.phone
          ? 'Phone saved — client can sign in with this number'
          : 'Contact updated',
      );
      setEditingContact(false);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Failed to save contact'),
  });

  const startEditContact = () => {
    setNameDraft(customer?.name || '');
    setPhoneDraft(customer?.phone || '');
    setEditingContact(true);
  };

  const statusMutation = useMutation({
    mutationFn: (status: string) => adminApi.updateCustomer(id, { status: status || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Status updated — client can see this');
      setStatusDraft(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save status'),
  });

  const packageMutation = useMutation({
    mutationFn: (servicePackageId: string | null) => {
      if (!servicePackageId) return adminApi.updateCustomer(id, { packageId: null });
      return adminApi.assignPackagePricing(id, { servicePackageId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Package updated');
      setPackageDraft(null);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || 'Failed to assign package'),
  });

  const paymentMutation = useMutation({
    mutationFn: (payload: { paymentTerms?: string | null }) => adminApi.updateCustomer(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      toast.success('Payment terms saved — visible on client profile');
      setPaymentTermsDraft(null);
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed to save payment terms'),
  });

  const sanitizeMoneyInput = (raw: string) => {
    let v = raw.replace(/[^\d.]/g, '');
    const parts = v.split('.');
    if (parts.length > 2) v = `${parts[0]}.${parts.slice(1).join('')}`;
    if (parts[1]?.length > 2) v = `${parts[0]}.${parts[1].slice(0, 2)}`;
    return v;
  };

  const openPay = (inv: any) => {
    setPayInvoice(inv);
    setPayNote('');
    setPayAmount('');
    setPayMethod('CASH');
    setPayReference('');
    setPayKey(crypto.randomUUID());
    setPayOpen(true);
  };

  const updatePaid = useMutation({
    mutationFn: async () => {
      if (!payInvoice) throw new Error('No invoice');
      const amount = Number(payAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the amount received in this payment');
      return billingApi.recordPayment(payInvoice.id, {
        amount, method: payMethod, reference: payReference.trim() || undefined, idempotencyKey: payKey,
        note: payNote.trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['billing-summary'] });
      qc.invalidateQueries({ queryKey: ['customer', id] });
      toast.success('Payment recorded and receipt created');
      setPayOpen(false);
      setPayInvoice(null);
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.message || 'Failed'),
  });

  const passwordMutation = useMutation({
    mutationFn: () => adminApi.resetPassword(id, newPassword.trim() || undefined),
    onSuccess: (res) => {
      const body = res.data;
      if (body.provider === 'cognito') {
        toast.success(body.message || 'Cognito password reset email sent');
        setShowPassword(false);
        return;
      }
      setIssuedPassword({ loginId: body.loginId, password: body.password });
      setShowPassword(false);
      setNewPassword('');
      toast.success('Password updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const disableMutation = useMutation({
    mutationFn: () => adminApi.disableCustomer(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', id] }); toast.success('Customer disabled'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const enableMutation = useMutation({
    mutationFn: () => adminApi.enableCustomer(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', id] }); toast.success('Customer enabled'); },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });
  const deleteMutation = useMutation({
    mutationFn: () => adminApi.deleteCustomer(id),
    onSuccess: () => {
      toast.success('Customer deleted');
      window.location.href = '/dashboard/clients';
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const { data: cognitoInfo, refetch: refetchCognito } = useQuery({
    queryKey: ['customer-cognito', id],
    queryFn: () => adminApi.cognitoDetails(id).then((r) => r.data),
    enabled: !!id,
    staleTime: 30000,
  });

  const agreementMutation = useMutation({
    mutationFn: () => {
      if (!agreementFile) throw new Error('PDF required');
      return adminApi.uploadContract({
        customerId: id,
        title: agreementTitle.trim() || 'Client agreement',
        file: agreementFile,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer', id] });
      refetchWedding();
      toast.success('Agreement uploaded');
      setShowAgreement(false);
      setAgreementFile(null);
      setAgreementTitle('Client agreement');
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.error?.message || e.response?.data?.error || e.message || 'Upload failed'),
  });

  /** Open PDF in in-app viewer (avoids popup blockers on async fetch). */
  const openAgreementPdf = async (opts: {
    id: string;
    title: string;
    kind: 'contract' | 'wedding';
    directUrl?: string | null;
  }) => {
    setPdfLoadingId(opts.id);
    try {
      let url = opts.directUrl || '';
      if (!url) {
        if (opts.kind === 'contract') {
          const r = await adminApi.downloadContract(opts.id);
          url = r.data?.url || r.url || '';
        } else {
          const r = await adminApi.weddingAgreementPdf(opts.id);
          url = r.data?.url || r.url || '';
        }
      }
      if (!url) throw new Error('PDF not available yet');
      setPdfViewer({ url, title: opts.title });
    } catch (e: any) {
      toast.error(
        e?.response?.data?.error?.message ||
          e?.response?.data?.error ||
          e?.message ||
          'Could not open agreement PDF',
      );
    } finally {
      setPdfLoadingId(null);
    }
  };

  if (!customer) {
    return <div className="text-center py-14 text-sm" style={{ color: 'var(--ink-3)' }}>Loading…</div>;
  }

  const grantedGalleryIds = new Set(customer.accessGrants?.map((g: any) => g.galleryId));
  const availableGalleries = galleriesData?.galleries?.filter((g: any) => !grantedGalleryIds.has(g.id)) || [];
  const selections = customer.selections || [];
  const selectionUnread = (s: any) =>
    s.unread === true || !!(s.submittedAt && !s.adminOpenedAt);
  const unreadSelectionCount = selections.filter(selectionUnread).length;
  const contracts = customer.contracts || [];
  const weddingAgreements =
    customer.weddingAgreements || weddingListData?.agreements || [];
  const notesValue = notesDraft !== null ? notesDraft : (customer.notes || '');
  const statusValue = statusDraft !== null ? statusDraft : (customer.status || '');
  // Prefer booking service package id; fall back to matching title from selection tier name
  const packageValue = packageDraft !== null
    ? packageDraft
    : (customer.booking?.servicePackage?.id
      || packages.find((p: any) => p.title === customer.package?.name || p.selectionTierId === customer.packageId)?.id
      || '');

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'galleries' as const, label: `Galleries (${customer.accessGrants?.length || 0})` },
    { id: 'agreements' as const, label: `Agreements (${contracts.length + weddingAgreements.length})` },
    { id: 'selections' as const, label: `Selections (${selections.length})` },
    { id: 'invoices' as const, label: `Invoices (${invoices.length})` },
    { id: 'notes' as const, label: 'Notes' },
  ];

  return (
    <div className="animate-fade-up">
      <Link href="/dashboard/clients" className="inline-flex items-center gap-2 text-sm mb-6 transition-colors" style={{ color: 'var(--ink-2)' }}>
        <ArrowLeft size={16} /> Back to clients
      </Link>

      <div className="card p-6 mb-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 rounded-full flex items-center justify-center font-display text-2xl shrink-0" style={{ background: 'var(--surface-sunken)', color: 'var(--ink)' }}>
              {customer.name[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-[26px] leading-tight flex items-center gap-2 flex-wrap" style={{ color: 'var(--ink)' }}>
                {customer.name}
                {customer.emailVerified && <span className="badge badge-green text-[11px]">email verified</span>}
                {customer.accountStatus === 'DISABLED' && <span className="badge badge-rose text-[11px]">disabled</span>}
              </h1>
              <div className="text-[13px] mt-1 space-y-0.5" style={{ color: 'var(--ink-2)' }}>
                {customer.phone ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium" style={{ color: 'var(--ink)' }}>{customer.phone}</span>
                    <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>phone · sign-in</span>
                  </div>
                ) : (
                  <div className="text-[12px] font-medium" style={{ color: 'var(--amber)' }}>
                    No phone on file — add one so they can sign in & receive WhatsApp
                  </div>
                )}
                {customer.email && (
                  <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                    Email (legacy): {customer.email}
                  </div>
                )}
                {customer.loginId && customer.loginId !== customer.phone && (
                  <div className="font-mono text-[12px]">Login ID: {customer.loginId}</div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="text-[13px] text-right" style={{ color: 'var(--ink-3)' }}>
              <div>Registered {customer.createdAt ? new Date(customer.createdAt).toLocaleDateString() : '—'}</div>
              <div>{customer.lastLoginAt ? `Last login ${new Date(customer.lastLoginAt).toLocaleString()}` : 'Never signed in'}</div>
              <div>{customer.galleryCount ?? customer.accessGrants?.length ?? 0} galleries · storage {(Number(customer.storageUsedBytes || 0) / (1024 * 1024)).toFixed(1)} MB</div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" onClick={startEditContact} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-sm">
                <Pencil size={14} /> {customer.phone ? 'Edit contact' : 'Add phone'}
              </button>
              <button type="button" onClick={() => setShowPassword(true)} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-sm">
                <KeyRound size={14} /> Reset password
              </button>
              {customer.accountStatus === 'DISABLED' ? (
                <button type="button" onClick={() => enableMutation.mutate()} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-sm">
                  <ShieldCheck size={14} /> Enable
                </button>
              ) : (
                <button type="button" onClick={() => disableMutation.mutate()} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-sm">
                  <ShieldOff size={14} /> Disable
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Permanently delete ${customer.name}? This cannot be undone.`)) deleteMutation.mutate();
                }}
                className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-sm"
                style={{ color: 'var(--rose)' }}
              >
                <Trash2 size={14} /> Delete
              </button>
              <button type="button" onClick={() => setShowAgreement(true)} className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-sm">
                <FileText size={14} /> Agreement
              </button>
            </div>
          </div>
        </div>

        {cognitoInfo?.enabled && (
          <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
                <Info size={14} /> Cognito details
              </p>
              <button type="button" className="text-[12px] underline" style={{ color: 'var(--ink-2)' }} onClick={() => refetchCognito()}>
                Refresh
              </button>
            </div>
            {!cognitoInfo.linked ? (
              <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>Not linked to a Cognito user yet. Client will be created on first Cognito sign-in, or invite via email on create.</p>
            ) : (
              <div className="text-[12px] space-y-1 font-mono" style={{ color: 'var(--ink-2)' }}>
                <div>Status: {cognitoInfo.details?.userStatus} · Enabled: {String(cognitoInfo.details?.enabled)}</div>
                <div>Username: {cognitoInfo.details?.username}</div>
                <div>Created: {cognitoInfo.details?.userCreateDate ? new Date(cognitoInfo.details.userCreateDate).toLocaleString() : '—'}</div>
              </div>
            )}
          </div>
        )}

        {/* Profile tabs */}
        <div className="mt-5 pt-4 flex flex-wrap gap-1" style={{ borderTop: '1px solid var(--line)' }}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="px-3 py-2 rounded-lg text-[13px] font-medium transition-colors inline-flex items-center gap-1.5"
              style={{
                background: tab === t.id ? 'var(--nav-active-bg)' : 'transparent',
                color: tab === t.id ? 'var(--ink)' : 'var(--ink-2)',
                boxShadow: tab === t.id ? 'inset 0 0 0 1px var(--nav-active-ring)' : undefined,
              }}
            >
              {t.label}
              {t.id === 'selections' && unreadSelectionCount > 0 && (
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: 'var(--green)' }}
                  aria-label="Unopened selections"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {(tab === 'overview' || tab === 'notes') && (
      <>
      {/* Wedding experience */}
      {tab === 'overview' && (
        <div className="card p-6 mb-6" style={{ borderColor: weddingOn ? 'color-mix(in srgb, #D6B77A 45%, var(--line))' : 'var(--line)' }}>
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="kicker mb-1">Exclusive</p>
              <h2 className="text-[16px] font-semibold" style={{ color: 'var(--ink)' }}>Wedding experience</h2>
              <p className="text-[13px] mt-1 max-w-xl" style={{ color: 'var(--ink-2)' }}>
                When on, the client app becomes a private luxury wedding portal — soft rose & champagne theme,
                couple hero, simplified navigation. Not a generic dashboard.
              </p>
            </div>
            <label className="flex items-center gap-2 text-[13px] font-medium shrink-0 cursor-pointer" style={{ color: 'var(--ink)' }}>
              <input
                type="checkbox"
                checked={weddingOn}
                disabled={weddingMutation.isPending}
                onChange={(e) => {
                  const next = e.target.checked;
                  setWeddingOn(next);
                  // Auto-save toggle so the client app flips without a second click
                  weddingMutation.mutate({ weddingExperience: next });
                }}
              />
              Wedding client {weddingOn ? '· ON' : '· OFF'}
            </label>
          </div>
          {weddingOn && (
            <div className="grid sm:grid-cols-2 gap-3">
              <input className="input" placeholder="Groom name" value={groomName} onChange={(e) => setGroomName(e.target.value)} />
              <input className="input" placeholder="Bride name" value={brideName} onChange={(e) => setBrideName(e.target.value)} />
              <input className="input" type="date" value={weddingDate} onChange={(e) => setWeddingDate(e.target.value)} />
              <input className="input" placeholder="Venue" value={weddingVenue} onChange={(e) => setWeddingVenue(e.target.value)} />
              <label className="sm:col-span-2 text-[12px]" style={{ color: 'var(--ink-2)' }}>
                Couple photo
                <input
                  type="file"
                  accept="image/*"
                  className="input mt-1"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setKeyCrop({ slot: 'couple', src: URL.createObjectURL(f) });
                  }}
                />
                {customer.couplePhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={customer.couplePhotoUrl} alt="" className="mt-2 h-24 rounded-lg object-cover" />
                ) : customer.hasCouplePhoto ? (
                  <span className="block mt-1 text-[12px]">Photo on file</span>
                ) : null}
              </label>
              <label className="sm:col-span-2 text-[12px]" style={{ color: 'var(--ink-2)' }}>
                Cover photo
                <input
                  type="file"
                  accept="image/*"
                  className="input mt-1"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setKeyCrop({ slot: 'cover', src: URL.createObjectURL(f) });
                  }}
                />
                {customer.weddingCoverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={customer.weddingCoverUrl} alt="" className="mt-2 h-24 rounded-lg object-cover" />
                ) : null}
              </label>
              <label className="sm:col-span-2 text-[12px]" style={{ color: 'var(--ink-2)' }}>
                Booking day photo
                <input
                  type="file"
                  accept="image/*"
                  className="input mt-1"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setKeyCrop({ slot: 'booking', src: URL.createObjectURL(f) });
                  }}
                />
                {customer.bookingPhotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={customer.bookingPhotoUrl} alt="" className="mt-2 h-24 rounded-lg object-cover" />
                ) : null}
              </label>
              <input className="input" placeholder="Album status" value={albumStatus} onChange={(e) => setAlbumStatus(e.target.value)} />
              <input className="input" placeholder="Delivery status" value={deliveryStatusW} onChange={(e) => setDeliveryStatusW(e.target.value)} />
              <input className="input" placeholder="Photographer" value={photographerName} onChange={(e) => setPhotographerName(e.target.value)} />
              <input className="input" placeholder="Cinematographer" value={cinematographerName} onChange={(e) => setCinematographerName(e.target.value)} />
              <textarea className="input sm:col-span-2 min-h-[70px]" placeholder="Special notes (internal + optional client)" value={weddingNotes} onChange={(e) => setWeddingNotes(e.target.value)} />
            </div>
          )}
          <p className="text-[12px] mt-3" style={{ color: 'var(--ink-3)' }}>
            Toggle saves immediately. Use Save below after editing names, date, venue, or photos.
            Client must refresh the app (or re-open) to pick up the change.
          </p>
          <button
            type="button"
            className="btn-primary mt-3 px-4 py-2 text-[13px]"
            disabled={weddingMutation.isPending}
            onClick={() => weddingMutation.mutate({ weddingExperience: weddingOn })}
          >
            {weddingMutation.isPending ? 'Saving…' : 'Save wedding details'}
          </button>
        </div>
      )}

      <div className="card p-6 mb-8">
        <div className={tab === 'notes' ? 'hidden' : 'space-y-0'}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Status (client dashboard)</p>
            {statusDraft !== null && (
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-sm"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate(statusValue)}
              >
                {statusMutation.isPending ? 'Saving…' : 'Save status'}
              </button>
            )}
          </div>
          <input
            value={statusValue}
            onChange={(e) => setStatusDraft(e.target.value)}
            list="status-suggestions-detail"
            placeholder="e.g. Photos ready — please select your favorites"
            className="input mb-4"
          />
          <datalist id="status-suggestions-detail">
            <option value="Welcome — galleries coming soon" />
            <option value="Photos ready — please select your favorites" />
            <option value="Selection received — editing in progress" />
            <option value="Payment pending" />
            <option value="Ready for delivery" />
            <option value="Completed" />
          </datalist>
          {customer.requestedPackage && (
            <p className="text-[12px] mb-3" style={{ color: 'var(--ink-2)' }}>
              Client requested package: <strong>{customer.requestedPackage.name}</strong>
            </p>
          )}

          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
              <Package size={14} /> Package &amp; pricing
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-sm"
                onClick={() => {
                  const currentId =
                    customer.booking?.servicePackage?.id
                    || packages.find((p: any) => p.title === customer.package?.name)?.id
                    || '';
                  const p = packages.find((x: any) => x.id === currentId);
                  setWizTierId(currentId);
                  setWizLimit(
                    p?.includedPhotos != null
                      ? String(p.includedPhotos)
                      : customer.package?.includedPhotos != null
                        ? String(customer.package.includedPhotos)
                        : '20',
                  );
                  setWizExtra(
                    p?.pricePerExtraPhoto != null
                      ? String(p.pricePerExtraPhoto)
                      : customer.package?.pricePerExtraPhoto != null
                        ? String(customer.package.pricePerExtraPhoto)
                        : '350',
                  );
                  setWizPreview(null);
                  setWizardOpen(true);
                }}
              >
                Assign package
              </button>
              {packageDraft !== null && (
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-sm"
                  disabled={packageMutation.isPending}
                  onClick={() => packageMutation.mutate(packageValue || null)}
                >
                  {packageMutation.isPending ? 'Saving…' : 'Save package'}
                </button>
              )}
            </div>
          </div>
          <select
            className="input mb-2"
            value={packageValue}
            onChange={(e) => setPackageDraft(e.target.value)}
          >
            <option value="">No package assigned</option>
            {packages.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.title || p.name}
                {p.includedPhotos != null ? ` · ${p.includedPhotos} photos` : ''}
                {p.pricePerExtraPhoto != null ? ` · ₹${p.pricePerExtraPhoto}/extra` : ''}
                {(p.discountPrice ?? p.price) != null ? ` · from ₹${p.discountPrice ?? p.price}` : ''}
              </option>
            ))}
          </select>
          {(customer.package || customer.booking?.servicePackage) && (
            <p className="text-[12px] mb-4" style={{ color: 'var(--ink-3)' }}>
              {customer.booking?.servicePackage?.title || customer.package?.name}
              {customer.package?.includedPhotos != null
                ? ` · ${customer.package.includedPhotos} included`
                : ''}
              {customer.package?.pricePerExtraPhoto != null
                ? ` · ₹${customer.package.pricePerExtraPhoto}/extra`
                : ''}
              {' · '}
              <Link href="/dashboard/service-packages" className="underline">Edit packages</Link>
            </p>
          )}
          {!customer.package && !customer.booking?.servicePackage && (
            <p className="text-[12px] mb-4" style={{ color: 'var(--ink-3)' }}>
              Assign a package from the same list as{' '}
              <Link href="/dashboard/service-packages" className="underline">Packages</Link>
              {' '}(client app + selection limit + booking).
            </p>
          )}

          <div className="flex items-center justify-between mb-2 mt-2">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
              Payment terms (shown on client profile)
            </p>
            {paymentTermsDraft !== null && (
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-sm"
                disabled={paymentMutation.isPending}
                onClick={() =>
                  paymentMutation.mutate({
                    paymentTerms: paymentTermsDraft,
                  })
                }
              >
                {paymentMutation.isPending ? 'Saving…' : 'Save terms'}
              </button>
            )}
          </div>
          <p className="text-[11px] mb-2" style={{ color: 'var(--ink-3)' }}>
            Paid amounts live on invoices — open the Invoices tab and use Record payment.
          </p>
          <textarea
            className="input resize-none mb-4"
            rows={3}
            placeholder="Payment terms for the client… e.g. 50% advance, balance before delivery. UPI: studio@upi"
            value={
              paymentTermsDraft !== null ? paymentTermsDraft : customer.paymentTerms || ''
            }
            onChange={(e) => setPaymentTermsDraft(e.target.value)}
          />

        </div>
        <div className={tab === 'overview' ? 'mt-6 pt-5' : ''} style={tab === 'overview' ? { borderTop: '1px solid var(--line)' } : undefined}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>Notes</p>
            {notesDraft !== null && (
              <button
                type="button"
                className="btn-primary px-3 py-1.5 text-sm"
                disabled={notesMutation.isPending}
                onClick={() => notesMutation.mutate(notesValue)}
              >
                {notesMutation.isPending ? 'Saving…' : 'Save notes'}
              </button>
            )}
          </div>
          <textarea
            value={notesValue}
            onChange={(e) => setNotesDraft(e.target.value)}
            rows={3}
            placeholder="Internal notes about this client…"
            className="input resize-none"
          />
        </div>
      </div>
      </>
      )}

      {/* Selections */}
      {tab === 'selections' && (
      <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <CheckSquare size={16} /> Photo selections · {selections.length}
        </h2>
        <Link href="/dashboard/selections" className="text-[13px]" style={{ color: 'var(--ink-2)' }}>View all</Link>
      </div>
      <div className="space-y-2.5 mb-8">
        {selections.map((s: any, idx: number) => (
          <Link key={s.id} href={`/dashboard/selections/${s.id}`} className="card flex items-center justify-between px-5 py-4 hover:bg-[var(--surface-sunken)] transition-colors">
            <div className="min-w-0">
              <div className="font-medium truncate flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                <span className="truncate">Selection {idx + 1} · {s.gallery?.name || 'Gallery'}</span>
                {selectionUnread(s) && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--green)' }} aria-label="Unopened" />
                )}
              </div>
              <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
                {s._count?.items ?? s.items?.length ?? 0} photos
                {s.submittedAt ? ` · ${new Date(s.submittedAt).toLocaleString()}` : ''}
              </div>
            </div>
            <span className="badge badge-green">Selection {idx + 1}</span>
          </Link>
        ))}
        {selections.length === 0 && (
          <div className="card text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
            No selections submitted yet.
          </div>
        )}
      </div>
      </>
      )}

      {/* Invoices */}
      {tab === 'invoices' && (
      <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <Receipt size={16} /> Invoices · {invoices.length}
        </h2>
        <Link href="/dashboard/invoices?new=1" className="btn-ghost flex items-center gap-2 px-3 py-2">
          <Plus size={15} /> New invoice
        </Link>
      </div>
      <div className="space-y-2.5 mb-8">
        {invoicesLoading && (
          <div className="card text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>Loading invoices…</div>
        )}
        {!invoicesLoading && invoices.map((inv: any) => {
          const total = Number(inv.totalAmount || 0);
          const paid = Number(inv.cashPaid ?? inv.amountPaid ?? 0);
          const balance = Number(inv.balance ?? Math.max(0, total - paid));
          const money = (n: number) =>
            new Intl.NumberFormat('en-IN', { style: 'currency', currency: inv.currency || 'INR', maximumFractionDigits: 0 }).format(n || 0);
          const label =
            inv.status === 'PAID' || balance <= 0.01
              ? 'Paid'
              : inv.status === 'PARTIALLY_PAID' || paid > 0
                ? 'Partially paid'
                : inv.status === 'DRAFT'
                  ? 'Not sent'
                  : inv.status === 'VOID'
                    ? 'Void'
                    : 'Sent';
          return (
            <div key={inv.id} className="card px-5 py-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                      {inv.invoiceNumber}
                    </span>
                    {statusBadge(inv.status === 'FINALIZED' || inv.status === 'SENT'
                      ? (balance <= 0.01 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'SENT')
                      : inv.status)}
                  </div>
                  <div className="font-medium mt-1 truncate" style={{ color: 'var(--ink)' }}>
                    {inv.title || 'Invoice'}
                  </div>
                  <div className="text-[13px] mt-0.5" style={{ color: 'var(--ink-2)' }}>
                    {inv.package?.title ? `${inv.package.title} · ` : ''}
                    {label} · {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString('en-IN') : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold" style={{ color: 'var(--ink)' }}>{money(total)}</div>
                  <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                    Paid {money(paid)} · due {money(balance)}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {inv.status !== 'DRAFT' && inv.status !== 'VOID' && (
                  <button
                    type="button"
                    className="btn-primary px-2.5 py-1.5 text-sm"
                    onClick={() => openPay(inv)}
                  >
                    Record payment
                  </button>
                )}
                <Link href="/dashboard/invoices" className="btn-ghost px-2.5 py-1.5 text-sm">
                  Open in invoices
                </Link>
                <button
                  type="button"
                  className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
                  disabled={pdfLoadingId === inv.id}
                  onClick={async () => {
                    setPdfLoadingId(inv.id);
                    try {
                      const r = await billingApi.invoicePdf(inv.id);
                      const data = r.data || r;
                      let url = data.url as string | undefined;
                      if (!url && data.base64) {
                        const bin = atob(data.base64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
                      }
                      if (!url) throw new Error('No PDF');
                      setPdfViewer({ url, title: data.title || inv.invoiceNumber || 'Invoice' });
                    } catch (e: any) {
                      toast.error(e?.response?.data?.error?.message || e?.message || 'PDF failed');
                    } finally {
                      setPdfLoadingId(null);
                    }
                  }}
                >
                  <Eye size={14} /> {pdfLoadingId === inv.id ? 'Opening…' : 'View PDF'}
                </button>
              </div>
            </div>
          );
        })}
        {!invoicesLoading && invoices.length === 0 && (
          <div className="card text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
            No invoices for this client yet.{' '}
            <Link href="/dashboard/invoices?new=1" className="underline">Create one</Link>.
          </div>
        )}
      </div>
      </>
      )}

      {/* Agreements */}
      {tab === 'agreements' && (
      <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
          <FileText size={16} /> Agreements · {contracts.length + weddingAgreements.length}
        </h2>
        <div className="flex gap-2">
          <Link
            href={`/dashboard/clients/${id}/agreement`}
            className="btn-primary flex items-center gap-2 px-3 py-2 text-sm"
          >
            <Plus size={14} /> Make agreement
          </Link>
          <button type="button" onClick={() => setShowAgreement(true)} className="btn-ghost flex items-center gap-2 px-3 py-2 text-sm">
            <Plus size={14} /> Upload PDF
          </button>
        </div>
      </div>
      <div className="space-y-2.5 mb-8">
        {/* Wedding form drafts / finalized */}
        {weddingAgreements.map((a: any) => (
          <div key={`wa-${a.id}`} className="card flex items-center justify-between px-5 py-4 gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate" style={{ color: 'var(--ink)' }}>{a.title}</div>
              <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
                Wedding form · {a.status}
                {a.updatedAt ? ` · ${new Date(a.updatedAt).toLocaleDateString()}` : ''}
                {a.finalizedAt ? ` · finalized ${new Date(a.finalizedAt).toLocaleDateString()}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {statusBadge(a.status)}
              {a.status === 'FINALIZED' && <ShareLinkButton path={`/contracts?id=${a.id}`} />}
              <Link
                href={`/dashboard/clients/${id}/agreement?id=${a.id}${a.status === 'FINALIZED' ? '&edit=1' : ''}`}
                className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
              >
                <Pencil size={14} /> {a.status === 'FINALIZED' ? 'Edit again' : 'Edit'}
              </Link>
              {(a.hasPdf || a.status === 'FINALIZED' || a.pdfUrl) && (
                <button
                  type="button"
                  className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
                  disabled={pdfLoadingId === a.id}
                  onClick={() =>
                    openAgreementPdf({
                      id: a.id,
                      title: a.title || 'Wedding agreement',
                      kind: 'wedding',
                      directUrl: a.pdfUrl,
                    })
                  }
                >
                  <Eye size={14} /> {pdfLoadingId === a.id ? 'Opening…' : 'View PDF'}
                </button>
              )}
              {a.contractId && (
                <button
                  type="button"
                  className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
                  disabled={pdfLoadingId === a.contractId}
                  onClick={() =>
                    openAgreementPdf({
                      id: a.contractId,
                      title: a.title || 'Agreement',
                      kind: 'contract',
                    })
                  }
                >
                  <Download size={14} /> Client copy
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Uploaded / finalized PDF contracts */}
        {contracts.map((c: any) => (
          <div key={c.id} className="card flex items-center justify-between px-5 py-4 gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate" style={{ color: 'var(--ink)' }}>{c.title}</div>
              <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>
                {c.source === 'WEDDING_FORM' ? 'Wedding form PDF · ' : 'Uploaded PDF · '}
                {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : ''}
                {c.fileSize ? ` · ${Math.round(c.fileSize / 1024)} KB` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {statusBadge(c.status)}
              <ShareLinkButton path={`/contracts?id=${c.id}`} />
              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
                title="View agreement PDF"
                disabled={pdfLoadingId === c.id}
                onClick={() =>
                  openAgreementPdf({
                    id: c.id,
                    title: c.title || 'Agreement',
                    kind: 'contract',
                    directUrl: c.downloadUrl,
                  })
                }
              >
                <Eye size={14} /> {pdfLoadingId === c.id ? 'Opening…' : 'View'}
              </button>
              <button
                type="button"
                className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-sm"
                title="Open in new tab"
                disabled={pdfLoadingId === `tab-${c.id}`}
                onClick={async () => {
                  setPdfLoadingId(`tab-${c.id}`);
                  try {
                    let url = c.downloadUrl as string | undefined;
                    if (!url) {
                      const r = await adminApi.downloadContract(c.id);
                      url = r.data?.url || r.url;
                    }
                    if (!url) throw new Error('No download URL');
                    window.open(url, '_blank', 'noopener,noreferrer');
                  } catch (e: any) {
                    toast.error(e?.response?.data?.error?.message || e?.message || 'Open failed');
                  } finally {
                    setPdfLoadingId(null);
                  }
                }}
              >
                <ExternalLink size={14} /> New tab
              </button>
            </div>
          </div>
        ))}
        {contracts.length === 0 && weddingAgreements.length === 0 && (
          <div className="card text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>
            No agreements yet. Use <strong>Make agreement</strong> for the wedding form wizard, or upload a PDF.
          </div>
        )}
      </div>

      {/* In-app PDF viewer */}
      <Modal
        open={!!pdfViewer}
        onClose={() => setPdfViewer(null)}
        variant="fullscreen"
        title={pdfViewer?.title || 'Agreement PDF'}
        description="Agreement PDF"
        ariaLabel="Agreement PDF viewer"
        footer={
          pdfViewer ? (
            <>
              <a
                href={pdfViewer.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
              >
                <ExternalLink size={14} /> Open tab
              </a>
              <a
                href={pdfViewer.url}
                download
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10"
              >
                <Download size={14} /> Download
              </a>
            </>
          ) : null
        }
      >
        {pdfViewer && (
          <div className="flex-1 min-h-0 p-3 sm:p-5 flex flex-col">
            <iframe
              title={pdfViewer.title}
              src={pdfViewer.url}
              className="w-full flex-1 rounded-xl bg-white"
              style={{ border: '1px solid rgba(255,255,255,0.12)', minHeight: '70vh' }}
            />
          </div>
        )}
      </Modal>

      </>
      )}

      {/* Gallery access */}
      {tab === 'galleries' && (
      <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Gallery access · {customer.accessGrants?.length || 0}</h2>
        <button
          onClick={() => { setSelectedGalleryIds([]); setShowGrantModal(true); }}
          className="btn-ghost flex items-center gap-2 px-3 py-2"
        >
          <Plus size={15} /> Grant galleries
        </button>
      </div>

      <div className="space-y-2.5">
        {customer.accessGrants?.map((grant: any) => (
          <div key={grant.id} className="card flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: 'var(--surface-sunken)' }}>
                <Images size={16} style={{ color: 'var(--ink-2)' }} />
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: 'var(--ink)' }}>{grant.gallery.name}</div>
                <div className="text-[13px]" style={{ color: 'var(--ink-2)' }}>{grant.gallery._count.photos} photos</div>
                {grant.availability?.accessible === false && <div className="text-xs text-amber-700 mt-1">{grant.availability.message}</div>}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {statusBadge(grant.gallery.status)}
              <button
                onClick={() => revokeMutation.mutate(grant.galleryId)}
                title="Revoke"
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: 'var(--ink-3)' }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = 'var(--rose)';
                  (e.currentTarget as HTMLElement).style.background = 'var(--rose-bg)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = 'var(--ink-3)';
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>
        ))}
        {customer.accessGrants?.length === 0 && (
          <div className="card text-center py-10 text-sm" style={{ color: 'var(--ink-3)' }}>No galleries assigned yet.</div>
        )}
      </div>

      <Modal
        open={wizardOpen}
        onClose={() => !assignWizard.isPending && setWizardOpen(false)}
        title="Assign package"
        description="Same packages as Packages page and the client app. Sets booking, selection limit, and ₹/extra together."
        size="md"
        preventClose={assignWizard.isPending}
        footer={
          <>
            <button type="button" className="btn-ghost flex-1 py-2.5" disabled={assignWizard.isPending} onClick={() => setWizardOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={!wizTierId || assignWizard.isPending}
              onClick={() => assignWizard.mutate()}
            >
              {assignWizard.isPending ? 'Saving…' : 'Assign package'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Package</div>
            <select className="input w-full" value={wizTierId} onChange={(e) => {
              setWizTierId(e.target.value);
              const p = packages.find((x: any) => x.id === e.target.value);
              if (p) {
                if (p.includedPhotos != null) setWizLimit(String(p.includedPhotos));
                if (p.pricePerExtraPhoto != null) setWizExtra(String(p.pricePerExtraPhoto));
              }
            }}>
              <option value="">Select package…</option>
              {packages.length === 0 && (
                <option value="" disabled>No packages — create one under Packages first</option>
              )}
              {packages.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.title || p.name}
                  {p.includedPhotos != null ? ` · ${p.includedPhotos} free` : ''}
                  {p.pricePerExtraPhoto != null ? ` · ₹${p.pricePerExtraPhoto}/extra` : ''}
                  {(p.discountPrice ?? p.price) != null ? ` · ₹${p.discountPrice ?? p.price}` : ''}
                </option>
              ))}
            </select>
            {packages.length === 0 && (
              <p className="text-[12px] mt-2" style={{ color: 'var(--rose)' }}>
                Create packages under{' '}
                <Link href="/dashboard/service-packages" className="underline">Packages</Link>
                {' '}first — that list is what appears here.
              </p>
            )}
          </div>
          <div>
            <div className="text-[12px] mb-1" style={{ color: 'var(--ink-3)' }}>Optional gallery override</div>
            <select className="input w-full mb-2" value={wizGalleryId} onChange={(e) => setWizGalleryId(e.target.value)}>
              <option value="">No gallery override</option>
              {(galleriesData?.galleries || []).map((g: any) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[13px] mb-2" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" checked={wizApplyGal} onChange={(e) => setWizApplyGal(e.target.checked)} />
              Override limit + ₹/extra on this gallery only
            </label>
            {wizApplyGal && (
              <div className="grid grid-cols-2 gap-2">
                <input className="input" type="number" min={0} placeholder="Free limit" value={wizLimit} onChange={(e) => setWizLimit(e.target.value)} />
                <input className="input" type="number" min={0} placeholder="₹/extra" value={wizExtra} onChange={(e) => setWizExtra(e.target.value)} />
              </div>
            )}
          </div>
          {wizTierId && (
            <div className="rounded-xl p-3 text-[12px]" style={{ background: 'var(--canvas)', border: '1px solid var(--line)', color: 'var(--ink-2)' }}>
              <strong style={{ color: 'var(--ink)' }}>Client selection banner (example):</strong>
              <p className="mt-1 leading-relaxed">
                {(() => {
                  const p = packages.find((x: any) => x.id === wizTierId);
                  const lim = wizApplyGal && wizLimit !== '' ? Number(wizLimit) : (p?.includedPhotos ?? 0);
                  const rate = wizApplyGal && wizExtra !== '' ? Number(wizExtra) : Number(p?.pricePerExtraPhoto ?? 350);
                  return `You've selected ${lim + 1} photos (limit ${lim}). You can keep selecting — each extra photo is ₹${rate}. Currently 1 extra = ₹${rate}.`;
                })()}
              </p>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={showGrantModal}
        onClose={() => !grantMutation.isPending && setShowGrantModal(false)}
        title="Grant gallery access"
        description={`Select galleries for ${customer.name.split(' ')[0]}. Draft galleries will be published so the client can open them.`}
        preventClose={grantMutation.isPending}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setShowGrantModal(false)} className="btn-ghost flex-1 py-2.5" disabled={grantMutation.isPending}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => grantMutation.mutate()}
              disabled={!selectedGalleryIds.length || grantMutation.isPending}
              className="btn-primary flex-1 py-2.5"
            >
              {grantMutation.isPending
                ? 'Granting…'
                : `Assign and publish ${selectedGalleryIds.length || ''} gallery${selectedGalleryIds.length === 1 ? '' : 'ies'}`}
            </button>
          </>
        }
      >
        <div className="max-h-56 overflow-y-auto rounded-xl border p-2 space-y-1" style={{ borderColor: 'var(--line)' }}>
          {availableGalleries.length === 0 && (
            <p className="text-[13px] p-3" style={{ color: 'var(--ink-3)' }}>All galleries already granted, or none exist.</p>
          )}
          {availableGalleries.map((g: any) => {
            const on = selectedGalleryIds.includes(g.id);
            return (
              <label
                key={g.id}
                className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer text-[13px]"
                style={{ background: on ? 'var(--surface-sunken)' : 'transparent', color: 'var(--ink)' }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setSelectedGalleryIds((prev) =>
                      on ? prev.filter((x) => x !== g.id) : [...prev, g.id],
                    )
                  }
                />
                <span className="flex-1 truncate">{g.name}</span>
                <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>{g.status}</span>
              </label>
            );
          })}
        </div>
      </Modal>
      </>
      )}

      {/* Shared modals (available from header on every tab) */}
      <Modal
        open={editingContact}
        onClose={() => !contactMutation.isPending && setEditingContact(false)}
        title={customer.phone ? 'Edit contact' : 'Add phone number'}
        description="Phone is used for sign-in and WhatsApp. India 10-digit numbers get 91 prefix automatically."
        preventClose={contactMutation.isPending}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              onClick={() => setEditingContact(false)}
              disabled={contactMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={contactMutation.isPending || !nameDraft.trim() || !phoneDraft.trim()}
              onClick={() =>
                contactMutation.mutate({
                  name: nameDraft.trim(),
                  phone: phoneDraft.trim(),
                })
              }
            >
              {contactMutation.isPending ? 'Saving…' : 'Save phone'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Full name
            </label>
            <input
              className="input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="Client name"
            />
          </div>
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Phone number *
            </label>
            <input
              className="input"
              type="tel"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder="98765… or 9198765…"
              autoFocus={!customer.phone}
            />
            <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
              After save, client signs in with this phone + their password. WhatsApp OTP reset also uses this number.
            </p>
          </div>
          {customer.email && (
            <div className="rounded-xl px-3 py-2 text-[12px]" style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              Legacy email on file: <strong style={{ color: 'var(--ink)' }}>{customer.email}</strong>
              <br />
              Kept for records only — not required for login.
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={showAgreement}
        onClose={() => !agreementMutation.isPending && setShowAgreement(false)}
        title="Upload agreement"
        description="PDF only. The client can view and accept it in their app."
        preventClose={agreementMutation.isPending}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setShowAgreement(false)} className="btn-ghost flex-1 py-2.5" disabled={agreementMutation.isPending}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => agreementMutation.mutate()}
              disabled={!agreementFile || agreementMutation.isPending}
              className="btn-primary flex-1 py-2.5"
            >
              {agreementMutation.isPending ? 'Uploading…' : 'Upload'}
            </button>
          </>
        }
      >
        <input value={agreementTitle} onChange={(e) => setAgreementTitle(e.target.value)} placeholder="Title" className="input mb-3" />
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="block w-full text-[13px]"
          style={{ color: 'var(--ink-2)' }}
          onChange={(e) => setAgreementFile(e.target.files?.[0] || null)}
        />
      </Modal>

      <Modal
        open={showPassword}
        onClose={() => !passwordMutation.isPending && setShowPassword(false)}
        title="Reset password"
        description={
          customer.cognitoSub
            ? `Sends a Cognito password-reset email to ${customer.email}. No password is stored on our servers.`
            : `Leave blank to auto-generate a temporary password for ${customer.loginId || 'this client'}.`
        }
        preventClose={passwordMutation.isPending}
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setShowPassword(false)} className="btn-ghost flex-1 py-2.5" disabled={passwordMutation.isPending}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => passwordMutation.mutate()}
              disabled={passwordMutation.isPending}
              className="btn-primary flex-1 py-2.5"
            >
              {passwordMutation.isPending ? 'Working…' : customer.cognitoSub ? 'Send reset email' : 'Update password'}
            </button>
          </>
        }
      >
        {!customer.cognitoSub && (
          <input
            type="text"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password (optional)"
            className="input font-mono"
            autoComplete="new-password"
          />
        )}
      </Modal>

      <Modal
        open={!!issuedPassword}
        onClose={() => setIssuedPassword(null)}
        title="New credentials"
        description="Share these with the client once."
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5 flex items-center justify-center gap-2"
              onClick={async () => {
                if (!issuedPassword) return;
                try {
                  await navigator.clipboard.writeText(`Login ID: ${issuedPassword.loginId}\nPassword: ${issuedPassword.password}`);
                  toast.success('Copied');
                } catch {
                  toast.error('Copy failed');
                }
              }}
            >
              <Copy size={15} /> Copy
            </button>
            <button type="button" onClick={() => setIssuedPassword(null)} className="btn-primary flex-1 py-2.5">
              Done
            </button>
          </>
        }
      >
        {issuedPassword && (
          <div className="rounded-xl p-4" style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line)' }}>
            <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>Login ID</div>
            <div className="font-mono text-sm font-semibold mb-2" style={{ color: 'var(--ink)' }}>{issuedPassword.loginId}</div>
            <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>Password</div>
            <div className="font-mono text-sm font-semibold" style={{ color: 'var(--ink)' }}>{issuedPassword.password}</div>
          </div>
        )}
      </Modal>

      <Modal
        open={payOpen}
        onClose={() => !updatePaid.isPending && setPayOpen(false)}
        title="Record payment"
        description={
          payInvoice
            ? `${payInvoice.invoiceNumber} · Bill ${new Intl.NumberFormat('en-IN', {
                style: 'currency',
                currency: payInvoice.currency || 'INR',
                maximumFractionDigits: 0,
              }).format(Number(payInvoice.totalAmount || 0))}`
            : undefined
        }
        preventClose={updatePaid.isPending}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="btn-ghost flex-1 py-2.5"
              onClick={() => setPayOpen(false)}
              disabled={updatePaid.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1 py-2.5"
              disabled={payAmount === '' || updatePaid.isPending}
              onClick={() => updatePaid.mutate()}
            >
              {updatePaid.isPending ? 'Saving…' : 'Update'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {payInvoice && (
            <div className="rounded-xl px-3 py-2.5 text-[13px]" style={{ background: 'var(--surface-sunken)' }}>
              <div className="flex justify-between gap-2">
                <span style={{ color: 'var(--ink-2)' }}>Bill total</span>
                <span className="font-semibold">
                  {new Intl.NumberFormat('en-IN', {
                    style: 'currency',
                    currency: payInvoice.currency || 'INR',
                    maximumFractionDigits: 0,
                  }).format(Number(payInvoice.totalAmount || 0))}
                </span>
              </div>
              <div className="flex justify-between gap-2 mt-1">
                <span style={{ color: 'var(--ink-2)' }}>Already received</span>
                <span className="font-semibold">
                  {new Intl.NumberFormat('en-IN', {
                    style: 'currency',
                    currency: payInvoice.currency || 'INR',
                    maximumFractionDigits: 0,
                  }).format(Number(payInvoice.cashPaid ?? payInvoice.amountPaid ?? 0))}
                </span>
              </div>
            </div>
          )}
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Amount received now
            </label>
            <input
              className="input"
              inputMode="decimal"
              value={payAmount}
              onChange={(e) => setPayAmount(sanitizeMoneyInput(e.target.value))}
              placeholder="0"
              autoFocus
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>
              Enter only this payment. Earlier receipts remain unchanged. The balance updates automatically.
            </p>
          </div>
          <div><label className="text-xs block mb-1">Payment method</label><select className="input" value={payMethod} onChange={e => setPayMethod(e.target.value)}><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK">Bank transfer</option></select></div>
          <div><label className="text-xs block mb-1">Reference / UTR (optional)</label><input className="input" value={payReference} onChange={e => setPayReference(e.target.value)} maxLength={120}/></div>
          <div>
            <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--ink-2)' }}>
              Note (optional)
            </label>
            <input
              className="input"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
      </Modal>

      <ImageCropModal
        open={!!keyCrop}
        title={
          keyCrop?.slot === 'couple'
            ? 'Crop couple photo'
            : keyCrop?.slot === 'cover'
              ? 'Crop wedding cover'
              : 'Crop booking photo'
        }
        src={keyCrop?.src || null}
        aspect={keyCrop?.slot === 'couple' ? 1 : keyCrop?.slot === 'cover' ? 16 / 9 : 4 / 3}
        onClose={() => setKeyCrop(null)}
        onSave={async ({ blob }) => {
          if (!blob || !keyCrop) { setKeyCrop(null); return; }
          try {
            const file = new File([blob], `${keyCrop.slot}.jpg`, { type: blob.type || 'image/jpeg' });
            await adminApi.uploadWeddingPhoto(id, keyCrop.slot, file);
            toast.success('Photo cropped and saved');
            qc.invalidateQueries({ queryKey: ['customer', id] });
          } catch (err: any) {
            toast.error(err?.response?.data?.error || 'Upload failed');
          } finally {
            setKeyCrop(null);
          }
        }}
      />
    </div>
  );
}
