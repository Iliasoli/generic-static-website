const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || 'AIzaSyAQDUBsJBlLZR7UTwFxqjGNZa8oLDN18sc';

// کش ساده در حافظه برای نتایج آخر
const cache = {
  Tehran: null
};

module.exports = async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url, 'http://localhost');
  const city = (url.searchParams.get('city') || (req.body && req.body.city) || 'Tehran').trim();

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if (method === 'GET') {
      const data = cache[city];
      if (!data) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'no-cached-data' }));
      }
      return res.end(JSON.stringify(data));
    }

    if (method === 'POST') {
      let body = req.body;
      if (!body) {
        body = await readJsonBody(req);
      }

      const context = body && body.context ? body.context : {};
      const analysis = await runGeminiHolidayAnalysis(city, context);

      const result = {
        overall: {
          isOff: analysis.overall.isOff,
          probability: analysis.overall.probability,
          sourcesCount: analysis.sourcesCount,
          updatedAt: new Date().toISOString(),
          message: analysis.overall.message
        },
        grades: analysis.grades,
        debugRaw: analysis.debugRaw,
        debugError: analysis.debugError
      };

      cache[city] = result;
      res.statusCode = 200;
      return res.end(JSON.stringify(result));
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method-not-allowed' }));
  } catch (err) {
    console.error('AI API error:', err);
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: 'ai-analysis-failed',
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : undefined
      })
    );
  }
};

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * runGeminiHolidayAnalysis
 * این تابع فعلاً فقط از مدل می‌خواهد بر اساس دانسته‌های خودش
 * و کمی کانتکست (AQI) درباره تعطیلی فردا در تهران نظر بدهد.
 * برای جلوگیری از پیچیدگی فعلاً اسکرپ وب را حذف کرده‌ایم.
 */
async function runGeminiHolidayAnalysis(city, context) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const faDate = tomorrow.toLocaleDateString('fa-IR');

  const prompt = buildGeminiPrompt({
    city,
    tomorrowFa: faDate,
    context
  });

  const geminiResponse = await callGemini(prompt);

  let parsed;
  try {
    let cleaned = (geminiResponse || '').trim();

    if (cleaned.startsWith('```')) {
      const lines = cleaned.split('\n');
      if (lines.length > 1) {
        const inner = lines.slice(1).join('\n');
        cleaned = inner.replace(/```[\s\S]*$/g, '').trim();
      }
    }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse Gemini JSON:', e, geminiResponse);
    parsed = {
      overall: {
        isOff: false,
        probability: 30,
        message: 'مدل نتوانست خروجی ساختاریافته بدهد؛ فرض می‌کنیم تعطیلی قطعی نیست.'
      },
      grades: {
        elementary: { isOff: false, probability: 30 },
        middle: { isOff: false, probability: 30 },
        high: { isOff: false, probability: 30 },
        university: { isOff: false, probability: 30 },
        offices: { isOff: false, probability: 30 }
      },
      sourcesCount: 0,
      debugRaw: geminiResponse,
      debugError: e && e.message ? e.message : String(e)
    };
  }

  parsed.sourcesCount = parsed.sourcesCount || 0;
  if (!parsed.overall) {
    parsed.overall = {
      isOff: false,
      probability: 30,
      message: 'ساختار کلی توسط مدل برنگشته است.'
    };
  }
  if (!parsed.grades) {
    parsed.grades = {
      elementary: { isOff: false, probability: 30 },
      middle: { isOff: false, probability: 30 },
      high: { isOff: false, probability: 30 },
      university: { isOff: false, probability: 30 },
      offices: { isOff: false, probability: 30 }
    };
  }

  return parsed;
}

function buildGeminiPrompt({ city, tomorrowFa, context }) {
  const aqiPart =
    context && (context.lastIQ != null || context.lastTH != null)
      ? `\n\nداده‌های کیفیت هوا (اگر کمک می‌کند):\n- AQI منبع IQAir: ${context.lastIQ ?? 'نامشخص'}\n- AQI منبع شهرداری: ${context.lastTH ?? 'نامشخص'}\n`
      : '';

  return `
شما یک مدل زبانی هستید که باید درباره تعطیلی فردا در شهر ${city} (تهران) یک تحلیل بدهید.
تاریخ فردا (تقریبی به تقویم شمسی): ${tomorrowFa}.

${aqiPart}

مقاطع مورد نظر:
- elementary: مدارس ابتدایی
- middle: مدارس متوسطه اول
- high: مدارس متوسطه دوم (دبیرستان‌ها)
- university: دانشگاه‌ها و مؤسسات آموزش عالی
- offices: ادارات دولتی، سازمان‌ها و بانک‌ها

اگر اطلاعات دقیقی از تعطیلی فردا ندارید، صادقانه بگو که «اطلاع قطعی ندارم» و احتمالات را پایین بگذار (مثلاً ۲۰-۴۰٪).
اگر نشانه‌ای قوی از تعطیلی یک مقطع خاص وجود دارد (مثلاً در خبرها یا اطلاعیه‌های رسمی که می‌شناسی)، برای همان مقطع isOff را true و probability را بالا (مثلاً ۷۰-۹۵٪) تنظیم کن.

فقط و فقط یک شیء JSON با ساختار زیر برگردان (هیچ متن دیگر، هیچ توضیح اضافی، هیچ بلاک کد):

{
  "overall": {
    "isOff": true or false,
    "probability": 0-100,
    "message": "یک جمله فارسی کوتاه که خلاصه وضعیت را می‌گوید"
  },
  "grades": {
    "elementary": { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "middle":     { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "high":       { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "university": { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "offices":    { "isOff": true/false, "probability": 0-100, "reason": "..." }
  },
  "sourcesCount": 0
}
`;
}

async function callGemini(prompt) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' +
    encodeURIComponent(GEMINI_API_KEY);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 512
      }
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error('Gemini API error: ' + resp.status + ' ' + text);
  }

  const data = await resp.json();
  const candidates = data.candidates || [];
  if (!candidates.length || !candidates[0].content || !candidates[0].content.parts) {
    throw new Error('No content from Gemini: ' + JSON.stringify(data));
  }

  const parts = candidates[0].content.parts;
  let fullText = '';
  for (const p of parts) {
    if (p.text) fullText += p.text;
  }
  return fullText.trim();
}