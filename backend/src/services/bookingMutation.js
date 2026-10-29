const { v4: uuidv4 } = require('uuid');
const { AppError, CODES } = require('../lib/errors');
const { jobsFromBooking, isPlaceholderJobList, selectJobIndex, parseBookingSteps,
  normalizeStatusKey, humanizeStatus, serializeJob } = require('./bookingJobs');

async function withBooking(db, studioId, customerId, action) {
  return db.$transaction(async tx => {
    // Jobs are JSON; serialize read/modify/write to prevent parallel shoot edits
    // (or enquiries) from dropping a sibling timeline.
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} AND "studioId" = ${studioId} FOR UPDATE`;
    const customer = await tx.customer.findFirst({ where: { id: customerId, studioId } });
    if (!customer) throw new AppError(CODES.NOT_FOUND, 'Customer not found', { status: 404 });
    const booking = await tx.customerBooking.findUnique({ where: { customerId }, include: { servicePackage: true } });
    return action(tx, booking, customer);
  });
}

async function updateStage(db, { studioId, customerId, body }) {
  return withBooking(db, studioId, customerId, async (tx, booking) => {
    let jobs = jobsFromBooking(booking);
    const creating = !booking || body.createJob === true;
    const index = creating ? jobs.length : selectJobIndex(jobs, body.jobId);
    const old = creating ? null : jobs[index];
    const packageId = body.servicePackageId !== undefined ? body.servicePackageId || null : old?.packageId;
    const pkg = packageId ? await tx.servicePackage.findFirst({ where: { id: packageId, studioId } }) : null;
    if (packageId && !pkg) throw new AppError(CODES.NOT_FOUND, 'Package not found', { status: 404 });
    const packageChanged = creating || (body.servicePackageId !== undefined && packageId !== old?.packageId);
    const base = packageChanged ? parseBookingSteps(pkg?.bookingSteps) : old.steps;
    const raw = String(body.customLabel || body.status || old?.status || base[0]?.key || 'ENQUIRY_RECEIVED').trim();
    const status = normalizeStatusKey(raw);
    const matched = base.find(s => s.key === status || s.label?.toUpperCase() === raw.toUpperCase());
    const note = body.customNote ?? body.notes ?? null;
    const now = new Date().toISOString();
    const jobId = old?.id || uuidv4();
    const entry = { status: matched?.key || status, label: body.customLabel || matched?.label || humanizeStatus(raw),
      at: now, note, custom: !matched, jobId };
    const job = serializeJob({ ...old, id: jobId, leadId: old?.leadId || null,
      source: old?.source || 'ADMIN', packageId: pkg?.id || null,
      packageTitle: pkg?.title || old?.packageTitle || 'Your booking',
      status: entry.status, steps: base, history: [...(old?.history || []), entry],
      createdAt: old?.createdAt || now, updatedAt: now });
    if (creating && isPlaceholderJobList(booking, jobs)) jobs = [];
    if (creating) jobs.push(job); else jobs[index] = job;
    const primary = jobs[0];
    const data = { jobs, status: primary.status, servicePackageId: primary.packageId,
      history: [...(Array.isArray(booking?.history) ? booking.history : []), entry],
      ...(body.notes !== undefined && { notes: body.notes }),
      ...(body.estimatedCompletion !== undefined && { estimatedCompletion: body.estimatedCompletion ? new Date(body.estimatedCompletion) : null }) };
    const result = booking
      ? await tx.customerBooking.update({ where: { id: booking.id }, data, include: { servicePackage: true } })
      : await tx.customerBooking.create({ data: { studioId, customerId, ...data }, include: { servicePackage: true } });
    return { booking: result, job, entry };
  });
}

async function updateSlot(db, { studioId, customerId, jobId, date, time, label, note, reschedule = false }) {
  return withBooking(db, studioId, customerId, async (tx, booking) => {
    if (!booking) throw new AppError(CODES.CONFLICT, 'Create a shoot timeline before scheduling it.', { status: 409 });
    const jobs = jobsFromBooking(booking);
    const index = selectJobIndex(jobs, jobId);
    const job = jobs[index];
    const now = new Date().toISOString();
    const event = reschedule ? 'RESCHEDULE_REQUESTED' : 'SLOT_UPDATED';
    const entry = { status: job.status, event, label: reschedule ? 'Reschedule requested' : 'Shoot time updated',
      at: now, note: `${reschedule ? 'Requested' : 'Confirmed'} shoot slot: ${label}${note ? ` · ${note}` : ''}`, jobId: job.id };
    const slot = reschedule
      ? { requestedDate: date, requestedTime: time, slotStatus: 'RESCHEDULE_REQUESTED', rescheduleNote: note || null, rescheduleRequestedAt: now }
      : { confirmedDate: date, confirmedTime: time, slotLabel: label, slotStatus: 'ACCEPTED', requestedDate: null,
        requestedTime: null, rescheduleNote: null, rescheduleRequestedAt: null };
    const hadConfirmed = !!job.confirmedDate;
    jobs[index] = serializeJob({ ...job, ...slot, history: [...job.history, entry], updatedAt: now });
    // Update only this shoot's enquiry. A legacy job has no related lead.
    await tx.lead.updateMany({ where: { id: job.leadId || job.id, customerId, studioId },
      data: { ...slot, slotLabel: undefined, ...(reschedule ? {} : { decidedAt: new Date(), status: 'WON' }) } });
    const rootSlot = { ...slot }; delete rootSlot.slotLabel;
    const result = await tx.customerBooking.update({ where: { id: booking.id }, data: {
      jobs, ...(index === 0 && rootSlot),
      history: [...(Array.isArray(booking.history) ? booking.history : []), entry],
    }, include: { servicePackage: true } });
    return { booking: result, job: jobs[index], hadConfirmed };
  });
}
module.exports = { withBooking, updateStage, updateSlot };
