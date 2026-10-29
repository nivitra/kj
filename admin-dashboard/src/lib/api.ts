import axios from 'axios';
import { useAuthStore } from './store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export const api = axios.create({ baseURL: BASE_URL, timeout: 30000 });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Only force logout on real session failures after hydration.
    // Do NOT logout on every 401 (e.g. a single broken/missing route used to
    // kick admins out of the whole dashboard when portal CMS returned 401).
    const state = useAuthStore.getState();
    if (
      err.response?.status === 401 &&
      state._hasHydrated &&
      state.token &&
      !err.config?.url?.includes('/auth/admin/login')
    ) {
      const msg = String(
        err.response?.data?.error?.message ||
          err.response?.data?.error ||
          err.response?.data?.message ||
          '',
      ).toLowerCase();
      const looksLikeSessionDead =
        msg.includes('invalid token') ||
        msg.includes('no token') ||
        msg.includes('expired') ||
        msg.includes('unauthorized') ||
        msg.includes('account is disabled') ||
        msg.includes('customer not found');
      // Prefer explicit auth wording; also treat bare 401 from admin auth middleware.
      if (looksLikeSessionDead) {
        // Soft-check: only logout if a known session probe would also fail.
        // Immediate logout for classic middleware messages.
        if (
          msg.includes('invalid token') ||
          msg.includes('no token provided') ||
          msg.includes('expired') ||
          msg.includes('account is disabled')
        ) {
          state.logout();
        }
      }
    }
    return Promise.reject(err);
  }
);

// Envelope unwrap: backend returns { data, request_id } for new routes.
const unwrap = (res: any) => (res?.data?.data !== undefined ? { ...res, data: res.data.data } : res);

export const authApi = {
  login: (email: string, password: string) => api.post('/auth/admin/login', { email, password }),
  setup: (data: any) => api.post('/auth/admin/setup', data),
};

