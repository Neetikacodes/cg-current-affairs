# CG परिपत्र — Chhattisgarh Current Affairs (auto-updating)

CGPSC / व्यापम exam ke liye daily Chhattisgarh current affairs digest. GitHub Actions
har din Gemini API (Google Search grounding ke saath) call karke naye topics `data.json`
me jod deta hai, aur GitHub Pages pe live dikh jata hai.

## Setup (5 minute)

1. **Repo banao** — is folder ka pura content ek naye GitHub repo me upload/push karo
   (root me `index.html`, `data.json`, `.github/`, `scripts/`, `package.json` hone chahiye).

2. **Gemini API key add karo:**
   - Repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `GEMINI_API_KEY`
   - Value: apni Gemini API key (Google AI Studio se milti hai: https://aistudio.google.com/apikey)

3. **GitHub Pages on karo:**
   - Repo → **Settings → Pages**
   - Source: **Deploy from a branch** → Branch: `main` → folder `/ (root)`
   - Save karne ke baad kuch minute me `https://<username>.github.io/<repo-name>/` pe page live ho jayega.

4. **Workflow permissions check karo** (agar push fail ho):
   - Repo → **Settings → Actions → General → Workflow permissions**
   - **"Read and write permissions"** select karo, Save.

5. **Test run:**
   - Repo → **Actions** tab → "Daily CG Current Affairs Update" workflow → **Run workflow** button
     se manually ek baar chala ke dekho ki `data.json` me naya entry aata hai ya nahi.

Uske baad yeh roz apne aap 7:00 AM IST pe chalega (`.github/workflows/daily-update.yml` me
cron schedule hai — chaho to time change kar sakte ho).

## Files

- `index.html` — page jo `data.json` fetch karke digest render karta hai.
- `data.json` — saare entries yahan store hote hain (seed data already daala hai).
- `scripts/update.mjs` — Gemini ko call karke naya din ka entry banata/jodta hai.
- `.github/workflows/daily-update.yml` — daily cron job.

## Local test (optional)

```bash
export GEMINI_API_KEY="your-key-here"
node scripts/update.mjs
```

Isse `data.json` me aaj ka entry (agar pehle se nahi hai) add ho jayega — GitHub pe push
karne se pehle locally check karne ke liye useful hai.

## Newspaper reference link (अतिरिक्त, optional)

अब हर item में official source (`source` / `source_url`) के साथ-साथ एक optional
`newspaper` / `newspaper_url` field भी आ सकता है — अगर उसी खबर को किसी भरोसेमंद अख़बार
(Dainik Bhaskar, Patrika, The Hindu, Indian Express, आदि) ने भी कवर किया हो, तो पेज पर
"अख़बार में भी पढ़ें" के तौर पर वो लिंक अलग से नीचे दिख जाएगा। यह सिर्फ़ अतिरिक्त
संदर्भ के लिए है — primary/mandatory source हमेशा official (.gov.in / newsonair.gov.in /
pib.gov.in) ही रहेगा; newspaper link न मिले तो item फिर भी valid रहेगा।

Seed data में अभी कोई newspaper link नहीं डाला है (सही article link के बिना ग़लत/काल्पनिक
लिंक देना ठीक नहीं) — पहला automatic run होने पर Gemini जो verified links देगा वही आने लगेंगे।

## Source restriction (ज़रूरी)

`scripts/update.mjs` में prompt अब सिर्फ़ इन्हें official source मानने को कहता है:
News on Air (newsonair.gov.in), PIB (pib.gov.in), और cgstate.gov.in / jansampark.cg.gov.in
जैसे राज्य सरकार के आधिकारिक पोर्टल। हर item के साथ अब `source` और `source_url` (असली .gov.in लिंक)
अनिवार्य है — अगर model को पक्का सरकारी लिंक नहीं मिलता, तो script उस item को अपने-आप
हटा देता है (देखें `update.mjs` में `filter`)।

**ईमानदार सीमा:** Gemini API का Google Search grounding tool किसी domain को hard-block/
whitelist करने का कोई parameter नहीं देता — यह restriction सिर्फ़ prompt-level instruction
है, guarantee नहीं। इसलिए हर हफ़्ते एक बार ख़ुद `data.json` में जाकर `source_url` चेक कर
लेना बेहतर रहेगा कि लिंक सच में .gov.in / newsonair.gov.in का ही है। अगर कभी कोई गलत/
private source वाला entry दिख जाए, उसे `data.json` से manually हटाकर commit कर दें।

Seed data (`data.json` में मौजूद शुरुआती 5 entries) के source links अभी approximate/
placeholder हैं — repo push करने से पहले चाहें तो इन्हें असली News on Air / PIB लिंक से
बदल लें, या इन्हें हटाकर पहला automatic run होने दें।

## Notes

- Agar kisi din Gemini se genuinely CG-specific news na mile, script fail ho sakta hai —
  workflow ke Actions log me error dikh jayega, agle din phir try hoga.
- `data.json` me last 60 din ke entries hi rakhe jaate hain (purane apne aap trim ho jaate hain) —
  `scripts/update.mjs` me `slice(0, 60)` change karke yeh limit badha/ghata sakte ho.
- Model `gemini-2.5-flash` use ho raha hai — chaho to `scripts/update.mjs` me `MODEL` variable
  badal ke koi aur Gemini model use kar sakte ho.
