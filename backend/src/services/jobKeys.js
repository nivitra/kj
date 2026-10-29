const keys = {
  derive: (photoId) => `derive-${photoId}`,
  index: (photoId) => `index-${photoId}`,
  search: (sessionId) => `search-${sessionId}`,
  broader: (sessionId) => `broader-${sessionId}`,
  del: (photoId) => `delete-${photoId}`,
  cleanup: (sessionId) => `cleanup-${sessionId}`,
  reindex: (galleryId) => `reindex-${galleryId}-${Date.now()}`,
};
module.exports = { keys };
