const LANGUAGE_ID = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const LANGUAGE_PART = "[a-z]{2,3}(?:-[a-z0-9]{2,8})*";
const READ_ROUTE = new RegExp(
  "^read/(" + LANGUAGE_PART + "(?:\\+" + LANGUAGE_PART + "){0,2})/([1-3]?[A-Z]{2,3})/(\\d+)(?:\\?ui=(" + LANGUAGE_PART + "))?$"
);

export function isLanguageCode(language) {
  return LANGUAGE_ID.test(String(language ?? ""));
}

export function normalizeReadingLanguages(languages) {
  return [...new Set(languages)].filter(isLanguageCode).slice(0, 3);
}

export function parseRoute(hash) {
  const raw = String(hash ?? "").replace(/^#/, "");
  if (!raw || raw === "home") return { view: "home" };
  const match = raw.match(READ_ROUTE);
  if (!match) return { view: "home" };
  const langs = normalizeReadingLanguages(match[1].split("+"));
  return langs.length
    ? { view: "reader", langs, uiLang: match[4] || null, book: match[2], chapter: Number(match[3]) }
    : { view: "home" };
}

export function buildReadHash(langs, book, chapter, uiLang = null) {
  const normalized = normalizeReadingLanguages(langs);
  const ui = uiLang && uiLang !== normalized[0] ? `?ui=${uiLang}` : "";
  return `#read/${normalized.join("+")}/${book}/${chapter}${ui}`;
}
