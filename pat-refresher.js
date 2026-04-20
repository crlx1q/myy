// pat-refresher.js
// Автоматически создаёт новый PAT токен SmartThings каждые 20 часов.
// Использует Puppeteer (headless браузер) — никакого OAuth, никаких CLI.
//
// Установка: npm install puppeteer
// Запуск:    node pat-refresher.js  (или запускается автоматически из server.js)

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'st_pat.json');
const ENV_FILE   = path.join(__dirname, '.env');

const SAMSUNG_EMAIL    = process.env.SAMSUNG_EMAIL;
const SAMSUNG_PASSWORD = process.env.SAMSUNG_PASSWORD;
const REFRESH_INTERVAL = 20 * 60 * 60 * 1000; // 20 часов

// ── Сохранить токен в файл и обновить .env ───────────────────
function saveToken(token) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    fs.writeFileSync(TOKEN_FILE, JSON.stringify({
        token,
        created_at: new Date().toISOString(),
    }, null, 2));

    // Обновить SMARTTHINGS_PAT в .env
    if (fs.existsSync(ENV_FILE)) {
        let env = fs.readFileSync(ENV_FILE, 'utf8');
        if (/^SMARTTHINGS_PAT=.*/m.test(env)) {
            env = env.replace(/^SMARTTHINGS_PAT=.*/m, `SMARTTHINGS_PAT=${token}`);
        } else {
            env += `\nSMARTTHINGS_PAT=${token}`;
        }
        fs.writeFileSync(ENV_FILE, env);
    }

    console.log(`[PAT Refresher] ✅ Новый токен сохранён: ${new Date().toISOString()}`);
    return token;
}

// ── Загрузить текущий токен ───────────────────────────────────
function loadToken() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).token;
        }
    } catch {}
    return process.env.SMARTTHINGS_PAT || null;
}