export const adminApi = {
  stats: () => api.get('/admin/stats'),
  customers: (params?: any) => api.get('/admin/customers', { params }),
  createCustomer: (data: {
    name: string;
    email?: string;
    phone?: string;
    notes?: string;
    status?: string;
    loginId?: string;
    password?: string;
    packageId?: string;
    galleryIds?: string[];
  }) => api.post('/admin/customers', data),
  updateCustomer: (id: string, data: any) => api.patch(`/admin/customers/${id}`, data),
  uploadWeddingPhoto: (id: string, slot: 'couple' | 'cover' | 'booking', file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('slot', slot);
    return api.post(`/admin/customers/${id}/wedding-photo`, fd, { timeout: 60000 }).then(unwrap);
  },
  getCustomer: (id: string) => api.get(`/admin/customers/${id}`),
  grantAccess: (customerId: string, galleryId: string) =>
    api.post(`/admin/customers/${customerId}/access`, { galleryId }),
  /** Grant one or many galleries in a single call. */
  grantAccessBulk: (customerId: string, galleryIds: string[]) =>
    api.post(`/admin/customers/${customerId}/access`, { galleryIds, publish: true }),
  revokeAccess: (customerId: string, galleryId: string) => api.delete(`/admin/customers/${customerId}/access/${galleryId}`),
  resetPassword: (id: string, password?: string) =>
    api.post(`/admin/customers/${id}/reset-password`, password ? { password } : {}),
  disableCustomer: (id: string) => api.post(`/admin/customers/${id}/disable`),
  enableCustomer: (id: string) => api.post(`/admin/customers/${id}/enable`),
  deleteCustomer: (id: string) => api.delete(`/admin/customers/${id}`),
  cognitoDetails: (id: string) => api.get(`/admin/customers/${id}/cognito`),

  // ── Packages (studio products assigned to clients) ───────────────────────
  packages: (params?: { active?: string }) =>
    api.get('/admin/packages', { params }).then(unwrap),
  createPackage: (data: {
    name: string;
    description?: string;
    basePrice?: number;
    includedPhotos?: number;
    pricePerExtraPhoto?: number;
    workflowMode?: string;
    paymentMode?: string;
    active?: boolean;
    sortOrder?: number;
  }) => api.post('/admin/packages', data).then(unwrap),
  updatePackage: (id: string, data: any) => api.patch(`/admin/packages/${id}`, data).then(unwrap),
  deletePackage: (id: string) => api.delete(`/admin/packages/${id}`).then(unwrap),
  /** One-shot: assign pricing tier (+ optional service package / gallery overrides). */
  assignPackagePricing: (customerId: string, data: {
    pricingPackageId?: string;
    servicePackageId?: string | null;
    galleryId?: string | null;
    selectionLimit?: number | null;
    extraPhotoPrice?: number | null;
    applyGalleryOverride?: boolean;
  }) => api.post(`/admin/customers/${customerId}/assign-package-pricing`, data).then(unwrap),
  billingSetupGaps: () => api.get('/admin/billing/setup-gaps').then(unwrap),
  team: () => api.get('/admin/team'),
  createTeamMember: (data: any) => api.post('/admin/team', data),
  auditLog: (params?: any) => api.get('/admin/audit', { params }),
  jobs: (params?: any) => api.get('/admin/jobs', { params }).then(unwrap),
  replayJob: (id: string) => api.post(`/admin/jobs/${id}/replay`).then(unwrap),
  faceAnalytics: (galleryId: string) => api.get(`/admin/galleries/${galleryId}/face-analytics`).then(unwrap),
  setFaceSearch: (galleryId: string, data: any) => api.patch(`/admin/galleries/${galleryId}/face-search`, data).then(unwrap),
  reindex: (galleryId: string) => api.post(`/admin/galleries/${galleryId}/reindex`).then(unwrap),
  /** Admin face search: upload a selfie, get ranked photo matches for this gallery. */
  faceSearch: (galleryId: string, file: File, threshold?: number) => {
    const form = new FormData();
    form.append('selfie', file);
    if (threshold != null) form.append('threshold', String(threshold));
    // Do not set Content-Type manually — axios must add multipart boundary.
    return api
      .post(`/admin/galleries/${galleryId}/face-search`, form, {
        timeout: 60000,
      })
      .then(unwrap);
  },

  // ── Selections (client photo picks) ──────────────────────────────────────
  selections: (params?: { status?: string }) =>
    api.get('/admin/selections', { params }).then(unwrap),
  getSelection: (id: string) => api.get(`/admin/selections/${id}`).then(unwrap),
  startEditing: (id: string, revision: number) => api.post(`/admin/selections/${id}/start-editing`, { revision }).then(unwrap),
  unlockSelection: (id: string, mode: 'INCLUDED' | 'EXTRAS' = 'INCLUDED', reason?: string, revision?: number) =>
    api.post(`/admin/selections/${id}/unlock`, { mode, reason, revision }).then(unwrap),
  classifySelection: (id: string, data: {
    classifications?: { photoId: string; deliveryType: 'RAW' | 'EDITED' | 'PENDING' | null }[];
    all?: 'RAW' | 'EDITED';
    defaultRemaining?: 'RAW' | 'EDITED';
  }) => api.post(`/admin/selections/${id}/classify`, data).then(unwrap),
  billSelection: (id: string) => api.post(`/admin/selections/${id}/bill`).then(unwrap),
  exportSelectionCsvUrl: (id: string) => `${BASE_URL}/admin/selections/${id}/export`,

  // ── Contracts / agreements ───────────────────────────────────────────────
  contracts: (params?: { customerId?: string }) =>
    api.get('/admin/contracts', { params }).then(unwrap),
  downloadContract: (id: string) =>
    api.get(`/admin/contracts/${id}/download`).then(unwrap),
  uploadContract: (data: { customerId: string; title: string; file: File; galleryId?: string }) => {
    const form = new FormData();
    form.append('customerId', data.customerId);
    form.append('title', data.title);
    form.append('file', data.file);
    if (data.galleryId) form.append('galleryId', data.galleryId);
    return api.post('/admin/contracts', form, { timeout: 60000 }).then(unwrap);
  },
  // Wedding agreement wizard (sectioned form → PDF)
  weddingTemplate: () => api.get('/admin/agreements/wedding/template').then(unwrap),
  listWeddingAgreements: (customerId: string) =>
    api.get(`/admin/agreements/customer/${customerId}`).then(unwrap),
  createWeddingAgreement: (customerId: string, data?: { title?: string; formData?: any }) =>
    api.post(`/admin/agreements/customer/${customerId}/wedding`, data || {}).then(unwrap),
  getWeddingAgreement: (id: string) => api.get(`/admin/agreements/${id}`).then(unwrap),
  updateWeddingAgreement: (id: string, data: { title?: string; formData?: any; reopen?: boolean }) =>
    api.put(`/admin/agreements/${id}`, data).then(unwrap),
  finalizeWeddingAgreement: (id: string, data?: { formData?: any }) =>
    api.post(`/admin/agreements/${id}/finalize`, data || {}, { timeout: 60000 }).then(unwrap),
  weddingAgreementPdf: (id: string) => api.get(`/admin/agreements/${id}/pdf`).then(unwrap),

  // ── Gallery share / QR (relatives, no client login) ───────────────────────
  listShareLinks: (galleryId: string) =>
    api.get(`/admin/share/galleries/${galleryId}/share-links`).then(unwrap),
  createShareLink: (
    galleryId: string,
    data?: { label?: string; expiresAt?: string; fullAccessCode?: string },
  ) => api.post(`/admin/share/galleries/${galleryId}/share-links`, data || {}).then(unwrap),
  setShareFullAccessCode: (
    linkId: string,
    data: { fullAccessCode?: string; clear?: boolean },
  ) => api.patch(`/admin/share/share-links/${linkId}/full-access-code`, data).then(unwrap),
  revokeShareLink: (linkId: string) =>
    api.delete(`/admin/share/share-links/${linkId}`).then(unwrap),
  listShareGuests: (galleryId: string) =>
    api.get(`/admin/share/galleries/${galleryId}/share-guests`).then(unwrap),
};

