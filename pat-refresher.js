// pat-refresher.js
// Стратегия:
//   1. Первый запуск — открывает браузер ВИДИМО, ты логинишься сам (2FA и всё такое)
//   2. Куки сохраняются в data/samsung-cookies.json
//   3. Все следующие запуски — используют куки, никакого 2FA
//   4. Новый PAT создаётся каждые 20 часов автоматически
//
// Первый запуск (ты за компьютером):
//   node pat-refresher.js --setup
//
// После этого просто перезапусти server.js — всё автоматически.

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const DATA_DIR      = path.join(__dirname, 'data');
const COOKIES_FILE  = path.join(DATA_DIR, 'samsung-cookies.json');
const TOKEN_FILE    = path.join(DATA_DIR, 'st_pat.json');
const ENV_FILE      = path.join(__dirname, '.env');
const REFRESH_MS    = 20 * 60 * 60 * 1000; // 20 часов

// ── Сохранить PAT токен ───────────────────────────────────────
function saveToken(token) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    fs.writeFileSync(TOKEN_FILE, JSON.stringify({
        token,
        created_at: new Date().toISOString(),
    }, null, 2));

    // Обновить SMARTTHINGS_PAT в .env
    if (fs.existsSync(ENV_FILE)) {
        let env = fs.readFileSync(ENV_FILE, 'utf8');
        env = /^SMARTTHINGS_PAT=.*/m.test(env)
            ? env.replace(/^SMARTTHINGS_PAT=.*/m, `SMARTTHINGS_PAT=${token}`)
            : env + `\nSMARTTHINGS_PAT=${token}`;
        fs.writeFileSync(ENV_FILE, env.trim() + '\n');
    }

    // Обновляем токен в памяти чтобы server.js сразу его использовал
    process.env.SMARTTHINGS_PAT = token;

    console.log(`[PAT] ✅ Новый токен сохранён: ${new Date().toISOString()}`);
    return token;
}

function loadToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token;
        }
    } catch {}
    return process.env.SMARTTHINGS_PAT || null;
}

function hasCookies() {
    return fs.existsSync(COOKIES_FILE);
}

// ── Запустить Puppeteer ───────────────────────────────────────
async function launchBrowser(headless) {
    let puppeteer;
    try {
        puppeteer = require('puppeteer');
    } catch {
        console.error('[PAT] ❌ Установи puppeteer: npm install puppeteer');
        process.exit(1);
    }

    return puppeteer.launch({
        headless: headless ? 'new' : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1024,768'],
        defaultViewport: { width: 1024, height: 768 },
    });
}

// ── SETUP: первый вход вручную, сохранение куков ──────────────
async function setupLogin() {
    console.log('\n' + '='.repeat(60));
    console.log('  ПЕРВОНАЧАЛЬНАЯ НАСТРОЙКА');
    console.log('='.repeat(60));
    console.log('\n📌 Сейчас откроется браузер на сервере.');
    console.log('   Если у тебя нет GUI на сервере — читай ниже.\n');
    console.log('   Войди в Samsung аккаунт (email + пароль + 2FA).');
    console.log('   Когда окажешься на странице токенов — вернись сюда');
    console.log('   и нажми Enter.\n');

    // Если нет дисплея — дать инструкцию
    if (!process.env.DISPLAY && process.platform === 'linux') {
        console.log('⚠️  Нет переменной DISPLAY (headless сервер).');
        console.log('   Подключись через SSH с X11 forwarding:');
        console.log('   ssh -X user@твой_сервер');
        console.log('   Или запусти setup на своём компьютере, скопируй data/samsung-cookies.json на сервер.\n');
    }

    const browser = await launchBrowser(false);
    const page    = await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    );

    await page.goto('https://account.smartthings.com/tokens', {
        waitUntil: 'networkidle2',
        timeout: 60000,
    });

    console.log('⏳ Войди в браузере, затем нажми Enter здесь...');
    await new Promise(resolve => {
        process.stdin.setRawMode?.(false);
        process.stdin.resume();
        process.stdin.once('data', () => {
            process.stdin.pause();
            resolve();
        });
        process.stdout.write('> ');
    });

    const currentUrl = page.url();
    if (!currentUrl.includes('smartthings.com/tokens')) {
        console.warn('[PAT] ⚠️  URL не совпадает:', currentUrl);
        console.warn('   Убедись что ты на странице https://account.smartthings.com/tokens');
    }

    const cookies = await page.cookies();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));

    console.log(`\n[PAT] ✅ Куки сохранены (${cookies.length} шт.) → ${COOKIES_FILE}`);
    await browser.close();

    console.log('\n[PAT] 🔧 Создаю первый PAT токен...');
    const token = await createPAT();

    if (token) {
        console.log('\n' + '='.repeat(60));
        console.log('🎉 Настройка завершена!');
        console.log('   Перезапусти сервер: pm2 restart all');
        console.log('   Токен будет обновляться автоматически каждые 20ч.');
        console.log('='.repeat(60) + '\n');
    }
}

