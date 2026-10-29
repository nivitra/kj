if (!process.env.DATABASE_URL?.includes('/sj_release_rehearsal') || process.env.REDIS_URL !== 'redis://127.0.0.1:55434') throw Error('Disposable PostgreSQL and Redis on localhost:55434 required');
process.env.NODE_ENV='production';
const assert=require('node:assert/strict'),{Worker,UnrecoverableError}=require('bullmq');
const {prisma:db}=require('../src/config/prisma');
const objects=new Map();
require.cache[require.resolve('../src/services/s3')]={exports:{headObject:async key=>objects.has(key)?{exists:true,size:objects.get(key)}:{exists:false}}};
const {queues,QUEUE,connection}=require('../src/queues');
const {enqueueDerivatives,markJob,keys,recoverStuck}=require('../src/services/jobs');
let worker,allowSuccess=false,held=false,release;
async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('Queue transition timed out');}
async function run(){
 assert.equal(await db.photo.count(),0,'Use a freshly initialized disposable database for queue recovery tests');
 const studio=await db.studio.create({data:{name:'Queue regression',email:`queue-${Date.now()}@example.invalid`}});
 const gallery=await db.eventGallery.create({data:{studioId:studio.id,name:'Queue recovery',faceSearchEnabled:false}});
 const photo=await db.photo.create({data:{galleryId:gallery.id,filename:'queue.jpg',originalKey:`test/${gallery.id}/originals/queue.jpg`,fileSize:1,mimeType:'image/jpeg',ingestionStatus:'PROCESSING',processingStatus:'PROCESSING'}});
 const args={studioId:studio.id,galleryId:gallery.id},key=keys.derive(photo.id);
 worker=new Worker(QUEUE.DERIVATIVES,async job=>{await markJob(job.data.idempotencyKey,'RUNNING');if(!allowSuccess){await markJob(job.data.idempotencyKey,'FAILED');throw new UnrecoverableError('Fixture failure');}if(held)await new Promise(r=>{release=r;});await markJob(job.data.idempotencyKey,'COMPLETED');return {ok:true};},{connection});
 await enqueueDerivatives(photo.id,args);await until(async()=>await (await queues[QUEUE.DERIVATIVES].getJob(key)).getState()==='failed');
 allowSuccess=true;held=true;
 await Promise.all([enqueueDerivatives(photo.id,args),enqueueDerivatives(photo.id,args)]);
 await until(async()=>await (await queues[QUEUE.DERIVATIVES].getJob(key)).getState()==='active' && !!release);
 await enqueueDerivatives(photo.id,args);assert.equal((await db.processingJob.findUnique({where:{idempotencyKey:key}})).status,'RUNNING');
 held=false;release();await until(async()=>await (await queues[QUEUE.DERIVATIVES].getJob(key)).getState()==='completed');
 await enqueueDerivatives(photo.id,args);assert.equal((await db.processingJob.findUnique({where:{idempotencyKey:key}})).status,'COMPLETED');
 assert.equal((await queues[QUEUE.DERIVATIVES].getJob(key)).attemptsMade,1);
 // Queue says completed but database photo remains PROCESSING: recovery retries it.
 held=true;await recoverStuck();await until(async()=>await (await queues[QUEUE.DERIVATIVES].getJob(key)).getState()==='active');held=false;release();
 await until(async()=>await (await queues[QUEUE.DERIVATIVES].getJob(key)).getState()==='completed');
 assert.equal((await db.processingJob.findUnique({where:{idempotencyKey:key}})).status,'COMPLETED');
 console.log('PASS real Redis failed-job retry, concurrent retry, active/completed mirror preservation, completed-job recovery for unfinished photo');
 await db.eventGallery.update({where:{id:gallery.id},data:{deletedAt:new Date()}});await markJob(key,'QUEUED');await recoverStuck();
 assert.equal((await db.processingJob.findUnique({where:{idempotencyKey:key}})).status,'FAILED');assert.equal(await (await queues[QUEUE.DERIVATIVES].getJob(key)).getState(),'completed');
 console.log('PASS recovery excludes deleted gallery work');
 const recoveryGallery=await db.eventGallery.create({data:{studioId:studio.id,name:'Interrupted upload'}});
 const registration=await db.photo.create({data:{galleryId:recoveryGallery.id,filename:'uploaded.jpg',originalKey:`test/${recoveryGallery.id}/uploaded.jpg`,fileSize:12,mimeType:'image/jpeg',createdAt:new Date(Date.now()-3600000)}});
 const missing=await db.photo.create({data:{galleryId:recoveryGallery.id,filename:'missing.jpg',originalKey:`test/${recoveryGallery.id}/missing.jpg`,fileSize:12,mimeType:'image/jpeg',createdAt:new Date(Date.now()-3600000)}});
 objects.set(registration.originalKey,12);await recoverStuck();
 assert.equal((await db.photo.findUnique({where:{id:registration.id}})).ingestionStatus,'UPLOADED');
 assert.equal((await db.photo.findUnique({where:{id:missing.id}})).ingestionStatus,'REGISTERED');
 await until(async()=>await (await queues[QUEUE.DERIVATIVES].getJob(keys.derive(registration.id))).getState()==='completed');
 console.log('PASS interrupted upload completes only after object existence and size verification');
 const replayId=require('node:crypto').randomUUID();
 await Promise.all(Array.from({length:12},()=>enqueueDerivatives(replayId,args)));
 await until(async()=>await (await queues[QUEUE.DERIVATIVES].getJob(keys.derive(replayId))).getState()==='completed');
 assert.equal((await db.processingJob.findUnique({where:{idempotencyKey:keys.derive(replayId)}})).status,'COMPLETED');
 console.log('PASS simultaneous initial enqueue leaves one completed job and consistent mirror');
}
run().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(release)release();if(worker)await worker.close();await Promise.all(Object.values(queues).map(q=>q.close()));await connection.quit();await db.$disconnect();});
