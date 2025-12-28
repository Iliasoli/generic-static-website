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

    const msg = err && err.message ? String(err.message) : String(err);
    if (msg.startsWith('quota-exceeded:')) {
      res.statusCode = 503;
      return res.end(
        JSON.stringify({
          error: 'ai-quota-exceeded',
          message:
            'سرویس هوش مصنوعی موقتاً به‌دلیل محدودیت کوتا یا پلن غیر فعال است. بعداً دوباره تلاش کنید یا تنظیمات Gemini API را بررسی کنید.'
        })
      );
    }

    res.statusCode = 500;
    res.end(
      JSON.stringify({
        error: 'ai-analysis-failed',
        message: msg,
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
 * در این نسخه از ابزار Google Search داخلی مدل استفاده می‌کنیم
 * تا خودش خبرها و اطلاعیه‌های مربوط به تعطیلی امروز در تهران را جستجو و تحلیل کند.
 */
async function runGeminiHolidayAnalysis(city, context) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  const today = new Date();
  const faDate = today.toLocaleDateString('fa-IR');

  const prompt = buildGeminiPrompt({
    city,
    todayFa: faDate,
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

function buildGeminiPrompt({ city, todayFa, context }) {
  const aqiPart =
    context && (context.lastIQ != null || context.lastTH != null)
      ? `\n\nداده‌های کیفیت هوا (اگر کمک می‌کند):\n- AQI منبع IQAir: ${context.lastIQ ?? 'نامشخص'}\n- AQI منبع شهرداری: ${context.lastTH ?? 'نامشخص'}\n`
      : '';

  return `
شما یک مدل زبانی مجهز به ابزار Google Search هستید که باید درباره تعطیلی «امروز» در شهر ${city} (تهران) تحلیل بدهید.
تاریخ امروز (تقریبی به تقویم شمسی): ${todayFa}.

${aqiPart}

لطفاً با استفاده از Google Search، سایت‌ها و خبرگزاری‌های رسمی و معتبر ایرانی مثل:
- ایسنا (isna.ir)
- ایرنا (irna.ir)
- مهر (mehrnews.com)
- تسنیم (tasnimnews.com)
- سایت استانداری تهران (ostan-th.ir)
- و سایر خبرگزاری‌های معتبر
را جستجو کن و وضعیت تعطیلی امروز در تهران را بررسی کن. به‌ویژه دنبال اطلاعیه‌های کارگروه اضطرار آلودگی هوا، آموزش و پرورش و استانداری تهران باش.

خروجی نهایی باید فقط یک شیء JSON با ساختار زیر باشد (هیچ توضیح اضافه، هیچ بلاک کد، فقط JSON):

{
  "overall": {
    "isOff": true or false,
    "probability": 0-100,
    "message": "یک جمله فارسی کوتاه که خلاصه وضعیت تعطیلی امروز را می‌گوید"
  },
  "grades": {
    "elementary": { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "middle":     { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "high":       { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "university": { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "offices":    { "isOff": true/false, "probability": 0-100, "reason": "..." }
  },
  "sourcesCount": (تعداد منابع مختلفی که صراحتاً به وضعیت تعطیلی امروز اشاره کرده‌اند)
}

اگر در نتایج جستجو هیچ اطلاعیه رسمی یا خبر معتبری درباره تعطیلی امروز در تهران پیدا نکردی، مقدار isOff را در همه موارد false بگذار، احتمال را پایین (مثلاً ۲۰-۴۰٪) انتخاب کن و در message و reason توضیح بده که «اطلاعیه رسمی پیدا نشد».
`;
}

async function callGemini(prompt) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' +
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
      tools: [
        {
          google_search: {}
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024
      }
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    if (resp.status === 429) {
      throw new Error('quota-exceeded:' + text);
    }
    throw new Error('Gemini API}

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
