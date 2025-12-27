const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAQDUBsJBlLZR7UTwFxqjGNZa8oLDN18sc';

// ساده‌ترین کش در حافظه (در سرورلس ممکن است همیشه پایدار نباشد، اما برای شروع کافی است)
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
        // اگر بدنه هنوز پارس نشده باشد، آن را بخوانیم
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
        grades: analysis.grades
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
    res.end(JSON.stringify({ error: 'ai-analysis-failed' }));
  }
};

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
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
 * این تابع:
 *  - چند سایت خبری/رسمی را می‌خواند
 *  - متن را به Gemini می‌دهد
 *  - خروجی ساختاریافته (overall + grades) برمی‌گرداند
 */
async function runGeminiHolidayAnalysis(city, context) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in environment variables');
  }

  const sources = [
    { name: 'ایرنا', url: 'https://www.irna.ir' },
    { name: 'ایسنا', url: 'https://www.isna.ir' },
    { name: 'مهر', url: 'https://www.mehrnews.com' },
    { name: 'تسنیم', url: 'https://www.tasnimnews.com' }
  ];

  let combinedText = '';
  let usedSources = 0;

  for (const src of sources) {
    try {
      const r = await fetch(src.url, { timeout: 8000 });
      if (!r.ok) continue;
      const html = await r.text();
      combinedText += `\n\n===== SOURCE: ${src.name} (${src.url}) =====\n` + stripHtml(html).slice(0, 15000);
      usedSources += 1;
    } catch (e) {
      // فقط لاگ می‌گیریم
      console.error('Source fetch error:', src.url, e.message || e);
    }
  }

  if (!combinedText) {
    combinedText = 'No sources could be fetched. The model should answer that it has insufficient information.';
  }

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const faDate = tomorrow.toLocaleDateString('fa-IR');

  const prompt = buildGeminiPrompt({
    city,
    tomorrowFa: faDate,
    newsText: combinedText,
    context
  });

  const geminiResponse = await callGemini(prompt);

  let parsed;
  try {
    parsed = JSON.parse(geminiResponse);
  } catch (e) {
    // اگر مدل JSON معتبر برنگرداند، یک خروجی پیش‌فرض می‌سازیم
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
      sourcesCount: usedSources
    };
  }

  // اطمینان از فیلدهای اصلی
  parsed.sourcesCount = parsed.sourcesCount || usedSources;
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

function buildGeminiPrompt({ city, tomorrowFa, newsText, context }) {
  const aqiPart = context && (context.lastIQ != null || context.lastTH != null)
    ? `\n\nداده‌های کیفیت هوا (ممکن است در تصمیم‌گیری برای تعطیلی نقش داشته باشند):\n- AQI منبع IQAir: ${context.lastIQ ?? 'نامشخص'}\n- AQI منبع شهرداری: ${context.lastTH ?? 'نامشخص'}\n`
    : '';

  return `
شما یک دستیار هوش مصنوعی هستید که فقط باید درباره تعطیلی فردا در شهر ${city} (تهران) تحلیل بدهید.
متن‌های زیر بخش‌هایی از خبرگزاری‌ها و سایت‌های رسمی ایران هستند.
هدف: تشخیص اینکه فردا (${tomorrowFa}) در شهر ${city} آیا برای مقاطع مختلف تعطیلی اعلام شده است یا خیر.

مقاطع مورد نظر:
- elementary: مدارس ابتدایی
- middle: مدارس متوسطه اول
- high: مدارس متوسطه دوم (دبیرستان‌ها)
- university: دانشگاه‌ها و مؤسسات آموزش عالی
- offices: ادارات دولتی، سازمان‌ها و بانک‌ها

${aqiPart}

متن خبرها و اطلاعیه‌ها:
------------------------------------------------
${newsText}
------------------------------------------------

لطفا:
1) فقط بر اساس متن فوق (و داده‌های کیفیت هوا در صورت کمک) تحلیل کن.
2) دقیقاً و فقط یک شیء JSON برگردان که ساختاری مثل زیر دارد (هیچ متن دیگری اضافه نکن):

{
  "overall": {
    "isOff": true or false,
    "probability": 0-100 (number),
    "message": "یک جمله فارسی کوتاه که توضیح خلاصه می‌دهد"
  },
  "grades": {
    "elementary": { "isOff": true/false, "probability": 0-100, "reason": "جمله فارسی کوتاه" },
    "middle":     { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "high":       { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "university": { "isOff": true/false, "probability": 0-100, "reason": "..." },
    "offices":    { "isOff": true/false, "probability": 0-100, "reason": "..." }
  },
  "sourcesCount": (number of distinct sources that clearly mention tomorrow's status)
}

اگر در متن هیچ اشاره‌ی قابل اعتمادی به تعطیلی فردا در ${city} نبود، مقدار isOff را در همه موارد false بگذار و احتمال را پایین (مثلاً ۲۰-۴۰) تنظیم کن و در message/reason توضیح بده که «اطلاعیه رسمی پیدا نشد».
خروجی باید JSON معتبر باشد و هیچ متن دیگری قبل یا بعد از آن چاپ نشود.
`;
}

async function callGemini(prompt) {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' +
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
        maxOutputTokens: 1024
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
    throw new Error('No content from Gemini');
  }

  // معمولاً متن در اولین part است
  const part = candidates[0].content.parts[0];
  return part.text || '';
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}