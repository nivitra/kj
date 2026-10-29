const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { cropBuffer } = require('../src/services/cropImage');
const { normalizePhone, normalizeForm } = require('../src/services/weddingInquiry');
test('Indian national number starting 91 is preserved', () => {
 for (const phone of ['9123456789', '+919123456789', '919123456789', '09123456789']) assert.equal(normalizePhone('+91',phone).national,'9123456789');
 assert.equal(normalizeForm({dates:{days:[{event:'Wedding',date:'2026-02-31'}]}}).dates.days[0].date,'');
});
test('crop uses EXIF oriented pixels and validates boundaries', async () => {
 const original=await sharp({create:{width:80,height:40,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const out=await cropBuffer(original,{x:0,y:0.5,width:1,height:0.5},{format:'jpeg'});
 const m=await sharp(out).metadata(); assert.equal(m.width,40);assert.equal(m.height,40);
 await assert.rejects(cropBuffer(original,{x:1,y:0,width:0.2,height:1}));
 const edge=await cropBuffer(original,{x:.9999,y:.9999,width:.001,height:.001});
 const tiny=await sharp(edge).metadata();assert.equal(tiny.width,1);assert.equal(tiny.height,1);
});
