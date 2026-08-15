// ==========================================
// bridge/smartthings.js
// Клиент SmartThings REST API для виртуальных устройств.
//
// ВАЖНО про эндпоинт событий:
//   POST /v1/devices/{id}/events работает только для устройств, созданных
//   самим текущим SmartApp/API_ONLY-приложением. Для виртуальных устройств,
//   созданных через Virtual Device Creator / CLI, нужен другой адрес:
//   POST /virtualdevices/{id}/events  — иначе ПОСТОЯННО приходит 403 Forbidden.
// Поэтому сначала пробуем /virtualdevices, при 403/404 — fallback на /v1/devices.
// ==========================================

const fetch = require('node-fetch');
const config = require('./config-store');

const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 12000;

let authBlockedUntil = 0;
let lastError = null;
let tokenSource = 'none';

// Запоминаем, какой эндпоинт сработал для конкретного устройства
const eventRouteCache = new Map(); // deviceId -> 'virtual' | 'device'

function apiRoot() {
    const configured = String(config.get('ST_API_URL') || 'https://api.smartthings.com/v1').replace(/\/+$/, '');
    return configured.replace(/\/v1$/, '');
}

function apiUrl() {
    return apiRoot() + '/v1';
}

function getToken() {
    const token = String(config.get('ST_PAT_TOKEN') || '').trim();
    if (token && !/^<.*>$/.test(token)) {
        tokenSource = 'pat';
        return token;
    }

    // Fallback: OAuth-токен из token-manager.js (он сам обновляется каждые ~24 ч)
    try {
        const { getCurrentToken } = require('../token-manager');
        const oauthToken = getCurrentToken && getCurrentToken();
        if (oauthToken) {
            tokenSource = 'oauth';
            return oauthToken;
        }
    } catch (error) {
        // token-manager может быть недоступен — это не критично
    }

    tokenSource = 'none';
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

// Основной запрос с ретраями.
// meta.softForbidden = true — 403 не считаем проблемой токена (может быть просто не тот эндпоинт)
async function rawRequest(url, options = {}, meta = {}) {
    const token = getToken();
    if (!token) {
        throw new Error('Нет токена SmartThings: укажи ST_PAT_TOKEN в админ-панели/.env или настрой OAuth в token-manager');
    }

    if (isAuthBlocked()) {
        const waitSec = Math.ceil((authBlockedUntil - Date.now()) / 1000);
        throw new Error(`SmartThings временно заблокирован после ошибки авторизации. Повтор через ${waitSec} с.`);
    }

    let response = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        response = await stFetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...(options.headers || {})
            }
        });

        if (response.status === 401) {
            authBlockedUntil = Date.now() + 15 * 60 * 1000;
            lastError = 'SmartThings 401: токен недействителен или просрочен (PAT живёт 24 ч)';
            const authError = new Error(lastError);
            authError.status = 401;
            throw authError;
        }

        if (response.status === 403) {
            const text = await response.text().catch(() => '');
            const forbidden = new Error(`SmartThings 403: ${text.slice(0, 200) || 'Forbidden'}`);
            forbidden.status = 403;
            if (!meta.softForbidden) {
                authBlockedUntil = Date.now() + 15 * 60 * 1000;
                lastError = forbidden.message;
            }
            throw forbidden;
        }

        if (response.status === 429) {
            const retryAfter = Number(response.headers.get('retry-after')) || (attempt + 1) * 2;
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 10) * 1000));
                continue;
            }
            lastError = 'SmartThings 429: превышен лимит запросов';
            const rateError = new Error(lastError);
            rateError.status = 429;
            throw rateError;
        }

        if (response.status >= 500 && attempt < MAX_RETRIES) {
            await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1500));
            continue;
        }

        break;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(`SmartThings ${response.status}: ${text.slice(0, 200)}`);
        error.status = response.status;
        if (!meta.softForbidden) lastError = error.message;
        throw error;
    }

    authBlockedUntil = 0;
    lastError = null;
    const raw = await response.text();
    return raw ? JSON.parse(raw) : {};
}

