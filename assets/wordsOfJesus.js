const SPEAKER_CLASSES = Object.freeze({ jesus: 'jesus-words', jehovah: 'jehovah-words', melchizedek: 'melchizedek-words' });
const MARKERS = new Set(['wj', 'red', 'jesus', 'jesus-words', 'words-of-jesus', 'red-letter']);
const TAGS = /<\/?(?:span|font|red|jesus|jesus-words|words-of-jesus)\b[^>]*>/gi;

// Defense in depth for cached/legacy payloads. Wrappers are never evidence.
export function normalizeSpeechContent(content, mode = 'none') {
  if (mode === 'none') return content;
  if (mode !== 'legacy') throw new Error(`Unknown speech normalization: ${mode}`);
  return content.flatMap(node => {
    if (typeof node === 'string') return [node.replace(TAGS, '').replaceAll('*', '')];
    if (!node || typeof node !== 'object') return [];
    const copy = { ...node };
    if (copy.content) copy.content = normalizeSpeechContent(copy.content, mode);
    return copy.type === 'char' && MARKERS.has((copy.marker || '').toLowerCase())
      ? copy.content || [] : [copy];
  });
}

export function highlightSpeech(body, book, speech = {}, chapter, speakerLabels = {}, ambiguity = {}) {
  if (!speech || typeof speech !== 'object' || Array.isArray(speech)) throw new Error(`Invalid speech map: ${book} ${chapter}`);
  if (!ambiguity || typeof ambiguity !== 'object' || Array.isArray(ambiguity)) throw new Error(`Invalid ambiguity map: ${book} ${chapter}`);
  if (!Object.keys(speech).length && !Object.keys(ambiguity).length) return;
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
  const entries = [
    ...Object.entries(speech).map(([number, entry]) => ({ number, entry, kind: 'speech' })),
    ...Object.entries(ambiguity).map(([number, entry]) => ({ number, entry, kind: 'ambiguity' }))
  ];
  const rangesByVerse = new Map();
  for (const { number, entry, kind } of entries) {
    const nodes = verses.get(number);
    const raw = nodes?.map(node => node.data).join('');
    if (!entry || typeof entry.text !== 'string' || !Array.isArray(entry.spans) || raw === undefined || raw.trim() !== entry.text) {
      throw new Error(`${kind === 'ambiguity' ? 'Ambiguity' : 'Speech'} text mismatch: ${book} ${number}`);
    }
    const points = Array.from(entry.text);
    const offsets = [0];
    for (const point of points) offsets.push(offsets.at(-1) + point.length);
    const leading = raw.length - raw.trimStart().length;
    let previous = 0;
    const ranges = entry.spans.map(span => {
      const validSpeech = kind === 'speech' && typeof span.speech === 'string' && span.speech && Object.hasOwn(SPEAKER_CLASSES, span.speaker);
      const validAmbiguity = kind === 'ambiguity' && typeof span.group === 'string' && span.group;
      if (!Number.isInteger(span.start) || !Number.isInteger(span.end) ||
          span.start < previous || span.end <= span.start || span.end > points.length ||
          (!validSpeech && !validAmbiguity)) {
        throw new Error(`Invalid ${kind} interval: ${book} ${number}`);
      }
      previous = span.end;
      return {
        start: offsets[span.start] + leading,
        end: offsets[span.end] + leading,
        kind,
        ...(validSpeech ? { speech: span.speech, speaker: span.speaker } : { group: span.group })
      };
    });
    rangesByVerse.set(number, [...(rangesByVerse.get(number) || []), ...ranges]);
  }
  for (const ranges of rangesByVerse.values()) {
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const speechRanges = ranges.filter(range => range.kind === 'speech');
    const ambiguityRanges = ranges.filter(range => range.kind === 'ambiguity');
    for (const sameKind of [speechRanges, ambiguityRanges]) {
      for (let index = 1; index < sameKind.length; index++) {
        if (sameKind[index].start < sameKind[index - 1].end) throw new Error(`Overlapping annotation intervals: ${book} ${chapter}`);
      }
    }
  }
  for (const [number, ranges] of rangesByVerse) {
    const nodes = verses.get(number);
    let position = 0;
    for (const node of nodes) {
      const end = position + node.length;
      const relevant = ranges.filter(range => range.start < end && range.end > position);
      if (relevant.length) changes.push({ node, position, ranges: relevant });
      position = end;
    }
  }
  for (const { node, position, ranges } of changes) {
    const replacement = document.createDocumentFragment();
    let cursor = 0;
    while (cursor < node.length) {
      const absolute = position + cursor;
      const ambiguityRange = ranges.find(range => range.kind === 'ambiguity' && range.start <= absolute && range.end > absolute);
      const active = ambiguityRange || ranges.find(range => range.kind === 'speech' && range.start <= absolute && range.end > absolute);
      const nextBoundary = ranges.reduce((next, range) => {
        if (range.start > absolute) return Math.min(next, range.start);
        if (range.end > absolute) return Math.min(next, range.end);
        return next;
      }, position + node.length);
      const localEnd = Math.min(node.length, nextBoundary - position);
      if (localEnd <= cursor) throw new Error(`Could not render annotation interval: ${book} ${chapter}`);
      if (!active) {
        replacement.append(document.createTextNode(node.data.slice(cursor, localEnd)));
      } else {
        const span = document.createElement('span');
        if (active.kind === 'ambiguity') {
          span.className = 'ambiguous-words';
          span.dataset.ambiguityGroup = active.group;
        } else {
          span.className = SPEAKER_CLASSES[active.speaker];
          span.dataset.speech = active.speech;
          span.dataset.speaker = active.speaker;
          span.title = speakerLabels[active.speaker] || active.speaker;
        }
        span.textContent = node.data.slice(cursor, localEnd);
        replacement.append(span);
      }
      cursor = localEnd;
    }
    node.replaceWith(replacement);
  }
}
