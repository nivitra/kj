const crypto = require('crypto');

// Deterministic in-memory Rekognition mock so local dev and tests run without AWS.
// Faces are derived from the S3 key so the same image always yields the same
// faceIds, and search matches any indexed face sharing a "person bucket".
//
// Person bucket = first hex char of sha1(key) — images with the same first hex
// char are treated as "the same person" for search, which is enough to exercise
// grouping, dedup, ranking, and access-filtering paths in tests.

const store = new Map(); // faceId -> { externalImageId, personBucket }

let failNextWith = null; // tests can set this to simulate errors
const _simulateFailure = (errName) => { failNextWith = errName; };

const maybeFail = () => {
  if (failNextWith) {
    const err = new Error(`Simulated ${failNextWith}`);
    err.name = failNextWith;
    failNextWith = null;
    throw err;
  }
};

const bucketOf = (key) => crypto.createHash('sha1').update(key).digest('hex')[0];
const faceCountOf = (key) => (parseInt(crypto.createHash('sha1').update(key).digest('hex')[1], 16) % 3); // 0..2

module.exports = {
  async ensureCollection(collectionId = 'sj-studio-prod-faces-v1') {
    return { collectionId, created: false, faceCount: store.size };
  },

  async listCollections() {
    return ['sj-studio-prod-faces-v1'];
  },

  async indexFaces({ key, bytes, externalImageId }) {
    maybeFail();
    const seed = key || (bytes ? crypto.createHash('sha1').update(bytes).digest('hex') : 'bytes');
    const count = faceCountOf(seed) || 1; // verification images always get ≥1 face in mock
    const faces = [];
    for (let i = 0; i < count; i++) {
      const faceId = crypto.createHash('sha1').update(`${seed}:${i}`).digest('hex');
      const personBucket = bucketOf(`${seed}:${i}`);
      store.set(faceId, { externalImageId, personBucket });
      faces.push({
        faceId,
        externalImageId,
        boundingBox: { Width: 0.1, Height: 0.1, Left: 0.1 * i, Top: 0.1 },
        confidence: 99.5,
        pose: { Yaw: 0, Pitch: 0, Roll: 0 },
        quality: { Brightness: 80, Sharpness: 80 },
      });
    }
    return faces;
  },

  async detectFaces({ key, bytes }) {
    maybeFail();
    const seed = key || '';
    // Selfies validate as exactly one clear face unless key hints otherwise.
    if (seed.includes('noface')) return [];
    if (seed.includes('multiface')) {
      return [
        { boundingBox: { Width: 0.3, Height: 0.3 }, confidence: 99, quality: { Brightness: 80, Sharpness: 80 } },
        { boundingBox: { Width: 0.3, Height: 0.3 }, confidence: 98, quality: { Brightness: 80, Sharpness: 80 } },
      ];
    }
    return [{ boundingBox: { Width: 0.4, Height: 0.4 }, confidence: 99.9, quality: { Brightness: 85, Sharpness: 85 } }];
  },

  async searchFacesByImage({ key, bytes }) {
    maybeFail();
    const seed = key || (bytes ? crypto.createHash('sha1').update(bytes).digest('hex') : 'bytes');
    const bucket = bucketOf(`${seed}:0`);
    const matches = [];
    for (const [faceId, rec] of store.entries()) {
      if (rec.personBucket === bucket) {
        matches.push({ faceId, externalImageId: rec.externalImageId, similarity: 97 + Math.random() * 2 });
      }
    }
    return matches;
  },

  async searchFaces({ faceId }) {
    maybeFail();
    const seed = store.get(faceId);
    if (!seed) return [];
    const matches = [];
    for (const [id, rec] of store.entries()) {
      if (rec.personBucket === seed.personBucket && id !== faceId) {
        matches.push({ faceId: id, externalImageId: rec.externalImageId, similarity: 96 + Math.random() * 3 });
      }
    }
    return matches;
  },

  async deleteFaces(faceIds) {
    const deleted = [];
    for (const id of faceIds || []) {
      store.delete(id);
      deleted.push(id);
    }
    return { deleted };
  },

  _simulateFailure,
  _reset() { store.clear(); failNextWith = null; },
};
