import { readPreference, writePreference, readLastLocation } from "./preferences.js";
import { createJSONLoader } from "./jsonCache.js";
import { prepareParallelLayout } from "./parallelLayout.js";
import { normalizeSpeechContent, highlightSpeech } from "./wordsOfJesus.js";
import { captureReadingPosition, restoreReadingPosition, prepareReadingFonts } from "./readingPosition.js";
import { buildReadHash, isLanguageCode, parseRoute } from "./routing.js";

const UI_LANGS = ["pt", "es", "en"];
const MAX_READING_LANGUAGES = 3;
const DEFAULT_LOCATION = { book: "GEN", chapter: 1 };
const MIN_SCRIPTURE_FONT_SIZE = 10;
const DEFAULT_SCRIPTURE_FONT_SIZE = 20;
const MAX_SCRIPTURE_FONT_SIZE = 40;
const state = { uiLang: "pt", readLangs: [], readingLanguages: [], theme: "classic", scriptureFontSize: DEFAULT_SCRIPTURE_FONT_SIZE, manifests: {}, locales: {} };
let navigationRevision = 0;
let renderedRoute = null;

const $ = (id) => document.getElementById(id);
const els = {
  main: $("main-content"), skip: $("skip-link"), home: $("home-view"), readerView: $("reader-view"), error: $("error-view"), reader: $("reader"),
  book: $("book-select"), chapter: $("chapter-select"), language: $("language-select"), theme: $("theme-toggle"),
  title: $("book-title"), chapterTitle: $("chapter-title"), testament: $("testament-label"),
  ot: $("ot-books"), nt: $("nt-books"), prev: $("prev-chapter"), next: $("next-chapter"), continueBtn: $("continue-reading"),
  parallel: $("parallel-switcher"), parallelOptions: $("parallel-language-options"), parallelApply: $("parallel-apply"), parallelSingle: $("parallel-single"), chapterNav: $("chapter-navigation"),
  fontSlider: $("font-size-slider"), readingTools: $("reading-tools")
};