// ── Создать PAT используя сохранённые куки ────────────────────
async function createPAT() {
    if (!hasCookies()) {
        console.error('[PAT] ❌ Нет куков. Запусти: node pat-refresher.js --setup');
        return null;
    }

    const browser = await launchBrowser(true);
    const page    = await browser.newPage();

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    );

    try {
        const cookies = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
        await page.setCookie(...cookies);

        console.log('[PAT] 🌐 Открываю страницу токенов...');
        await page.goto('https://account.smartthings.com/tokens', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // Сессия истекла?
        if (page.url().includes('login') || page.url().includes('signin') || page.url().includes('account.samsung')) {
            console.error('[PAT] ⚠️  Сессия истекла — нужно повторить setup.');
            console.error('     Запусти: node pat-refresher.js --setup');
            await browser.close();
            return null;
        }

        // Обновляем куки
        const updatedCookies = await page.cookies();
        fs.writeFileSync(COOKIES_FILE, JSON.stringify(updatedCookies, null, 2));

        // Нажать "Generate new token"
        console.log('[PAT] 🔧 Нажимаю Generate new token...');
        const clicked = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, a')];
            const btn  = btns.find(b =>
                b.textContent.toLowerCase().includes('generate') ||
                b.textContent.toLowerCase().includes('create') ||
                b.textContent.toLowerCase().includes('new token')
            );
            if (btn) { btn.click(); return true; }
            return false;
        });

        if (!clicked) {
            await page.screenshot({ path: path.join(DATA_DIR, 'debug-no-button.png') });
            throw new Error('Кнопка Generate не найдена. Скриншот: data/debug-no-button.png');
        }

        await new Promise(r => setTimeout(r, 2000));

        // Имя токена
        const nameInput = await page.$('input[type="text"], input[name="name"], input[placeholder]');
        if (nameInput) {
            await nameInput.click({ clickCount: 3 });
            await nameInput.type(`smart-home-${Date.now()}`);
        }

        // Выбрать все scopes
        await page.evaluate(() => {
            document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (!cb.checked) cb.click();
            });
        });

        await new Promise(r => setTimeout(r, 500));

        // Нажать финальный Generate
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const btn  = btns.find(b =>
                b.textContent.trim().toLowerCase().includes('generate') && !b.disabled
            );
            if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 3000));

        // Извлечь токен
        const token = await page.evaluate(() => {
            for (const sel of ['code', 'pre', '.token-value', '[class*="token"]', '[class*="Token"]']) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim().length > 20) return el.textContent.trim();
            }
            const match = document.body.innerText.match(
                /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
            );
            return match ? match[0] : null;
        });

        if (!token) {
            await page.screenshot({ path: path.join(DATA_DIR, 'debug-no-token.png') });
            throw new Error('Токен не найден. Скриншот: data/debug-no-token.png');
        }

        await browser.close();
        return saveToken(token);

    } catch (e) {
        try { await browser.close(); } catch {}
        throw e;
    }
}

// ── Экспорт для server.js ─────────────────────────────────────
function getCurrentToken() {
    return loadToken();
}

async function startAutoRefresh() {
    if (!hasCookies()) {
        console.warn('[PAT] ⚠️  Куки не найдены. Запусти: node pat-refresher.js --setup');
        return;
    }

    console.log('[PAT] 🔄 Авто-обновление PAT запущено (каждые 20ч)');

    try { await createPAT(); }
    catch (e) { console.error('[PAT] Ошибка первого обновления:', e.message); }

    setInterval(async () => {
        try { await createPAT(); }
        catch (e) { console.error('[PAT] Ошибка авто-обновления:', e.message); }
    }, REFRESH_MS);
}

module.exports = { getCurrentToken, startAutoRefresh };

// ── Прямой запуск ─────────────────────────────────────────────
if (require.main === module) {
    const isSetup = process.argv.includes('--setup');

    if (isSetup) {
        setupLogin().catch(e => { console.error('❌', e.message); process.exit(1); });
    } else {
        createPAT()
            .then(t => { console.log(t ? '✅ Токен обновлён.' : '⚠️  Нужен --setup'); process.exit(0); })
            .catch(e => { console.error('❌', e.message); process.exit(1); });
    }
}
