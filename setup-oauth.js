#!/usr/bin/env node
// ============================================================
// SmartThings OAuth — полная автоматизация (запустить 1 раз)
// Использование: node setup-oauth.js --pat ВАШ_PAT_ТОКЕН
// ============================================================

require('dotenv').config();
const http    = require('http');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

// ── Конфиг ───────────────────────────────────────────────────
const REDIRECT_PORT = 9876;
const REDIRECT_URI  = `http://localhost:${REDIRECT_PORT}`;
const DATA_DIR      = path.join(__dirname, 'data');
const TOKENS_FILE   = path.join(DATA_DIR, 'st_tokens.json');
const CREDS_FILE    = path.join(DATA_DIR, 'st_oauth_creds.json');
const SCOPES        = [
    'r:devices:*', 'w:devices:*', 'x:devices:*',
    'r:locations:*', 'w:locations:*',
    'r:scenes:*',   'x:scenes:*',
    'r:rules:*',    'w:rules:*',
].join(' ');

// ── Аргументы ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const patIdx = args.indexOf('--pat');
const PAT = patIdx !== -1 ? args[patIdx + 1] : process.env.SMARTTHINGS_PAT;

if (!PAT) {
    console.error('\n❌ Укажи PAT токен:');
    console.error('   node setup-oauth.js --pat ВАШ_PAT_ТОКЕН\n');
    process.exit(1);
}

// ── Утилиты ───────────────────────────────────────────────────
function log(msg)  { console.log(`\n✅ ${msg}`); }
function info(msg) { console.log(`   ${msg}`); }
function err(msg)  { console.error(`\n❌ ${msg}`); }

