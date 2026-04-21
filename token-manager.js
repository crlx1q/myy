// token-manager.js
// SmartThings OAuth — токены in-memory + Koyeb Secrets (без файлов, без redeploy).
//
// Стратегия персистентности:
//   Токены (ST_ACCESS_TOKEN, ST_REFRESH_TOKEN) → Koyeb Secrets API (PUT /v1/secrets)
//     Обновление секрета НЕ вызывает redeploy. При следующем рестарте сервис читает
//     свежие значения из секретов (env ссылается на них).
//   Client creds (ST_CLIENT_ID, ST_CLIENT_SECRET) → PATCH /v1/services (разовый redeploy
//     при первой настройке через /api/auth/setup).
//
// Env-переменные:
//   ST_CLIENT_ID, ST_CLIENT_SECRET   — OAuth app credentials
//   ST_ACCESS_TOKEN, ST_REFRESH_TOKEN — текущие токены (из секретов Koyeb)
//   KOYEB_API_TOKEN                  — Koyeb API token для управления секретами
//   KOYEB_APP_NAME                   — имя app или service в Koyeb (для поиска сервиса)
//   SMARTTHINGS_PAT                  — fallback если OAuth ещё не настроен

require('dotenv').config();
const https = require('https');

const REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 часов
const ST_SCOPES = [
    'r:devices:*', 'w:devices:*', 'x:devices:*',
    'r:locations:*', 'r:scenes:*', 'x:scenes:*',
    'r:rules:*', 'w:rules:*',
];

let _currentToken = process.env.ST_ACCESS_TOKEN || null;

