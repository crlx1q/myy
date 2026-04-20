#!/usr/bin/env node
// ============================================================
// SmartThings OAuth — полная автоматизация (запустить 1 раз)
// Использование: node setup-oauth.js --pat ВАШ_PAT_ТОКЕН
// ============================================================

require('dotenv').config();
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

const REDIRECT_URI = 'https://httpbin.org/get'; // HTTPS — Samsung принимает
const DATA_DIR     = path.join(__dirname, 'data');
const TOKENS_FILE  = path.join(DATA_DIR, 'st_tokens.json');
const CREDS_FILE   = path.join(DATA_DIR, 'st_oauth_creds.json');
const ENV_FILE     = path.join(__dirname, '.env');
const SCOPES       = [
    'r:devices:*', 'w:devices:*', 'x:devices:*',
    'r:locations:*', 'r:scenes:*', 'x:scenes:*',
    'r:rules:*', 'w:rules:*',
].join(' ');

// ── Аргументы ─────────────────────────────────────────────────
const args   = process.argv.slice(2);
const patIdx = args.indexOf('--pat');
const PAT    = patIdx !== -1 ? args[patIdx + 1] : process.env.SMARTTHINGS_PAT;

if (!PAT) {
    console.error('\n❌ Укажи PAT токен:');
    console.error('   node setup-oauth.js --pat ВАШ_PAT_ТОКЕН\n');
    process.exit(1);
}

// ── Утилиты ───────────────────────────────────────────────────
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function apiPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const parsed  = new URL(url);
        const req = https.request({
            hostname: parsed.hostname,
            path:     parsed.pathname,
            method:   'POST',
            headers:  {
                'Authorization': `Bearer ${PAT}`,
                'Content-Type':  'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                ...headers,
            },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
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

async function formPost(url, params) {
    return new Promise((resolve, reject) => {
        const bodyStr = new URLSearchParams(params).toString();
        const parsed  = new URL(url);
        const req = https.request({
            hostname: parsed.hostname,
            path:     parsed.pathname,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        }, res => {
            let data = '';
            res.on('data', c => data += c);
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
    if (fs.existsSync(CREDS_FILE)) {
        const creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'));
        console.log('\n✅ OAuth приложение уже создано');
        console.log(`   Client ID: ${creds.clientId}`);
        return creds;
    }

    console.log('\n🔧 Создаю OAuth приложение...');

    const res = await apiPost('https://api.smartthings.com/v1/apps', {
        appName:         `smart-home-${Date.now()}`,
        displayName:     'Smart Home',
        description:     'Умный дом',
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
        console.error(`\n❌ Ошибка создания приложения (HTTP ${res.status}):`);
        console.error(JSON.stringify(res.body, null, 2));
        process.exit(1);
    }

    const clientId     = res.body?.oauthClientId     || res.body?.app?.oauthClientId;
    const clientSecret = res.body?.oauthClientSecret || res.body?.app?.oauthClientSecret;

    if (!clientId || !clientSecret) {
        console.error('\n❌ Не получил Client ID / Secret. Ответ:');
        console.error(JSON.stringify(res.body, null, 2));
        process.exit(1);
    }

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const creds = { clientId, clientSecret };
    fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));

    console.log('✅ Приложение создано!');
    console.log(`   Client ID:     ${clientId}`);
    console.log(`   Client Secret: ${clientSecret.slice(0, 8)}...`);

    return creds;
}

// ── Шаг 2: Авторизация через браузер ─────────────────────────
async function getAuthCode(clientId) {
    const authUrl =
        `https://api.smartthings.com/oauth/authorize` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(SCOPES)}`;

    console.log('\n' + '='.repeat(60));
    console.log('🌐 ОТКРОЙ ЭТУ ССЫЛКУ В БРАУЗЕРЕ (на телефоне или компе):');
    console.log('='.repeat(60));
    console.log('\n' + authUrl + '\n');
    console.log('='.repeat(60));
    console.log('\n📌 Войди в Samsung аккаунт и разреши доступ.');
    console.log('   Тебя перекинет на httpbin.org — это нормально!');
    console.log('   На той странице найди поле "code" в JSON и скопируй его значение.\n');
    console.log('   Пример того что увидишь:');
    console.log('   {');
    console.log('     "args": {');
    console.log('       "code": "XXXXXX",   <-- вот это копируй');
    console.log('     }');
    console.log('   }\n');

    const code = await ask('   Вставь сюда код: ');

    if (!code || code.length < 3) {
        console.error('❌ Код не введён. Попробуй снова.');
        process.exit(1);
    }

    return code;
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
        console.error(`\n❌ Ошибка получения токенов (HTTP ${res.status}):`);
        console.error(JSON.stringify(res.body, null, 2));
        process.exit(1);
    }

    return res.body;
}

// ── Шаг 4: Сохранить всё ─────────────────────────────────────
function saveResults(tokens, creds) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    fs.writeFileSync(TOKENS_FILE, JSON.stringify({
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        updated_at:    new Date().toISOString(),
    }, null, 2));

    // Обновить .env
    let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    const set = (content, key, val) => {
        const re = new RegExp(`^${key}=.*$`, 'm');
        return re.test(content) ? content.replace(re, `${key}=${val}`) : content + `\n${key}=${val}`;
    };
    env = set(env, 'ST_CLIENT_ID',     creds.clientId);
    env = set(env, 'ST_CLIENT_SECRET', creds.clientSecret);
    fs.writeFileSync(ENV_FILE, env.trim() + '\n');

    console.log('\n' + '='.repeat(60));
    console.log('🎉 Всё готово!');
    console.log(`   Токены сохранены:  ${TOKENS_FILE}`);
    console.log(`   .env обновлён:     ST_CLIENT_ID, ST_CLIENT_SECRET`);
    console.log('\n   Перезапусти сервер — токен будет жить вечно! 🏠');
    console.log('='.repeat(60) + '\n');
}

// ── Главная функция ───────────────────────────────────────────
async function main() {
    console.log('\n' + '='.repeat(60));
    console.log('   SmartThings OAuth — автоматическая настройка');
    console.log('='.repeat(60));

    try {
        const creds  = await createApp();
        const code   = await getAuthCode(creds.clientId);
        const tokens = await exchangeCode(code, creds.clientId, creds.clientSecret);
        saveResults(tokens, creds);
    } catch (e) {
        console.error('\n❌ Ошибка:', e.message);
        process.exit(1);
    }
}

main();
