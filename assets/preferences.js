// Preferences are optional: unavailable storage must not prevent reading.
export function readPreference(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Keep the in-memory preference. */ }
}

export function readLastLocation(lang, books) {
  try {
    const saved = JSON.parse(readPreference(`ak-bible-last-${lang}`));
    const book = books.find(item => item.code === saved?.book);
    return book && Number.isInteger(saved.chapter) && saved.chapter >= 1 && saved.chapter <= book.chapters
      ? { book: book.code, chapter: saved.chapter }
      : null;
  } catch { return null; }
}
