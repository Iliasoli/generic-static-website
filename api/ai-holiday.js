const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

  // --- وب‌اسکرپینگ ساده از ۳ منبع: ایرنا، ایسنا، استانداری تهران ---
  const sources = [
    { name: 'IRNA', url: 'https://www.irna.ir' },
    { name: 'ISNA', url: 'https://www.isna.ir' },
    { name: 'TehranGov', url: 'https://ostan-th.ir' } // سایت استانداری تهران
  ];
  const MAX_CHARS_PER_SOURCE = 2500;

  let combinedText = '';
  let usedSources = 0;

  for (const src of sources) {
    try {
      const r = await fetch(src.url, { redirect: 'follow' });
      if (!r.ok) continue;
      const html = await r.text();
      const plain = stripHtml(html).slice(0, MAX_CHARS_PER_SOURCE);
      combinedText += `\n\n===== SOURCE: ${src.name} (${src.url}) =====\n` + plain;
      usedSources += 1;
    } catch (e) {
      console.error('Source fetch error:', src.url, e.message || e);
    }
  }

  const prompt = buildGeminiPrompt({
    city,
    tomorrowFa: faDate,
    context,
    newsText: combinedText,
    sourcesCount: usedSources
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
      sourcesCount: usedSources,
      debugRaw: geminiResponse,
      debugError: e && e.message ? e.message : String(e)
    };
  }

  parsed.sourcesCount = parsed.sourcesCount || usedSources || 0;
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

function buildGeminiPrompt({ city, tomorrowFa, context, newsText, sourcesCount }) {
  const aqiPart =
    context && (context.lastIQ != null || context.lastTH != null)
      ? `\n\nداده‌های کیفیت هوا (اگر کمک می‌کند):\n- AQI منبع IQAir: ${context.lastIQ ?? 'نامشخص'}\n- AQI منبع شهرداری: ${context.lastTH ?? 'نامشخص'}\n`
      : '';

  const newsPart = newsText
    ? `\n\nمتن‌های زیر بخش‌هایی از خبرگزاری‌ها و سایت‌های رسمی (ایرنا، ایسنا، استانداری تهران) هستند. آن‌ها را بخوان و فقط در صورتی که به‌صورت واضح درباره تعطیلی فردا در تهران صحبت می‌کنند، از آن‌ها استفاده کن:\n-----------------------------\n${newsText}\n-----------------------------\n`
    : '\n(هیچ متن خبری مستقیمی ارسال نشده است؛ اگر اطلاع رسمی مخصوص فردا نمی‌شناسی، با احتیاط و احتمال پایین صحبت کن.)\n';

  return `
شما یک مدل زبانی هستید که باید درباره تعطیلی فردا در شهر ${city} (تهران) تحلیل بدهید.
تاریخ فردا (تقریبی به تقویم شمسی): ${tomorrowFa}.
تعداد منابع خبری گرفته‌شده: ${sourcesCount ?? 0}.

${aqiPart}
${newsPart}

مقاطع مورد نظر:
- elementary: مدارس ابتدایی
- middle: مدارس متوسطه اول
- high: مدارس متوسطه دوم (دبیرستان‌ها)
- university: دانشگاه‌ها و مؤسسات آموزش عالی
- offices: ادارات دولتی، سازمان‌ها و بانک‌ها

اگر در متن‌های خبری فوق (از ایرنا، ایسنا، استانداری تهران) هیچ اشاره‌ی رسمی و واضحی به تعطیلی فردا در تهران ندیدی، صادقانه بگو که اطلاع قطعی نداری و احتمالات را پایین بگذار (مثلاً ۲۰-۴۰٪) و در reason توضیح بده که «اطلاعیه رسمی در متن‌ها پیدا نشد».
اگر در متن‌ها دیدی که «مدارس ابتدایی تهران فردا تعطیل هستند» یا مشابه آن، برای elementary مقدار isOff را true بگذار و احتمال را بالا (مثلاً ۷۰-۹۵٪) تنظیم کن و در reason جمله‌ای کوتاه از محتوا یا خلاصه آن را بنویس.
همین منطق را برای سایر مقاطع اعمال کن (middle, high, university, offices) اگر در متن‌ها درباره آن‌ها صحبت شده بود.

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
  "sourcesCount": ${sourcesCount ?? 0}
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
        maxOutputTokens: 4096
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