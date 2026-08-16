// ==========================================
// Клиент Tuya OpenAPI (подпись HMAC-SHA256 + авто access_token)
// ==========================================
const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('./config');

const REQUEST_TIMEOUT_MS = 12000;
const TOKEN_SAFETY_WINDOW_MS = 60 * 1000;
const RETRY_TOKEN_CODES = [1010, 1011, 1012, 1013];

let tokenState = { accessToken: null, refreshToken: null, expiresAt: 0, uid: null };
let tokenPromise = null;
let lastError = null;

function sha256(text) {
    return crypto.createHash('sha256').update(text || '', 'utf8').digest('hex');
}

function hmac(text, secret) {
    return crypto.createHmac('sha256', secret).update(text, 'utf8').digest('hex').toUpperCase();
}

function buildStringToSign(method, urlWithQuery, body) {
    const bodyHash = sha256(body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '');
    return `${method.toUpperCase()}\n${bodyHash}\n\n${urlWithQuery}`;
}

async function rawRequest(method, urlWithQuery, { body = null, withToken = true } = {}) {
    const clientId = config.get('TUYA_CLIENT_ID');
    const secret = config.get('TUYA_CLIENT_SECRET');
    const endpoint = config.get('TUYA_ENDPOINT').replace(/\/$/, '');

    if (!clientId || !secret) {
        throw new Error('Не заданы TUYA_CLIENT_ID / TUYA_CLIENT_SECRET');
    }

    const timestamp = Date.now().toString();
    const bodyString = body ? JSON.stringify(body) : '';
    const stringToSign = buildStringToSign(method, urlWithQuery, bodyString);
    const accessToken = withToken ? (await getAccessToken()) : '';
    const signSource = clientId + (withToken ? accessToken : '') + timestamp + stringToSign;

    const headers = {
        client_id: clientId,
        sign: hmac(signSource, secret),
        t: timestamp,
        sign_method: 'HMAC-SHA256',
        'Content-Type': 'application/json'
    };
    if (withToken) headers.access_token = accessToken;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(endpoint + urlWithQuery, {
            method: method.toUpperCase(),
            headers,
            body: bodyString || undefined,
            signal: controller.signal
        });
        const json = await response.json().catch(() => ({}));
        return json;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchToken() {
    const json = await rawRequest('GET', '/v1.0/token?grant_type=1', { withToken: false });
    if (!json || json.success !== true || !json.result) {
        const message = json && (json.msg || json.message) ? `${json.msg || json.message} (code ${json.code})` : 'неизвестная ошибка';
        throw new Error(`Tuya: не удалось получить access_token — ${message}`);
    }
    const result = json.result;
    tokenState = {
        accessToken: result.access_token,
        refreshToken: result.refresh_token,
        expiresAt: Date.now() + (Number(result.expire_time || 7200) * 1000) - TOKEN_SAFETY_WINDOW_MS,
        uid: result.uid || tokenState.uid
    };
    return tokenState.accessToken;
}

async function getAccessToken(force = false) {
    if (!force && tokenState.accessToken && Date.now() < tokenState.expiresAt) {
        return tokenState.accessToken;
    }
    if (!tokenPromise) {
        tokenPromise = fetchToken().finally(() => { tokenPromise = null; });
    }
    return tokenPromise;
}

function invalidateToken() {
    tokenState.accessToken = null;
    tokenState.expiresAt = 0;
}

// Основной вызов: возвращает result Tuya, при протухшем токене повторяет один раз
async function request(method, urlWithQuery, body = null) {
    let json = await rawRequest(method, urlWithQuery, { body });

    if (json && json.success !== true && RETRY_TOKEN_CODES.includes(Number(json.code))) {
        invalidateToken();
        await getAccessToken(true);
        json = await rawRequest(method, urlWithQuery, { body });
    }

    if (!json || json.success !== true) {
        const code = json ? json.code : 'no-response';
        const message = json ? (json.msg || json.message || '') : 'нет ответа';
        lastError = `Tuya API ${method} ${urlWithQuery} → code ${code}: ${message}`;
        const error = new Error(lastError);
        error.tuyaCode = code;
        throw error;
    }

    lastError = null;
    return json.result;
}

// ---------- Конкретные методы ----------

async function getDeviceInfo(deviceId) {
    return request('GET', `/v1.0/devices/${deviceId}`);
}

async function getDeviceStatus(deviceId) {
    return request('GET', `/v1.0/devices/${deviceId}/status`);
}

async function getDeviceFunctions(deviceId) {
    return request('GET', `/v1.0/devices/${deviceId}/functions`);
}

async function sendCommands(deviceId, commands) {
    return request('POST', `/v1.0/devices/${deviceId}/commands`, { commands });
}

// Список устройств: сначала по UID аккаунта, иначе — все связанные с проектом
async function listDevices() {
    const uid = config.get('TUYA_UID');

    if (uid) {
        try {
            const result = await request('GET', `/v1.0/users/${uid}/devices`);
            if (Array.isArray(result) && result.length) return result;
        } catch (error) {
            console.error('[tuya] Список по UID не получился:', error.message);
        }
    }

    // Все устройства привязанных к проекту аккаунтов (постранично)
    const devices = [];
    let lastRowKey = '';
    for (let page = 0; page < 10; page += 1) {
        const query = `/v1.0/iot-01/associated-users/devices?size=100${lastRowKey ? `&last_row_key=${encodeURIComponent(lastRowKey)}` : ''}`;
        const result = await request('GET', query);
        const items = (result && (result.devices || result.list)) || [];
        devices.push(...items);
        if (!result || !result.has_more || !result.last_row_key) break;
        lastRowKey = result.last_row_key;
    }
    return devices;
}

async function healthCheck() {
    const started = Date.now();
    try {
        await getAccessToken(true);
        const devices = await listDevices().catch(() => []);
        return {
            ok: true,
            uid: tokenState.uid || null,
            devices: devices.length,
            tookMs: Date.now() - started
        };
    } catch (error) {
        return { ok: false, error: error.message, tookMs: Date.now() - started };
    }
}

function status() {
    return {
        endpoint: config.get('TUYA_ENDPOINT'),
        clientId: config.get('TUYA_CLIENT_ID'),
        hasToken: !!tokenState.accessToken,
        tokenExpiresAt: tokenState.expiresAt ? new Date(tokenState.expiresAt).toISOString() : null,
        uid: tokenState.uid || config.get('TUYA_UID') || null,
        lastError
    };
}

module.exports = {
    request,
    getAccessToken,
    invalidateToken,
    getDeviceInfo,
    getDeviceStatus,
    getDeviceFunctions,
    sendCommands,
    listDevices,
    healthCheck,
    status
};
