// scripts/update.mjs
// BINA KISI AI/API KE chalne wala version.
// Sources: PIB RSS + Google News RSS (Hindi + English, national papers, interstate
// disputes, sports). Keywords se category banti hai, data.json ka format purana hi hai.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "data.json");

const MAX_PER_CATEGORY = 4; // ek category se max itni khabrein
const MAX_TOTAL = 16;       // ek din me max itni khabrein
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

// ---------- Date helpers ----------
function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const HI_MONTHS = ["जनवरी","फरवरी","मार्च","अप्रैल","मई","जून","जुलाई","अगस्त","सितंबर","अक्टूबर","नवंबर","दिसंबर"];
function todayHindiLabel(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${HI_MONTHS[m - 1]} ${y}`;
}
function dayShort(isoDate) {
  return new Date(isoDate + "T00:00:00+05:30").toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
}
function hindiDateFromPub(pub) {
  const d = new Date(pub);
  if (isNaN(d)) return "";
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  return todayHindiLabel(iso);
}

const isoDate = todayIST();

// ---------- Queries ----------
const BASE = "https://news.google.com/rss/search?q=";
const HI = "&hl=hi-IN&gl=IN&ceid=IN:hi";
const EN = "&hl=en-IN&gl=IN&ceid=IN:en";

// loose: true => title me "Chhattisgarh" na bhi ho to rakho (jaise "Odisha moves SC on Mahanadi")
const QUERIES = [
  // Hindi (sthaniya + rashtriya akhbaar)
  { q: "छत्तीसगढ़ when:2d", lang: HI },
  { q: "छत्तीसगढ़ खिलाड़ी OR पदक OR टूर्नामेंट when:3d", lang: HI },
  { q: "छत्तीसगढ़ विवाद ओडिशा OR तेलंगाना OR महाराष्ट्र OR झारखंड OR मध्यप्रदेश when:7d", lang: HI },
  { q: "महानदी विवाद छत्तीसगढ़ ओडिशा when:30d", lang: HI, loose: true },

  // English national papers
  { q: "Chhattisgarh when:2d", lang: EN },
  { q: "Chhattisgarh site:thehindu.com when:3d", lang: EN },
  { q: "Chhattisgarh site:indianexpress.com when:3d", lang: EN },
  { q: "Chhattisgarh site:timesofindia.indiatimes.com when:3d", lang: EN },
  { q: "Chhattisgarh site:hindustantimes.com when:3d", lang: EN },
  { q: "Chhattisgarh site:livemint.com OR site:business-standard.com when:3d", lang: EN },

  // Interstate disputes
  { q: "Chhattisgarh dispute Odisha OR Telangana OR Maharashtra OR Jharkhand OR \"Madhya Pradesh\" OR \"Uttar Pradesh\" when:7d", lang: EN },
  { q: "Mahanadi water dispute Chhattisgarh Odisha when:30d", lang: EN, loose: true },
  { q: "Chhattisgarh Telangana Polavaram OR Indravati OR border when:30d", lang: EN, loose: true },

  // Sports
  { q: "Chhattisgarh player OR athlete OR medal OR team when:5d", lang: EN },
  { q: "Chhattisgarh \"National Games\" OR \"Khelo India\" OR Ranji OR hockey OR kabaddi when:7d", lang: EN },
  { q: "Chhattisgarh Olympic OR \"Asian Games\" OR international when:14d", lang: EN },
];

// ---------- Filters ----------
const CG_RE = /छत्तीसगढ|Chhattisgarh|Chattisgarh|रायपुर|Raipur|बिलासपुर|Bilaspur|बस्तर|Bastar|दुर्ग|Durg|Bhilai|भिलाई|Korba|कोरबा|Naya Raipur|नवा रायपुर|Sukma|Bijapur|Dantewada|दंतेवाड़ा|रायगढ़|Raigarh|Surguja|सरगुजा|CGPSC|Vyapam|व्यापम/i;

// Sirf crime/accident wali khabrein hatao (exam GK ke liye kaam ki nahi)
const CRIME_RE = /हत्या|दुष्कर्म|बलात्कार|रेप|आत्महत्या|सड़क हादसा|दुर्घटना|मारपीट|चाकू|लूट|murder|rape|suicide|road accident|stabbed|robbery/i;

// Order matter karta hai: pehla match jeetega
const CATEGORIES = [
  ["अंतरराज्यीय विवाद", /विवाद|सीमा|जल बंटवारा|dispute|border|water.?sharing|Mahanadi|महानदी|Polavaram|Indravati|इंद्रावती|Godavari|गोदावरी|Odisha|ओडिशा|तेलंगाना|Telangana|झारखंड|Jharkhand/i],
  ["खेल", /खिलाड़ी|पदक|टूर्नामेंट|खेल|क्रिकेट|हॉकी|कबड्डी|ओलंपिक|player|athlete|medal|Ranji|hockey|kabaddi|cricket|Khelo India|National Games|Olympic|Asian Games|tournament/i],
  ["शासन/राजनीति", /मुख्यमंत्री|मंत्रिमंडल|कैबिनेट|विधानसभा|सरकार|राज्यपाल|Chief Minister|cabinet|assembly|Governor|Vishnu Deo Sai|CM Sai/i],
  ["भर्ती/परीक्षा/योजना", /भर्ती|परीक्षा|नियुक्ति|योजना|CGPSC|Vyapam|व्यापम|recruitment|scheme|exam/i],
  ["नक्सल/सुरक्षा", /नक्सल|माओवादी|मुठभेड़|Naxal|Maoist|encounter/i],
  ["अर्थव्यवस्था/विकास", /निवेश|उद्योग|रेल|परियोजना|बजट|खनन|कोयला|investment|railway|project|budget|mining|coal|steel/i],
];
const CATEGORY_ORDER = [...CATEGORIES.map(([n]) => n), "अन्य"];

// ---------- RSS helpers (bina library) ----------
const decode = (s = "") => s
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
  .trim();

function parseRssItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const get = (tag) => decode((b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "");
    let title = get("title");
    const link = get("link");
    if (!title || !link) continue;
    let source = get("source");
    if (source && title.endsWith(source)) {
      title = title.slice(0, title.length - source.length).replace(/\s*[-–—]\s*$/, "").trim();
    } else {
      const sm = title.match(/\s-\s([^-]+)$/);
      if (sm) {
        if (!source) source = sm[1].trim();
        title = title.replace(/\s-\s[^-]+$/, "").trim();
      }
    }
    items.push({ title, url: link, source, date: get("pubDate") });
  }
  return items;
}

async function fetchXml(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ---------- Source 1: PIB (official) ----------
async function fetchPib() {
  const url = "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=2&Regid=3&reg=48";
  try {
    const xml = await fetchXml(url);
    const items = parseRssItems(xml).filter((it) => CG_RE.test(it.title));
    console.log(`[PIB] ${items.length} Chhattisgarh-related items.`);
    return items.map((it) => ({ ...it, source: "PIB" }));
  } catch (e) {
    console.warn("[PIB] fail:", e.message);
    return [];
  }
}

// ---------- Source 2: Google News RSS (sabhi queries) ----------
async function fetchQuery({ q, lang, loose }) {
  const url = BASE + encodeURIComponent(q) + lang;
  try {
    const items = parseRssItems(await fetchXml(url));
    console.log(`[News] "${q.slice(0, 45)}..." -> ${items.length}`);
    return items.map((it) => ({ ...it, loose: !!loose }));
  } catch (e) {
    console.warn(`[News] fail "${q.slice(0, 45)}...": ${e.message}`);
    return [];
  }
}

async function fetchAllSources() {
  const [pib, ...news] = await Promise.all([fetchPib(), ...QUERIES.map(fetchQuery)]);
  const all = [...pib, ...news.flat()];

  const seenUrl = new Set();
  const seenTitle = new Set();
  const unique = [];
  for (const it of all) {
    if (!it.loose && !CG_RE.test(it.title)) continue;     // CG se related hi
    if (CRIME_RE.test(it.title)) continue;                // crime/accident nahi
    const tkey = it.title.toLowerCase().replace(/[\s\W_]+/g, "").slice(0, 60);
    if (seenUrl.has(it.url) || seenTitle.has(tkey)) continue;
    seenUrl.add(it.url);
    seenTitle.add(tkey);
    unique.push(it);
  }

  unique.sort((a, b) => (new Date(b.date) || 0) - (new Date(a.date) || 0)); // latest pehle
  console.log(`Total ${unique.length} unique items sabhi sources se mile.`);
  return unique;
}

// ---------- Category + selection ----------
function categorize(items) {
  const grouped = {};
  for (const it of items) {
    const cat = (CATEGORIES.find(([, re]) => re.test(it.title)) || ["अन्य"])[0];
    (grouped[cat] ||= []).push(it);
  }
  return grouped;
}

function buildEntries(rawItems) {
  const grouped = categorize(rawItems);
  const out = [];
  for (const cat of CATEGORY_ORDER) {
    for (const it of (grouped[cat] || []).slice(0, MAX_PER_CATEGORY)) {
      const when = hindiDateFromPub(it.date);
      out.push({
        tag: cat,
        title: it.title,
        body: `समाचार स्रोत: ${it.source || "अज्ञात"}${when ? ` | प्रकाशित: ${when}` : ""}। पूरी खबर के लिए स्रोत लिंक खोलें।`,
        source: it.source || "Google News",
        source_url: it.url,
      });
      if (out.length >= MAX_TOTAL) return out;
    }
  }
  return out;
}

// ---------- MAIN ----------
async function main() {
  const raw = await readFile(DATA_PATH, "utf-8");
  const entries = JSON.parse(raw);

  if (entries.some((e) => e.iso_date === isoDate)) {
    console.log(`Aaj (${isoDate}) ka entry pehle se maujood hai — skip.`);
    return;
  }

  const rawItems = await fetchAllSources();
  if (rawItems.length === 0) {
    console.log("Aaj kisi bhi source se Chhattisgarh-related item nahi mila — skip.");
    return;
  }

  const items = buildEntries(rawItems);
  if (items.length === 0) {
    console.log("Koi valid item nahi bana — skip.");
    return;
  }

  entries.unshift({ iso_date: isoDate, date: todayHindiLabel(isoDate), day: dayShort(isoDate), items });
  entries.sort((a, b) => (a.iso_date < b.iso_date ? 1 : -1));
  await writeFile(DATA_PATH, JSON.stringify(entries.slice(0, 60), null, 2) + "\n", "utf-8");
  console.log(`${isoDate} ke ${items.length} items add ho gaye.`);
}

main().catch((err) => {
  console.error("Update fail hua:", err);
  process.exit(1);
});
