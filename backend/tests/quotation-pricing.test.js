const {test}=require('node:test');
const assert=require('node:assert/strict');
const {calculateQuote}=require('../src/services/billing/quotePricing');
const catalog={options:[{id:'a',title:'A',price:1000.25},{id:'b',title:'B',price:2000.50}],addOns:[{id:'album',code:'ALBUM',title:'Album',price:500},{id:'day',code:'EXTRA_DAY',title:'Coverage day',price:100}]};
test('explicit extra-day selection is charged once, multiple coverage days are not double counted',()=>{
 const one=calculateQuote(catalog,{optionIds:['a'],addOnIds:['day']},18);assert.equal(one.total,1298.30);
 const many=calculateQuote(catalog,{optionIds:['a','b'],addOnIds:['day'],extraDays:2},18);assert.deepEqual(many.alternatives.map(x=>x.total),[1416.30,2596.59]);
});
test('an album preference can be explicitly excluded from quotation scope',()=>{
 assert.equal(calculateQuote(catalog,{optionIds:['a'],albumNeeded:true}).subtotal,1500.25);
 assert.equal(calculateQuote(catalog,{optionIds:['a'],albumNeeded:true,addOnIds:[]}).subtotal,1000.25);
 assert.throws(()=>calculateQuote(catalog,{optionIds:['a'],addOnIds:'album'}),/Choose add-ons/);
});
test('budget and album answers are optional for wedding inquiry submission',()=>{
 const {normalizeForm,validateWeddingForm}=require('../src/services/weddingInquiry');
 const form=normalizeForm({name:'Example client',phone:'9123456789',venue:{city:'Pune'},dates:{flexible:true,days:[{event:'Wedding',services:['candid_photographer']}]}});
 assert.deepEqual(validateWeddingForm(form),{});
});

test('PDF amount in words preserves paise instead of rounding to a different rupee amount',()=>{
 const {rupeesInWords}=require('../src/services/billing/quotePricing');
 assert.equal(rupeesInWords(2000.50),'Two Thousand Rupees and Fifty Paise Only');
 assert.equal(rupeesInWords(1000.25),'One Thousand Rupees and Twenty Five Paise Only');
 assert.equal(rupeesInWords(0),'Zero Only');
});
