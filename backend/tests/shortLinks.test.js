const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDestination, canShare, createShortLink, available } = require('../src/services/shortLinks');

test('share destinations reject external URLs, encoded path tricks and credentials', () => {
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/gallery/../app', '/gallery/%2f%2fevil', '/app#secret', '/quotes?id=x&id=y', '/app?token=secret', '/quotation-request?studioId=x&token=secret', '/login', '/app?tab=\n']) assert.equal(parseDestination(path), null, path);
  for (const path of ['/app', '/gallery/gallery-1', '/gallery/gallery-1/selection', '/packages?id=package-2', '/quotation-request?studioId=studio-1']) assert.equal(parseDestination(path).path, path);
});
test('sharing verifies client ownership, publication and tenant scope', async () => {
  const db = {
    quote: { findFirst: async ({where}) => where.customerId === 'owner' && where.studioId === 'studio' ? {id:'quote'} : null },
    eventGallery: { findFirst: async () => ({ status: 'PUBLISHED' }) },
    accessGrant: { findFirst: async ({where}) => where.customerId === 'owner' ? {} : null },
  };
  assert.equal(await canShare(parseDestination('/quotes?id=quote'), {studioId:'studio',customerId:'owner'}, db), true);
  assert.equal(await canShare(parseDestination('/quotes?id=quote'), {studioId:'studio',customerId:'other'}, db), false);
  assert.equal(await canShare(parseDestination('/quotes?id=quote'), {studioId:'other',customerId:'owner'}, db), false);
  assert.equal(await canShare(parseDestination('/gallery/gallery'), {studioId:'studio',customerId:'other'}, db), false);
  assert.equal(await canShare(parseDestination('/quotation-request?studioId=other'), {studioId:'studio'}, db), false);
});
test('short URLs are reused and expired or revoked links become unavailable', async () => {
  let row;
  const db = { shortLink: {
    findUnique: async () => row,
    create: async ({data}) => (row = {...data,id:'link'}),
    updateMany: async ({data}) => { row = {...row,...data}; return {count:1}; },
  }};
  const first = await createShortLink({studioId:'studio',path:'/quotes?id=quote'},db);
  assert.match(first.path, /^\/l\/[A-Za-z0-9_-]{16}$/);
  assert.deepEqual(await createShortLink({studioId:'studio',path:'/quotes?id=quote'},db),first);
  assert.equal(available(row),true);
  row.active=false;
  assert.equal(available(row),false);
  const replacement=await createShortLink({studioId:'studio',path:'/quotes?id=quote'},db);
  assert.notEqual(replacement.path,first.path);
  row.expiresAt=new Date(Date.now()-1000);
  assert.equal(available(row),false);
});
