// ==========================================
// Конфигурация Tuya Cloud
// Приоритет: админка (data/tuya-keys.json) > переменные окружения > фолбэк в коде
// ==========================================
const path = require('path');
const fs = require('fs-extra');

const KEYS_FILE = path.join(__dirname, '..', 'data', 'tuya-keys.json');

const DEFAULTS = {
    TUYA_CLIENT_ID: '3efgnhtcmqtc4h7fxk8c',
    TUYA_CLIENT_SECRET: 'd45bde1ed4a443bfa09437e52ae188ce',
    TUYA_ENDPOINT: 'https://openapi.tuyaeu.com',
    TUYA_PROJECT_CODE: 'p1786794003140jfs89g',
    // Известные устройства (фолбэк, если список из облака не пришёл)
    TUYA_TEMP_DEVICE_ID: 'bf92808ce982033cbaia4b',
    TUYA_LED_DEVICE_ID: 'bf44f166005ea9bfceu3bx',
    TUYA_DOORBELL_DEVICE_ID: 'bf0c1a2c570f440357gbdo',
    TUYA_SMOKE_DEVICE_ID: '',
    // Через запятую можно добавить любые другие device_id
    TUYA_DEVICE_IDS: '',
    // UID аккаунта Smart Life (если задан — берём ВСЕ устройства аккаунта)
    TUYA_UID: '',
    // auto | 1 | 10 | 100 — делитель для температуры
    TUYA_TEMP_SCALE: 'auto'
};

const SECRET_KEYS = ['TUYA_CLIENT_SECRET'];

let overrides = {};

function load() {
    try {
        if (fs.existsSync(KEYS_FILE)) {
            overrides = fs.readJsonSync(KEYS_FILE) || {};
        }
    } catch (error) {
        console.error('[tuya] Не удалось прочитать data/tuya-keys.json:', error.message);
        overrides = {};
    }
}

load();

function get(key) {
    const fromFile = overrides[key];
    if (fromFile !== undefined && fromFile !== null && String(fromFile).trim() !== '') {
        return String(fromFile).trim();
    }
    const fromEnv = process.env[key];
    if (fromEnv !== undefined && fromEnv !== null && String(fromEnv).trim() !== '') {
        return String(fromEnv).trim();
    }
    return DEFAULTS[key] !== undefined ? DEFAULTS[key] : '';
}

function all() {
    const result = {};
    Object.keys(DEFAULTS).forEach(key => {
        result[key] = get(key);
    });
    return result;
}

// Для админки: секреты отдаём замаскированными
function publicView() {
    const values = all();
    const result = {};
    Object.keys(values).forEach(key => {
        if (SECRET_KEYS.includes(key)) {
            const value = values[key] || '';
            result[key] = value ? `${value.slice(0, 4)}••••${value.slice(-4)}` : '';
        } else {
            result[key] = values[key];
        }
        result[`${key}__source`] = overrides[key] ? 'admin'
            : (process.env[key] ? 'env' : 'default');
    });
    return result;
}

// Пустая строка = сбросить переопределение (вернуться к env/фолбэку)
function update(patch = {}) {
    Object.keys(patch).forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
        const value = patch[key];
        if (value === undefined || value === null || String(value).trim() === '') {
            delete overrides[key];
        } else {
            const clean = String(value).trim();
            // Замаскированное значение из формы не сохраняем
            if (clean.includes('••••')) return;
            overrides[key] = clean;
        }
    });

    try {
        fs.ensureDirSync(path.dirname(KEYS_FILE));
        fs.writeJsonSync(KEYS_FILE, overrides, { spaces: 2 });
    } catch (error) {
        console.error('[tuya] Не удалось сохранить data/tuya-keys.json:', error.message);
    }

    return publicView();
}

function knownDeviceIds() {
    const ids = [
        get('TUYA_TEMP_DEVICE_ID'),
        get('TUYA_LED_DEVICE_ID'),
        get('TUYA_DOORBELL_DEVICE_ID'),
        get('TUYA_SMOKE_DEVICE_ID'),
        ...String(get('TUYA_DEVICE_IDS') || '').split(',')
    ];
    return [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
}

module.exports = { DEFAULTS, SECRET_KEYS, get, all, publicView, update, knownDeviceIds, reload: load };
