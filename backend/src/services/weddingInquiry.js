/**
 * Wedding inquiry catalog, validation, and timeline mapping.
 * Coverage options stay aligned with the wedding agreement SCOPE_LABELS.
 */

const SERVICE_OPTIONS = [
  { id: 'traditional_photographer', label: 'Traditional photography' },
  { id: 'candid_photographer', label: 'Candid photography' },
  { id: 'traditional_videographer', label: 'Traditional videography' },
  { id: 'cinematic_videographer', label: 'Cinematography' },
  { id: 'drone', label: 'Drone' },
  { id: 'pre_wedding', label: 'Pre-wedding' },
  { id: 'same_day_edit', label: 'Same-day edit' },
  { id: 'live_stream', label: 'Live streaming' },
  { id: 'album_design', label: 'Album design' },
  { id: 'audio_setup', label: 'Audio setup' },
];

const BUDGET_TIERS = [
  { id: 'UNDER_1L', label: 'Under ₹1 lakh' },
  { id: '1L_2L', label: '₹1–2 lakh' },
  { id: '2L_4L', label: '₹2–4 lakh' },
  { id: '4L_PLUS', label: '₹4 lakh+' },
  { id: 'UNSURE', label: 'Not sure yet' },
];

const SCHEDULES = [
  { id: 'MORNING', label: 'Morning' },
  { id: 'EVENING', label: 'Evening' },
  { id: 'FULL_DAY', label: 'Full day' },
];

