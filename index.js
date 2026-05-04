const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================
// НАСТРОЙКИ — ИЗМЕНИ ЭТИ ЗНАЧЕНИЯ
// =============================================
const TELEGRAM_BOT_LINK = process.env.TELEGRAM_BOT_LINK || 'https://t.me/your_bot';
const VK_PIXEL_ID = process.env.VK_PIXEL_ID || '';
const UTM_SOURCE = process.env.UTM_SOURCE || 'vkads';
// =============================================

// Хранение статистики по дням
const STATS_FILE = path.join(__dirname, 'stats.json');
let statsDb = {
  dates: {}, // "YYYY-MM-DD": { total, real, bots, clicks }
  log: []
};

if (fs.existsSync(STATS_FILE)) {
  try {
    statsDb = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch(e) {}
}

function saveStats() {
  fs.writeFileSync(STATS_FILE, JSON.stringify(statsDb));
}

function getTodayStr() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
}

function initDate(dateStr) {
  if (!statsDb.dates[dateStr]) {
    statsDb.dates[dateStr] = { total: 0, real: 0, bots: 0, clicks: 0 };
  }
}

// --- IP диапазоны модераторов / ботов ---
// VK, Яндекс, Google, известные datacenter ranges
const BOT_IP_RANGES = [
  // VK / Mail.ru
  '5.61.', '5.45.', '5.158.', '87.240.', '87.226.',
  '95.142.', '178.154.', '46.8.', '46.148.',
  // Яндекс
  '5.45.', '37.9.', '77.88.', '87.250.',
  '95.108.', '100.43.', '141.8.', '178.154.',
  // Google
  '66.102.', '66.249.', '72.14.', '74.125.',
  '64.233.', '216.239.', '209.85.',
  // Amazon AWS / Datacenter
  '52.', '54.', '18.', '34.', '35.',
  // Microsoft Azure
  '13.', '20.', '40.',
  // DigitalOcean
  '167.99.', '178.62.', '188.166.', '206.189.',
  // Hetzner
  '5.9.', '78.46.', '88.198.', '136.243.',
];

// --- User-Agent чёрный список ---
const BOT_USER_AGENTS = [
  'bot', 'crawl', 'spider', 'slurp', 'mediapartners',
  'googlebot', 'yandexbot', 'baiduspider', 'bingbot',
  'facebookexternalhit', 'twitterbot', 'linkedinbot',
  'whatsapp', 'telegrambot', 'vkshare', 'vkrobot',
  'semrushbot', 'ahrefsbot', 'mj12bot', 'dotbot',
  'rogerbot', 'exabot', 'gigabot', 'ia_archiver',
  'python-requests', 'python-urllib', 'curl/', 'wget/',
  'go-http-client', 'java/', 'ruby', 'php/',
  'headlesschrome', 'phantomjs', 'selenium',
  'webdriver', 'puppeteer', 'playwright',
  'mail.ru', 'vkontakte', 'ok.ru',
];

function isBot(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';
  const ua = (req.headers['user-agent'] || '').toLowerCase();
  const referer = (req.headers['referer'] || '').toLowerCase();

  // Проверка User-Agent
  for (const botUA of BOT_USER_AGENTS) {
    if (ua.includes(botUA)) {
      return { result: true, reason: `bot_ua:${botUA}` };
    }
  }

  // Пустой User-Agent — подозрительно
  if (!ua || ua.length < 10) {
    return { result: true, reason: 'empty_ua' };
  }

  // Проверка IP диапазонов
  for (const range of BOT_IP_RANGES) {
    if (ip.startsWith(range)) {
      return { result: true, reason: `bot_ip:${range}` };
    }
  }

  // Если реферер — сам VK но IP датацентровый
  if (referer.includes('vk.com') && ip.startsWith('87.')) {
    return { result: true, reason: 'vk_moderator_ip' };
  }

  return { result: false, reason: 'real_user' };
}

