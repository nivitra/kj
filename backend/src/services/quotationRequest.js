const { normalizePhone, validatePhone } = require('./weddingInquiry');

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
function integer(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) invalid(`${label} must be between ${min} and ${max}`);
  return n;
}
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function normalizeRequest(body, catalog, customer = {}) {
  const kind = text(body.kind, 60).toUpperCase();
  const types = [{ id: 'WEDDING', label: 'Wedding' }, ...catalog.eventTypes];
  const type = types.find(t => t.id === kind);
  if (!type) invalid('Choose an event type');
  const contact = body.contact || {};
  const name = text(contact.name || customer.name, 120);
  if (name.length < 2) invalid('Enter your full name');
  const phone = normalizePhone(contact.countryCode || '+91', contact.phone || customer.phone);
  const phoneError = validatePhone(phone.countryCode, phone.national);
  if (phoneError || phone.e164.length > 16) invalid(phoneError || 'Enter a valid phone number');
  const email = text(contact.email || customer.email, 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('Enter a valid email address');
  const venue = { location: text(body.venue?.location || body.venue, 200), city: text(body.venue?.city, 80) };
  if (!venue.location && !venue.city) invalid('Add your venue or city');
  const inputDates = body.dates || {};
  const flexible = inputDates.flexible === true;
  const dayCount = integer(inputDates.dayCount, 1, 30, 'Coverage days');
  const start = flexible ? null : dateOnly(inputDates.start);
  const end = flexible ? null : dateOnly(inputDates.end);
  if (!flexible) {
    if (!start || !end) invalid('Choose valid start and end dates');
    if (end < start) invalid('End date must be on or after the start date');
    if (start.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)) invalid('Choose today or a future date');
    if (dayCount > Math.round((end - start) / 86400000) + 1) invalid('Coverage days cannot exceed your date range');
  }
  if (!Array.isArray(body.services) || !body.services.length || body.services.some(id => !catalog.services.some(s => s.id === id))) invalid('Choose the coverage you need');
  const services = [...new Set(body.services)];
  const crewCounts = Object.fromEntries(services.map(id => [id, integer(body.crewCounts?.[id] ?? 1, 1, 50, 'Team quantity')]));
  const budgetTier = text(body.budgetTier || catalog.budgetTiers.at(-1)?.id, 60);
  if (!catalog.budgetTiers.some(t => t.id === budgetTier)) invalid('Choose a budget preference');
  const albumNeeded = body.album?.needed;
  if (typeof albumNeeded !== 'boolean') invalid('Tell us whether you need a physical album');
  const album = { needed: albumNeeded, count: albumNeeded ? integer(body.album.count ?? 1, 1, 20, 'Album quantity') : 0, notes: text(body.album?.notes, 400) };
  const guestCount = body.guestCount == null || body.guestCount === '' ? null : integer(body.guestCount, 1, 100000, 'Expected guests');
  return {
    kind, eventType: type.label,
    contact: { name, phone: phone.e164, countryCode: phone.countryCode, email }, venue,
    dates: { flexible, dayCount, start: start?.toISOString().slice(0, 10) || '', end: end?.toISOString().slice(0, 10) || '', days: [] },
    services, crewCounts, album, budgetTier, guestCount,
    organization: text(body.organization, 160), deliverables: text(body.deliverables, 1500), notes: text(body.notes, 4000),
    labels: { services: Object.fromEntries(catalog.services.map(s => [s.id, s.label])), budgets: Object.fromEntries(catalog.budgetTiers.map(s => [s.id, s.label])) },
  };
}

function leadData(studioId, form, customerId = null) {
  return {
    studioId, customerId, name: form.contact.name, phone: form.contact.phone, email: form.contact.email || null,
    source: 'QUOTATION_REQUEST', inquiryKind: form.kind, inquiryStatus: 'PENDING', status: 'NEW', formData: form,
    message: [form.eventType, form.organization, form.venue.location, form.deliverables, form.notes].filter(Boolean).join('\n'),
    requestedDate: form.dates.flexible ? null : dateOnly(form.dates.start), slotStatus: form.dates.flexible ? 'NONE' : 'REQUESTED',
  };
}
module.exports = { normalizeRequest, leadData, dateOnly };
