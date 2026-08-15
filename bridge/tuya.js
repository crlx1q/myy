// ==========================================
// bridge/tuya.js
// Клиент Tuya OpenAPI: подпись HMAC-SHA256, авто-обновление access_token,
// чтение статуса устройств и отправка команд.
// ==========================================

const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('./config-store');

const EMPTY_BODY_HASH = crypto.createHash('sha256').update('').digest('hex');
const REQUEST_TIMEOUT_MS = 12000;

let tokenCache = {
    accessToken: null,
    refreshToken: null,
    expiresAt: 0,
    fingerprint: ''
};

function endpoint() {
    return String(config.get('TUYA_ENDPOINT') || '').replace(/\/+$/, '');
}

function sha256(body) {
    if (!body) return EMPTY_BODY_HASH;
    return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

// str_to_sign = METHOD \n Content-SHA256 \n Headers \n URL
function buildStringToSign(method, urlPath, body) {
    return [String(method).toUpperCase(), sha256(body), '', urlPath].join('\n');
}

function sign(str) {
    const secret = config.get('TUYA_CLIENT_SECRET');
    return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
}

async function tuyaFetch(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function assertConfigured() {
    if (!config.get('TUYA_CLIENT_ID') || !config.get('TUYA_CLIENT_SECRET') || !endpoint()) {
        throw new Error('Tuya не настроена: заполни TUYA_CLIENT_ID / TUYA_CLIENT_SECRET / TUYA_ENDPOINT');
    }
}

// ---------- access_token ----------
async function requestToken(pathWithQuery) {
    assertConfigured();
    const t = Date.now().toString();
    const clientId = config.get('TUYA_CLIENT_ID');
    const stringToSign = buildStringToSign('GET', pathWithQuery, '');
    const signature = sign(clientId + t + stringToSign);

    const response = await tuyaFetch(endpoint() + pathWithQuery, {
        method: 'GET',
        headers: {
            client_id: clientId,
            sign: signature,
            t,
            sign_method: 'HMAC-SHA256'
        }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
        const message = data.msg || data.errorMsg || `HTTP ${response.status}`;
        throw new Error(`Tuya token error: ${message}${data.code ? ` (code ${data.code})` : ''}`);
    }
    return data.result || {};
}

function cacheToken(result) {
    const expireSeconds = Number(result.expire_time || result.expire || 7200);
    tokenCache = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token || null,
        expiresAt: Date.now() + Math.max(60, expireSeconds - 60) * 1000,
        fingerprint: config.credentialsFingerprint()
    };
    return tokenCache.accessToken;
}

async function getAccessToken({ force = false } = {}) {
    const fingerprint = config.credentialsFingerprint();
    if (fingerprint !== tokenCache.fingerprint) {
        tokenCache = { accessToken: null, refreshToken: null, expiresAt: 0, fingerprint };
    }

    if (!force && tokenCache.accessToken && Date.now() < tokenCache.expiresAt) {
        return tokenCache.accessToken;
    }

    if (!force && tokenCache.refreshToken) {
        try {
            const refreshed = await requestToken(`/v1.0/token/${tokenCache.refreshToken}`);
            if (refreshed.access_token) return cacheToken(refreshed);
        } catch (error) {
            console.warn('[tuya] refresh_token не сработал, получаю новый token:', error.message);
        }
    }

    const result = await requestToken('/v1.0/token?grant_type=1');
    if (!result.access_token) throw new Error('Tuya не вернула access_token');
    return cacheToken(result);
}

function invalidateToken() {
    tokenCache = { accessToken: null, refreshToken: null, expiresAt: 0, fingerprint: '' };
}

// ---------- Бизнес-запросы ----------
async function request(method, pathWithQuery, body = null, { retryOnAuthError = true } = {}) {
    assertConfigured();
    const accessToken = await getAccessToken();
    const t = Date.now().toString();
    const clientId = config.get('TUYA_CLIENT_ID');
    const payload = body ? JSON.stringify(body) : '';
    const stringToSign = buildStringToSign(method, pathWithQuery, payload);
    const signature = sign(clientId + accessToken + t + stringToSign);

    const response = await tuyaFetch(endpoint() + pathWithQuery, {
        method: String(method).toUpperCase(),
        headers: {
            client_id: clientId,
            access_token: accessToken,
            sign: signature,
            t,
            sign_method: 'HMAC-SHA256',
            'Content-Type': 'application/json'
        },
        body: payload || undefined
    });

    const data = await response.json().catch(() => ({}));

    const authErrorCodes = [1010, 1011, 1012, 1013];
    if (!data.success && authErrorCodes.includes(Number(data.code)) && retryOnAuthError) {
        invalidateToken();
        await getAccessToken({ force: true });
        return request(method, pathWithQuery, body, { retryOnAuthError: false });
    }

    if (!response.ok || !data.success) {
        const message = data.msg || data.errorMsg || `HTTP ${response.status}`;
        const error = new Error(`Tuya API: ${message}${data.code ? ` (code ${data.code})` : ''}`);
        error.code = data.code;
        throw error;
    }

    return data.result;
}

// GET /v1.0/devices/{device_id}/status -> { code: value }
async function getDeviceStatus(deviceId) {
    if (!deviceId) throw new Error('Не указан deviceId Tuya');
    const result = await request('GET', `/v1.0/devices/${deviceId}/status`);
    const status = {};
    (Array.isArray(result) ? result : []).forEach((item) => {
        if (item && item.code !== undefined) status[item.code] = item.value;
    });
    return status;
}

async function getDeviceInfo(deviceId) {
    if (!deviceId) throw new Error('Не указан deviceId Tuya');
    return request('GET', `/v1.0/devices/${deviceId}`);
}

// POST /v1.0/devices/{device_id}/commands
async function sendCommands(deviceId, commands) {
    if (!deviceId) throw new Error('Не указан deviceId Tuya');
    if (!Array.isArray(commands) || !commands.length) throw new Error('Пустой список команд Tuya');
    return request('POST', `/v1.0/devices/${deviceId}/commands`, { commands });
}

async function healthCheck() {
    const startedAt = Date.now();
    try {
        await getAccessToken({ force: true });
        return { ok: true, latencyMs: Date.now() - startedAt, endpoint: endpoint() };
    } catch (error) {
        return { ok: false, latencyMs: Date.now() - startedAt, endpoint: endpoint(), error: error.message };
    }
}

module.exports = {
    getAccessToken,
    invalidateToken,
    request,
    getDeviceStatus,
    getDeviceInfo,
    sendCommands,
    healthCheck
};
