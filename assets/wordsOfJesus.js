const BOOKS = new Set(['GEN', 'MAT', 'MRK', 'LUK', 'JHN', 'REV']);
const isSpeechChapter = (book, chapter) => BOOKS.has(book) && (book !== 'GEN' || Number(chapter) === 14);
const MARKERS = new Set(['wj', 'red', 'jesus', 'jesus-words', 'words-of-jesus', 'red-letter']);
const TAGS = /<\/?(?:span|font|red|jesus|jesus-words|words-of-jesus)\b[^>]*>/gi;

// Defense in depth for cached/legacy payloads. Wrappers are never evidence.
export function normalizeSpeechContent(content, book, chapter) {
  if (!isSpeechChapter(book, chapter)) return content;
  return content.flatMap(node => {
    if (typeof node === 'string') return [node.replace(TAGS, '').replaceAll('*', '')];
    if (!node || typeof node !== 'object') return [];
    const copy = { ...node };
    if (copy.content) copy.content = normalizeSpeechContent(copy.content, book, chapter);
    return copy.type === 'char' && MARKERS.has((copy.marker || '').toLowerCase())
      ? copy.content || [] : [copy];
  });
}

export function highlightSpeech(body, book, speech = {}, chapter) {
  if (!isSpeechChapter(book, chapter)) return;
  const verses = new Map();
  let current;
  for (const fragment of body.querySelectorAll('.scripture-verse, .scripture-continuation')) {
    const number = fragment.querySelector('.verse-number');
    if (number) {
      current = number.textContent;
      if (verses.has(current)) throw new Error(`Duplicate speech verse: ${current}`);
      verses.set(current, []);
    }
    if (!verses.has(current)) continue;
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement.closest('.verse-number')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    while (walker.nextNode()) verses.get(current).push(walker.currentNode);
  }
  // Validate the chapter before highlighting. Catalogue offsets are code points;
  // DOM slicing uses UTF-16 code units (which differ for supplementary characters).
  const changes = [];
  for (const [number, entry] of Object.entries(speech)) {
    const nodes = verses.get(number);
    const raw = nodes?.map(node => node.data).join('');
    if (raw === undefined || raw.trim() !== entry.text) {
      throw new Error(`Speech text mismatch: ${book} ${number}`);
    }
    const points = Array.from(entry.text);
    const offsets = [0];
    for (const point of points) offsets.push(offsets.at(-1) + point.length);
    const leading = raw.length - raw.trimStart().length;
    let previous = 0;
    const spans = entry.spans.map(span => {
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) ||
          span.start < previous || span.end <= span.start || span.end > points.length || !span.speech) {
        throw new Error(`Invalid speech interval: ${book} ${number}`);
      }
      previous = span.end;
      return { start: offsets[span.start] + leading, end: offsets[span.end] + leading, speech: span.speech };
    });
    let position = 0;
    for (const node of nodes) {
      const end = position + node.length;
      const parts = spans.filter(span => span.start < end && span.end > position)
        .map(span => ({ start: Math.max(0, span.start - position), end: Math.min(node.length, span.end - position), speech: span.speech }));
      if (parts.length) changes.push({ node, parts });
      position = end;
    }
  }
  for (const { node, parts } of changes) {
    const replacement = document.createDocumentFragment();
    let cursor = 0;
    for (const part of parts) {
      replacement.append(document.createTextNode(node.data.slice(cursor, part.start)));
      const span = document.createElement('span');
      span.className = book === 'GEN' ? 'melchizedek-words' : 'jesus-words';
      span.dataset.speech = part.speech;
      span.textContent = node.data.slice(part.start, part.end);
      replacement.append(span);
      cursor = part.end;
    }
    replacement.append(document.createTextNode(node.data.slice(cursor)));
    node.replaceWith(replacement);
  }
}
