const BOOKING_STATUSES = [
  'ENQUIRY_RECEIVED', 'BOOKING_CONFIRMED', 'SHOOT_SCHEDULED', 'SHOOT_COMPLETED',
  'EDITING', 'COLOR_GRADING', 'ALBUM_DESIGNING', 'ALBUM_PRINTING',
  'READY_FOR_REVIEW', 'READY_FOR_DELIVERY', 'DELIVERED',
];


const humanizeStatus = (key) => String(key || '')
  .replace(/_/g, ' ')
  .toLowerCase()
  .replace(/\b\w/g, (c) => c.toUpperCase());

/** Stable key for free-text / custom booking stages. */
const normalizeStatusKey = (raw) => {
  const k = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return k || 'CUSTOM';
};

const parseBookingSteps = (raw) => {
  let steps = [];
  if (Array.isArray(raw)) steps = raw;
  else if (typeof raw === 'string') {
    try { steps = JSON.parse(raw); } catch { steps = []; }
  }
  if (!Array.isArray(steps) || !steps.length) {
    return BOOKING_STATUSES.map((key, order) => ({
      key,
      label: humanizeStatus(key),
      order,
      custom: false,
    }));
  }
  return steps
    .map((s, i) => {
      if (typeof s === 'string') {
        return {
          key: normalizeStatusKey(s),
          label: s,
          order: i,
          custom: false,
        };
      }
      const label = (s.label || s.title || s.key || `Step ${i + 1}`).toString();
      const key = normalizeStatusKey(s.key || label);
      return { key, label, order: s.order != null ? Number(s.order) : i, custom: false };
    })
    .sort((a, b) => a.order - b.order);
};

/**
 * Fold custom / free-text statuses into the base package (or default) flow.
 * Customs insert after the last matched step in history — never a separate track.
 */
const mergeBookingFlow = (baseSteps, history, currentStatus) => {
  const base = (Array.isArray(baseSteps) && baseSteps.length)
    ? baseSteps.map((s, i) => ({
      key: s.key || normalizeStatusKey(s.label || s),
      label: s.label || humanizeStatus(s.key || s),
      order: i,
      custom: !!s.custom,
    }))
    : parseBookingSteps([]);

  const result = base.map((s) => ({ ...s }));

  const findIdx = (raw) => {
    if (raw == null || raw === '') return -1;
    const u = String(raw).trim().toUpperCase();
    const nk = normalizeStatusKey(raw);
    return result.findIndex(
      (s) => s.key === nk || s.key.toUpperCase() === u || String(s.label).toUpperCase() === u,
    );
  };

  let cursor = 0;
  const hist = Array.isArray(history) ? history : [];
  for (const h of hist) {
    if (!h || typeof h !== 'object') continue;
    if (h.event === 'SLOT_UPDATED' || h.event === 'RESCHEDULE_REQUESTED') continue;
    const raw = (h.status ?? h.key ?? '').toString();
    if (!raw) continue;
    const key = normalizeStatusKey(raw);
    const label = (h.label || raw).toString().trim() || humanizeStatus(key);
    let idx = findIdx(key);
    if (idx < 0) idx = findIdx(raw);
    if (idx >= 0) {
      cursor = idx + 1;
      if (h.label && result[idx] && result[idx].custom) {
        result[idx] = { ...result[idx], label: h.label };
      }
    } else {
      result.splice(cursor, 0, {
        key,
        label,
        order: cursor,
        custom: true,
      });
      cursor += 1;
    }
  }

  if (currentStatus) {
    const key = normalizeStatusKey(currentStatus);
    let idx = findIdx(key);
    if (idx < 0) idx = findIdx(currentStatus);
    if (idx < 0) {
      const looksKey = String(currentStatus).trim() === key || /_/.test(String(currentStatus));
      result.splice(cursor, 0, {
        key,
        label: looksKey ? humanizeStatus(key) : String(currentStatus).trim(),
        order: cursor,
        custom: true,
      });
    }
  }

  return result.map((s, i) => ({ ...s, order: i }));
};

