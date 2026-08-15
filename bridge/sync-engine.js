// ==========================================
// bridge/sync-engine.js
// Фоновый движок: читает устройства Tuya и транслирует их на локальный экран.
// SmartThings больше не участвует: в Google Home устройства попадают штатной
// интеграцией "Tuya Smart" (см. BRIDGE.md).
// ==========================================

const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');

const config = require('./config-store');
const tuya = require('./tuya');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, 'doorbell-latest.jpg');
// Отдельный файл, чтобы не мешать data/history.json из server.js
const HISTORY_FILE = path.join(DATA_DIR, 'bridge-history.json');
const HISTORY_LIMIT = 2000;
const LOG_LIMIT = 200;

let io = null;
let timer = null;
let running = false;
const logs = [];

const state = {
    startedAt: new Date().toISOString(),
    lastSyncAt: null,
    lastSuccessAt: null,
    lastError: null,
    intervalMinutes: 5,
    temperature: { value: null, unit: 'C', raw: null, code: null, updatedAt: null },
    led: { on: null, level: null, mode: null, updatedAt: null },
    doorbell: { imageUrl: null, cached: false, updatedAt: null },
    devices: { temperature: 'unknown', led: 'unknown', doorbell: 'unknown' }
};

// ---------- Логи ----------
function log(level, message) {
    const entry = { ts: new Date().toISOString(), level, message };
    logs.push(entry);
    if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
    console.log(`[bridge] ${message}`);
    if (io) io.emit('bridge-log', entry);
    return entry;
}

function getLogs(limit = 100) {
    return logs.slice(-limit);
}

function setSocketServer(server) {
    io = server || null;
}

function getPublicState() {
    return JSON.parse(JSON.stringify({ ...state, running }));
}

function broadcast(event, payload) {
    if (!io) return;
    io.emit(event, payload);
}

// ---------- История температуры ----------
function appendHistory(entry) {
    try {
        fs.ensureDirSync(DATA_DIR);
        let history = [];
        if (fs.existsSync(HISTORY_FILE)) {
            history = fs.readJsonSync(HISTORY_FILE, { throws: false }) || [];
            if (!Array.isArray(history)) history = [];
        }
        history.push(entry);
        if (history.length > HISTORY_LIMIT) history = history.slice(-HISTORY_LIMIT);
        fs.writeJsonSync(HISTORY_FILE, history);
    } catch (error) {
        log('warn', `История не сохранена: ${error.message}`);
    }
}

function readHistory(limit = 200) {
    try {
        if (!fs.existsSync(HISTORY_FILE)) return [];
        const history = fs.readJsonSync(HISTORY_FILE, { throws: false }) || [];
        return Array.isArray(history) ? history.slice(-limit) : [];
    } catch (error) {
        return [];
    }
}

// ---------- Температура ----------
function parseTemperature(status) {
    const code = ['va_temperature', 'temp_current', 'temperature', 'temp_indoor']
        .find((key) => status[key] !== undefined && status[key] !== null);
    if (!code) return null;

    const raw = Number(status[code]);
    if (!Number.isFinite(raw)) return null;

    const scaleSetting = String(config.get('TUYA_TEMP_SCALE') || 'auto').toLowerCase();
    let divider = 1;
    if (scaleSetting === 'auto') {
        if (Math.abs(raw) >= 1000) divider = 100;
        else if (Math.abs(raw) >= 100) divider = 10;
    } else {
        divider = Number(scaleSetting) || 1;
    }

    return { value: Math.round((raw / divider) * 10) / 10, raw, code };
}