function request(endpoint, options = {}) {
    return rawRequest(apiUrl() + endpoint, options);
}

// ---------- Отправка событий ----------
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

    const body = JSON.stringify({ deviceEvents });
    const routes = {
        virtual: `${apiRoot()}/virtualdevices/${deviceId}/events`,
        device: `${apiUrl()}/devices/${deviceId}/events`
    };

    const cached = eventRouteCache.get(deviceId);
    const order = cached ? [cached, cached === 'virtual' ? 'device' : 'virtual'] : ['virtual', 'device'];

    let lastRouteError = null;
    for (const route of order) {
        try {
            await rawRequest(routes[route], { method: 'POST', body }, { softForbidden: true });
            eventRouteCache.set(deviceId, route);
            return { success: true, count: deviceEvents.length, route };
        } catch (error) {
            lastRouteError = error;
            // Пробуем следующий эндпоинт только для "не тот адрес/не тот тип устройства"
            if (![403, 404, 422].includes(error.status)) break;
        }
    }

    eventRouteCache.delete(deviceId);
    lastError = lastRouteError ? lastRouteError.message : 'Не удалось отправить событие в SmartThings';

    if (lastRouteError && lastRouteError.status === 403) {
        throw new Error(
            '403 от SmartThings на обоих эндпоинтах. Это значит, что устройство ' +
            `${deviceId} не является Virtual Device, созданным через Virtual Device Creator / SmartThings CLI, ` +
            'либо токену не хватает прав x:devices:*. Подробнее в BRIDGE.md.'
        );
    }

    throw lastRouteError || new Error(lastError);
}

async function getDevice(deviceId) {
    return request(`/devices/${deviceId}`, { method: 'GET' });
}

// Состояние устройства (нужно для обратной синхронизации SmartThings -> Tuya)
async function getDeviceStatus(deviceId) {
    if (!deviceId) throw new Error('Не указан deviceId SmartThings');
    return request(`/devices/${deviceId}/status`, { method: 'GET' });
}

async function healthCheck() {
    const startedAt = Date.now();
    try {
        const tempId = config.get('ST_TEMP_DEVICE_ID');
        if (tempId) await getDevice(tempId);
        else await request('/devices?max=1', { method: 'GET' });
        return { ok: true, latencyMs: Date.now() - startedAt, tokenSource };
    } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, tokenSource, error: error.message };
    }
}

// Диагностика: проверяем каждое виртуальное устройство по отдельности
async function diagnose() {
    const ids = {
        temperature: config.get('ST_TEMP_DEVICE_ID'),
        led: config.get('ST_LED_DEVICE_ID'),
        doorbell: config.get('ST_DOORBELL_DEVICE_ID')
    };

    const result = { tokenSource, authBlocked: isAuthBlocked(), devices: {} };

    for (const [name, deviceId] of Object.entries(ids)) {
        if (!deviceId) {
            result.devices[name] = { ok: false, error: 'ID не задан' };
            continue;
        }
        try {
            const device = await getDevice(deviceId);
            result.devices[name] = {
                ok: true,
                deviceId,
                label: device.label || device.name || null,
                // только у Virtual Device есть этот блок — по нему понятно, примет ли оно события
                isVirtual: Boolean(device.virtualDevice || device.type === 'VIRTUAL'),
                type: device.type || null,
                eventRoute: eventRouteCache.get(deviceId) || null
            };
        } catch (error) {
            result.devices[name] = { ok: false, deviceId, error: error.message };
        }
    }

    return result;
}

module.exports = {
    sendEvents,
    getDevice,
    getDeviceStatus,
    request,
    healthCheck,
    diagnose,
    isAuthBlocked,
    getTokenSource: () => tokenSource,
    getLastError: () => lastError
};
