// scripts/update.mjs
// Gemini ke "Google Search grounding" tool par depend NAHI karte (uski quota/billing
// alag/sakht hai). Iske bajaye seedhe official govt sites fetch karte hain:
//   1. PIB (pib.gov.in) — Government of India press releases
//   2. Jansampark Chhattisgarh (jansampark.cg.gov.in) — Chhattisgarh state PRD releases
// Inme se jo Chhattisgarh-related mile, unhe khud regex se nikalte hain (real, verified
// links — model inhe invent nahi karta). Phir Gemini ko sirf PLAIN call (bina tool ke)
// se in real items ko Hindi me summarize karne ko kehte hain.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "..", "data.json");

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error("GEMINI_API_KEY missing — GitHub repo secret set karein.");
  process.exit(1);
}

const MODEL = "gemini-3.5-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

function todayIST() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date());
}
function todayHindiLabel(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const months = ["जनवरी","फरवरी","मार्च","अप्रैल","मई","जून","जुलाई","अगस्त","सितंबर","अक्टूबर","नवंबर","दिसंबर"];
  return `${d} ${months[m - 1]} ${y}`;
}
function dayShort(isoDate) {
  const d = new Date(isoDate + "T00:00:00+05:30");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const isoDate = todayIST();

const CG_KEYWORDS = [
  "chhattisgarh", "chattisgarh", "raipur", "bastar", "bilaspur",
  "durg", "korba", "rajnandgaon", "jagdalpur", "ambikapur", "dantewada",
];

// ------------------------------------------------------------------
// GENERIC PARSER: kisi bhi listing page se links + nearby date nikalta hai.
// Strict "same 120 chars me date ho" wali sharat hata di — ab sabhi links aur
// sabhi "Posted on:"/date-jaise patterns ko ALAG-ALAG dhoondte hain, phir har
// link ke baad sabse pehli aane wali date se pair karte hain. Isse HTML ka
// beech ka markup jitna bhi ho, matching nahi tootti.
// ------------------------------------------------------------------
function extractLinksAndDates(html, { linkPattern, dateRegex }) {
  const links = [];
  let m;
  linkPattern.lastIndex = 0;
  while ((m = linkPattern.exec(html)) !== null) {
    let title = (m[2] || "").replace(/<[^>]+>/g, "").trim();
    title = title.replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
    if (!title) continue;
    links.push({ url: m[1], title, index: m.index + m[0].length });
  }

  const dates = [];
  let dm;
  dateRegex.lastIndex = 0;
  while ((dm = dateRegex.exec(html)) !== null) {
    dates.push({ text: dm[1] || dm[0], index: dm.index });
  }

  // Har link ke liye, usi ke baad (ya 400 chars pehle tak bhi, kabhi date pehle likhi hoti hai)
  // sabse nazdeeki date dhoondo.
  for (const link of links) {
    let best = null;
    let bestDist = Infinity;
    for (const d of dates) {
      const dist = Math.abs(d.index - link.index);
      if (dist < bestDist && dist < 600) {
        bestDist = dist;
        best = d.text;
      }
    }
    link.dateText = best;
  }

  return links;
}

const MONTH_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
function parseFlexibleDate(text) {
  if (!text) return null;
  // "18 Aug 2026" ya "18-08-2026" ya "2026-08-18" jaise formats try karo
  let m = text.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const month = MONTH_MAP[m[2].slice(0, 3).toLowerCase()];
    if (month) return new Date(Date.UTC(parseInt(m[3], 10), month - 1, parseInt(m[1], 10)));
  }
  m = text.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return new Date(Date.UTC(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
  m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  return null;
}

function filterChhattisgarhRecent(links) {
  const now = new Date();
  return links.filter((it) => {
    const titleLower = it.title.toLowerCase();
    if (!CG_KEYWORDS.some((kw) => titleLower.includes(kw))) return false;
    const posted = parseFlexibleDate(it.dateText);
    if (!posted) return true; // date na mile to bhi rakh lo
    const diffDays = (now - posted) / (1000 * 60 * 60 * 24);
    return diffDays >= -1 && diffDays <= 6;
  });
}

// ------------------------------------------------------------------
// SOURCE 1: PIB — All Press Release
// ------------------------------------------------------------------
async function fetchPib() {
  const url = "https://www.pib.gov.in/AllRelease.aspx?MenuId=22&PMO=1&lang=1&reg=1";
  console.log("[PIB] Fetch:", url);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!res.ok) throw new Error(`[PIB] HTTP ${res.status}`);
  const html = await res.text();
  console.log(`[PIB] Page mila, length: ${html.length} chars.`);

  const linkPattern = /<a[^>]+href="([^"]*PressReleseDetail\.aspx\?PRID=\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  const dateRegex = /Posted on:\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/g;

  const links = extractLinksAndDates(html, { linkPattern, dateRegex });
  console.log(`[PIB] Total ${links.length} links mile.`);
  if (links.length === 0) {
    console.log("[PIB] Debug sample (pehle 500 chars):", html.slice(0, 500));
  }

  const cgItems = filterChhattisgarhRecent(links).map((it) => ({
    ...it,
    url: it.url.startsWith("http") ? it.url : `https://www.pib.gov.in/${it.url.replace(/^\//, "")}`,
    source: "PIB",
  }));
  console.log(`[PIB] ${cgItems.length} Chhattisgarh-related recent items.`);
  return cgItems;
}

