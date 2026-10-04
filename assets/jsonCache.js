// Session-only, bounded LRU. First requests still revalidate HTTP content.
// Failed requests are never retained; reloading the document starts a fresh cache.
export function createJSONLoader(fetcher = (...args) => fetch(...args), limit = 24) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Invalid JSON cache limit');
  const entries = new Map();
  return function getJSON(path) {
    if (entries.has(path)) {
      const request = entries.get(path);
      entries.delete(path);
      entries.set(path, request);
      return request;
    }
    const request = Promise.resolve()
      .then(() => fetcher(path, { cache: 'no-cache' }))
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${path}`);
        return response.json();
      })
      .catch(error => {
        // An old, evicted request must not remove a newer request for this URL.
        if (entries.get(path) === request) entries.delete(path);
        throw error;
      });
    entries.set(path, request);
    if (entries.size > limit) entries.delete(entries.keys().next().value);
    return request;
  };
}
