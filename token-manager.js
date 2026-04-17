// token-manager.js
// Автоматическое обновление SmartThings OAuth токена каждые 20 часов.
// Один раз получи токены вручную (см. README), потом этот модуль
// сам всё обновляет — навсегда.

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const TOKEN_FILE = path.join(__dirname, 'data', 'st_tokens.json');
const REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 часов

let _currentToken = null;

// ── Загрузить токены из файла ──────────────────────────────────────────────
function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[TokenManager] Ошибка чтения токенов:', e.message);
    }
    return null;
}

// ── Сохранить токены в файл ────────────────────────────────────────────────
function saveTokens(tokens) {
    try {
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    } catch (e) {
        console.error('[TokenManager] Ошибка сохранения токенов:', e.message);
    }
}

// ── Обновить access_token через refresh_token ──────────────────────────────
async function refreshAccessToken() {
    const clientId     = process.env.ST_CLIENT_ID;
    const clientSecret = process.env.ST_CLIENT_SECRET;
    const tokens       = loadTokens();

    if (!clientId || !clientSecret) {
        console.warn('[TokenManager] ST_CLIENT_ID / ST_CLIENT_SECRET не заданы. Используется SMARTTHINGS_PAT из .env');
        return;
    }

    if (!tokens?.refresh_token) {
        console.error('[TokenManager] Нет refresh_token! Прочитай README и получи начальные токены.');
        return;
    }

    try {
        console.log('[TokenManager] Обновляю SmartThings токен...');

        const body = new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id:     clientId,
            client_secret: clientSecret,
        });

        const res = await fetch('https://api.smartthings.com/oauth/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    body.toString(),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const data = await res.json();

        const updated = {
            access_token:  data.access_token,
            refresh_token: data.refresh_token || tokens.refresh_token,
            updated_at:    new Date().toISOString(),
        };

        saveTokens(updated);
        _currentToken = updated.access_token;

        console.log('[TokenManager] ✅ Токен обновлён:', updated.updated_at);
    } catch (e) {
        console.error('[TokenManager] ❌ Ошибка обновления токена:', e.message);
    }
}

// ── Получить текущий токен ─────────────────────────────────────────────────
// Порядок приоритета:
//   1. OAuth access_token из st_tokens.json  (если есть ST_CLIENT_ID)
//   2. SMARTTHINGS_PAT из .env               (старый режим — без изменений)
function getCurrentToken() {
    if (_currentToken) return _currentToken;

    // Попробуем загрузить из файла (после рестарта сервера)
    const tokens = loadTokens();
    if (tokens?.access_token) {
        _currentToken = tokens.access_token;
        return _currentToken;
    }

    // Фоллбэк на старый PAT
    return process.env.SMARTTHINGS_PAT || null;
}

// ── Запустить авто-обновление ──────────────────────────────────────────────
function startAutoRefresh() {
    // Если OAuth не настроен — тихо работаем на SMARTTHINGS_PAT
    if (!process.env.ST_CLIENT_ID) {
        console.log('[TokenManager] OAuth не настроен, используется SMARTTHINGS_PAT (истекает через 24ч)');
        return;
    }

    // Загружаем токен из файла при старте
    const tokens = loadTokens();
    if (tokens?.access_token) {
        _currentToken = tokens.access_token;
        console.log('[TokenManager] Токен загружен из файла, обновлён:', tokens.updated_at);
    }

    // Первое обновление при старте
    refreshAccessToken();

    // Потом каждые 20 часов
    setInterval(refreshAccessToken, REFRESH_INTERVAL_MS);

    console.log('[TokenManager] 🔄 Авто-обновление токена запущено (каждые 20ч)');
}

module.exports = { getCurrentToken, startAutoRefresh };
