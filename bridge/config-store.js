// ==========================================
// bridge/config-store.js
// Управление секретами и настройками моста.
// .env (dotenv) + fallback-значения + динамическое переопределение из веб-интерфейса.
// ==========================================

const path = require('path');
const fs = require('fs-extra');
const DEFAULTS = require('./defaults');

const DATA_DIR = path.join(__dirname, '..', 'data');
// Отдельный файл, чтобы не конфликтовать с записью data/settings.json из server.js
const BRIDGE_SETTINGS_FILE = path.join(DATA_DIR, 'bridge-settings.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const KEYS = Object.keys(DEFAULTS);
const SECRET_KEYS = ['TUYA_CLIENT_SECRET', 'ST_PAT_TOKEN'];

let overrides = {};
let loaded = false;

function ensureLoaded() {
    if (loaded) return;
    loaded = true;
    fs.ensureDirSync(DATA_DIR);

    // 1) data/bridge-settings.json — основной источник переопределений
    try {
        if (fs.existsSync(BRIDGE_SETTINGS_FILE)) {
            const raw = fs.readJsonSync(BRIDGE_SETTINGS_FILE) || {};
            overrides = sanitize(raw);
        }
    } catch (error) {
        console.error('[bridge/config] Не удалось прочитать bridge-settings.json:', error.message);
        overrides = {};
    }

    // 2) data/settings.json -> { "bridge": { ... } } — совместимость с общим файлом настроек
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const settings = fs.readJsonSync(SETTINGS_FILE) || {};
            if (settings.bridge && typeof settings.bridge === 'object') {
                overrides = { ...sanitize(settings.bridge), ...overrides };
            }
        }
    } catch (error) {
        console.error('[bridge/config] Не удалось прочитать settings.json:', error.message);
    }
}

function sanitize(obj) {
    const result = {};
    KEYS.forEach((key) => {
        const value = obj[key];
        if (value === undefined || value === null) return;
        const str = String(value).trim();
        if (!str) return;
        result[key] = str;
    });
    return result;
}

function get(key) {
    ensureLoaded();
    if (overrides[key] !== undefined && overrides[key] !== '') return overrides[key];

    const envValue = process.env[key];
    if (envValue !== undefined && String(envValue).trim() !== '') {
        const trimmed = String(envValue).trim();
        // Плейсхолдер из .env.example не считаем валидным значением
        if (!/^<.*>$/.test(trimmed)) return trimmed;
    }

    // Совместимость со старым именем токена SmartThings
    if (key === 'ST_PAT_TOKEN' && process.env.SMARTTHINGS_PAT) {
        return String(process.env.SMARTTHINGS_PAT).trim();
    }

    return DEFAULTS[key] !== undefined ? DEFAULTS[key] : '';
}

function getNumber(key, fallback = 0) {
    const value = Number(get(key));
    return Number.isFinite(value) ? value : fallback;
}

function getBool(key, fallback = false) {
    const value = String(get(key)).toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(value)) return true;
    if (['0', 'false', 'no', 'off'].includes(value)) return false;
    return fallback;
}

function getAll() {
    ensureLoaded();
    const result = {};
    KEYS.forEach((key) => { result[key] = get(key); });
    return result;
}

function mask(value) {
    const str = String(value || '');
    if (!str) return '';
    if (str.length <= 8) return '••••';
    return str.slice(0, 4) + '••••••••' + str.slice(-4);
}

// Безопасное представление для админки: секреты маскируются
function getMasked() {
    ensureLoaded();
    const result = {};
    KEYS.forEach((key) => {
        const value = get(key);
        result[key] = SECRET_KEYS.includes(key) ? mask(value) : value;
    });
    result._secretKeys = SECRET_KEYS;
    result._source = {};
    KEYS.forEach((key) => {
        if (overrides[key]) result._source[key] = 'settings';
        else if (process.env[key]) result._source[key] = 'env';
        else result._source[key] = 'default';
    });
    return result;
}

// Сохранение новых ключей из админ-панели
function save(patch = {}) {
    ensureLoaded();
    const clean = sanitize(patch);

    // Пустая строка = сброс к значению из .env/defaults
    Object.keys(patch || {}).forEach((key) => {
        if (!KEYS.includes(key)) return;
        const value = patch[key];
        if (value === '' || value === null) delete overrides[key];
    });

    overrides = { ...overrides, ...clean };

    fs.ensureDirSync(DATA_DIR);
    fs.writeJsonSync(BRIDGE_SETTINGS_FILE, overrides, { spaces: 2 });

    // Зеркалим в data/settings.json -> bridge (по ТЗ), не ломая остальные настройки
    try {
        const settings = fs.existsSync(SETTINGS_FILE) ? (fs.readJsonSync(SETTINGS_FILE) || {}) : {};
        settings.bridge = overrides;
        fs.writeJsonSync(SETTINGS_FILE, settings, { spaces: 2 });
    } catch (error) {
        console.error('[bridge/config] Не удалось обновить settings.json:', error.message);
    }

    return getMasked();
}

// Отпечаток учётных данных Tuya — для инвалидации кеша access_token
function credentialsFingerprint() {
    return [get('TUYA_CLIENT_ID'), get('TUYA_CLIENT_SECRET'), get('TUYA_ENDPOINT')].join('|');
}

module.exports = {
    KEYS,
    SECRET_KEYS,
    get,
    getNumber,
    getBool,
    getAll,
    getMasked,
    save,
    mask,
    credentialsFingerprint,
    BRIDGE_SETTINGS_FILE
};
