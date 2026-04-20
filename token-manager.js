// token-manager.js — работает с Koyeb (env vars, без файлов)
require('dotenv').config();
const https = require('https');

const REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 часов
let _currentToken = process.env.ST_ACCESS_TOKEN || null;

// ── Обновить токен через refresh_token ────────────────────────
async function refreshAccessToken() {
    const clientId     = process.env.ST_CLIENT_ID;
    const clientSecret = process.env.ST_CLIENT_SECRET;
    const refreshToken = process.env.ST_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        console.error('[TokenManager] ❌ Нет ST_CLIENT_ID / ST_CLIENT_SECRET / ST_REFRESH_TOKEN в env');
        return;
    }

    console.log('[TokenManager] 🔄 Обновляю токен...');

    try {
        const bodyStr = new URLSearchParams({
            grant_type:    'refresh_token',
            refresh_token: refreshToken,
            client_id:     clientId,
            client_secret: clientSecret,
        }).toString();

        const data = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.smartthings.com',
                path:     '/oauth/token',
                method:   'POST',
                headers:  {
                    'Content-Type':   'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(bodyStr),
                    'Authorization':  'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
                },
            }, res => {
                let d = '';
                res.on('data', c => d += c);
                res.on('end',  () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
            });
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });

        if (data.status !== 200 || !data.body.access_token) {
            console.error('[TokenManager] ❌ Ошибка обновления:', JSON.stringify(data.body));
            return;
        }

        const newAccess  = data.body.access_token;
        const newRefresh = data.body.refresh_token || refreshToken;

        // Обновляем в памяти
        _currentToken = newAccess;
        process.env.ST_ACCESS_TOKEN  = newAccess;
        process.env.ST_REFRESH_TOKEN = newRefresh;

        console.log('[TokenManager] ✅ Токен обновлён:', new Date().toISOString());

        // Сохраняем в Koyeb чтобы пережить рестарт
        await updateKoyebEnv(newAccess, newRefresh);

    } catch (e) {
        console.error('[TokenManager] ❌ Исключение:', e.message);
    }
}

// ── Обновить env vars в Koyeb через API ───────────────────────
async function updateKoyebEnv(accessToken, refreshToken) {
    const koyebToken  = process.env.KOYEB_API_TOKEN;
    const koyebApp    = process.env.KOYEB_APP_NAME;

    if (!koyebToken || !koyebApp) {
        console.warn('[TokenManager] ⚠️  KOYEB_API_TOKEN / KOYEB_APP_NAME не заданы — токен не сохранится после рестарта');
        return;
    }

    try {
        // 1. Получить список сервисов приложения
        const services = await koyebRequest('GET', `/v1/services?app_name=${koyebApp}`, null, koyebToken);
        const service  = services?.services?.[0];
        if (!service) {
            console.error('[TokenManager] ❌ Сервис Koyeb не найден для app:', koyebApp);
            return;
        }

        // 2. Получить текущий definition сервиса
        const svcDetail = await koyebRequest('GET', `/v1/services/${service.id}`, null, koyebToken);
        const definition = svcDetail?.service?.latest_deployment_id
            ? svcDetail.service
            : service;

        // 3. Обновить только нужные env vars
        const currentEnv = definition?.latest_provisioning_config?.env || [];

        const updatedEnv = mergeEnv(currentEnv, {
            ST_ACCESS_TOKEN:  accessToken,
            ST_REFRESH_TOKEN: refreshToken,
        });

        await koyebRequest('PATCH', `/v1/services/${service.id}`, {
            definition: {
                env: updatedEnv,
            },
        }, koyebToken);

        console.log('[TokenManager] ✅ Koyeb env обновлён');
    } catch (e) {
        console.error('[TokenManager] ❌ Ошибка обновления Koyeb env:', e.message);
    }
}

function mergeEnv(currentEnv, updates) {
    const result = [...currentEnv];
    for (const [key, value] of Object.entries(updates)) {
        const idx = result.findIndex(e => e.key === key);
        if (idx !== -1) {
            result[idx] = { key, value };
        } else {
            result.push({ key, value });
        }
    }
    return result;
}

function koyebRequest(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const bodyStr = body ? JSON.stringify(body) : null;
        const req = https.request({
            hostname: 'app.koyeb.com',
            path,
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'application/json',
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end',  () => {
                try { resolve(JSON.parse(d)); }
                catch { resolve(d); }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ── Получить текущий токен ────────────────────────────────────
function getCurrentToken() {
    return _currentToken || process.env.ST_ACCESS_TOKEN || process.env.SMARTTHINGS_PAT || null;
}

// ── Запустить авто-обновление ─────────────────────────────────
function startAutoRefresh() {
    if (!process.env.ST_CLIENT_ID) {
        console.warn('[TokenManager] ⚠️  ST_CLIENT_ID не задан, авто-обновление отключено');
        return;
    }

    console.log('[TokenManager] 🏠 Авто-обновление токена запущено (каждые 20ч)');

    // Обновляем сразу при старте
    refreshAccessToken();

    // Потом каждые 20 часов
    setInterval(refreshAccessToken, REFRESH_INTERVAL_MS);
}

module.exports = { getCurrentToken, startAutoRefresh };
