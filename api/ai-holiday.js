const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || 'AIzaSyAQDUBsJBlLZR7UTwFxqjGNZa8oLDN18sc';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!GEMINI_API_KEY) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'no-api-key' }));
  }

  try {
    const body = await readJsonBody(req);
    const city = (body && body.city) || 'Tehran';

    // یک پرامپت خیلی ساده برای تست
    const prompt = `
شهر: ${city}
وظیفه: یک شیء JSON ساده برگردان که فقط همین باشد:

{
  "overall": {
    "isOff": true or false,
    "probability": 0-100
  }
}

هیچ متن اضافی، توضیح یا بلاک کد نده. فقط JSON خالص.
`;

    const raw = await callGemini(prompt);

    res.statusCode = 200;
    return res.end(
      JSON.stringify({
        ok: true,
        rawFromGemini: raw
      })
    );
  } catch (err) {
    console.error('AI API error (debug):', err);
    res.statusCode = 500;
    return res.end(
      JSON.stringify({
        error: 'debug-failed',
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
        maxOutputTokens: 256
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

  // کل متن خروجی مدل را برمی‌گردانیم (بدون پارس)
  const parts = candidates[0].content.parts;
  let fullText = '';
  for (const p of parts) {
    if (p.text) fullText += p.text;
  }
  return fullText.trim();
}
