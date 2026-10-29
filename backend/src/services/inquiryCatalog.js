const { prisma } = require('../config/prisma');
const { catalogs } = require('./weddingInquiry');
const defaultTypes=[{id:'CORPORATE',label:'Corporate / brand event'},{id:'ENGAGEMENT',label:'Engagement'},{id:'PORTRAIT',label:'Portrait / family session'},{id:'BIRTHDAY',label:'Birthday / celebration'},{id:'PRODUCT',label:'Product / commercial shoot'},{id:'OTHER',label:'Something else'}];
async function getCatalog(studioId) {
 const profile=await prisma.studioProfile.findUnique({where:{studioId}});
 const saved=profile?.inquirySettings||{};
 return {...catalogs(),eventTypes:defaultTypes,...saved};
}
function validateCatalog(body){
 const result={};
 for(const field of ['services','budgetTiers','schedules','eventTypes']){
  const rows=body[field];if(!Array.isArray(rows)||!rows.length||rows.length>50)throw new Error(`Add 1–50 choices for ${field}`);
  const seen=new Set();result[field]=rows.map(r=>{const rawId=String(r.id||'').trim();const id=field==='services'?rawId:rawId.toUpperCase();const label=String(r.label||'').trim();if(!/^[A-Za-z0-9_-]{1,60}$/.test(id)||!label||label.length>120||seen.has(id))throw new Error(`Check labels and unique identifiers in ${field}`);seen.add(id);return {id,label};});
 }
 return result;
}
module.exports={getCatalog,validateCatalog};
