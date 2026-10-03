// Match canonical verse labels (or book codes on Home), never translated text.
function readingLine() {
  return (document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0) + 12;
}

function anchors(container) {
  return [...container.querySelectorAll('.verse-number, [data-book]')]
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
}

function key(element) {
  return element.dataset.verse ?? element.dataset.book;
}

function visibleColumn(container, preferredLanguage) {
  const columns = [...container.querySelectorAll('.scripture-column')];
  const viewport = container.getBoundingClientRect();
  return columns.sort((a, b) => {
    const width = column => {
      const rect = column.getBoundingClientRect();
      return Math.max(0, Math.min(rect.right, viewport.right, innerWidth) - Math.max(rect.left, viewport.left, 0));
    };
    const difference = width(b) - width(a);
    if (Math.abs(difference) < 1) {
      return Number(b.dataset.language === preferredLanguage) - Number(a.dataset.language === preferredLanguage);
    }
    return difference;
  })[0] || container;
}

function interval(items, index, column) {
  const start = items[index].getBoundingClientRect().top;
  const end = items[index + 1]?.getBoundingClientRect().top ?? column.getBoundingClientRect().bottom;
  return { start, height: Math.max(1, end - start) };
}

export function captureReadingPosition(container, preferredLanguage) {
  const column = visibleColumn(container, preferredLanguage);
  const position = {
    top: window.scrollY, left: window.scrollX,
    language: column.dataset.language,
    columnOffset: column.getBoundingClientRect().left - container.getBoundingClientRect().left
  };
  if (position.top === 0) return position;
  const items = anchors(column);
  if (!items.length) return position;
  const line = readingLine();
  let index = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].getBoundingClientRect().top <= line + 0.5) index = i;
    else break;
  }
  const { start, height } = interval(items, index, column);
  position.anchor = key(items[index]);
  // Keep progress inside long verses, whose translated text may wrap differently.
  position.progress = Math.min(1, Math.max(0, (line - start) / height));
  position.gap = Math.max(0, start - line);
  return position;
}

export function restoreReadingPosition(container, position) {
  const columns = [...container.querySelectorAll('.scripture-column')];
  const column = columns.find(element => element.dataset.language === position.language) || columns[0] || container;
  if (columns.length > 1 && column.dataset.language === position.language) {
    container.scrollLeft += column.getBoundingClientRect().left - container.getBoundingClientRect().left - position.columnOffset;
  } else {
    container.scrollLeft = 0;
  }
  const items = anchors(column);
  const index = items.findIndex(element => key(element) === position.anchor);
  let top = position.top;
  if (position.anchor !== undefined && index >= 0) {
    const { start, height } = interval(items, index, column);
    top = window.scrollY + start + position.progress * height - position.gap - readingLine();
  }
  // An absent exact reference uses the original pixel offset, clamped by the
  // browser. Do not infer equivalence between differently numbered verses.
  window.scrollTo({ top: Math.max(0, top), left: position.left, behavior: 'instant' });
}

export async function prepareReadingFonts(size) {
  // Keep the old chapter visible while fonts/data load. Cached fonts resolve
  // immediately; restoration then happens in the same task as the DOM swap.
  await Promise.all(['normal 400', 'normal 700', 'italic 400', 'italic 700'].map(face =>
    document.fonts.load(`${face} ${size}px "AK Computer Modern"`).catch(() => [])
  ));
}