async function apiCall(method, url, body, authToken) {
    return new Promise((resolve, reject) => {
        const parsed   = new URL(url);
        const bodyStr  = body ? JSON.stringify(body) : null;
        const options  = {
            hostname: parsed.hostname,
            path:     parsed.pathname + parsed.search,
            method,
            headers: {
                'Authorization': `Bearer ${authToken || PAT}`,
                'Content-Type':  'application/json',
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
        };

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end',  () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

async function formPost(url, params) {
    return new Promise((resolve, reject) => {
        const bodyStr = new URLSearchParams(params).toString();
        const parsed  = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path:     parsed.pathname,
            method:   'POST',
            headers: {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        };

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end',  () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

// ── Шаг 1: Создать OAuth приложение ───────────────────────────
async function createApp() {
    // Если уже есть сохранённые credentials — пропускаем
    if (fs.existsSync(CREDS_FILE)) {
        const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
        log('OAuth приложение уже создано, используем сохранённые данные');
        info(`Client ID: ${creds.clientId}`);
        return creds;
    }

    console.log('\n🔧 Создаю OAuth приложение в SmartThings...');

    const appName = `smart-home-${Date.now()}`;
    const res = await apiCall('POST', 'https://api.smartthings.com/v1/apps', {
        appName,
        displayName:     'Smart Home OAuth',
        description:     'Автоматическое OAuth приложение для умного дома',
        appType:         'API_ONLY',
        classifications: ['AUTOMATION'],
        apiOnly:         {},
        oauth: {
            clientName:   'smart-home',
            scope:        SCOPES.split(' '),
            redirectUris: [REDIRECT_URI],
        },
    });

    if (res.status !== 200 && res.status !== 201) {
        err(`Ошибка создания приложения: HTTP ${res.status}`);
        console.error(JSON.stringify(res.body, null, 2));
        process.exit(1);
    }

    const clientId     = res.body?.oauthClientId     || res.body?.app?.oauthClientId;
    const clientSecret = res.body?.oauthClientSecret || res.body?.app?.oauthClientSecret;

    if (!clientId || !clientSecret) {
        err('Не удалось получить Client ID / Secret из ответа:');
        console.error(JSON.stringify(res.body, null, 2));
        process.exit(1);
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const creds = { clientId, clientSecret, appName };
    fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));

    log('Приложение создано!');
    info(`Client ID:     ${clientId}`);
    info(`Client Secret: ${clientSecret.slice(0, 8)}...`);
    info(`Сохранено в:   ${CREDS_FILE}`);

    return creds;
}

// ── Шаг 2: Авторизация — ловим код через локальный сервер ─────
async function getAuthCode(clientId) {
    const authUrl =
        `https://api.smartthings.com/oauth/authorize` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(SCOPES)}`;

    console.log('\n🌐 Нужна одноразовая авторизация в браузере.');
    console.log('   Открой эту ссылку на своём компьютере/телефоне:\n');
    console.log(`   ${authUrl}\n`);
    console.log('   Войди в Samsung аккаунт и разреши доступ.');
    console.log(`   Сервер ждёт ответа на порту ${REDIRECT_PORT}...`);

    // Попробуем открыть браузер если возможно
    try { execSync(`xdg-open "${authUrl}" 2>/dev/null`); } catch {}

    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url    = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
            const code   = url.searchParams.get('code');
            const errMsg = url.searchParams.get('error');

            if (errMsg) {
                res.end('<h2>Ошибка авторизации. Закрой вкладку.</h2>');
                server.close();
                reject(new Error(`OAuth ошибка: ${errMsg}`));
                return;
            }

            if (code) {
                res.end(`
                    <html><body style="font-family:sans-serif;padding:40px;text-align:center">
                    <h2>✅ Авторизация успешна!</h2>
                    <p>Можно закрыть эту вкладку — сервер продолжает настройку.</p>
                    </body></html>
                `);
                server.close();
                resolve(code);
            } else {
                res.end('<h2>Нет кода. Попробуй снова.</h2>');
            }
        });

        server.listen(REDIRECT_PORT, () => {
            // Просто ждём
        });

        server.on('error', e => {
            if (e.code === 'EADDRINUSE') {
                reject(new Error(`Порт ${REDIRECT_PORT} занят. Освободи его и попробуй снова.`));
            } else {
                reject(e);
            }
        });

        // Таймаут 5 минут
        setTimeout(() => {
            server.close();
            reject(new Error('Таймаут ожидания авторизации (5 мин). Запусти скрипт снова.'));
        }, 5 * 60 * 1000);
    });
}

// ── Шаг 3: Обменять код на токены ────────────────────────────
async function exchangeCode(code, clientId, clientSecret) {
    console.log('\n🔄 Получаю токены...');

    const res = await formPost('https://api.smartthings.com/oauth/token', {
        grant_type:    'authorization_code',
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  REDIRECT_URI,
    });

    if (res.status !== 200 || !res.body.access_token) {
        err(`Ошибка получения токенов: HTTP ${res.status}`);
        console.error(JSON.stringify(res.body, null, 2));
        process.exit(1);
    }

    return res.body;
}

// ── Шаг 4: Сохранить токены и обновить .env ───────────────────
function saveResults(tokens, creds) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // Сохранить токены
    const tokenData = {
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        updated_at:    new Date().toISOString(),
    };
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokenData, null, 2));

    // Обновить .env
    const envFile = path.join(__dirname, '.env');
    let envContent = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';

    const setEnvVar = (content, key, value) => {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        return regex.test(content)
            ? content.replace(regex, `${key}=${value}`)
            : content + `\n${key}=${value}`;
    };

    envContent = setEnvVar(envContent, 'ST_CLIENT_ID',     creds.clientId);
    envContent = setEnvVar(envContent, 'ST_CLIENT_SECRET', creds.clientSecret);

    fs.writeFileSync(envFile, envContent.trim() + '\n');

    log('Всё готово!');
    info(`Токены сохранены: ${TOKENS_FILE}`);
    info(`.env обновлён с ST_CLIENT_ID и ST_CLIENT_SECRET`);
    info('Теперь перезапусти сервер: pm2 restart all  (или node server.js)');

    console.log('\n' + '='.repeat(55));
    console.log('🏠 Умный дом будет работать без перебоев навсегда!');
    console.log('   token-manager.js обновляет токен каждые 20 часов.');
    console.log('='.repeat(55) + '\n');
}

// ── Главная функция ───────────────────────────────────────────
async function main() {
    console.log('\n' + '='.repeat(55));
    console.log('   SmartThings OAuth — автоматическая настройка');
    console.log('='.repeat(55));

    try {
        const creds = await createApp();
        const code   = await getAuthCode(creds.clientId);
        log(`Код получен: ${code.slice(0, 6)}...`);
        const tokens = await exchangeCode(code, creds.clientId, creds.clientSecret);
        log('Токены получены!');
        saveResults(tokens, creds);
    } catch (e) {
        err(e.message);
        process.exit(1);
    }
}

main();
