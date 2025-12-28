// Admin page script: manage manual status for today's closures

document.addEventListener('DOMContentLoaded', () => {
  const cityInput = document.getElementById('city-input');
  const loadBtn = document.getElementById('load-status');
  const saveBtn = document.getElementById('save-manual');
  const runAiBtn = document.getElementById('run-ai');
  const statusMessage = document.getElementById('status-message');
  const statusRaw = document.getElementById('status-raw');

  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      const city = (cityInput.value || 'Tehran').trim() || 'Tehran';
      await loadStatus(city, statusMessage, statusRaw);
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const city = (cityInput.value || 'Tehran').trim() || 'Tehran';
      await saveManual(city, statusMessage, statusRaw);
    });
  }

  if (runAiBtn) {
    runAiBtn.addEventListener('click', async () => {
      const city = (cityInput.value || 'Tehran').trim() || 'Tehran';
      await runAiCheck(city, statusMessage, statusRaw);
    });
  }
});

async function loadStatus(city, statusMessage, statusRaw) {
  clearStatus(statusMessage, statusRaw);

  try {
    const response = await fetch(`/api/ai-holiday?city=${encodeURIComponent(city)}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.status === 404) {
      statusMessage.textContent = 'هیچ وضعیت ذخیره‌شده‌ای برای این شهر پیدا نشد.';
      return;
    }

    if (!response.ok) {
      statusMessage.textContent = `خطا در دریافت وضعیت (کد ${response.status})`;
      return;
    }

    const data = await response.json();
    statusMessage.textContent = buildSummary(city, data);
    statusRaw.textContent = JSON.stringify(data, null, 2);
    fillFormFromData(data);
  } catch (err) {
    console.error('Error loading status:', err);
    statusMessage.textContent = 'خطای شبکه یا سرور هنگام دریافت وضعیت.';
  }
}

async function saveManual(city, statusMessage, statusRaw) {
  clearStatus(statusMessage, statusRaw);

  const manual = collectManualFromForm();
  try {
    const response = await fetch(`/api/ai-holiday?city=${encodeURIComponent(city)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ city, manual })
    });

    const data = await safeJson(response);

    if (!response.ok) {
      statusMessage.textContent = `خطا در ذخیره وضعیت دستی (کد ${response.status})`;
      if (data) {
        statusRaw.textContent = JSON.stringify(data, null, 2);
      }
      return;
    }

    statusMessage.textContent = 'وضعیت دستی با موفقیت ذخیره شد.';
    if (data) {
      statusRaw.textContent = JSON.stringify(data, null, 2);
      fillFormFromData(data);
    }
  } catch (err) {
    console.error('Error saving manual status:', err);
    statusMessage.textContent = 'خطای شبکه هنگام ذخیره وضعیت.';
  }
}

async function runAiCheck(city, statusMessage, statusRaw) {
  clearStatus(statusMessage, statusRaw);

  statusMessage.textContent = 'در حال ارسال درخواست به سرور برای تحلیل هوش مصنوعی...';
  try {
    const response = await fetch(`/api/ai-holiday?city=${encodeURIComponent(city)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ city })
    });

    const data = await safeJson(response);

    if (!response.ok) {
      statusMessage.textContent = `خطا در درخواست تحلیل هوش مصنوعی (کد ${response.status})`;
      if (data) {
        statusRaw.textContent = JSON.stringify(data, null, 2);
      }
      return;
    }

    statusMessage.textContent = 'پاسخ سرور برای تحلیل هوش مصنوعی دریافت شد.';
    if (data) {
      statusRaw.textContent = JSON.stringify(data, null, 2);
      fillFormFromData(data);
    }
  } catch (err) {
    console.error('Error running AI check:', err);
    statusMessage.textContent = 'خطای شبکه هنگام درخواست تحلیل هوش مصنوعی.';
  }
}

function clearStatus(statusMessage, statusRaw) {
  if (statusMessage) statusMessage.textContent = '';
  if (statusRaw) statusRaw.textContent = '';
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function collectManualFromForm() {
  const overallSelect = document.getElementById('overall-isOff');
  const overallReason = document.getElementById('overall-reason');

  const overallIsOff = overallSelect ? overallSelect.value === 'true' : false;
  const overallMessage = overallReason ? overallReason.value.trim() : '';

  const gradeKeys = ['elementary', 'middle', 'high', 'university', 'offices'];
  const grades = {};

  gradeKeys.forEach(key => {
    const select = document.getElementById(`grade-${key}-isOff`);
    if (select) {
      grades[key] = {
        isOff: select.value === 'true',
        probability: 1
      };
    }
  });

  return {
    overall: {
      isOff: overallIsOff,
      probability: 1,
      sourcesCount: 0,
      message: overallMessage
    },
    grades
  };
}

function fillFormFromData(data) {
  if (!data || !data.overall) return;

  const overallSelect = document.getElementById('overall-isOff');
  const overallReason = document.getElementById('overall-reason');

  if (overallSelect) {
    overallSelect.value = data.overall.isOff ? 'true' : 'false';
  }
  if (overallReason) {
    overallReason.value = data.overall.message || '';
  }

  const gradeKeys = ['elementary', 'middle', 'high', 'university', 'offices'];
  gradeKeys.forEach(key => {
    const select = document.getElementById(`grade-${key}-isOff`);
    if (select && data.grades && data.grades[key]) {
      select.value = data.grades[key].isOff ? 'true' : 'false';
    }
  });
}

function buildSummary(city, data) {
  if (!data || !data.overall) return '';

  const status = data.overall.isOff ? 'تعطیل' : 'باز';
  const reason = data.overall.message || '';
  const updatedAt = data.overall.updatedAt;

  let text = `وضعیت امروز برای ${city}: ${status}`;
  if (reason) {
    text += ` — ${reason}`;
  }
  if (updatedAt) {
    text += ` (به‌روزرسانی: ${updatedAt})`;
  }
  return text;
}