// ────────────────────────────────────────────────────────────────
// HTTPS helpers
// ────────────────────────────────────────────────────────────────
function httpsRequest({ hostname, path, method, headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const bodyStr = body == null ? null
            : (typeof body === 'string' ? body : JSON.stringify(body));
        const req = https.request({
            hostname,
            path,
            method,
            headers: {
                ...headers,
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end',  () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch {}
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

function stFormPost(path, params, basicAuth) {
    const body = new URLSearchParams(params).toString();
    return httpsRequest({
        hostname: 'api.smartthings.com',
        path,
        method: 'POST',
        headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(basicAuth).toString('base64'),
        },
        body,
    });
}

function koyebRequest(method, path, body, token) {
    return httpsRequest({
        hostname: 'app.koyeb.com',
        path,
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept':        'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
    });
}

// ────────────────────────────────────────────────────────────────
// Koyeb Secrets: создать/обновить секрет (НЕ вызывает redeploy)
// ────────────────────────────────────────────────────────────────
async function upsertKoyebSecret(secretName, secretValue) {
    const koyebToken = process.env.KOYEB_API_TOKEN;
    if (!koyebToken) return;

    // Ищем секрет по имени
    const listRes = await koyebRequest('GET', `/v1/secrets?name=${encodeURIComponent(secretName)}&limit=100`, null, koyebToken);
    const existing = listRes?.body?.secrets?.find(s => s.name === secretName);

    if (existing) {
        // Обновляем значение
        const putRes = await koyebRequest('PUT', `/v1/secrets/${existing.id}`, {
            name: secretName,
            type: 'SIMPLE',
            value: secretValue,
        }, koyebToken);
        if (putRes.status >= 400) {
            throw new Error(`PUT secret "${secretName}" failed ${putRes.status}: ${JSON.stringify(putRes.body)}`);
        }
    } else {
        // Создаём новый
        const postRes = await koyebRequest('POST', '/v1/secrets', {
            name: secretName,
            type: 'SIMPLE',
            value: secretValue,
        }, koyebToken);
        if (postRes.status >= 400) {
            throw new Error(`POST secret "${secretName}" failed ${postRes.status}: ${JSON.stringify(postRes.body)}`);
        }
    }
}

// Обновить токены через Koyeb Secrets (без redeploy!)
async function saveTokensToKoyebSecrets(accessToken, refreshToken) {
    const koyebToken = process.env.KOYEB_API_TOKEN;
    if (!koyebToken) {
        console.warn('[TokenManager] ⚠️  KOYEB_API_TOKEN не задан — токены не переживут рестарт');
        return;
    }

    try {
        await upsertKoyebSecret('st-access-token', accessToken);
        await upsertKoyebSecret('st-refresh-token', refreshToken);
        console.log('[TokenManager] ✅ Koyeb secrets обновлены (без redeploy)');
    } catch (e) {
        console.error('[TokenManager] ❌ Koyeb secrets error:', e.message);
    }
}

// ────────────────────────────────────────────────────────────────
// Koyeb Service: обновить env definition (ВЫЗЫВАЕТ redeploy — только для разовых ops)
// ────────────────────────────────────────────────────────────────
async function findKoyebService(koyebToken, koyebApp) {
    let service = null;

    // Попытка 1: по имени app
    const appsRes = await koyebRequest('GET', `/v1/apps?name=${encodeURIComponent(koyebApp)}`, null, koyebToken);
    const app = appsRes?.body?.apps?.find(a => a.name === koyebApp) || appsRes?.body?.apps?.[0];
    if (app?.id) {
        const svcRes = await koyebRequest('GET', `/v1/services?app_id=${app.id}`, null, koyebToken);
        service = svcRes?.body?.services?.[0];
    }

    // Попытка 2: по имени service
    if (!service) {
        const allSvc = await koyebRequest('GET', `/v1/services?name=${encodeURIComponent(koyebApp)}`, null, koyebToken);
        service = allSvc?.body?.services?.find(s => s.name === koyebApp) || allSvc?.body?.services?.[0];
    }

    // Попытка 3: первый service
    if (!service) {
        const allSvc = await koyebRequest('GET', '/v1/services?limit=5', null, koyebToken);
        service = allSvc?.body?.services?.[0];
        if (service) console.log(`[TokenManager] ℹ️  Fallback на service: "${service.name}" (id: ${service.id})`);
    }

    return service;
}

async function updateKoyebServiceEnv(updates) {
    const koyebToken = process.env.KOYEB_API_TOKEN;
    const koyebApp   = process.env.KOYEB_APP_NAME;
    if (!koyebToken || !koyebApp) {
        console.warn('[TokenManager] ⚠️  KOYEB_API_TOKEN / KOYEB_APP_NAME не заданы');
        return;
    }

    try {
        const service = await findKoyebService(koyebToken, koyebApp);
        if (!service?.id) throw new Error(`Service не найден. Проверь KOYEB_APP_NAME="${koyebApp}".`);

        const deployId = service.latest_deployment_id || service.active_deployment_id;
        if (!deployId) throw new Error('У сервиса нет latest_deployment_id');

        const depRes = await koyebRequest('GET', `/v1/deployments/${deployId}`, null, koyebToken);
        const definition = depRes?.body?.deployment?.definition;
        if (!definition) throw new Error('Не получили definition');

        // Мержим env
        definition.env = mergeEnv(definition.env || [], updates);

        const patchRes = await koyebRequest('PATCH', `/v1/services/${service.id}`, { definition }, koyebToken);
        if (patchRes.status >= 400) {
            throw new Error(`PATCH ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
        }

        console.log(`[TokenManager] ✅ Koyeb service env обновлён (${Object.keys(updates).join(', ')}) — будет redeploy`);
    } catch (e) {
        console.error('[TokenManager] ❌ Koyeb service update error:', e.message);
    }
}

function mergeEnv(currentEnv, updates) {
    const result = currentEnv.map(e => ({ ...e }));
    for (const [key, value] of Object.entries(updates)) {
        const idx = result.findIndex(e => e.key === key);
        if (typeof value === 'object' && value.secret) {
            // Ссылка на секрет: { key, secret: "secret-name" }
            const entry = { key, secret: value.secret };
            if (idx !== -1) { result[idx] = entry; } else { result.push(entry); }
        } else {
            // Обычное значение
            const entry = { key, value: String(value) };
            if (idx !== -1) {
                result[idx] = { ...result[idx], ...entry };
                delete result[idx].secret;
            } else {
                result.push(entry);
            }
        }
    }
    return result;
}

// ────────────────────────────────────────────────────────────────
// Первоначальная настройка: привязать env vars к секретам (1 раз)
// ────────────────────────────────────────────────────────────────
async function setupTokenSecretsOnKoyeb(accessToken, refreshToken) {
    const koyebToken = process.env.KOYEB_API_TOKEN;
    if (!koyebToken) return;

    // 1. Создать/обновить секреты
    await upsertKoyebSecret('st-access-token', accessToken);
    await upsertKoyebSecret('st-refresh-token', refreshToken);

    // 2. Обновить service definition: env ссылается на секреты (redeploy — один раз)
    await updateKoyebServiceEnv({
        ST_ACCESS_TOKEN:  { secret: 'st-access-token' },
        ST_REFRESH_TOKEN: { secret: 'st-refresh-token' },
    });
}

// ────────────────────────────────────────────────────────────────
// SmartThings: refresh access token (каждые 20ч)
// ────────────────────────────────────────────────────────────────
async function refreshAccessToken() {
    const clientId     = process.env.ST_CLIENT_ID;
    const clientSecret = process.env.ST_CLIENT_SECRET;
    const refreshToken = process.env.ST_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        console.warn('[TokenManager] ⚠️  OAuth не полностью настроен — refresh пропущен.');
        return;
    }

    console.log('[TokenManager] 🔄 Refresh access token...');

    try {
        const res = await stFormPost('/oauth/token', {
            grant_type:    'refresh_token',
            refresh_token: refreshToken,
            client_id:     clientId,
            client_secret: clientSecret,
        }, `${clientId}:${clientSecret}`);

        if (res.status !== 200 || !res.body.access_token) {
            console.error('[TokenManager] ❌ Refresh отклонён:', JSON.stringify(res.body));
            return;
        }

        const newAccess  = res.body.access_token;
        const newRefresh = res.body.refresh_token || refreshToken;

        _currentToken = newAccess;
        process.env.ST_ACCESS_TOKEN  = newAccess;
        process.env.ST_REFRESH_TOKEN = newRefresh;

        console.log('[TokenManager] ✅ Токен обновлён:', new Date().toISOString());

        // Сохраняем в Koyeb Secrets — БЕЗ redeploy!
        await saveTokensToKoyebSecrets(newAccess, newRefresh);
    } catch (e) {
        console.error('[TokenManager] ❌ Refresh error:', e.message);
    }
}

// ────────────────────────────────────────────────────────────────
// SmartThings: обмен code → tokens (первичная авторизация)
// ────────────────────────────────────────────────────────────────
async function exchangeCodeAndSave(code, clientId, clientSecret, redirectUri) {
    clientId     = clientId     || process.env.ST_CLIENT_ID;
    clientSecret = clientSecret || process.env.ST_CLIENT_SECRET;

    if (!code)         throw new Error('code обязателен');
    if (!clientId)     throw new Error('clientId не задан (env ST_CLIENT_ID пуст)');
    if (!clientSecret) throw new Error('clientSecret не задан (env ST_CLIENT_SECRET пуст)');

    const params = {
        grant_type:    'authorization_code',
        code,
        client_id:     clientId,
        client_secret: clientSecret,
    };
    if (redirectUri) params.redirect_uri = redirectUri;

    const res = await stFormPost('/oauth/token', params, `${clientId}:${clientSecret}`);
    if (res.status !== 200 || !res.body.access_token) {
        throw new Error('SmartThings отклонил code: ' + JSON.stringify(res.body));
    }

    const newAccess  = res.body.access_token;
    const newRefresh = res.body.refresh_token;

    _currentToken = newAccess;
    process.env.ST_ACCESS_TOKEN  = newAccess;
    process.env.ST_REFRESH_TOKEN = newRefresh;
    process.env.ST_CLIENT_ID     = clientId;
    process.env.ST_CLIENT_SECRET = clientSecret;

    console.log('[TokenManager] ✅ Code обменян на токены');

    // Первичная настройка: создать секреты + привязать env к ним (1 redeploy)
    await setupTokenSecretsOnKoyeb(newAccess, newRefresh);

    return { access_token: newAccess, refresh_token: newRefresh };
}

// ────────────────────────────────────────────────────────────────
// SmartThings: создать OAuth-приложение (через PAT, разовая операция)
// ────────────────────────────────────────────────────────────────
async function createOAuthApp(pat, { appName, redirectUri } = {}) {
    if (!pat)         throw new Error('PAT обязателен');
    if (!redirectUri) throw new Error('redirectUri обязателен');

    const body = {
        appName:         (appName || `smart-home-${Date.now()}`).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        displayName:     'Smart Home',
        description:     'Умный дом',
        appType:         'API_ONLY',
        classifications: ['AUTOMATION'],
        apiOnly:         {},
        oauth: {
            clientName:   'smart-home',
            scope:        ST_SCOPES,
            redirectUris: [redirectUri],
        },
    };

    const res = await httpsRequest({
        hostname: 'api.smartthings.com',
        path:     '/v1/apps',
        method:   'POST',
        headers:  {
            'Authorization': `Bearer ${pat}`,
            'Content-Type':  'application/json',
        },
        body,
    });

    if (res.status !== 200 && res.status !== 201) {
        throw new Error(`SmartThings API ${res.status}: ${JSON.stringify(res.body)}`);
    }

    const clientId     = res.body?.oauthClientId     || res.body?.app?.oauthClientId;
    const clientSecret = res.body?.oauthClientSecret || res.body?.app?.oauthClientSecret;
    if (!clientId || !clientSecret) {
        throw new Error('Не получили clientId/clientSecret: ' + JSON.stringify(res.body));
    }

    process.env.ST_CLIENT_ID     = clientId;
    process.env.ST_CLIENT_SECRET = clientSecret;

    // Client creds — в service env (вызовет 1 redeploy, это нормально)
    await updateKoyebServiceEnv({
        ST_CLIENT_ID:     clientId,
        ST_CLIENT_SECRET: clientSecret,
    });

    return { clientId, clientSecret, scopes: ST_SCOPES, redirectUri };
}

// ────────────────────────────────────────────────────────────────
// Публичный API
// ────────────────────────────────────────────────────────────────
function getCurrentToken() {
    return _currentToken || process.env.ST_ACCESS_TOKEN || process.env.SMARTTHINGS_PAT || null;
}

function startAutoRefresh() {
    if (!process.env.ST_CLIENT_ID || !process.env.ST_REFRESH_TOKEN) {
        console.warn('[TokenManager] ⚠️  OAuth не настроен — авто-refresh отключён. Открой /api/auth/setup.');
        return;
    }
    console.log('[TokenManager] 🏠 Авто-refresh каждые 20ч');
    refreshAccessToken();
    setInterval(refreshAccessToken, REFRESH_INTERVAL_MS);
}

module.exports = {
    getCurrentToken,
    startAutoRefresh,
    exchangeCodeAndSave,
    createOAuthApp,
    ST_SCOPES,
};