export const galleryApi = {
  list: (params?: any) => api.get('/galleries', { params }),
  trash: (params?: any) => api.get('/galleries', { params: { ...params, trash: '1' } }),
  create: (data: any) => api.post('/galleries', data),
  update: (id: string, data: any) => api.patch(`/galleries/${id}`, data),
  /** Soft-delete → recycle bin (S3 purge after 30 days). */
  softDelete: (id: string) => api.delete(`/galleries/${id}`),
  restore: (id: string) => api.post(`/galleries/${id}/restore`),
  /** Permanent purge now (must already be in trash). */
  purge: (id: string) => api.delete(`/galleries/${id}/purge`),
  get: (id: string) => api.get(`/galleries/${id}`),
  /** Assign this gallery to one or more clients. */
  grantClients: (galleryId: string, customerIds: string[]) =>
    api.post(`/galleries/${galleryId}/access`, { customerIds, publish: true }),
  revokeClient: (galleryId: string, customerId: string) =>
    api.delete(`/galleries/${galleryId}/access/${customerId}`),
  grantRawAccess: (galleryId: string, customerId: string, faceSearchEnabled?: boolean) =>
    api.post(`/galleries/${galleryId}/raw-access`, { customerId, faceSearchEnabled }),
  revokeRawAccess: (galleryId: string, customerId: string) =>
    api.delete(`/galleries/${galleryId}/raw-access/${customerId}`),
  updateClientAccess: (galleryId: string, customerId: string, data: {
    accessMode?: 'SELECTION' | 'RAW' | 'VIEW';
    selectionLimit?: number | null;
    extraPhotoPrice?: number | null;
    downloadEnabled?: boolean | null;
    faceSearchEnabled?: boolean | null;
  }) => api.patch(`/galleries/${galleryId}/access/${customerId}`, data),
  setCover: (galleryId: string, data: { file: Blob; photoId?: string; crop?: unknown }) => {
    const fd = new FormData();
    fd.append('cover', data.file, 'cover.jpg');
    if (data.photoId) fd.append('photoId', data.photoId);
    if (data.crop) fd.append('crop', JSON.stringify(data.crop));
    return api.post(`/galleries/${galleryId}/cover`, fd, { timeout: 60000 });
  },
};