function preferredLanguage() {
  const saved = readPreference("ak-bible-language");
  if (UI_LANGS.includes(saved)) return saved;
  const browser = (navigator.language || "pt").slice(0,2).toLowerCase();
  return UI_LANGS.includes(browser) ? browser : "pt";
}
function preferredTheme() {
  const saved = readPreference("ak-bible-theme");
  if (["classic","classic-dark"].includes(saved)) return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "classic-dark" : "classic";
}
function preferredScriptureFontSize() {
  const saved = Number(readPreference("ak-bible-scripture-font-size"));
  return Number.isFinite(saved) && saved >= MIN_SCRIPTURE_FONT_SIZE && saved <= MAX_SCRIPTURE_FONT_SIZE
    ? saved : DEFAULT_SCRIPTURE_FONT_SIZE;
}
function sliderValueFromFontSize(size) {
  return size <= DEFAULT_SCRIPTURE_FONT_SIZE
    ? Math.round((size - DEFAULT_SCRIPTURE_FONT_SIZE) * 10)
    : Math.round((size - DEFAULT_SCRIPTURE_FONT_SIZE) * 5);
}
function fontSizeFromSlider(value) {
  const offset = Number(value);
  return offset <= 0
    ? DEFAULT_SCRIPTURE_FONT_SIZE + offset / 10
    : DEFAULT_SCRIPTURE_FONT_SIZE + offset / 5;
}
function applyScriptureFontSize() {
  document.documentElement.style.setProperty("--scripture-font-size", `${state.scriptureFontSize}px`);
  writePreference("ak-bible-scripture-font-size", String(state.scriptureFontSize));
  els.fontSlider.value = String(sliderValueFromFontSize(state.scriptureFontSize));
  els.fontSlider.setAttribute("aria-valuetext", `${state.scriptureFontSize}px`);
}
const getJSON = createJSONLoader();
async function loadLanguageIndex() {
  const index=await getJSON("data/index.json");
  state.readingLanguages=[...new Set((index.languages || []).map(item=>item.language).filter(isLanguageCode))];
  if(!state.readingLanguages.length) throw new Error("No reading languages declared in data/index.json");
}
async function ensureLocale(lang) {
  if(!UI_LANGS.includes(lang)) throw new Error(`Unsupported interface language: ${lang}`);
  if(!state.locales[lang]) state.locales[lang]=await getJSON(`locales/${lang}.json`);
}
async function ensureManifest(lang) {
  if(!state.readingLanguages.includes(lang)) throw new Error(`Unsupported reading language: ${lang}`);
  if(!state.manifests[lang]) state.manifests[lang]=await getJSON(`data/${lang}/manifest.json`);
}
function defaultReadingLanguage() {
  return state.readLangs.find(lang=>state.readingLanguages.includes(lang))
    || (state.readingLanguages.includes(state.uiLang) ? state.uiLang : state.readingLanguages[0]);
}
function navigationLanguage() {
  return state.readingLanguages.includes(state.uiLang) ? state.uiLang : defaultReadingLanguage();
}
function locale() { return state.locales[state.uiLang]; }
function manifest(lang=defaultReadingLanguage()) { return state.manifests[lang]; }
function renderLanguageControls() {
  els.language.replaceChildren(...UI_LANGS.map(lang=>{
    const option=document.createElement("option"); option.value=lang; option.textContent=lang.toUpperCase(); return option;
  }));
  els.parallelOptions.replaceChildren(...state.readingLanguages.map(lang=>{
    const label=document.createElement("label");
    const input=document.createElement("input"); input.type="checkbox"; input.name="parallel-language"; input.value=lang;
    const text=document.createElement("span"); text.textContent=lang.toUpperCase();
    label.append(input,document.createTextNode(" "),text); return label;
  }));
}
function translate(lang,key,vars={}) {
  let s = state.locales[lang]?.[key] ?? key;
  for (const [k,v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
function t(key, vars={}) { return translate(state.uiLang,key,vars); }
function applyLocale() {
  document.documentElement.lang = locale().langTag;
  document.title = locale().title;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
  document.querySelectorAll("[data-i18n-title]").forEach(el => { el.title = t(el.dataset.i18nTitle); });
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  writePreference("ak-bible-theme", state.theme);
  els.theme.setAttribute("aria-pressed", String(state.theme === "classic-dark"));
  document.querySelector('meta[name="theme-color"]').setAttribute("content", state.theme === "classic" ? "#FAF9F6" : "#151515");
}
function route() {
  return parseRoute(location.hash);
}
function bookByCode(code,lang=defaultReadingLanguage()) { return manifest(lang)?.books.find(b => b.code === code); }
function fillBookSelect(selected) {
  els.book.innerHTML = "";
  for (const b of manifest(navigationLanguage()).books) {
    const o = document.createElement("option"); o.value=b.code; o.textContent=b.name; o.selected=b.code===selected; els.book.append(o);
  }
}
function fillChapterSelect(book, selected) {
  els.chapter.innerHTML = "";
  for (let n=1;n<=book.chapters;n++) { const o=document.createElement("option");o.value=n;o.textContent=n;o.selected=n===selected;els.chapter.append(o); }
}
function renderBookIndex() {
  els.ot.innerHTML = ""; els.nt.innerHTML = "";
  for (const b of manifest(navigationLanguage()).books) {
    const btn=document.createElement("button"); btn.className="book-link"; btn.type="button"; btn.textContent=b.name; btn.dataset.book=b.code;
    btn.addEventListener("click",()=>navigateTo(b.code,1));
    (b.testament === "OT" ? els.ot : els.nt).append(btn);
  }
}
function setVisible(view) {
  els.home.hidden=view!=="home"; els.readerView.hidden=view!=="reader"; els.error.hidden=view!=="error";
  els.readingTools.hidden=view!=="reader";
  els.chapterNav.hidden=view!=="reader";
  document.body.classList.toggle("reading-active",view==="reader");
}
function navigateTo(book, chapter, langs=state.readLangs, uiLang=state.uiLang) {
  location.hash=buildReadHash(langs,book,chapter,uiLang);
}
function flattenText(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  if (node.type === "note") return "";
  return (node.content || []).map(flattenText).join("");
}
function renderInline(node, parent, lang) {
  if (typeof node === "string") { parent.append(document.createTextNode(node)); return; }
  if (!node || typeof node !== "object") return;
  if (node.type === "verse" || node.type === "note") return;
  if (node.type === "char") {
    const span=document.createElement("span"); span.className=`char-${node.marker || "generic"}`;
    (node.content || []).forEach(x=>renderInline(x,span,lang)); parent.append(span); return;
  }
  (node.content || []).forEach(x=>renderInline(x,parent,lang));
}
function appendVerseNumber(parent,node,lang) {
  const s=document.createElement("sup"); s.className="verse-number"; s.id=`${lang}-v-${node.number}`;
  s.dataset.verse=String(node.number);
  s.textContent=node.number; parent.append(s);
}
function renderVerseSequence(content, container, lang, extraClass="") {
  let current=null;
  let continuation=null;
  for (const node of content || []) {
    if (node && typeof node === "object" && node.type === "verse") {
      if (node.sid) {
        current=document.createElement("p");
        current.className=`scripture-verse${extraClass ? ` ${extraClass}` : ""}`;
        appendVerseNumber(current,node,lang);
        container.append(current);
      }
      continue;
    }
    if (!current) {
      if (!continuation) {
        continuation=document.createElement("p");
        continuation.className=`scripture-continuation${extraClass ? ` ${extraClass}` : ""}`;
        container.append(continuation);
      }
      renderInline(node,continuation,lang);
    } else {
      renderInline(node,current,lang);
    }
  }
  for (const p of [...container.querySelectorAll(":scope > .scripture-verse, :scope > .scripture-continuation")]) {
    if (!p.textContent.trim() && !p.querySelector(".verse-number")) p.remove();
  }
}
function renderNode(node, container, chapterNumber, lang) {
  if (!node || typeof node !== "object") return;
  if (node.type === "chapter" || node.type === "book") return;
  if (node.type === "para") {
    const marker=node.marker || "p";
    if (/^(s|ms|mr)/.test(marker)) {
      const h=document.createElement("h2");h.className="section-heading";h.textContent=(node.content || []).map(flattenText).join("").trim();
      if (h.textContent) container.append(h); return;
    }
    if (/^q/.test(marker)) {
      const d=document.createElement("div"); d.className=`poetry ${marker}`;
      renderVerseSequence(node.content,d,lang,"poetry-line");
      if (d.textContent.trim()) container.append(d); return;
    }
    if (["h","toc1","toc2","toc3","mt1","mt2"].includes(marker)) return;
    const block=document.createElement("div"); block.className=`scripture-prose para-${marker}`;
    renderVerseSequence(node.content,block,lang);
    if (block.textContent.trim() || block.querySelector(".verse-number")) container.append(block);
    return;
  }
  if (node.type === "table") {
    const block=document.createElement("div"); block.className="table-block"; block.textContent=flattenText(node); if(block.textContent.trim()) container.append(block);
  }
}
async function setUiLanguage(lang) {
  await ensureLocale(lang);
  if(state.readingLanguages.includes(lang)) await ensureManifest(lang);
  applyUiLanguage(lang);
}
function applyUiLanguage(lang) {
  state.uiLang=lang; writePreference("ak-bible-language",lang); els.language.value=lang;
  applyLocale(); renderBookIndex();
}
function setParallelChecks(langs) {
  document.querySelectorAll('input[name="parallel-language"]').forEach(cb=>{ cb.checked=langs.includes(cb.value); });
  updateParallelSelection();
}
function updateParallelSelection() {
  els.parallelApply.disabled=!document.querySelector('input[name="parallel-language"]:checked');
}
function selectedParallelLanguages() {
  const checked=[...document.querySelectorAll('input[name="parallel-language"]:checked')].map(x=>x.value);
  // Keep existing column order; append newly selected languages in menu order.
  return [...state.readLangs.filter(lang=>checked.includes(lang)),...checked.filter(lang=>!state.readLangs.includes(lang))];
}
async function showHome(position=null) {
  const readingLang=defaultReadingLanguage();
  state.readLangs=[readingLang];
  await Promise.all([ensureManifest(readingLang),ensureManifest(navigationLanguage())]);
  setParallelChecks(state.readLangs); setVisible("home");
  const navigationManifest=manifest(navigationLanguage());
  fillBookSelect(navigationManifest.books[0]?.code); fillChapterSelect(navigationManifest.books[0],1);
  const last=readLastLocation(readingLang,manifest(readingLang).books);
  els.continueBtn.textContent = last ? t("continueReading") : t("startReading");
  els.continueBtn.onclick=()=>navigateTo(last?.book||DEFAULT_LOCATION.book,last?.chapter||DEFAULT_LOCATION.chapter,[readingLang]);
  renderedRoute={view:"home"};
  if(position) restoreReadingPosition(els.home,position);
  else window.scrollTo({top:0,behavior:"instant"});
}
function neighboring(book,chapter,delta) {
  const books=manifest(state.readLangs[0] || defaultReadingLanguage()).books; let bi=books.findIndex(b=>b.code===book); if(bi<0)return null;
  let ch=chapter+delta;
  if(ch>=1 && ch<=books[bi].chapters)return {book,chapter:ch};
  bi+=delta>0?1:-1; if(bi<0||bi>=books.length)return null;
  const nb=books[bi]; return {book:nb.code,chapter:delta>0?1:nb.chapters};
}
function formatYearRange(value) {
  if(!value || value.from==null) return "";
  return value.to!=null && value.to!==value.from ? `${value.from}–${value.to}` : String(value.from);
}
function renderEditionFooter(lang,uiLang) {
  const edition=manifest(lang);
  const source=edition?.source_basis_metadata;
  if(!source) return null;
  const footer=document.createElement("footer"); footer.className="scripture-column-footer";
  footer.setAttribute("aria-label",translate(uiLang,"editionInformation",{language:lang.toUpperCase()}));

  const title=document.createElement("p"); title.className="edition-note-title";
  const strong=document.createElement("strong"); strong.textContent=`${lang.toUpperCase()} · Argus Kepheus`;
  title.append(strong,document.createTextNode(` · ${translate(uiLang,"revisionShort")} ${edition.revision}`));

  const basis=document.createElement("p"); basis.className="edition-note-basis";
  const basisLabel=document.createElement("span"); basisLabel.textContent=`${translate(uiLang,"textualBasis")}: `;
  const basisName=document.createElement("cite"); basisName.textContent=source.title;
  basis.append(basisLabel,basisName);

  const details=document.createElement("details"); details.className="edition-note-details";
  const summary=document.createElement("summary"); summary.textContent=translate(uiLang,"editorialDetails");
  details.append(summary);

  const publication=source.publication || {};
  const chronologyParts=[];
  const project=formatYearRange(publication.project_interval);
  const complete=formatYearRange(publication.complete_bible);
  if(project) chronologyParts.push(project);
  if(complete) chronologyParts.push(`${translate(uiLang,"completeBible")}: ${complete}`);
  if(chronologyParts.length) {
    const chronology=document.createElement("p"); chronology.className="edition-note-chronology";
    chronology.textContent=chronologyParts.join(" · ");
    details.append(chronology);
  }

  const rights=document.createElement("p"); rights.className="edition-note-rights";
  rights.textContent=source.rights_br?.status==="public-domain-currently"
    ? translate(uiLang,"rightsPublicDomainBrazil")
    : translate(uiLang,"rightsUnderReviewBrazil");
  details.append(rights);

  footer.append(title,basis,details);
  return footer;
}
async function renderLanguageColumn(lang,bookCode,chapter,uiLang) {
  await ensureManifest(lang);
  const b=bookByCode(bookCode,lang);
  const article=document.createElement("article"); article.className="scripture-column"; article.dataset.language=lang;
  article.lang=lang;
  const header=document.createElement("header"); header.className="scripture-column-header";
  const label=document.createElement("span"); label.className="scripture-lang-badge"; label.textContent=lang.toUpperCase();
  const title=document.createElement("strong"); title.textContent=b ? `${b.name} ${chapter}` : `${bookCode} ${chapter}`;
  header.append(label,title); article.append(header);
  if(!b || chapter<1 || chapter>b.chapters) {
    const p=document.createElement("p"); p.textContent=translate(uiLang,"loadErrorCopy"); article.append(p); return article;
  }
  const data=await getJSON(`data/${lang}/books/${bookCode}/${chapter}.json`);
  const body=document.createElement("div"); body.className="scripture-body";
  for(const node of normalizeSpeechContent(data.content,bookCode,chapter)) renderNode(node,body,chapter,lang);
  highlightSpeech(body,bookCode,data.speech,chapter);
  article.append(body);
  const editionFooter=renderEditionFooter(lang,uiLang);
  if(editionFooter) article.append(editionFooter);
  return article;
}
async function showReader(bookCode,chapter,langs,uiLang,revision) {
  const readLangs=[...new Set(langs)].filter(x=>state.readingLanguages.includes(x)).slice(0,MAX_READING_LANGUAGES);
  if(!readLangs.length) readLangs.push(defaultReadingLanguage());
  try {
    const displayLang=state.readingLanguages.includes(uiLang) ? uiLang : readLangs[0];
    await Promise.all([
      ensureLocale(uiLang),
      ...[...new Set([...readLangs,displayLang])].map(ensureManifest)
    ]);
    if(revision!==navigationRevision) return;
    const book=bookByCode(bookCode,displayLang);
    if(!book || chapter<1 || chapter>book.chapters) { renderedRoute=null; setVisible("error"); return; }
    const preserve=renderedRoute?.view==="reader" && renderedRoute.book===bookCode && renderedRoute.chapter===chapter;
    const [cols]=await Promise.all([
      Promise.all(readLangs.map(lang=>renderLanguageColumn(lang,bookCode,chapter,uiLang))),
      preserve ? prepareReadingFonts(state.scriptureFontSize) : Promise.resolve()
    ]);
    if(revision!==navigationRevision) return;
    // Capture immediately before replacement, including any reading/scrolling
    // performed while the next translation was loading.
    const position=preserve ? captureReadingPosition(els.reader,readLangs[0]) : null;
    state.readLangs=readLangs;
    applyUiLanguage(uiLang);
    fillBookSelect(bookCode); fillChapterSelect(book,chapter); setParallelChecks(readLangs);
    const parallel=cols.length>1;
    els.reader.classList.toggle("parallel-aligned",parallel);
    els.reader.style.setProperty("--parallel-rows",String(parallel ? prepareParallelLayout(cols) : 1));
    els.reader.tabIndex=parallel ? 0 : -1;
    if(parallel) {
      els.reader.setAttribute("role","region");
      els.reader.setAttribute("aria-label",t("readingLanguages"));
    } else {
      els.reader.removeAttribute("role");
      els.reader.removeAttribute("aria-label");
    }
    els.reader.replaceChildren(...cols); els.reader.dataset.columns=String(cols.length);
    els.readerView.classList.toggle("parallel-active",cols.length>1);
    els.title.textContent=book.name; els.chapterTitle.textContent=t("chapterLabel",{n:chapter}); els.testament.textContent=book.testament==="OT"?t("oldTestament"):t("newTestament");
    const prev=neighboring(bookCode,chapter,-1), next=neighboring(bookCode,chapter,1);
    els.prev.disabled=!prev; els.next.disabled=!next; els.prev.onclick=()=>prev&&navigateTo(prev.book,prev.chapter); els.next.onclick=()=>next&&navigateTo(next.book,next.chapter);
    writePreference(`ak-bible-last-${state.readLangs[0]}`,JSON.stringify({book:bookCode,chapter,langs:state.readLangs}));
    writePreference("ak-bible-parallel-languages",JSON.stringify(state.readLangs));
    setVisible("reader"); renderedRoute={view:"reader",book:bookCode,chapter};
    if(position) restoreReadingPosition(els.reader,position);
    else { els.reader.focus({preventScroll:true}); window.scrollTo({top:0,behavior:"instant"}); }
  } catch(err) {
    if(revision!==navigationRevision) return;
    console.error(err); renderedRoute=null; setVisible("error");
  }
}
async function handleRoute() {
  const revision=++navigationRevision;
  const r=route();
  if(r.view!=="reader") { await showHome(); return; }
  const uiLang=r.uiLang || (UI_LANGS.includes(r.langs[0]) ? r.langs[0] : state.uiLang);
  if(!UI_LANGS.includes(uiLang) || r.langs.some(lang=>!state.readingLanguages.includes(lang))) {
    await showHome(); return;
  }
  await showReader(r.book,r.chapter,r.langs,uiLang,revision);
}
async function init() {
  state.theme=preferredTheme(); applyTheme();
  state.scriptureFontSize=preferredScriptureFontSize(); applyScriptureFontSize();
  await loadLanguageIndex();
  renderLanguageControls();
  const initialUiLang=preferredLanguage();
  state.readLangs=[state.readingLanguages.includes(initialUiLang) ? initialUiLang : state.readingLanguages[0]];
  await ensureManifest(state.readLangs[0]);
  await setUiLanguage(initialUiLang);
  els.skip.addEventListener("click",event=>{
    event.preventDefault();
    els.main.focus({preventScroll:true});
    els.main.scrollIntoView({block:"start",behavior:"instant"});
  });
  els.language.addEventListener("change",async()=>{
    const lang=els.language.value; const r=route();
    if(r.view==="reader") {
      navigateTo(r.book,r.chapter,r.langs,lang);
    } else {
      const revision=++navigationRevision;
      const position=captureReadingPosition(els.home);
      await setUiLanguage(lang);
      if(revision!==navigationRevision) return;
      await showHome(position);
    }
  });
  els.theme.addEventListener("click",()=>{state.theme=state.theme==="classic"?"classic-dark":"classic";applyTheme();});
  els.fontSlider.addEventListener("input",()=>{
    state.scriptureFontSize=fontSizeFromSlider(els.fontSlider.value);
    applyScriptureFontSize();
  });
  els.book.addEventListener("change",()=>navigateTo(els.book.value,1));
  els.chapter.addEventListener("change",()=>navigateTo(els.book.value,Number(els.chapter.value)));
  els.parallel.addEventListener("change",updateParallelSelection);
  els.parallelApply.addEventListener("click",async()=>{
    const r=route(); const langs=selectedParallelLanguages();
    if(!langs.length) return;
    els.parallel.open=false;
    if(r.view==="reader") navigateTo(r.book,r.chapter,langs);
    else {
      const primary=langs[0];
      await ensureManifest(primary);
      const last=readLastLocation(primary,manifest(primary).books) || DEFAULT_LOCATION;
      navigateTo(last.book,last.chapter,langs);
    }
  });
  els.parallelSingle.addEventListener("click",()=>{
    const r=route(); state.readLangs=[state.readLangs[0] || defaultReadingLanguage()]; setParallelChecks(state.readLangs); els.parallel.open=false;
    if(r.view==="reader") navigateTo(r.book,r.chapter,state.readLangs);
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape" && els.parallel.open) {
      els.parallel.open=false;
      els.parallel.querySelector("summary").focus({preventScroll:true});
    }
  });
  document.addEventListener("click",event=>{
    if(!els.parallel.contains(event.target)) els.parallel.open=false;
  });
  addEventListener("hashchange",handleRoute);
  await handleRoute();
}
init().catch(err=>{console.error(err);setVisible("error");});
