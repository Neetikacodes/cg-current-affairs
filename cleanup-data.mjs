// Ek baar chalao: node scripts/cleanup-data.mjs
// Purani data.json se repeat khabrein hatata hai. Har khabar sirf ek hi (sabse sahi) tareekh par rahegi.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const P = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data.json");

const HI = ["जनवरी","फरवरी","मार्च","अप्रैल","मई","जून","जुलाई","अगस्त","सितंबर","अक्टूबर","नवंबर","दिसंबर"];
const STOP = new Set(["के","में","को","से","का","की","है","हैं","पर","ने","और","भी","एक","यह","ये","वो","कर","करें","लिए","तक","था","थी","थे","हो","गया","गई","the","of","in","to","a","an","for","on","and","is","at","by","with","as","from","after","over"]);
const tokens = (t) => new Set(t.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 2 && !STOP.has(w)));
function similar(a, b) {
  let i = 0; for (const w of a) if (b.has(w)) i++;
  if (i < 3) return false;
  return i / (a.size + b.size - i) >= 0.5 || (i / Math.min(a.size, b.size) >= 0.75 && i >= 4);
}
// body me "प्रकाशित: 15 अक्टूबर 2026" jaisi asli tareekh ho to wahi lo
function bodyIso(body = "") {
  const m = body.match(/(\d{1,2}) (जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर) (\d{4})/);
  if (!m) return null;
  return `${m[3]}-${String(HI.indexOf(m[2]) + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const dayShort = (iso) => new Date(iso + "T00:00:00+05:30").toLocaleDateString("en-US", { weekday: "short", timeZone: "Asia/Kolkata" });
const label = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${HI[m - 1]} ${y}`; };

const entries = JSON.parse(await readFile(P, "utf-8"));
const before = entries.reduce((n, e) => n + e.items.length, 0);

// Har item ki "sahi tareekh": body ki tareekh (agar entry ki tareekh se pehle ki ho), warna entry ki tareekh
const all = [];
for (const e of entries) for (const it of e.items) {
  const b = bodyIso(it.body);
  all.push({ it, iso: b && b <= e.iso_date ? b : e.iso_date, entryIso: e.iso_date });
}
// Sabse purani tareekh pehle: wahi khabar ka "ghar"
all.sort((x, y) => (x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : 0));

const urls = new Set(); const seenTok = [];
const byDate = new Map();
for (const { it, iso } of all) {
  const us = [it.source_url, ...(it.sources || []).map((s) => s.url)].filter(Boolean);
  const tk = tokens(it.title || "");
  if (us.some((u) => urls.has(u)) || seenTok.some((t) => similar(t, tk))) continue;
  us.forEach((u) => urls.add(u)); seenTok.push(tk);
  if (!byDate.has(iso)) byDate.set(iso, []);
  byDate.get(iso).push(it);
}

const out = [...byDate.entries()]
  .sort((a, b) => (a[0] < b[0] ? 1 : -1))
  .map(([iso, items]) => ({ iso_date: iso, date: label(iso), day: dayShort(iso), items }));

await writeFile(P, JSON.stringify(out, null, 2) + "\n", "utf-8");
const after = out.reduce((n, e) => n + e.items.length, 0);
console.log(`Entries: ${entries.length} -> ${out.length} | Items: ${before} -> ${after} (${before - after} repeat hataye)`);
