// Align existing rendered verse labels, without changing text or versification.
// Shared CSS grid tracks handle wrapping, font loading and resizing automatically.
function collectVerseRows(body) {
  const rows = [];
  let current = null;
  let before = [];

  for (const block of [...body.children]) {
    if (block.matches('.scripture-prose, .poetry')) {
      for (const part of [...block.children]) {
        const number = part.querySelector('.verse-number');
        // Keep the paragraph/poetry styles around each original rendered fragment.
        const fragment = block.cloneNode(false);
        fragment.append(part);
        if (number) {
          current = { number: number.textContent, before, content: [fragment] };
          rows.push(current);
          before = [];
        } else if (current && before.length === 0) {
          current.content.push(fragment);
        } else {
          before.push(fragment);
        }
      }
    } else if (block.matches('.section-heading') || !current || before.length) {
      before.push(block);
    } else {
      current.content.push(block);
    }
  }
  return { rows, trailing: before };
}

function cell(className, row, nodes, number) {
  const element = document.createElement('div');
  element.className = className;
  element.style.gridRow = String(row);
  if (number !== undefined) element.dataset.verse = number;
  element.append(...nodes);
  return element;
}

export function prepareParallelLayout(columns) {
  const contents = columns.map(column => {
    const body = column.querySelector('.scripture-body');
    return body ? { body, ...collectVerseRows(body) } : { body: null, rows: [] };
  });
  // Match exact labels only. An absent verse leaves an empty cell in that language.
  const numbers = [...new Set(contents.flatMap(content => content.rows.map(row => row.number)))];
  numbers.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const positions = new Map(numbers.map((number, index) => [number, index * 2 + 1]));

  for (const { body, rows, trailing } of contents) {
    if (!body) continue;
    const cells = [];
    for (const row of rows) {
      const position = positions.get(row.number);
      if (row.before.length) cells.push(cell('parallel-preface', position, row.before));
      cells.push(cell('parallel-verse', position + 1, row.content, row.number));
    }
    if (trailing.length) cells.push(cell('parallel-preface', numbers.length * 2 + 1, trailing));
    body.replaceChildren(...cells);
  }
  // One column header, two tracks per verse (preface + verse), one trailing track.
  return numbers.length * 2 + 2;
}