// ── Создать новый PAT через Puppeteer ─────────────────────────
async function createNewPAT() {
    let puppeteer;
    try {
        puppeteer = require('puppeteer');
    } catch {
        console.error('[PAT Refresher] ❌ Puppeteer не установлен. Запусти: npm install puppeteer');
        process.exit(1);
    }

    if (!SAMSUNG_EMAIL || !SAMSUNG_PASSWORD) {
        console.error('[PAT Refresher] ❌ Задай SAMSUNG_EMAIL и SAMSUNG_PASSWORD в .env');
        process.exit(1);
    }

    console.log('[PAT Refresher] 🌐 Запускаю браузер...');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
        );

        // ── 1. Открыть страницу токенов ───────────────────────
        console.log('[PAT Refresher] 📂 Открываю account.smartthings.com/tokens...');
        await page.goto('https://account.smartthings.com/tokens', {
            waitUntil: 'networkidle2',
            timeout: 30000,
        });

        // ── 2. Войти в Samsung аккаунт ────────────────────────
        console.log('[PAT Refresher] 🔑 Вхожу в Samsung аккаунт...');

        // Ввести email
        await page.waitForSelector('input[type="email"], input[name="email"], #id-email-input', { timeout: 15000 });
        await page.type('input[type="email"], input[name="email"], #id-email-input', SAMSUNG_EMAIL, { delay: 50 });

        // Нажать продолжить / next
        const nextBtn = await page.$('button[type="submit"], #btnNext, .btn-next');
        if (nextBtn) await nextBtn.click();
        await page.waitForTimeout(2000);

        // Ввести пароль
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
        await page.type('input[type="password"]', SAMSUNG_PASSWORD, { delay: 50 });

        // Нажать войти
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            page.click('button[type="submit"], #btnSignIn, .btn-signin, button:has-text("Sign in")'),
        ]);

        console.log('[PAT Refresher] ✅ Вошёл в аккаунт');

        // Убедимся что мы на странице токенов
        if (!page.url().includes('smartthings.com/tokens')) {
            await page.goto('https://account.smartthings.com/tokens', {
                waitUntil: 'networkidle2',
                timeout: 20000,
            });
        }

        // ── 3. Нажать "Generate new token" ───────────────────
        console.log('[PAT Refresher] 🔧 Создаю новый токен...');
        await page.waitForSelector('button, a', { timeout: 10000 });

        // Ищем кнопку генерации
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, a')];
            const btn  = btns.find(b => b.textContent.includes('Generate') || b.textContent.includes('generate'));
            if (btn) btn.click();
        });

        await page.waitForTimeout(2000);

        // ── 4. Заполнить имя токена ───────────────────────────
        const nameInput = await page.$('input[placeholder*="name"], input[placeholder*="Name"], input[name="name"]');
        if (nameInput) {
            await nameInput.click({ clickCount: 3 });
            await nameInput.type(`smart-home-${Date.now()}`);
        }

        // ── 5. Выбрать все нужные scopes ─────────────────────
        const scopes = [
            'Devices', 'Locations', 'Scenes', 'Rules',
            'r:devices', 'w:devices', 'x:devices',
            'r:locations', 'r:scenes', 'x:scenes',
        ];

        await page.evaluate((scopeList) => {
            document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                const label = cb.closest('label')?.textContent || cb.getAttribute('aria-label') || cb.name || '';
                const match = scopeList.some(s => label.toLowerCase().includes(s.toLowerCase()));
                if (match && !cb.checked) cb.click();
            });
        }, scopes);

        // ── 6. Нажать Generate ────────────────────────────────
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button')];
            const btn  = btns.find(b =>
                b.textContent.trim().toLowerCase().includes('generate') &&
                !b.disabled
            );
            if (btn) btn.click();
        });

        await page.waitForTimeout(3000);

        // ── 7. Получить токен со страницы ─────────────────────
        const token = await page.evaluate(() => {
            // Ищем токен в разных местах
            const codeEl = document.querySelector('code, .token-value, [class*="token"], pre');
            if (codeEl) return codeEl.textContent.trim();

            // Ищем UUID-подобную строку в тексте
            const bodyText = document.body.innerText;
            const uuidMatch = bodyText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
            return uuidMatch ? uuidMatch[0] : null;
        });

        if (!token) {
            // Сделать скриншот для отладки
            await page.screenshot({ path: path.join(DATA_DIR, 'debug-screenshot.png') });
            throw new Error('Не удалось найти токен на странице. Скриншот: data/debug-screenshot.png');
        }

        console.log(`[PAT Refresher] 🎉 Токен получен: ${token.slice(0, 8)}...`);
        return saveToken(token);

    } finally {
        await browser.close();
    }
}

// ── Экспорт для использования в server.js ────────────────────
function getCurrentToken() {
    return loadToken();
}

async function startAutoRefresh() {
    if (!SAMSUNG_EMAIL || !SAMSUNG_PASSWORD) {
        console.warn('[PAT Refresher] ⚠️  SAMSUNG_EMAIL / SAMSUNG_PASSWORD не заданы в .env');
        console.warn('[PAT Refresher]    Используется текущий SMARTTHINGS_PAT (истечёт через 24ч)');
        return;
    }

    // Первое обновление сразу при старте
    try {
        await createNewPAT();
    } catch (e) {
        console.error('[PAT Refresher] Ошибка первого обновления:', e.message);
    }

    // Потом каждые 20 часов
    setInterval(async () => {
        try {
            await createNewPAT();
        } catch (e) {
            console.error('[PAT Refresher] Ошибка обновления токена:', e.message);
        }
    }, REFRESH_INTERVAL);

    console.log('[PAT Refresher] 🔄 Авто-обновление PAT запущено (каждые 20ч)');
}

module.exports = { getCurrentToken, startAutoRefresh };

// ── Если запущен напрямую (node pat-refresher.js) ────────────
if (require.main === module) {
    createNewPAT()
        .then(token => {
            console.log('\n✅ Готово! Токен сохранён в data/st_pat.json и обновлён в .env');
            console.log(`   Токен: ${token.slice(0, 8)}...`);
            process.exit(0);
        })
        .catch(e => {
            console.error('❌ Ошибка:', e.message);
            process.exit(1);
        });
}
