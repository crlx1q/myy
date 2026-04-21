// token-manager.js
// SmartThings OAuth токены хранятся in-memory + персистентно в Koyeb env (без файлов).
//
// Ожидаемые env-переменные:
//   SmartThings OAuth app:  ST_CLIENT_ID, ST_CLIENT_SECRET
//   Текущие токены:         ST_ACCESS_TOKEN, ST_REFRESH_TOKEN (заполняются автоматически)
//   Koyeb API:              KOYEB_API_TOKEN, KOYEB_APP_NAME
//   Fallback (опц.):        SMARTTHINGS_PAT — если OAuth ещё не настроен
//
// Экспорт:
//   getCurrentToken()                       — взять актуальный access_token
//   startAutoRefresh()                      — запустить фоновое обновление (каждые 20ч)
//   exchangeCodeAndSave(code, cid?, csec?)  — обменять code (из redirect) на токены
//   createOAuthApp(pat, appName?, redirectUri) — создать OAuth-приложение через PAT
//   saveClientCredsToKoyeb(cid, csec)       — записать client_id/secret в Koyeb env

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
// SmartThings: refresh access token
// ────────────────────────────────────────────────────────────────
async function refreshAccessToken() {
    const clientId     = process.env.ST_CLIENT_ID;
    const clientSecret = process.env.ST_CLIENT_SECRET;
    const refreshToken = process.env.ST_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        console.warn('[TokenManager] ⚠️  Нет ST_CLIENT_ID / ST_CLIENT_SECRET / ST_REFRESH_TOKEN — refresh пропущен. Пройди OAuth через /api/auth/authorize.');
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

        await updateKoyebEnv({
            ST_ACCESS_TOKEN:  newAccess,
            ST_REFRESH_TOKEN: newRefresh,
        });
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

    await updateKoyebEnv({
        ST_ACCESS_TOKEN:  newAccess,
        ST_REFRESH_TOKEN: newRefresh,
        ST_CLIENT_ID:     clientId,
        ST_CLIENT_SECRET: clientSecret,
    });

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

    await updateKoyebEnv({
        ST_CLIENT_ID:     clientId,
        ST_CLIENT_SECRET: clientSecret,
    });

    return { clientId, clientSecret, scopes: ST_SCOPES, redirectUri };
}

// ────────────────────────────────────────────────────────────────
// Koyeb: обновить env vars сервиса (триггерит redeploy)
// ────────────────────────────────────────────────────────────────
async function updateKoyebEnv(updates) {
    const koyebToken = process.env.KOYEB_API_TOKEN;
    const koyebApp   = process.env.KOYEB_APP_NAME;

    if (!koyebToken || !koyebApp) {
        console.warn('[TokenManager] ⚠️  KOYEB_API_TOKEN / KOYEB_APP_NAME не заданы — изменения не переживут рестарт');
        return;
    }

    try {
        // Находим service: сначала по app name, потом по service name
        let service = null;

        // Попытка 1: KOYEB_APP_NAME — это имя App
        const appsRes = await koyebRequest('GET', `/v1/apps?name=${encodeURIComponent(koyebApp)}`, null, koyebToken);
        const app = appsRes?.body?.apps?.find(a => a.name === koyebApp) || appsRes?.body?.apps?.[0];
        if (app?.id) {
            const svcRes = await koyebRequest('GET', `/v1/services?app_id=${app.id}`, null, koyebToken);
            service = svcRes?.body?.services?.[0];
        }

        // Попытка 2: KOYEB_APP_NAME — это имя Service (частый случай)
        if (!service) {
            const allSvc = await koyebRequest('GET', `/v1/services?name=${encodeURIComponent(koyebApp)}`, null, koyebToken);
            service = allSvc?.body?.services?.find(s => s.name === koyebApp) || allSvc?.body?.services?.[0];
        }

        // Попытка 3: вообще взять первый service в аккаунте
        if (!service) {
            const allSvc = await koyebRequest('GET', '/v1/services?limit=5', null, koyebToken);
            service = allSvc?.body?.services?.[0];
            if (service) {
                console.log(`[TokenManager] ℹ️  App/Service "${koyebApp}" не найден по имени, но нашёлся service: "${service.name}" (id: ${service.id})`);
            }
        }

        if (!service?.id) {
            // Показываем все apps для отладки
            const debugApps = await koyebRequest('GET', '/v1/apps?limit=10', null, koyebToken);
            console.error('[TokenManager] Доступные apps:', JSON.stringify(debugApps?.body?.apps?.map(a => a.name)));
            throw new Error(`Koyeb: не найден ни app, ни service с именем "${koyebApp}". Проверь KOYEB_APP_NAME.`);
        }

        // 3. latest deployment (там — полный definition)
        const deployId = service.latest_deployment_id || service.active_deployment_id;
        if (!deployId) throw new Error('У сервиса нет latest_deployment_id');
        const depRes = await koyebRequest('GET', `/v1/deployments/${deployId}`, null, koyebToken);
        const definition = depRes?.body?.deployment?.definition;
        if (!definition) throw new Error('Не получили definition из deployment: ' + JSON.stringify(depRes.body));

        // 4. merge env
        definition.env = mergeEnv(definition.env || [], updates);

        // 5. PATCH service — Koyeb сам создаст новый deployment
        const patchRes = await koyebRequest('PATCH', `/v1/services/${service.id}`, { definition }, koyebToken);
        if (patchRes.status >= 400) {
            throw new Error(`PATCH failed ${patchRes.status}: ${JSON.stringify(patchRes.body)}`);
        }

        console.log(`[TokenManager] ✅ Koyeb env обновлён (${Object.keys(updates).join(', ')}) — будет redeploy`);
    } catch (e) {
        console.error('[TokenManager] ❌ Koyeb update error:', e.message);
    }
}

function mergeEnv(currentEnv, updates) {
    const result = currentEnv.map(e => ({ ...e }));
    for (const [key, value] of Object.entries(updates)) {
        const idx = result.findIndex(e => e.key === key);
        const entry = { key, value };
        if (idx !== -1) {
            // сохраняем scopes если были
            result[idx] = { ...result[idx], ...entry };
            // если раньше было secret — value нельзя слать вместе с secret reference, сбрасываем secret
            delete result[idx].secret;
        } else {
            result.push(entry);
        }
    }
    return result;
}

// ────────────────────────────────────────────────────────────────
// Публичный API
// ────────────────────────────────────────────────────────────────
function getCurrentToken() {
    return _currentToken || process.env.ST_ACCESS_TOKEN || process.env.SMARTTHINGS_PAT || null;
}

function startAutoRefresh() {
    if (!process.env.ST_CLIENT_ID || !process.env.ST_REFRESH_TOKEN) {
        console.warn('[TokenManager] ⚠️  OAuth не настроен — авто-refresh отключён. Открой /api/auth/authorize.');
        return;
    }
    console.log('[TokenManager] 🏠 Авто-refresh каждые 20ч');
    refreshAccessToken();
    setInterval(refreshAccessToken, REFRESH_INTERVAL_MS);
}

async function saveClientCredsToKoyeb(clientId, clientSecret) {
    process.env.ST_CLIENT_ID     = clientId;
    process.env.ST_CLIENT_SECRET = clientSecret;
    await updateKoyebEnv({ ST_CLIENT_ID: clientId, ST_CLIENT_SECRET: clientSecret });
}

module.exports = {
    getCurrentToken,
    startAutoRefresh,
    exchangeCodeAndSave,
    createOAuthApp,
    saveClientCredsToKoyeb,
    ST_SCOPES,
};