const indexInBookingFlow = (steps, currentStatus) => {
  if (!steps?.length) return 0;
  const u = String(currentStatus || '').trim().toUpperCase();
  const nk = normalizeStatusKey(currentStatus);
  const idx = steps.findIndex(
    (s) => s.key === nk || s.key.toUpperCase() === u || String(s.label || '').toUpperCase() === u,
  );
  return idx >= 0 ? idx : Math.max(0, steps.length - 1);
};

function serializeJob(job) {
  const hist = Array.isArray(job?.history) ? job.history : [];
  const base = Array.isArray(job?.steps) && job.steps.length
    ? job.steps
    : parseBookingSteps([]);
  const steps = mergeBookingFlow(base, hist, job?.status);
  const created = job?.createdAt || hist[0]?.at || null;
  return {
    ...job,
    id: job?.id,
    leadId: job?.leadId || job?.id || null,
    packageId: job?.packageId || null,
    packageTitle: job?.packageTitle || 'Your booking',
    source: job?.source || 'ENQUIRE',
    status: job?.status || 'ENQUIRY_RECEIVED',
    steps,
    stepIndex: indexInBookingFlow(steps, job?.status),
    history: hist,
    slotStatus: job?.slotStatus || 'NONE',
    requestedDate: job?.requestedDate || null,
    requestedTime: job?.requestedTime || null,
    slotLabel: job?.slotLabel || null,
    confirmedDate: job?.confirmedDate || null,
    confirmedTime: job?.confirmedTime || null,
    rescheduleNote: job?.rescheduleNote || null,
    rescheduleRequestedAt: job?.rescheduleRequestedAt || null,
    createdAt: created,
    updatedAt: job?.updatedAt || created,
  };
}

function legacyBookingToJob(booking) {
  const pkg = booking?.servicePackage;
  const steps = pkg ? parseBookingSteps(pkg.bookingSteps) : parseBookingSteps([]);
  const hist = Array.isArray(booking?.history) ? booking.history : [];
  return serializeJob({
    id: booking.id,
    packageId: booking.servicePackageId || pkg?.id || null,
    packageTitle: pkg?.title || 'Your booking',
    source: 'LEGACY',
    status: booking.status,
    steps,
    history: hist,
    slotStatus: booking.slotStatus || 'NONE',
    requestedDate: booking.requestedDate,
    requestedTime: booking.requestedTime,
    confirmedDate: booking.confirmedDate,
    confirmedTime: booking.confirmedTime,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  });
}

function jobsFromBooking(booking) {
  const raw = booking?.jobs;
  if (Array.isArray(raw) && raw.length > 0) {
    // Labels stay stable when a newer enquiry is prepended or a stage advances.
    const jobs = raw.map((j) => serializeJob(j));
    const chronological = [...jobs].sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)));
    return jobs.map(j => ({ ...j, shootNumber: chronological.findIndex(x => x.id === j.id) + 1,
      shootLabel: `S${chronological.findIndex(x => x.id === j.id) + 1}` }));
  }
  if (!booking) return [];
  return [{ ...legacyBookingToJob(booking), shootNumber: 1, shootLabel: 'S1' }];
}

function selectJobIndex(jobs, jobId) {
  if (jobId) {
    const index = jobs.findIndex(j => j.id === jobId || j.leadId === jobId);
    if (index >= 0) return index;
    const err = new Error('This shoot no longer exists. Refresh and choose a shoot.');
    err.status = 404;
    throw err;
  }
  if (jobs.length > 1) {
    const err = new Error('Choose which shoot to update. This client has multiple timelines.');
    err.status = 409;
    throw err;
  }
  return 0;
}

function isPlaceholderJobList(booking, jobs) {
  if (!jobs.length) return true;
  if (jobs.length !== 1) return false;
  const j = jobs[0];
  const hist = j.history || [];
  const noPkg = !j.packageId && !booking?.servicePackageId;
  const onlySeed = hist.length <= 1
    && (hist[0]?.note === 'Timeline started' || !hist[0]?.note);
  return noPkg && onlySeed && (j.status === 'ENQUIRY_RECEIVED' || !j.status);
}


module.exports = { BOOKING_STATUSES, humanizeStatus, normalizeStatusKey, parseBookingSteps, mergeBookingFlow, indexInBookingFlow, serializeJob, legacyBookingToJob, jobsFromBooking, isPlaceholderJobList, selectJobIndex };