function logVisit(req, type, reason) {
  const dateStr = getTodayStr();
  initDate(dateStr);

  const entry = {
    time: new Date().toISOString(),
    type,
    reason,
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    ua: (req.headers['user-agent'] || '').substring(0, 80),
    utm: req.query.utm_source || req.query.source || '-',
  };
  statsDb.log.unshift(entry);
  if (statsDb.log.length > 200) statsDb.log.pop();
  
  statsDb.dates[dateStr].total++;
  if (type === 'real') statsDb.dates[dateStr].real++;
  if (type === 'bot') statsDb.dates[dateStr].bots++;
  
  saveStats();
}

// =============================================
// МАРШРУТЫ
// =============================================

// Главная — лендинг для всех (VK-compliant, без авто-редиректа)
app.get('/', (req, res) => {
  const { result, reason } = isBot(req);
  logVisit(req, result ? 'bot' : 'real', reason);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  const filePath = path.join(__dirname, 'public', 'landing.html');
  res.sendFile(filePath);
});

// Принудительный редирект (на случай если JS не сработал)
app.get('/go', (req, res) => {
  const source = req.query.s || UTM_SOURCE;
  res.redirect(`${TELEGRAM_BOT_LINK}?start=${source}`);
});

// Юридические страницы
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

// Красивая панель статистики
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Трекинг кликов в бота
app.all('/track-click', (req, res) => {
  const dateStr = getTodayStr();
  initDate(dateStr);
  statsDb.dates[dateStr].clicks++;
  saveStats();
  res.json({ok: true});
});

function getStatsForPeriod(period) {
  let result = { total: 0, real: 0, bots: 0, clicks: 0 };
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  const today = d.toISOString().split('T')[0];
  
  let validDates = [];
  if (period === 'today') {
    validDates.push(today);
  } else if (period === 'yesterday') {
    const yest = new Date(d);
    yest.setDate(yest.getDate() - 1);
    validDates.push(yest.toISOString().split('T')[0]);
  } else if (period === 'week') {
    for (let i = 0; i < 7; i++) {
      const wd = new Date(d);
      wd.setDate(wd.getDate() - i);
      validDates.push(wd.toISOString().split('T')[0]);
    }
  }

  for (const [dateStr, data] of Object.entries(statsDb.dates)) {
    if (period === 'all' || validDates.includes(dateStr)) {
      result.total += data.total || 0;
      result.real += data.real || 0;
      result.bots += data.bots || 0;
      result.clicks += data.clicks || 0;
    }
  }
  return result;
}

function getChartData() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  let labels = [];
  let clicks = [];
  let real = [];
  for (let i = 6; i >= 0; i--) {
    const dTemp = new Date(d);
    dTemp.setDate(dTemp.getDate() - i);
    const dateStr = dTemp.toISOString().split('T')[0];
    labels.push(dateStr.substring(5)); // MM-DD
    const st = statsDb.dates[dateStr] || { clicks: 0, real: 0 };
    clicks.push(st.clicks || 0);
    real.push(st.real || 0);
  }
  return { labels, clicks, real };
}

// Статистика (защита паролем через env)
app.get('/stats', (req, res) => {
  const adminKey = process.env.ADMIN_KEY || 'admin123';
  if (req.query.key !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const period = req.query.period || 'all';
  const s = getStatsForPeriod(period);
  
  res.json({
    stats: {
      total: s.total,
      real: s.real,
      bots: s.bots,
      clicks: s.clicks,
      conversion: s.total > 0 ? ((s.real / s.total) * 100).toFixed(1) + '%' : '0%',
      ctr: s.real > 0 ? ((s.clicks / s.real) * 100).toFixed(1) + '%' : '0%'
    },
    chart: getChartData(),
    recent: statsDb.log.slice(0, 50)
  });
});

// Отдача VK Pixel ID для клиентской части
app.get('/config.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(`window.VK_PIXEL_ID="${VK_PIXEL_ID}";window.BOT_LINK="${TELEGRAM_BOT_LINK}";window.UTM="${UTM_SOURCE}";`);
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Cloaker running on port ${PORT}`);
  console.log(`Bot link: ${TELEGRAM_BOT_LINK}`);
  console.log(`VK Pixel: ${VK_PIXEL_ID || 'NOT SET'}`);
});