// ── Customer Portal V2 CMS ─────────────────────────────────────────────────
export const portalApi = {
  getProfile: () => api.get('/admin/portal/profile').then(unwrap),
  saveProfile: (form: FormData) =>
    api.put('/admin/portal/profile', form, { timeout: 60000 }).then(unwrap),

  packages: () => api.get('/admin/portal/packages').then(unwrap),
  createPackage: (form: FormData) =>
    api.post('/admin/portal/packages', form, { timeout: 60000 }).then(unwrap),
  updatePackage: (id: string, form: FormData) =>
    api.patch(`/admin/portal/packages/${id}`, form, { timeout: 60000 }).then(unwrap),
  deletePackage: (id: string) => api.delete(`/admin/portal/packages/${id}`).then(unwrap),

  portfolio: () => api.get('/admin/portal/portfolio').then(unwrap),
  createPortfolio: (form: FormData) =>
    api.post('/admin/portal/portfolio', form, { timeout: 120000 }).then(unwrap),
  updatePortfolio: (id: string, data: any) =>
    api.patch(`/admin/portal/portfolio/${id}`, data).then(unwrap),
  deletePortfolio: (id: string) => api.delete(`/admin/portal/portfolio/${id}`).then(unwrap),
  addPortfolioMedia: (id: string, form: FormData) =>
    api.post(`/admin/portal/portfolio/${id}/media`, form, { timeout: 120000 }).then(unwrap),
  deletePortfolioMedia: (id: string, mediaId: string) =>
    api.delete(`/admin/portal/portfolio/${id}/media/${mediaId}`).then(unwrap),

  announcements: () => api.get('/admin/portal/announcements').then(unwrap),
  createAnnouncement: (form: FormData) =>
    api.post('/admin/portal/announcements', form, { timeout: 60000 }).then(unwrap),
  /** JSON or FormData (for image replace). */
  updateAnnouncement: (id: string, data: FormData | Record<string, unknown>) =>
    api.patch(`/admin/portal/announcements/${id}`, data, {
      timeout: 60000,
      headers: data instanceof FormData ? { 'Content-Type': 'multipart/form-data' } : undefined,
    }).then(unwrap),
  deleteAnnouncement: (id: string) => api.delete(`/admin/portal/announcements/${id}`).then(unwrap),

  bookings: () => api.get('/admin/portal/bookings').then(unwrap),
  updateBooking: (customerId: string, data: any) =>
    api.put(`/admin/portal/bookings/${customerId}`, data).then(unwrap),
  updateBookingTimeslot: (customerId: string, data: any) =>
    api.put(`/admin/portal/bookings/${customerId}/timeslot`, data).then(unwrap),

  leads: (params?: any) => api.get('/admin/portal/leads', { params }).then(unwrap),
  updateLead: (id: string, data: any) => api.patch(`/admin/portal/leads/${id}`, data).then(unwrap),

  weddingInquiries: (params?: any) =>
    api.get('/admin/portal/wedding-inquiries', { params }).then(unwrap),
  weddingInquiry: (id: string) =>
    api.get(`/admin/portal/wedding-inquiries/${id}`).then(unwrap),
  updateWeddingInquiry: (id: string, data: any) =>
    api.patch(`/admin/portal/wedding-inquiries/${id}`, data).then(unwrap),
  addWeddingInquiryNote: (id: string, body: string) =>
    api.post(`/admin/portal/wedding-inquiries/${id}/notes`, { body }).then(unwrap),
};

export const quoteApi = {
  accept: (id: string, optionId: string, note: string, updatedAt?: string) => api.post(`/admin/quotes/${id}/accept`, { optionId, note, updatedAt }).then(unwrap),
  catalog: () => api.get('/admin/quotes/catalog').then(unwrap),
  preview: (data: any) => api.post('/admin/quotes/preview', data).then(unwrap),
  list: (params?: any) => api.get('/admin/quotes', { params }).then(unwrap),
  create: (data: any) => api.post('/admin/quotes', data).then(unwrap),
  get: (id: string) => api.get(`/admin/quotes/${id}`).then(unwrap),
  save: (id: string, data: any) => api.put(`/admin/quotes/${id}`, data).then(unwrap),
  finalize: (id: string) => api.post(`/admin/quotes/${id}/finalize`).then(unwrap),
  pdf: (id: string) => api.get(`/admin/quotes/${id}/pdf`, { timeout: 60000 }).then(unwrap),
  convert: (id: string) => api.post(`/admin/quotes/${id}/convert`).then(unwrap),
};

// ── WhatsApp (Baileys) ─────────────────────────────────────────────────────
export const whatsappApi = {
  status: () => api.get('/admin/whatsapp/status').then(unwrap),
  connect: () => api.post('/admin/whatsapp/connect').then(unwrap),
  disconnect: (logout = false) => api.post('/admin/whatsapp/disconnect', { logout }).then(unwrap),
  updateSettings: (data: any) => api.patch('/admin/whatsapp/settings', data).then(unwrap),
  templates: () => api.get('/admin/whatsapp/templates').then(unwrap),
  createTemplate: (data: any) => api.post('/admin/whatsapp/templates', data).then(unwrap),
  updateTemplate: (id: string, data: any) => api.patch(`/admin/whatsapp/templates/${id}`, data).then(unwrap),
  deleteTemplate: (id: string) => api.delete(`/admin/whatsapp/templates/${id}`).then(unwrap),
  previewTemplate: (body: string, vars?: any) =>
    api.post('/admin/whatsapp/templates/preview', { body, vars }).then(unwrap),
  send: (data: any) => api.post('/admin/whatsapp/send', data, { timeout: 120000 }).then(unwrap),
  bulk: (data: any) => api.post('/admin/whatsapp/bulk', data, { timeout: 30000 }).then(unwrap),
  messages: (params?: any) => api.get('/admin/whatsapp/messages', { params }).then(unwrap),
  campaigns: () => api.get('/admin/whatsapp/campaigns').then(unwrap),
  recipients: () => api.get('/admin/whatsapp/recipients').then(unwrap),
};