// ------------------------------------------------------------------
// SOURCE 2: Jansampark Chhattisgarh (Chhattisgarh state PRD)
// ------------------------------------------------------------------
async function fetchJansampark() {
  const url = "https://jansampark.cg.gov.in/";
  console.log("[Jansampark] Fetch:", url);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!res.ok) throw new Error(`[Jansampark] HTTP ${res.status}`);
  const html = await res.text();
  console.log(`[Jansampark] Page mila, length: ${html.length} chars.`);

  // Generic: kisi bhi <a href="...">TEXT</a> ko le lo jiska href ek article/post jaisa
  // dikhta ho (id/number ho ya .aspx/.php/date-pattern ho), aur uske aas-paas koi
  // date-jaisa text dhoondo. Yeh site ki exact HTML na jaanne ke bawajood best-effort hai.
  const linkPattern = /<a[^>]+href="([^"#][^"]{5,})"[^>]*>([\s\S]{5,150}?)<\/a>/g;
  const dateRegex = /(\d{1,2}[\s\-/][A-Za-z0-9]{3,10}[\s\-/]\d{4})/g;

  const links = extractLinksAndDates(html, { linkPattern, dateRegex });
  console.log(`[Jansampark] Total ${links.length} links mile (raw, filter se pehle).`);

  const cgItems = filterChhattisgarhRecent(links).map((it) => ({
    ...it,
    url: it.url.startsWith("http") ? it.url : new URL(it.url, url).toString(),
    source: "जनसंपर्क विभाग, छत्तीसगढ़ (Jansampark CG)",
  }));
  console.log(`[Jansampark] ${cgItems.length} Chhattisgarh-related recent items.`);
  return cgItems;
}

// ------------------------------------------------------------------
// Sabhi sources se fetch karo, ek-doosre se independent (ek fail ho to doosra chale)
// ------------------------------------------------------------------
async function fetchAllSources() {
  const results = [];

  try {
    const pibItems = await fetchPib();
    results.push(...pibItems);
  } catch (err) {
    console.error("[PIB] fetch/parse fail hua:", err.message || err);
  }

  try {
    const jsItems = await fetchJansampark();
    results.push(...jsItems);
  } catch (err) {
    console.error("[Jansampark] fetch/parse fail hua:", err.message || err);
  }

  // Duplicate URLs hata do
  const seen = new Set();
  const unique = results.filter((it) => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });

  console.log(`Total ${unique.length} unique Chhattisgarh items sabhi sources se mile.`);
  unique.slice(0, 10).forEach((it) => console.log(` - [${it.source}]`, it.title, "|", it.url));

  return unique.slice(0, 8);
}

// ------------------------------------------------------------------
// Gemini ko PLAIN call (NO tools) — sirf format/summarize karne do
// ------------------------------------------------------------------
async function summarizeWithGemini(rawItems) {
  const itemsListText = rawItems
    .map((it, i) => `${i + 1}. Source: ${it.source}\n   Title: ${it.title}\n   URL: ${it.url}`)
    .join("\n\n");

  const prompt = `Tum Chhattisgarh Public Service Commission (CGPSC) aur Vyapam jaisi Chhattisgarh
state exams ke liye current affairs digest banate ho.

Neeche official government sources se liye gaye REAL items hain (title, source, URL pehle
se diye hue hain — inhe mat badalna):

${itemsListText}

Inme se sabse important/exam-relevant 3-4 items chuno (agar kam hain to jitne hain utne hi
use karo). Har chune hue item ke liye ek 3-4 sentence ka Hindi (Devanagari) paragraph likho
jisme concrete facts/numbers/names ho jo exam MCQ me pooche ja sakte hain — apne shabdon me
likho, title ko translate/paraphrase karke likho.

Output STRICTLY valid JSON array hona chahiye, bina extra text ke, bina markdown fence ke:

[
  {
    "tag": "2-3 word Hindi category, e.g. शासन/प्रशासन, अर्थव्यवस्था, स्वास्थ्य, दूरसंचार, कृषि",
    "title": "Ek line ka Hindi headline",
    "body": "3-4 sentence Hindi paragraph",
    "source": "UPAR DIYE GAYE ITEM KA EXACT 'Source' field, jaisa hai waisa hi",
    "source_url": "UPAR DIYE GAYE ITEM KA EXACT URL, bilkul copy-paste karo, badalna mat"
  }
]

Sirf JSON array return karo.`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3 },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || "").join("\n").trim();
  if (!text) throw new Error("Gemini response me text nahi mila: " + JSON.stringify(data));

  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let items;
  try {
    items = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("JSON parse fail hua. Raw response:\n" + text);
  }
  if (!Array.isArray(items)) return [];

  const validUrls = new Set(rawItems.map((it) => it.url));
  items = items
    .filter((it) => it && it.tag && it.title && it.body && it.source_url && validUrls.has(it.source_url))
    .slice(0, 4);

  return items;
}

// ------------------------------------------------------------------
// MAIN
// ------------------------------------------------------------------
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

  let items;
  try {
    items = await summarizeWithGemini(rawItems);
  } catch (err) {
    console.error("Gemini summarize step me error:", err.message || err);
    if (String(err.message || "").includes("429")) {
      console.log("Rate-limit hai, thoda ruk kar ek retry karte hain...");
      await sleep(30000);
      items = await summarizeWithGemini(rawItems);
    } else {
      throw err;
    }
  }

  if (!items || items.length === 0) {
    console.log("Gemini se koi valid item nahi mila — skip.");
    return;
  }

  const newEntry = {
    iso_date: isoDate,
    date: todayHindiLabel(isoDate),
    day: dayShort(isoDate),
    items,
  };

  entries.unshift(newEntry);
  entries.sort((a, b) => (a.iso_date < b.iso_date ? 1 : -1));
  const trimmed = entries.slice(0, 60);

  await writeFile(DATA_PATH, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
  console.log(`${isoDate} ke ${items.length} items add ho gaye.`);
}

main().catch((err) => {
  console.error("Update fail hua:", err);
  process.exit(1);
});