async function syncTemperature() {
    const deviceId = config.get('TUYA_TEMP_DEVICE_ID');
    if (!deviceId) return;

    try {
        const status = await tuya.getDeviceStatus(deviceId);
        const parsed = parseTemperature(status);
        state.devices.temperature = 'online';

        if (!parsed) {
            log('warn', `Датчик температуры: нет знакомого DP-кода (${Object.keys(status).join(', ') || 'пусто'})`);
            return;
        }

        const humidity = status.va_humidity !== undefined ? Number(status.va_humidity) : null;

        state.temperature = {
            value: parsed.value,
            unit: 'C',
            raw: parsed.raw,
            code: parsed.code,
            humidity: humidity !== null && Number.isFinite(humidity) ? humidity : null,
            battery: status.battery_percentage !== undefined ? Number(status.battery_percentage) : null,
            updatedAt: new Date().toISOString()
        };

        log('info', `Температура: ${parsed.value}\u00b0C (${parsed.code}=${parsed.raw})`);
        broadcast('bridge-temperature', state.temperature);
        appendHistory({
            ts: state.temperature.updatedAt,
            temperature: parsed.value,
            humidity: state.temperature.humidity
        });
    } catch (error) {
        state.devices.temperature = 'error';
        log('error', `Датчик температуры: ${error.message}`);
    }
}

// ---------- LED ----------
function brightnessToPercent(raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (value <= 100) return Math.round(value);
    return Math.round((value / 1000) * 100);
}

function pickBrightCode(status) {
    const configured = String(config.get('TUYA_BRIGHT_CODE') || 'auto').toLowerCase();
    if (configured !== 'auto') return configured;
    if (status && status.bright_value_v2 !== undefined) return 'bright_value_v2';
    if (status && status.bright_value !== undefined) return 'bright_value';
    return 'bright_value_v2';
}

async function syncLed() {
    const deviceId = config.get('TUYA_LED_DEVICE_ID');
    if (!deviceId) return;

    try {
        const status = await tuya.getDeviceStatus(deviceId);
        state.devices.led = 'online';

        const brightCode = pickBrightCode(status);
        state.led = {
            on: status.switch_led !== undefined ? Boolean(status.switch_led) : null,
            level: brightnessToPercent(status[brightCode]),
            mode: status.work_mode !== undefined ? String(status.work_mode) : null,
            brightCode,
            updatedAt: new Date().toISOString()
        };

        log('info', `LED: switch=${state.led.on}, яркость=${state.led.level}%, режим=${state.led.mode}`);
        broadcast('bridge-led', state.led);
    } catch (error) {
        state.devices.led = 'error';
        log('error', `LED-лента: ${error.message}`);
    }
}

async function setLed({ on, level } = {}) {
    const deviceId = config.get('TUYA_LED_DEVICE_ID');
    if (!deviceId) throw new Error('Не задан TUYA_LED_DEVICE_ID');

    let status = {};
    try {
        status = await tuya.getDeviceStatus(deviceId);
    } catch (error) {
        log('warn', `Не удалось прочитать статус LED перед командой: ${error.message}`);
    }

    const commands = [];
    if (on !== undefined && on !== null) {
        commands.push({ code: 'switch_led', value: Boolean(on) });
    }
    if (level !== undefined && level !== null && level !== '') {
        const percent = Math.min(100, Math.max(1, Number(level)));
        const brightCode = pickBrightCode(status);
        const value = brightCode === 'bright_value_v2'
            ? Math.max(10, Math.round(percent * 10))
            : Math.max(25, Math.round(percent * 2.55));
        commands.push({ code: brightCode, value });
        // Яркость работает только в белом режиме
        if (status.work_mode && status.work_mode !== 'white') {
            commands.unshift({ code: 'work_mode', value: 'white' });
        }
    }

    if (!commands.length) throw new Error('Нечего отправлять: укажи on и/или level');

    await tuya.sendCommands(deviceId, commands);
    log('info', `Команда LED -> Tuya: ${JSON.stringify(commands)}`);

    // Обновляем состояние и рассылаем на экраны
    await syncLed();
    return state.led;
}

// ---------- Дверной звонок ----------
async function cacheSnapshot(url) {
    const response = await fetch(url, { timeout: 15000 });
    if (!response.ok) throw new Error(`HTTP ${response.status} при загрузке кадра`);
    const buffer = await response.buffer();
    fs.ensureDirSync(SNAPSHOT_DIR);
    fs.writeFileSync(SNAPSHOT_FILE, buffer);
    return buffer.length;
}