// ── Billing: coupons + invoices + payment ledger ───────────────────────────
export const billingApi = {
  paymentClaims: () => api.get('/admin/billing/payment-claims').then(unwrap),
  reviewPaymentClaim: (id: string, data: { approve: boolean; note?: string }) => api.post(`/admin/billing/payment-claims/${id}/review`, data).then(unwrap),
  listCoupons: () => api.get('/admin/billing/coupons').then(unwrap),
  createCoupon: (data: any) => api.post('/admin/billing/coupons', data).then(unwrap),
  updateCoupon: (id: string, data: any) => api.patch(`/admin/billing/coupons/${id}`, data).then(unwrap),
  deleteCoupon: (id: string) => api.delete(`/admin/billing/coupons/${id}`).then(unwrap),

  summary: () => api.get('/admin/billing/summary').then(unwrap),
  listInvoices: (params?: any) => api.get('/admin/billing/invoices', { params }).then(unwrap),
  getInvoice: (id: string) => api.get(`/admin/billing/invoices/${id}`).then(unwrap),
  createInvoice: (data: any) => api.post('/admin/billing/invoices', data).then(unwrap),
  updateInvoice: (id: string, data: any) => api.put(`/admin/billing/invoices/${id}`, data).then(unwrap),
  finalizeInvoice: (id: string) => api.post(`/admin/billing/invoices/${id}/finalize`).then(unwrap),
  deleteInvoice: (id: string) => api.delete(`/admin/billing/invoices/${id}`).then(unwrap),
  /** Set how much is paid on the invoice (total received). */
  recordPayment: (id: string, data: { amount: number; method: string; reference?: string; idempotencyKey: string; note?: string; kind?: string }) => api.post(`/admin/billing/invoices/${id}/payments`, data).then(unwrap),
  updatePaid: (id: string, data: { amountPaid: number; method?: string; note?: string }) =>
    api.put(`/admin/billing/invoices/${id}/paid`, data).then(unwrap),
  voidPayment: (invoiceId: string, paymentId: string, reason?: string) =>
    api.post(`/admin/billing/invoices/${invoiceId}/payments/${paymentId}/void`, { reason }).then(unwrap),
  /** @deprecated use voidPayment */
  deletePayment: (invoiceId: string, paymentId: string) =>
    api.post(`/admin/billing/invoices/${invoiceId}/payments/${paymentId}/void`, { reason: 'Deleted from admin UI' }).then(unwrap),
  reviseInvoice: (id: string, data: any) =>
    api.post(`/admin/billing/invoices/${id}/revise`, data).then(unwrap),
  /** Generate invoice PDF and return { url?, base64, filename, title }. */
  receiptPdf: (id: string) => api.get(`/admin/billing/receipts/${id}/pdf`).then(unwrap),
  invoicePdf: (id: string) =>
    api.get(`/admin/billing/invoices/${id}/pdf`, { timeout: 60000 }).then(unwrap),
};

// Production presigned upload pipeline (FACE-PIPELINE-PLAN.md §5 / §7).
// register → browser PUT direct to S3 → complete → worker processes async.
export const uploadApi = {
  register: (
    galleryId: string,
    files: {
      name: string;
      type: string;
      size: number;
      onDuplicate?: string;
      replacePhotoId?: string;
    }[],
    uploadQuality?: number,
  ) => api.post(`/upload/gallery/${galleryId}/register`, { files, uploadQuality }).then(unwrap),

  checkDuplicates: (galleryId: string, names: string[]) =>
    api.post(`/upload/gallery/${galleryId}/check-duplicates`, { names }, { timeout: 60000 }).then(unwrap),

  complete: (galleryId: string, photoIds: string[]) =>
    api.post(`/upload/gallery/${galleryId}/complete`, { photoIds }).then(unwrap),

  status: (galleryId: string) =>
    api.get(`/upload/gallery/${galleryId}/status`).then(unwrap),

  retryFailed: (galleryId: string) =>
    api.post(`/upload/gallery/${galleryId}/retry-failed`).then(unwrap),
};

export const photoApi = {
  list: (galleryId: string, params?: any) => api.get(`/photos/gallery/${galleryId}`, { params }),
  delete: (id: string) => api.delete(`/photos/${id}`),
};
