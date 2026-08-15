// ==========================================
// bridge/smartthings.js
// Клиент SmartThings REST API для виртуальных устройств.
// POST /v1/devices/{deviceId}/events + корректная обработка 429 и просрочки токена.
// ==========================================

const fetch = require('node-fetch');
const config = require('./config-store');

const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 12000;

let authBlockedUntil = 0;
let lastError = null;

function apiUrl() {
    return String(config.get('ST_API_URL') || 'https://api.smartthings.com/v1').replace(/\/+$/, '');
}

function getToken() {
    const token = String(config.get('ST_PAT_TOKEN') || '').trim();
    if (token && !/^<.*>$/.test(token)) return token;

    // Fallback: OAuth-токен из token-manager.js, если он уже настроен в проекте
    try {
        const { getCurrentToken } = require('../token-manager');
        const oauthToken = getCurrentToken && getCurrentToken();
        if (oauthToken) return oauthToken;
    } catch (error) {
        // token-manager может быть недоступен — это не критично
    }
    return '';
}

function isAuthBlocked() {
    return Date.now() < authBlockedUntil;
}

async function stFetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function request(endpoint, options = {}) {
    const token = getToken();
    if (!token) throw new Error('Нет токена SmartThings (ST_PAT_TOKEN). Укажи его в админ-панели или .env');

    if (isAuthBlocked()) {
        const waitSec = Math.ceil((authBlockedUntil - Date.now()) / 1000);
        throw new Error(`SmartThings временно заблокирован после ошибки авторизации. Повтор через ${waitSec} c.`);
    }

    let response = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        response = await stFetch(apiUrl() + endpoint, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                ...(options.headers || {})
            }
        });

        if (response.status === 401 || response.status === 403) {
            // Токен просрочен/отозван — уходим в кулдаун на 15 минут
            authBlockedUntil = Date.now() + 15 * 60 * 1000;
            lastError = `SmartThings ${response.status}: токен недействителен`;
            throw new Error(lastError);
        }

        if (response.status === 429) {
            const retryAfter = Number(response.headers.get('retry-after')) || (attempt + 1) * 2;
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 10) * 1000));
                continue;
            }
            lastError = 'SmartThings 429: превышен лимит запросов';
            throw new Error(lastError);
        }

        if (response.status >= 500 && attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1500));
            continue;
        }

        break;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        lastError = `SmartThings ${response.status}: ${text.slice(0, 200)}`;
        throw new Error(lastError);
    }

    authBlockedUntil = 0;
    lastError = null;
    const raw = await response.text();
    return raw ? JSON.parse(raw) : {};
}

// Отправка событий в виртуальное устройство
// events: [{ capability, attribute, value, unit?, component? }]
async function sendEvents(deviceId, events) {
    if (!deviceId) throw new Error('Не указан deviceId SmartThings');
    const deviceEvents = (events || [])
        .filter((event) => event && event.capability && event.attribute && event.value !== undefined && event.value !== null)
        .map((event) => {
            const payload = {
                component: event.component || 'main',
                capability: event.capability,
                attribute: event.attribute,
                value: event.value
            };
            if (event.unit) payload.unit = event.unit;
            if (event.data) payload.data = event.data;
            return payload;
        });

    if (!deviceEvents.length) return { skipped: true };

    await request(`/devices/${deviceId}/events`, {
        method: 'POST',
        body: JSON.stringify({ deviceEvents })
    });

    return { success: true, count: deviceEvents.length };
}

async function getDevice(deviceId) {
    return request(`/devices/${deviceId}`, { method: 'GET' });
}

async function healthCheck() {
    const startedAt = Date.now();
    try {
        const tempId = config.get('ST_TEMP_DEVICE_ID');
        if (tempId) await getDevice(tempId);
        else await request('/devices?max=1', { method: 'GET' });
        return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, error: error.message };
    }
}

module.exports = {
    sendEvents,
    getDevice,
    request,
    healthCheck,
    isAuthBlocked,
    getLastError: () => lastError
};
