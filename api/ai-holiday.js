
  const cache = {
  Tehran: null
};

const ADMIN_TOKEN =
  process.env.ADMIN_HOLIDAY_TOKEN ||
  process.env.ADMIN_PASSWORD ||
  process.env.ADMIN_TOKEN ||
  '';

module.exports = async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url, 'http://localhost');
  const body = req.body || {};
  const city = (url.searchParams.get('city') || body.city || 'Tehran').trim();

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
      const manual = body.manual;

      // برای هر نوع POST (چه دستی چه AI) از توکن ادمین استفاده می‌کنیم
      if (!ADMIN_TOKEN) {
        res.statusCode = 500;
        return res.end(
          JSON.stringify({
            error: 'admin-token-not-configured',
            message: 'توکن ادمین روی سرور تنظیم نشده است.'
          })
        );
      }

      const headerToken =
        (req.headers && (req.headers['x-admin-token
      // AI بخش هوش مصنوعی برای تحلیل تعطیلی غیرفعال شده است.
      const today = new Date();
      const faDate = today.toLocaleDateString('fa-IR');

      const result = {
        overall: {
          isOff: false,
          probability: 0,
          sourcesCount: 0,
          updatedAt: new Date().toISOString(),
          message:
            `تحلیل هوش مصنوعی غیرفعال است. برای امروز (${faDate}) تنها می‌توانید از دکمه «اطلاع رسمی» استفاده کنید یا خبرها را به‌صورت دستی بررسی کنید.`
        },
        grades: {
          elementary: { isOff: false, probability: 0 },
          middle: { isOff: false, probability: 0 },
          high: { isOff: false, probability: 0 },
          university: { isOff: false, probability: 0 },
          offices: { isOff: false, probability: 0 }
        }
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
        error: 'ai-disabled',
        message: 'بخش هوش مصنوعی برای این سرویس غیرفعال شده است.'
      })
    );
  }
};

function buildManualResult(manual) {
  const now = new Date().toISOString();
  const overall = manual.overall || {};
  const grades = manual.grades || {};

  const overallIsOff = !!overall.isOff;

  const normalizedOverall = {
    isOff: overallIsOff,
    probability:
      typeof overall.probability === 'number' ? overall.probability : 1,
    sourcesCount:
      typeof overall.sourcesCount === 'number' ? overall.sourcesCount : 0,
    updatedAt: overall.updatedAt || now,
    message: overall.message || overall.reason || ''
  };

  const normalizedGrades = {
    elementary: normalizeGrade(grades.elementary, overallIsOff),
    middle: normalizeGrade(grades.middle, overallIsOff),
    high: normalizeGrade(grades.high, overallIsOff),
    university: normalizeGrade(grades.university, overallIsOff),
    offices: normalizeGrade(grades.offices, overallIsOff)
  };

  return {
    overall: normalizedOverall,
    grades: normalizedGrades
  };
}

function normalizeGrade(grade, defaultIsOff) {
  const obj = grade || {};
  const isOff =
    typeof obj.isOff === 'boolean' ? obj.isOff : !!defaultIsOff;
  const probability =
    typeof obj.probability === 'number' ? obj.probability : 1;

  return { isOff, probability };
}