async function syncDoorbell() {
    const deviceId = config.get('TUYA_DOORBELL_DEVICE_ID');
    if (!deviceId) return;

    try {
        const status = await tuya.getDeviceStatus(deviceId);
        state.devices.doorbell = 'online';

        const code = ['doorbell_pic', 'movement_detect_pic', 'ipc_flip', 'alarm_message']
            .find((key) => typeof status[key] === 'string' && /^https?:\/\//.test(status[key]));

        if (!code) return;

        const url = status[code];
        if (url === state.doorbell.imageUrl) return;

        let cached = false;
        try {
            const size = await cacheSnapshot(url);
            cached = true;
            log('info', `Звонок: новый кадр (${code}, ${Math.round(size / 1024)} КБ)`);
        } catch (error) {
            log('warn', `Звонок: кадр не скачан (${error.message})`);
        }

        state.doorbell = {
            imageUrl: url,
            cached,
            code,
            updatedAt: new Date().toISOString()
        };

        broadcast('bridge-doorbell', state.doorbell);
    } catch (error) {
        state.devices.doorbell = 'error';
        log('error', `Дверной звонок: ${error.message}`);
    }
}

// ---------- Цикл синхронизации ----------
async function runSync({ trigger = 'scheduler' } = {}) {
    if (running) {
        return { success: false, skipped: true, reason: 'Синхронизация уже идёт' };
    }

    running = true;
    state.lastSyncAt = new Date().toISOString();
    log('info', `Старт синхронизации (${trigger})`);

    try {
        await syncTemperature();
        await syncLed();
        await syncDoorbell();

        const hasError = Object.values(state.devices).includes('error');
        state.lastError = hasError ? 'Часть устройств недоступна' : null;
        if (!hasError) state.lastSuccessAt = new Date().toISOString();

        broadcast('bridge-update', getPublicState());
        return { success: !hasError, state: getPublicState() };
    } catch (error) {
        state.lastError = error.message;
        log('error', `Синхронизация: ${error.message}`);
        broadcast('bridge-update', getPublicState());
        return { success: false, error: error.message };
    } finally {
        running = false;
    }
}

function startScheduler() {
    if (timer) clearInterval(timer);

    const minutes = Math.max(1, config.getNumber('SYNC_INTERVAL_MINUTES', 5));
    state.intervalMinutes = minutes;

    timer = setInterval(() => {
        runSync({ trigger: 'scheduler' }).catch(() => {});
    }, minutes * 60 * 1000);
    if (timer.unref) timer.unref();

    log('info', `Планировщик запущен: синхронизация каждые ${minutes} мин.`);

    setTimeout(() => {
        runSync({ trigger: 'startup' }).catch(() => {});
    }, 3000);
}

function stopScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
}

async function healthCheck() {
    const result = { tuya: await tuya.healthCheck(), devices: {} };

    const ids = {
        temperature: config.get('TUYA_TEMP_DEVICE_ID'),
        led: config.get('TUYA_LED_DEVICE_ID'),
        doorbell: config.get('TUYA_DOORBELL_DEVICE_ID')
    };

    for (const [name, deviceId] of Object.entries(ids)) {
        if (!deviceId) {
            result.devices[name] = { ok: false, error: 'ID не задан' };
            continue;
        }
        try {
            const info = await tuya.getDeviceInfo(deviceId);
            result.devices[name] = {
                ok: true,
                deviceId,
                name: info && info.name ? info.name : null,
                online: info ? Boolean(info.online) : null,
                category: info ? info.category : null
            };
        } catch (error) {
            result.devices[name] = { ok: false, deviceId, error: error.message };
        }
    }

    return result;
}

module.exports = {
    SNAPSHOT_FILE,
    HISTORY_FILE,
    log,
    getLogs,
    setSocketServer,
    getPublicState,
    readHistory,
    runSync,
    startScheduler,
    stopScheduler,
    healthCheck,
    setLed,
    syncTemperature,
    syncLed,
    syncDoorbell
};
