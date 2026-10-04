const LANGUAGES = ["pt", "es", "en"];
const LANGUAGE_SET = new Set(LANGUAGES);
const READ_ROUTE = /^read\/((?:pt|es|en)(?:\+(?:pt|es|en)){0,2})\/([1-3]?[A-Z]{2,3})\/(\d+)(?:\?ui=(pt|es|en))?$/;

export function normalizeReadingLanguages(languages) {
  return [...new Set(languages)].filter(language => LANGUAGE_SET.has(language)).slice(0, 3);
}

export function parseRoute(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  if (!raw || raw === "home") return { view: "home" };
  const match = raw.match(READ_ROUTE);
  if (!match) return { view: "home" };
  const langs = normalizeReadingLanguages(match[1].split("+"));
  return langs.length
    ? { view: "reader", langs, uiLang: match[4] || langs[0], book: match[2], chapter: Number(match[3]) }
    : { view: "home" };
}

export function buildReadHash(langs, book, chapter, uiLang = langs[0]) {
  const ui = uiLang === langs[0] ? "" : `?ui=${uiLang}`;
  return `#read/${langs.join("+")}/${book}/${chapter}${ui}`;
}