const INQUIRY_STATUSES = ['PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'BOOKED'];

const WEDDING_STEPS = [
  { key: 'INQUIRY_SENT', label: 'Inquiry sent', inquiryStatus: 'PENDING' },
  { key: 'REVIEW_QUOTE', label: 'Admin review & quote', inquiryStatus: 'IN_REVIEW' },
  { key: 'CONTRACT', label: 'Contract / confirmation', inquiryStatus: 'APPROVED' },
  { key: 'EVENT', label: 'Event execution', inquiryStatus: 'BOOKED' },
];

const LEAD_STATUS_FOR_INQUIRY = {
  PENDING: 'NEW',
  IN_REVIEW: 'CONTACTED',
  APPROVED: 'WON',
  BOOKED: 'WON',
  REJECTED: 'LOST',
};

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function serviceLabel(id) {
  return SERVICE_OPTIONS.find((s) => s.id === id)?.label || id;
}

function budgetLabel(id) {
  return BUDGET_TIERS.find((s) => s.id === id)?.label || id || '';
}

function scheduleLabel(id) {
  return SCHEDULES.find((s) => s.id === id)?.label || id || '';
}

function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

function normalizeCountryCode(raw) {
  let s = String(raw || '+91').trim();
  if (!s.startsWith('+')) s = `+${s.replace(/^00/, '')}`;
  const d = digitsOnly(s);
  if (!d || d.length > 4) return '+91';
  return `+${d}`;
}

function normalizePhone(countryCode, phone) {
  const cc = normalizeCountryCode(countryCode);
  let national = digitsOnly(phone);
  const ccDigits = digitsOnly(cc);
  if (national.startsWith(ccDigits) && (String(phone || '').trim().startsWith('+') || (cc === '+91' && national.length === 12))) {
    national = national.slice(ccDigits.length);
  }
  if (cc === '+91' && national.length === 11 && national.startsWith('0')) {
    national = national.slice(1);
  }
  return { countryCode: cc, national, e164: `${cc}${national}` };
}

function validatePhone(countryCode, phone) {
  const { countryCode: cc, national } = normalizePhone(countryCode, phone);
  if (cc === '+91') {
    if (!/^[6-9]\d{9}$/.test(national)) {
      return 'Enter a valid 10-digit Indian mobile number';
    }
  } else if (national.length < 7 || national.length > 12) {
    return 'Enter a valid phone number';
  }
  return null;
}

function parseIsoDate(raw) {
  if (!raw) return null;
  const s = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

function formatDay(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function datesSummary(dates) {
  if (!dates || typeof dates !== 'object') return '';
  const days = Array.isArray(dates.days) ? dates.days.filter((d) => d && (d.date || d.event || d.name)) : [];
  if (days.length) {
    return days
      .map((d, i) => {
        const label = d.event || d.name || `Day ${d.day || i + 1}`;
        const when = formatDay(d.date);
        return when ? `Day ${d.day || i + 1} ${label} · ${when}` : `Day ${d.day || i + 1} ${label}`;
      })
      .join('; ');
  }
  const ceremonies = Array.isArray(dates.ceremonies)
    ? dates.ceremonies.filter((c) => c && (c.date || c.name))
    : [];
  if (dates.mode === 'ceremonies' && ceremonies.length) {
    return ceremonies
      .map((c) => [c.name, formatDay(c.date)].filter(Boolean).join(' · '))
      .join(', ');
  }
  const start = formatDay(dates.start);
  const end = formatDay(dates.end);
  if (start && end && start !== end) return `${start} – ${end}`;
  return start || end || '';
}

function normalizeForm(body, customer = {}, catalog = catalogs()) {
  const contactIn = body.contact && typeof body.contact === 'object' ? body.contact : body;
  const venueIn = body.venue && typeof body.venue === 'object' ? body.venue : {};
  const datesIn = body.dates && typeof body.dates === 'object' ? body.dates : {};
  const servicesRaw = Array.isArray(body.services) ? body.services : [];
  const allowed = new Set(catalog.services.map((s) => s.id));
  const phone = normalizePhone(
    contactIn.countryCode || contactIn.phoneCountry || '+91',
    contactIn.phone || customer.phone || '',
  );
  const rawDays = Array.isArray(datesIn.days) && datesIn.days.length
    ? datesIn.days
    : (Array.isArray(datesIn.ceremonies) ? datesIn.ceremonies : []);
  let days = rawDays
    .map((d, i) => {
      const svc = Array.isArray(d?.services) ? d.services : [];
      return {
        day: Math.max(1, Number(d?.day) || i + 1),
        event: String(d?.event || d?.name || '').trim().slice(0, 80),
        name: String(d?.event || d?.name || '').trim().slice(0, 80),
        date: parseIsoDate(d?.date) ? String(d.date).slice(0, 10) : '',
        schedule: catalog.schedules.some((s) => s.id === String(d?.schedule || '').toUpperCase())
          ? String(d.schedule).toUpperCase()
          : String(body.schedule || 'FULL_DAY').toUpperCase(),
        services: [...new Set(svc.map((s) => String(s)).filter((s) => allowed.has(s)))],
      };
    })
    .filter((d) => d.event || d.date);
  let dayCount = Number(datesIn.dayCount || body.dayCount || days.length || 0);
  if (!Number.isFinite(dayCount)) dayCount = days.length;
  dayCount = Math.max(0, Math.min(7, Math.round(dayCount)));
  if (days.length > 7) days = days.slice(0, 7);
  const ceremonies = days.map((d) => ({ name: d.event, date: d.date }));
  const start = parseIsoDate(days[0]?.date || datesIn.start || body.eventStart || body.requestedDate);
  const lastDated = [...days].reverse().find((d) => d.date);
  const end = parseIsoDate(lastDated?.date || datesIn.end || body.eventEnd) || start;
  const mode = days.length ? 'days' : 'range';
  const schedule = String(body.schedule || 'FULL_DAY').toUpperCase();
  const budgetTier = String(body.budgetTier || '').toUpperCase();
  const guestCount = body.guestCount == null || body.guestCount === ''
    ? null
    : Number(body.guestCount);

  return {
    kind: 'WEDDING',
    labels: {services:Object.fromEntries(catalog.services.map(r=>[r.id,r.label])),budgets:Object.fromEntries(catalog.budgetTiers.map(r=>[r.id,r.label]))},
    contact: {
      name: String(contactIn.name || customer.name || '').trim().slice(0, 120),
      phone: phone.e164,
      national: phone.national,
      countryCode: phone.countryCode,
      email: String(contactIn.email || customer.email || '').trim().slice(0, 160),
    },
    venue: {
      location: String(venueIn.location || body.location || (typeof body.venue === 'string' ? body.venue : '')).trim().slice(0, 200),
      city: String(venueIn.city || body.city || '').trim().slice(0, 80),
      state: String(venueIn.state || body.state || '').trim().slice(0, 80),
    },
    dates: {
      mode,
      flexible: datesIn.flexible === true,
      dayCount: days.length || dayCount || 0,
      start: start ? start.toISOString().slice(0, 10) : '',
      end: end ? end.toISOString().slice(0, 10) : '',
      days,
      ceremonies,
    },
    schedule: catalog.schedules.some((s) => s.id === schedule) ? schedule : 'FULL_DAY',
    services: [...new Set([
      ...servicesRaw.map((s) => String(s)).filter((s) => allowed.has(s)),
      ...days.flatMap((d) => d.services || []),
    ])],
    album: {
      needed: body.album?.needed === true || body.albumNeeded === true,
      sheets: (() => {
        const n = Number(body.album?.sheets ?? body.albumSheets);
        if (!Number.isFinite(n)) return 20;
        return Math.max(10, Math.min(40, Math.round(n)));
      })(),
      notes: String(body.album?.notes || body.albumNotes || '').trim().slice(0, 400),
    },
    budgetTier: catalog.budgetTiers.some((s) => s.id === budgetTier) ? budgetTier : '',
    guestCount: Number.isFinite(guestCount) && guestCount > 0 ? Math.round(guestCount) : null,
    notes: String(body.notes || body.message || '').trim().slice(0, 4000),
  };
}

function validateWeddingForm(form) {
  const errors = {};
  if (!form.contact.name || form.contact.name.length < 2) {
    errors.name = 'Enter your full name';
  }
  const phoneErr = validatePhone(form.contact.countryCode, form.contact.national || form.contact.phone);
  if (phoneErr) errors.phone = phoneErr;
  if (form.contact.email && !emailRe.test(form.contact.email)) {
    errors.email = 'Enter a valid email address';
  }
  if (!form.venue.location && !form.venue.city) {
    errors.venue = 'Add a venue or city';
  }
  const days = Array.isArray(form.dates.days) ? form.dates.days : [];
  if (days.length < 1 || days.length > 7) {
    errors.dates = 'Select 1 to 7 days of coverage';
  } else {
    const missingEvent = days.find((d) => !d.event);
    const missingDate = days.find((d) => !d.date);
    const missingCrew = days.find((d) => !Array.isArray(d.services) || !d.services.length);
    if (missingEvent) errors.dates = 'Type the event name for every day';
    else if (missingDate && !form.dates.flexible) errors.dates = 'Pick a date for every day';
    else if (missingCrew) errors.services = 'Choose coverage for every day';
  }
  if (!form.services.length) {
    errors.services = 'Choose at least one coverage type';
  }
  if (form.album && form.album.needed === true) {
    const sheets = Number(form.album.sheets);
    if (!Number.isFinite(sheets) || sheets < 10 || sheets > 40) {
      errors.album = 'Album sheets should be between 10 and 40';
    }
  }
  return errors;
}

function primaryDate(form) {
  if (form.dates?.flexible) return null;
  const firstDay = (form.dates.days || []).find((d) => d.date);
  if (firstDay) return parseIsoDate(firstDay.date);
  if (form.dates.start) return parseIsoDate(form.dates.start);
  const c = (form.dates.ceremonies || []).find((x) => x.date);
  return c ? parseIsoDate(c.date) : null;
}

function venueLine(form) {
  return [form.venue?.location, form.venue?.city, form.venue?.state].filter(Boolean).join(', ');
}

function leadMessage(form) {
  const lines = [
    'Wedding inquiry',
    form.contact.name ? `Name: ${form.contact.name}` : null,
    venueLine(form) ? `Venue: ${venueLine(form)}` : null,
    datesSummary(form.dates) ? `Dates: ${datesSummary(form.dates)}` : null,
    form.schedule ? `Schedule: ${scheduleLabel(form.schedule)}` : null,
    form.services.length
      ? `Coverage: ${form.services.map(serviceLabel).join(', ')}`
      : null,
    form.budgetTier ? `Budget: ${budgetLabel(form.budgetTier)}` : null,
    form.guestCount ? `Guests: ${form.guestCount}` : null,
    form.notes ? `Notes: ${form.notes}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function timelineForStatus(inquiryStatus) {
  const status = INQUIRY_STATUSES.includes(inquiryStatus) ? inquiryStatus : 'PENDING';
  if (status === 'REJECTED') {
    return WEDDING_STEPS.map((s, i) => ({
      ...s,
      state: i === 0 ? 'done' : 'rejected',
    })).concat([{
      key: 'REJECTED',
      label: 'Inquiry closed',
      inquiryStatus: 'REJECTED',
      state: 'current',
    }]);
  }
  const idx = WEDDING_STEPS.findIndex((s) => s.inquiryStatus === status);
  const current = idx < 0 ? 0 : idx;
  return WEDDING_STEPS.map((s, i) => ({
    ...s,
    state: i < current ? 'done' : i === current ? 'current' : 'upcoming',
  }));
}

function stepForStatus(inquiryStatus) {
  if (inquiryStatus === 'REJECTED') {
    return { key: 'REJECTED', label: 'Inquiry closed' };
  }
  return WEDDING_STEPS.find((s) => s.inquiryStatus === inquiryStatus) || WEDDING_STEPS[0];
}

function serializeInquiry(lead, extras = {}) {
  const form = (lead.formData && typeof lead.formData === 'object') ? lead.formData : {};
  const status = lead.inquiryStatus || 'PENDING';
  return {
    id: lead.id,
    shortId: String(lead.id).slice(0, 8).toUpperCase(),
    inquiryKind: lead.inquiryKind || 'WEDDING',
    inquiryStatus: status,
    status: lead.status,
    source: lead.source,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    message: lead.message,
    form,
    datesLabel: datesSummary(form.dates) || (form.dates?.flexible ? 'Date to be decided' : ''),
    venueLabel: venueLine(form),
    budgetLabel: form.labels?.budgets?.[form.budgetTier] || budgetLabel(form.budgetTier),
    servicesLabel: (form.services || []).map(id=>form.labels?.services?.[id] || serviceLabel(id)).join(', '),
    scheduleLabel: scheduleLabel(form.schedule),
    timeline: timelineForStatus(status),
    slotStatus: lead.slotStatus,
    requestedDate: lead.requestedDate,
    requestedTime: lead.requestedTime,
    confirmedDate: lead.confirmedDate,
    confirmedTime: lead.confirmedTime,
    adminNote: lead.adminNote || null,
    package: lead.package
      ? { id: lead.package.id, title: lead.package.title }
      : null,
    customerId: lead.customerId || lead.customer?.id || null,
    customer: lead.customer || null,
    notes: extras.notes || undefined,
    job: extras.job || undefined,
  };
}

function catalogs() {
  return {
    services: SERVICE_OPTIONS,
    budgetTiers: BUDGET_TIERS,
    schedules: SCHEDULES,
    timeline: WEDDING_STEPS,
    statuses: INQUIRY_STATUSES,
  };
}

module.exports = {
  SERVICE_OPTIONS,
  BUDGET_TIERS,
  SCHEDULES,
  INQUIRY_STATUSES,
  WEDDING_STEPS,
  LEAD_STATUS_FOR_INQUIRY,
  serviceLabel,
  budgetLabel,
  scheduleLabel,
  normalizeForm,
  validateWeddingForm,
  primaryDate,
  venueLine,
  datesSummary,
  leadMessage,
  timelineForStatus,
  stepForStatus,
  serializeInquiry,
  catalogs,
  normalizePhone,
  validatePhone,
  parseIsoDate,
};
