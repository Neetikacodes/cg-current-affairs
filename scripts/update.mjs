// scripts/update.mjs
// Gemini API (Google Search grounding) se aaj ke Chhattisgarh current affairs
// nikaal ke data.json me naya entry jod deta hai. GitHub Action isko roz chalata hai.

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

// Model change karna ho to yahi ek jagah badlein.
const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

function todayIST() {
  // Asia/Kolkata date, yyyy-mm-dd
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // "2026-08-20"
}

function todayHindiLabel(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const months = [
    "जनवरी","फरवरी","मार्च","अप्रैल","मई","जून",
    "जुलाई","अगस्त","सितंबर","अक्टूबर","नवंबर","दिसंबर",
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

function dayShort(isoDate) {
  const d = new Date(isoDate + "T00:00:00+05:30");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
}

const isoDate = todayIST();

const ALLOWED_SOURCES = `
- newsonair.gov.in (All India Radio / News on Air)
- pib.gov.in (Press Information Bureau)
- cg.gov.in aur uske under aane wale state department/portal sites (jaise cgstate.gov.in,
  cgvidhansabha.gov.in, DPR Chhattisgarh, cgprd.gov.in, etc.)
- kisi bhi central ministry ka .gov.in site (agar khabar Chhattisgarh se related central
  scheme/project ki ho)
`;

const prompt = `Aaj ki tareekh ${isoDate} (India) hai. Tum Chhattisgarh Public Service Commission
(CGPSC) aur Vyapam jaisi Chhattisgarh state exams ke liye current affairs digest bana rahe ho.

Google Search grounding ka istemal karke, PICHLE 24-48 GHANTON ke Chhattisgarh-specific news items
dhoondo jo exam ke liye important ho sakte hain: sarkari yojana/scheme launch, cabinet decisions,
budget/policy, appointments/transfers, awards, infrastructure projects, health/education initiatives,
tribal welfare, mining/industry, sports/culture events involving Chhattisgarh, ya CG se related
national-level events.

SOURCE RESTRICTION — यह सबसे ज़रूरी नियम है:
- Sirf in official sources se hi jaankari lo (PRIMARY source):
${ALLOWED_SOURCES}
- Agar koi khabar kisi private news site, blog, YouTube channel, ya kisi coaching/exam-prep
  portal (Drishti IAS, Vision IAS, sarkariyojana.com, etc.) par dikhe, to usko DIRECTLY use
  mat karo. Uske bajaye wahi topic PIB / News on Air / concerned .gov.in site par dhoondo aur
  sirf wahan se confirm hone par hi include karo. Agar official source par confirmation na mile,
  to woh item chhod do — usko mat likho.
- Har item ke saath uska "source" (site ka naam, e.g. "News on Air" ya "PIB") aur "source_url"
  (asli .gov.in ya newsonair.gov.in link) zaroor do. Agar pakka official URL na mile to woh
  item include hi mat karo.
- ADDITIONAL (optional): agar usi khabar ko kisi established Hindi/English newspaper
  (Dainik Bhaskar, Patrika, Hindustan, Nai Dunia, The Hindu, Times of India, Indian Express,
  etc.) ne bhi cover kiya ho, to uska link "newspaper" (naam) aur "newspaper_url" (asli link)
  me extra reference ke taur par de sakte ho — yeh sirf additional confirmation ke liye hai,
  primary source hamesha official (.gov.in / newsonair.gov.in / pib.gov.in) hi rahega. Agar
  koi bharosemand newspaper link na mile to yeh field khaali chhod do ya bilkul mat do —
  isse item invalid nahi hoga (sirf official source hona zaroori hai).

Sirf 3 se 4 sabse important/exam-relevant items chuno, sirf un cases me jinka official source
mil jaye. Agar aaj kisi topic ka official confirmation na mile, kam items bhi de sakte ho
(1-2), lekin kabhi bhi unverified/private-source item mat daalo.

Output STRICTLY valid JSON hona chahiye, bina kisi extra text, bina markdown code fence ke.
Exact format:

[
  {
    "tag": "2-3 word Hindi category, e.g. शासन/प्रशासन, अर्थव्यवस्था, स्वास्थ्य, बजट, नियुक्ति, खेल",
    "title": "Ek line ka Hindi headline (Devanagari script)",
    "body": "3-4 sentence ka Hindi paragraph (Devanagari script) jisme concrete facts, numbers,
             names, dates ho jo exam MCQ me pooche ja sakte hain. Apne shabdon me likho, kisi
             article se seedha copy mat karo.",
    "source": "News on Air / PIB / concerned .gov.in site ka naam",
    "source_url": "https://... (official .gov.in ya newsonair.gov.in link, verbatim)",
    "newspaper": "optional — akhbar ka naam, e.g. Dainik Bhaskar, The Hindu (agar mile to)",
    "newspaper_url": "optional — akhbar ke article ka asli link (agar mile to, warna khaali)"
  }
]

Sirf yeh JSON array return karo, kuch aur nahi.`;

async function callGemini() {
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.4,
    },
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

  // Model kabhi kabhi ```json fence laga deta hai — clean karo.
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let items;
  try {
    items = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("JSON parse fail hua. Raw response:\n" + text);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Gemini ne khaali ya galat-format array diya.");
  }

  // Basic shape validation — source aur source_url dono zaroori hain,
  // taaki private/unverified items filter ho jaayein.
  items = items
    .filter(
      (it) =>
        it &&
        it.tag &&
        it.title &&
        it.body &&
        it.source &&
        typeof it.source_url === "string" &&
        /^https?:\/\//i.test(it.source_url)
    )
    .slice(0, 4);

  if (items.length < 1) {
    throw new Error(
      "Koi bhi item official source ke saath verified nahi mila — is baar skip kar rahe hain."
    );
  }

  return items;
}

async function main() {
  const raw = await readFile(DATA_PATH, "utf-8");
  const entries = JSON.parse(raw);

  if (entries.some((e) => e.iso_date === isoDate)) {
    console.log(`Aaj (${isoDate}) ka entry pehle se maujood hai — skip.`);
    return;
  }

  const items = await callGemini();

  const newEntry = {
    iso_date: isoDate,
    date: todayHindiLabel(isoDate),
    day: dayShort(isoDate),
    items,
  };

  entries.unshift(newEntry);

  // Purane entries zyada na badhein — last 60 din rakho.
  entries.sort((a, b) => (a.iso_date < b.iso_date ? 1 : -1));
  const trimmed = entries.slice(0, 60);

  await writeFile(DATA_PATH, JSON.stringify(trimmed, null, 2) + "\n", "utf-8");
  console.log(`${isoDate} ke ${items.length} items add ho gaye.`);
}

main().catch((err) => {
  console.error("Update fail hua:", err);
  process.exit(1);
});
