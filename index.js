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

// Логи статистики (в памяти, сбрасываются при рестарте)
let stats = {
  real: 0,
  bots: 0,
  total: 0,
  log: []
};

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
  const entry = {
    time: new Date().toISOString(),
    type,
    reason,
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
    ua: (req.headers['user-agent'] || '').substring(0, 80),
    utm: req.query.utm_source || req.query.source || '-',
  };
  stats.log.unshift(entry);
  if (stats.log.length > 200) stats.log.pop();
  stats.total++;
  if (type === 'real') stats.real++;
  if (type === 'bot') stats.bots++;
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

// Статистика (защита паролем через env)
app.get('/stats', (req, res) => {
  const adminKey = process.env.ADMIN_KEY || 'admin123';
  if (req.query.key !== adminKey) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json({
    stats: {
      total: stats.total,
      real: stats.real,
      bots: stats.bots,
      conversion: stats.total > 0 ? ((stats.real / stats.total) * 100).toFixed(1) + '%' : '0%'
    },
    recent: stats.log.slice(0, 50)
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
