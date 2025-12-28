/**
 * Simple Node.js script to test Gemini 2.5 Flash-Lite grounding with Google Search
 *
 * Usage:
 *   1) Install dependencies (only if needed): node 18+ (built-in fetch) or:
 *      - For Node &lt;18: npm install node-fetch
 *   2) Set environment variable:
 *      - On macOS/Linux:
 *          export GEMINI_API_KEY="YOUR_API_KEY_HERE"
 *      - On Windows (PowerShell):
 *          $env:GEMINI_API_KEY="YOUR_API_KEY_HERE"
 *   3) Run:
 *      node test-gemini-grounding.js
 *
 * This script asks Gemini:
 *   - "Check if TODAY schools in Tehran are closed due to air pollution"
 * and prints the raw JSON-like answer from the model.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Error: GEMINI_API_KEY environment variable is not set.');
  process.exit(1);
}

// If running on Node &lt;18, uncomment this block and install node-fetch:
// const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

async function main() {
  const today = new Date();
  const faDate = today.toLocaleDateString('fa-IR');

  const prompt = buildPrompt(faDate);

  try {
    const raw = await callGeminiWithSearch(prompt);
    console.log('--- Raw response text from Gemini ---\n');
    console.log(raw);
    console.log('\n--- End ---');

    // Try to clean and parse JSON if possible
    const cleaned = extractJson(raw);
    if (cleaned) {
      console.log('\n--- Parsed JSON ---\n');
      console.log(JSON.stringify(cleaned, null, 2));
    } else {
      console.log('\nCould not detect a valid JSON object in the response.');
    }
  } catch (err) {
    console.error('\nError calling Gemini:', err && err.message ? err.message : err);
  }
}

function buildPrompt(todayFa) {
  return `
شما یک مدل زبانی هستید که به ابزار Google Search دسترسی دارید.
وظیفه شما: بررسی کنید که امروز (${todayFa}) در شهر تهران، آیا مدارس و ادارات به خاطر آلودگی هوا یا اطلاعیه‌های رسمی تعطیل شده‌اند یا خیر.

لطفاً با استفاده از Google Search، منابع رسمی و خبرگزاری‌های معتبر ایرانی (مثل ایسنا، ایرنا، مهر، تسنیم، سایت استانداری تهران و سایر خبرگزاری‌های معتبر) را بررسی کن و فقط بر اساس خبرهای امروز یا اطلاعیه‌های رسمی معتبر، وضعیت تعطیلی را مشخص کن.

در نهایت فقط یک شیء JSON برگردان (هیچ متن اضافه، هیچ بلاک کد):

{
  "overall": {
    "isOff": true or false,
    "reason": "توضیح کوتاه فارسی درباره اینکه چرا (مثلاً: طبق اطلاعیه کارگروه اضطرار آلودگی هوا، ابتدایی‌ها غیرحضوری شدند...)"
  },
  "grades": {
    "elementary": { "isOff": true/false, "reason": "..." },
    "middle":     { "isOff": true/false, "reason": "..." },
    "high":       { "isOff": true/false, "reason": "..." },
    "university": { "isOff": true/false, "reason": "..." },
    "offices":    { "isOff": true/false, "reason": "..." }
  },
  "sourcesHint": "لیستی خیلی کوتاه از چند منبع (مثلاً: isna.ir, irna.ir, mehrnews.com) که بر اساس آن‌ها نتیجه گرفتی"
}

اگر هیچ اطلاعیه رسمی درباره تعطیلی امروز پیدا نکردی، برای همه مقاطع isOff را false بگذار و در reason توضیح بده که اطلاعیه رسمی پیدا نشد.
`;
}

async function callGeminiWithSearch(prompt) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=' +
    encodeURIComponent(GEMINI_API_KEY);

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    tools: [
      {
        google_search: {}
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024
    }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini API error: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const candidates = data.candidates || [];
  if (!candidates.length || !candidates[0].content || !candidates[0].content.parts) {
    throw new Error('No content from Gemini: ' + JSON.stringify(data));
  }

  let fullText = '';
  for (const part of candidates[0].content.parts) {
    if (part.text) fullText += part.text;
  }
  return fullText.trim();
}

/**
 * Try to extract a JSON object from a free-form text response.
 */
function extractJson(text) {
  if (!text) return null;
  let cleaned = text.trim();

  // Remove ```json fences if present
  if (cleaned.startsWith('```')) {
    const lines = cleaned.split('\n');
    if (lines.length > 1) {
      const inner = lines.slice(1).join('\n');
      cleaned = inner.replace(/```[\s\S]*$/g, '').trim();
    }
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
});