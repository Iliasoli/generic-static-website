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
