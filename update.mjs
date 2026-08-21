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
const MODEL = "gemini-3.5-flash-lite";
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
- cgstate.gov.in — Chhattisgarh state government ka main official portal
- jansampark.cg.gov.in — Directorate of Public Relations, Chhattisgarh (roz ki official
  press releases ke liye sabse useful site)
- cgvidhansabha.gov.in (Chhattisgarh Vidhan Sabha / Legislative Assembly)
- psc.cg.gov.in (CGPSC khud)
- Chhattisgarh ke individual department websites, jo [department].cg.gov.in ya
  [department].cg.nic.in pattern follow karte hain, jaise:
  home.cg.gov.in (Home Dept), phed.cg.gov.in (Public Health Engineering),
  pwd.cg.nic.in (Public Works), samvad.cg.nic.in (Chhattisgarh Samvad — media/advertising
  wing of PRD), aur isi tarah ke health/education/agriculture/forest/mining/police
  department ke official .cg.gov.in ya .cg.nic.in sites
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
  zaroor do — LEKIN "source_url" HAMESHA us specific article/press-release/notice ka DIRECT
  PAGE LINK hona chahiye, homepage ya sirf domain (jaise "https://cg.gov.in" ya
  "https://newsonair.gov.in") KABHI mat do. Link me kam se kam ek meaningful path/slug ya
  article-id hona chahiye (jaise ".../press-release/12345" ya ".../news/scheme-launch-2026").
  Agar tumhe specific article ka URL search results me nahi milta — sirf homepage milta hai —
  to us item ko chhod do, use include mat karo. Bare/homepage link dena galat hai kyunki
  user click karke seedha us news tak pahunchna chahta hai, na ki site ke homepage par.
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


async function callGeminiOnce(attemptPrompt) {
  const body = {
    contents: [{ role: "user", parts: [{ text: attemptPrompt }] }],
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

  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

  let items;
  try {
    items = JSON.parse(cleaned);
  } catch (e) {
    throw new Error("JSON parse fail hua. Raw response:\n" + text);
  }

  if (!Array.isArray(items)) return [];
  return items;
}

// Ek link "real article link hai, homepage nahi" — heuristic check:
// scheme + domain ke baad kam se kam 1 meaningful path segment (>1 char) hona chahiye.
function isSpecificArticleUrl(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, ""); // trailing slash hata do
    if (!path || path === "") return false; // "https://cgstate.gov.in" jaisa bare domain
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return false;
    // sirf ek chota generic segment (jaise "/en", "/home") bhi reject karo
    if (segments.length === 1 && segments[0].length <= 4) return false;
    return true;
  } catch {
    return false;
  }
}

function validateAndClean(rawItems) {
  // Basic shape validation — source aur ek real (non-homepage) source_url dono zaroori hain,
  // taaki private/unverified/broken items filter ho jaayein.
  let items = rawItems
    .filter(
      (it) =>
        it &&
        it.tag &&
        it.title &&
        it.body &&
        it.source &&
        typeof it.source_url === "string" &&
        /^https?:\/\//i.test(it.source_url) &&
        isSpecificArticleUrl(it.source_url)
    )
    .slice(0, 4);

  // Newspaper link optional hai — agar diya hai to wahi bare-homepage check laga do,
  // warna field hi hata do (broken/misleading link dikhane se accha kuch na dikhana).
  items = items.map((it) => {
    if (it.newspaper_url && !isSpecificArticleUrl(it.newspaper_url)) {
      delete it.newspaper_url;
      delete it.newspaper;
    }
    return it;
  });

  return items;
}

const RETRY_PROMPT_SUFFIX = `

(Pichhle attempt me koi valid, verified-official-source item nahi mila tha. Is baar thoda
zyada wide search karo — pichhle 4-5 din tak ki bhi Chhattisgarh-related official news
dekh lo agar sirf 24-48 ghante me kuch na mile. Phir bhi sirf official .gov.in /
newsonair.gov.in / pib.gov.in source hi use karna hai.)`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Quantum Digest jaisa hi robust pattern: 2 attempts try karo (jaise "attempt 1 status: 200"),
// taaki genuinely daily kuch content mile, sirf 1 hi try par give up na ho.
// Attempts ke beech thoda ruk-thak ke jaate hain taaki per-minute (RPM) free-tier limit
// se na takraaye — pehle immediate retry karta tha, jo 429 ka ek karan tha.
async function callGeminiWithRetry() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const attemptPrompt = attempt === 1 ? prompt : prompt + RETRY_PROMPT_SUFFIX;
    try {
      const rawItems = await callGeminiOnce(attemptPrompt);
      console.log(`Gemini attempt ${attempt}: ${rawItems.length} raw item(s) mile.`);
      const cleanItems = validateAndClean(rawItems);
      console.log(`Gemini attempt ${attempt}: ${cleanItems.length} verified item(s) bache.`);
      if (cleanItems.length > 0) {
        return { items: cleanItems, skipped: false };
      }
      // is attempt me kuch nahi mila — agla attempt se pehle thoda ruk jao
      if (attempt < 2) {
        console.log("Attempt 2 se pehle 20 second ruk rahe hain (rate-limit-safe)...");
        await sleep(20000);
      }
    } catch (err) {
      const msg = err.message || String(err);
      console.error(`Gemini attempt ${attempt} fail hua:`, msg);
      if (attempt === 2) throw err; // dono attempt fail — yeh ab genuine error hai
      // 429 (rate limit) mila ho to agla attempt se pehle zyada der ruko
      const isRateLimit = msg.includes("429");
      const waitMs = isRateLimit ? 45000 : 15000;
      console.log(`Attempt 2 se pehle ${waitMs / 1000} second ruk rahe hain...`);
      await sleep(waitMs);
    }
  }
  // Dono attempts ke baad bhi koi verified item nahi mila — yeh "aaj news nahi mili"
  // wala graceful-skip case hai (job fail nahi maana jaayega), Quantum Digest ke
  // "already logged, skipping" jaisa hi.
  return { items: [], skipped: true };
}

async function main() {
  const raw = await readFile(DATA_PATH, "utf-8");
  const entries = JSON.parse(raw);

  if (entries.some((e) => e.iso_date === isoDate)) {
    console.log(`Aaj (${isoDate}) ka entry pehle se maujood hai — skip.`);
    return;
  }

  const { items, skipped } = await callGeminiWithRetry();

  if (skipped) {
    console.log(
      `Aaj (${isoDate}) 2 attempts ke baad bhi koi verified official-source item nahi mila — skip kar rahe hain.`
    );
    return;
  }

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

// Sirf genuine failures (network error, API error, bad JSON dono attempts me) par
// job fail (exit 1) ho — "aaj kuch verified nahi mila" wala case upar hi handle ho
// chuka hai (graceful skip, exit 0), isliye yahan tak pahunchna matlab real problem hai.
main().catch((err) => {
  console.error("Update fail hua:", err);
  process.exit(1);
});
