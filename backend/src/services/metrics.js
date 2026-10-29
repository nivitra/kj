const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const counters = {
  photosProcessed: new client.Counter({ name: 'photos_processed_total', help: 'Photos processed', labelNames: ['outcome'], registers: [register] }),
  facesIndexed: new client.Counter({ name: 'faces_indexed_total', help: 'Faces indexed', registers: [register] }),
  faceSearches: new client.Counter({ name: 'face_searches_total', help: 'Face searches', labelNames: ['outcome'], registers: [register] }),
  rekognitionCalls: new client.Counter({ name: 'rekognition_calls_total', help: 'Rekognition API calls', labelNames: ['op', 'outcome'], registers: [register] }),
  jobsFailed: new client.Counter({ name: 'jobs_failed_total', help: 'Jobs failed', labelNames: ['queue'], registers: [register] }),
  deadLetter: new client.Counter({ name: 'jobs_dead_letter_total', help: 'Jobs dead-lettered', labelNames: ['queue'], registers: [register] }),
  selfieCleanups: new client.Counter({ name: 'selfie_cleanups_total', help: 'Selfie cleanups', labelNames: ['outcome'], registers: [register] }),
};

module.exports = { register, counters };
