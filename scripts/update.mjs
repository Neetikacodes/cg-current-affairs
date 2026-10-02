// scripts/update.mjs
// HYBRID version:
//  - GEMINI_API_KEY set hai aur kaam kar rahi hai  -> Gemini Hindi me summary banata hai
//  - key nahi hai ya Gemini fail (403/429/etc.)    -> automatically plain digest (headline + link)
// Job kabhi Gemini ki wajah se fail nahi hoga.
// Sources: PIB RSS + Google News RSS (Hindi + English, national papers, interstate
// disputes, sports). Keywords se category banti hai, data.json ka format purana hi hai.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "data.json");

// Optional: key na ho to bhi script chalegi
const API_KEY = process.env.GEMINI_API_KEY || "";
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Har category se max `perCat` khabrein, total max `total`
function selectCandidates(rawItems, perCat, total) {
  const grouped = categorize(rawItems);
  const out = [];
  for (const cat of CATEGORY_ORDER) {
    for (const it of (grouped[cat] || []).slice(0, perCat)) {
      out.push({ ...it, category: cat });
      if (out.length >= total) return out;
    }
  }
  return out;
}

// AI ke bina: headline + source line
function plainEntries(rawItems) {
  return selectCandidates(rawItems, MAX_PER_CATEGORY, MAX_TOTAL).map((it) => {
    const when = hindiDateFromPub(it.date);
    return {
      tag: it.category,
      title: it.title,
      body: `समाचार स्रोत: ${it.source || "अज्ञात"}${when ? ` | प्रकाशित: ${when}` : ""}। पूरी खबर के लिए स्रोत लिंक खोलें।`,
      source: it.source || "Google News",
      source_url: it.url,
    };
  });
}

// ---------- Gemini (optional) ----------
async function summarizeWithGemini(candidates) {
  const list = candidates
    .map((it, i) => `${i + 1}. Category: ${it.category}\n   Source: ${it.source}\n   Title: ${it.title}\n   URL: ${it.url}`)
    .join("\n\n");

  const prompt = `Tum Chhattisgarh Public Service Commission (CGPSC) aur Vyapam jaisi Chhattisgarh
state exams ke liye current affairs digest banate ho.

Neeche kai sources se liye gaye REAL items hain (title, source, URL pehle se diye hue hain — inhe mat badalna):

${list}

Inme se sabse important/exam-relevant 8-10 items chuno. In sabhi types ko cover karo agar available ho:
sarkari yojana/scheme, cabinet/policy decisions, budget, appointments, awards, infrastructure,
Chhattisgarh ke antarrajyiya vivad (jal bantwara, seema, Odisha/Telangana/Maharashtra etc. ke saath),
Chhattisgarh ke khiladi/khel upalabdhiyan (national/international), economy, tribal welfare,
mining/industry, CGPSC/Vyapam notifications.

CRIME, ACCIDENTS, VIOLENCE, COURT JUDGMENTS (murder, sexual assault, riots) YA KISI VYAKTIGAT/SENSITIVE
MAMLE ko BILKUL MAT CHUNO. Sankhya poori karne ke liye crime wali khabar mat chuno; kam items chalenge.

Har chune hue item ke liye ek 3-4 sentence ka Hindi (Devanagari) paragraph likho jisme concrete
facts/names jo exam MCQ me pooche ja sakte hain — sirf title me diye gaye facts par aadharit rahna,
apni taraf se numbers/facts invent mat karna. Apne shabdon me likho.

Output STRICTLY valid JSON array, bina extra text ke, bina markdown fence ke:

[
  {
    "tag": "2-3 word Hindi category, e.g. शासन/प्रशासन, खेल, अंतरराज्यीय विवाद, अर्थव्यवस्था",
    "title": "Ek line ka Hindi headline",
    "body": "3-4 sentence Hindi paragraph",
    "source": "UPAR DIYE GAYE ITEM KA EXACT 'Source' field",
    "source_url": "UPAR DIYE GAYE ITEM KA EXACT URL, bilkul copy-paste, badalna mat"
  }
]

Sirf JSON array return karo.`;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("\n").trim();
  if (!text) throw new Error("Gemini response me text nahi mila");

  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  let items;
  try { items = JSON.parse(cleaned); } catch { throw new Error("Gemini JSON parse fail"); }
  if (!Array.isArray(items)) throw new Error("Gemini ne array nahi diya");

  const validUrls = new Set(candidates.map((it) => it.url));
  return items
    .filter((it) => it && it.tag && it.title && it.body && validUrls.has(it.source_url))
    .slice(0, MAX_TOTAL);
}

// Gemini try karo, fail ho to null (caller plain digest use karega)
async function tryGemini(rawItems) {
  if (!API_KEY) {
    console.log("GEMINI_API_KEY set nahi hai — plain digest banega.");
    return null;
  }
  const candidates = selectCandidates(rawItems, 6, 25);
  try {
    try {
      return await summarizeWithGemini(candidates);
    } catch (err) {
      if (String(err.message).includes("429")) {
        console.log("Rate-limit (429), 30s ruk kar ek retry...");
        await sleep(30000);
        return await summarizeWithGemini(candidates);
      }
      throw err;
    }
  } catch (err) {
    console.warn("Gemini fail hua, plain digest par fallback:", String(err.message).slice(0, 300));
    return null;
  }
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

  let items = await tryGemini(rawItems);
  if (items && items.length > 0) {
    console.log(`Gemini se ${items.length} summarized items mile.`);
  } else {
    items = plainEntries(rawItems);
  }
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
