// ==========================================
// bridge/sync-engine.js
// Фоновый Sync-Engine: Tuya -> SmartThings -> Local Dashboard (WebSocket).
// Устойчив к офлайну устройств: любая ошибка логируется, процесс не падает.
// ==========================================

const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');

const config = require('./config-store');
const tuya = require('./tuya');
const smartthings = require('./smartthings');

const DATA_DIR = path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, 'doorbell-latest.jpg');

const MAX_LOGS = 200;
const MAX_HISTORY_POINTS = 5000;

let io = null;
let syncTimer = null;
let syncInProgress = false;

const logs = [];

const state = {
    enabled: true,
    running: false,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastError: null,
    intervalMinutes: 5,
    tuya: { connected: false, error: null, lastCheckAt: null },
    smartthings: { connected: false, error: null, lastCheckAt: null },
    devices: {
        temperature: { online: false, value: null, raw: null, updatedAt: null, error: null },
        led: { online: false, on: null, level: null, workMode: null, updatedAt: null, error: null },
        doorbell: { online: false, snapshotUrl: null, hasSnapshot: false, updatedAt: null, error: null }
    }
};

// ---------- Логи ----------
function log(level, message, meta) {
    const entry = {
        time: new Date().toISOString(),
        level,
        message: String(message),
        meta: meta || null
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);

    const prefix = `[bridge] ${entry.message}`;
    if (level === 'error') console.error(prefix);
    else if (level === 'warn') console.warn(prefix);
    else console.log(prefix);

    emit('bridge-log', entry);
    return entry;
}

function emit(event, payload) {
    if (io) {
        try { io.emit(event, payload); } catch (error) { /* сокет не должен ронять мост */ }
    }
}

function getLogs(limit = 100) {
    return logs.slice(-limit);
}

// ---------- История ----------
function appendHistory(type, value) {
    try {
        let history = { events: [], temperature: [], humidity: [], power: [], notifications: [] };
        if (fs.existsSync(HISTORY_FILE)) {
            const parsed = fs.readJsonSync(HISTORY_FILE);
            if (parsed && typeof parsed === 'object') history = { ...history, ...parsed };
        }
        if (!Array.isArray(history[type])) history[type] = [];
        history[type].push({
            timestamp: Date.now(),
            time: new Date().toISOString(),
            value,
            source: 'tuya-bridge'
        });
        if (history[type].length > MAX_HISTORY_POINTS) {
            history[type] = history[type].slice(-MAX_HISTORY_POINTS);
        }
        fs.writeJsonSync(HISTORY_FILE, history, { spaces: 2 });
    } catch (error) {
        log('warn', `Не удалось записать историю (${type}): ${error.message}`);
    }
}

// ---------- Утилиты ----------
function pickFirst(status, codes) {
    for (const code of codes) {
        if (status && status[code] !== undefined && status[code] !== null) {
            return { code, value: status[code] };
        }
    }
    return null;
}

function normalizeTemperature(rawValue) {
    const raw = Number(rawValue);
    if (!Number.isFinite(raw)) return null;

    const scaleSetting = String(config.get('TUYA_TEMP_SCALE') || 'auto').toLowerCase();
    if (scaleSetting !== 'auto') {
        const divider = Number(scaleSetting);
        if (Number.isFinite(divider) && divider > 0) return Math.round((raw / divider) * 10) / 10;
    }

    // auto: Tuya обычно отдаёт значение в десятых долях градуса
    if (Math.abs(raw) >= 1000) return Math.round((raw / 100) * 10) / 10;
    if (Math.abs(raw) >= 90) return Math.round((raw / 10) * 10) / 10;
    return Math.round(raw * 10) / 10;
}

function tuyaBrightnessToPercent(value, code) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;
    const max = code === 'bright_value_v2' || raw > 255 ? 1000 : 255;
    return Math.max(0, Math.min(100, Math.round((raw / max) * 100)));
}

function percentToTuyaBrightness(percent, code) {
    const max = code === 'bright_value_v2' ? 1000 : 255;
    const value = Math.round((Math.max(0, Math.min(100, Number(percent) || 0)) / 100) * max);
    return Math.max(code === 'bright_value_v2' ? 10 : 25, value);
}

// ---------- 1. Датчик температуры ----------
async function syncTemperature() {
    const deviceId = config.get('TUYA_TEMP_DEVICE_ID');
    const target = state.devices.temperature;
    if (!deviceId) {
        target.error = 'Не задан TUYA_TEMP_DEVICE_ID';
        return;
    }

    try {
        const status = await tuya.getDeviceStatus(deviceId);
        const found = pickFirst(status, ['va_temperature', 'temp_current', 'temperature', 'temp_value']);
        if (!found) throw new Error('В статусе устройства нет кода температуры');

        const temperature = normalizeTemperature(found.value);
        if (temperature === null) throw new Error(`Некорректное значение температуры: ${found.value}`);

        const humidityFound = pickFirst(status, ['va_humidity', 'humidity_value']);
        const humidity = humidityFound ? Math.round(Number(humidityFound.value)) : null;

        target.online = true;
        target.error = null;
        target.value = temperature;
        target.raw = found.value;
        target.humidity = humidity;
        target.updatedAt = new Date().toISOString();

        log('info', `Температура Tuya: ${temperature}°C (${found.code}=${found.value})`);

        // -> SmartThings
        const stDeviceId = config.get('ST_TEMP_DEVICE_ID');
        if (stDeviceId) {
            const events = [{ capability: 'temperatureMeasurement', attribute: 'temperature', value: temperature, unit: 'C' }];
            if (humidity !== null && Number.isFinite(humidity)) {
                events.push({ capability: 'relativeHumidityMeasurement', attribute: 'humidity', value: humidity, unit: '%' });
            }
            await smartthings.sendEvents(stDeviceId, events);
            log('info', `SmartThings: температура ${temperature}°C отправлена`);
        }

        // -> история
        appendHistory('temperature', temperature);
        if (humidity !== null && Number.isFinite(humidity)) appendHistory('humidity', humidity);
    } catch (error) {
        target.online = false;
        target.error = error.message;
        log('error', `Датчик температуры: ${error.message}`);
    }
}

// ---------- 2. LED-лента ----------
async function syncLed() {
    const deviceId = config.get('TUYA_LED_DEVICE_ID');
    const target = state.devices.led;
    if (!deviceId) {
        target.error = 'Не задан TUYA_LED_DEVICE_ID';
        return;
    }

    try {
        const status = await tuya.getDeviceStatus(deviceId);
        const switchFound = pickFirst(status, ['switch_led', 'switch', 'led_switch']);
        const brightFound = pickFirst(status, ['bright_value_v2', 'bright_value']);
        const modeFound = pickFirst(status, ['work_mode']);

        target.online = true;
        target.error = null;
        target.on = switchFound ? !!switchFound.value : null;
        target.level = brightFound ? tuyaBrightnessToPercent(brightFound.value, brightFound.code) : null;
        target.brightCode = brightFound ? brightFound.code : 'bright_value_v2';
        target.workMode = modeFound ? modeFound.value : null;
        target.updatedAt = new Date().toISOString();

        log('info', `LED Tuya: switch=${target.on}, brightness=${target.level}%, mode=${target.workMode}`);

        const stDeviceId = config.get('ST_LED_DEVICE_ID');
        if (stDeviceId) {
            const events = [];
            if (target.on !== null) {
                events.push({ capability: 'switch', attribute: 'switch', value: target.on ? 'on' : 'off' });
            }
            if (target.level !== null) {
                events.push({ capability: 'switchLevel', attribute: 'level', value: target.level, unit: '%' });
            }
            if (events.length) {
                await smartthings.sendEvents(stDeviceId, events);
                log('info', 'SmartThings: состояние LED обновлено');
            }
        }
    } catch (error) {
        target.online = false;
        target.error = error.message;
        log('error', `LED-лента: ${error.message}`);
    }
}

// ---------- 3. Дверной звонок ----------
async function cacheSnapshot(url) {
    try {
        await fs.ensureDir(SNAPSHOT_DIR);

        if (typeof url === 'string' && /^data:image\//i.test(url)) {
            const base64 = url.split(',')[1] || '';
            await fs.writeFile(SNAPSHOT_FILE, Buffer.from(base64, 'base64'));
            return true;
        }

        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
            const response = await fetch(url, { timeout: 15000 });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const buffer = await response.buffer();
            await fs.writeFile(SNAPSHOT_FILE, buffer);
            return true;
        }

        return false;
    } catch (error) {
        log('warn', `Не удалось закешировать снимок звонка: ${error.message}`);
        return false;
    }
}

async function syncDoorbell() {
    const deviceId = config.get('TUYA_DOORBELL_DEVICE_ID');
    const target = state.devices.doorbell;
    if (!deviceId) {
        target.error = 'Не задан TUYA_DOORBELL_DEVICE_ID';
        return;
    }

    try {
        const status = await tuya.getDeviceStatus(deviceId);
        const picFound = pickFirst(status, ['doorbell_pic', 'movement_detect_pic', 'alarm_message', 'ipc_pic']);

        target.online = true;
        target.error = null;
        target.updatedAt = new Date().toISOString();

        if (!picFound) {
            log('info', 'Звонок: новых кадров нет');
            return;
        }

        const picValue = picFound.value;
        const isNew = picValue !== target.rawValue;
        target.rawValue = picValue;
        target.snapshotCode = picFound.code;

        if (isNew) {
            const cached = await cacheSnapshot(picValue);
            target.hasSnapshot = cached || target.hasSnapshot;
            target.snapshotUrl = cached ? `/api/bridge/doorbell/snapshot?ts=${Date.now()}` : (typeof picValue === 'string' && /^https?:/i.test(picValue) ? picValue : null);
            target.snapshotAt = new Date().toISOString();
            log('info', `Звонок: получен новый кадр (${picFound.code})`);

            const stDeviceId = config.get('ST_DOORBELL_DEVICE_ID');
            if (stDeviceId) {
                await smartthings.sendEvents(stDeviceId, [
                    { capability: 'imageCapture', attribute: 'image', value: String(picValue).slice(0, 1024) }
                ]);
                log('info', 'SmartThings: кадр звонка отправлен (imageCapture)');
            }

            emit('doorbell-snapshot', {
                url: target.snapshotUrl,
                at: target.snapshotAt
            });
        }
    } catch (error) {
        target.online = false;
        target.error = error.message;
        log('error', `Дверной звонок: ${error.message}`);
    }
}

// ---------- Полный цикл ----------
async function runSync({ trigger = 'scheduler' } = {}) {
    if (syncInProgress) {
        return { success: false, skipped: true, reason: 'Синхронизация уже выполняется' };
    }

    syncInProgress = true;
    state.running = true;
    state.lastSyncAt = new Date().toISOString();
    log('info', `Старт синхронизации (${trigger})`);
    emit('bridge-sync-start', { trigger, at: state.lastSyncAt });

    try {
        // Проверяем доступность Tuya один раз за цикл
        try {
            await tuya.getAccessToken();
            state.tuya = { connected: true, error: null, lastCheckAt: new Date().toISOString() };
        } catch (error) {
            state.tuya = { connected: false, error: error.message, lastCheckAt: new Date().toISOString() };
            log('error', `Tuya недоступна: ${error.message}`);
        }

        if (state.tuya.connected) {
            await syncTemperature();
            await syncLed();
            await syncDoorbell();
        }

        const stError = smartthings.getLastError();
        state.smartthings = {
            connected: !stError && !smartthings.isAuthBlocked(),
            error: stError,
            lastCheckAt: new Date().toISOString()
        };

        const deviceErrors = Object.values(state.devices).filter((device) => device.error).length;
        state.lastError = state.tuya.connected ? (deviceErrors ? `Ошибок устройств: ${deviceErrors}` : null) : state.tuya.error;
        if (!state.lastError) state.lastSuccessAt = new Date().toISOString();

        log(state.lastError ? 'warn' : 'info', state.lastError ? `Синхронизация завершена с ошибками: ${state.lastError}` : 'Синхронизация успешно завершена');
        broadcastState();
        return { success: !state.lastError, state: getPublicState() };
    } catch (error) {
        state.lastError = error.message;
        log('error', `Критическая ошибка синхронизации: ${error.message}`);
        broadcastState();
        return { success: false, error: error.message, state: getPublicState() };
    } finally {
        syncInProgress = false;
        state.running = false;
        emit('bridge-sync-end', getPublicState());
    }
}

function broadcastState() {
    const publicState = getPublicState();
    emit('bridge-update', publicState);

    // Отдельное событие температуры — для быстрого обновления главного экрана
    const temperature = state.devices.temperature;
    if (temperature.value !== null && temperature.value !== undefined) {
        emit('bridge-temperature', {
            value: temperature.value,
            humidity: temperature.humidity !== undefined ? temperature.humidity : null,
            updatedAt: temperature.updatedAt,
            online: temperature.online
        });
    }

    emit('bridge-led', { ...state.devices.led });
}

function getPublicState() {
    return JSON.parse(JSON.stringify({
        ...state,
        intervalMinutes: config.getNumber('SYNC_INTERVAL_MINUTES', 5),
        enabled: config.getBool('BRIDGE_ENABLED', true),
        snapshotAvailable: fs.existsSync(SNAPSHOT_FILE)
    }));
}

// ---------- Управление LED через мост ----------
async function setLed({ on, level }) {
    const deviceId = config.get('TUYA_LED_DEVICE_ID');
    if (!deviceId) throw new Error('Не задан TUYA_LED_DEVICE_ID');

    const commands = [];
    if (on !== undefined && on !== null) commands.push({ code: 'switch_led', value: !!on });
    if (level !== undefined && level !== null) {
        const brightCode = state.devices.led.brightCode || 'bright_value_v2';
        commands.push({ code: brightCode, value: percentToTuyaBrightness(level, brightCode) });
    }
    if (!commands.length) throw new Error('Нечего отправлять: укажи on и/или level');

    await tuya.sendCommands(deviceId, commands);
    log('info', `LED: команда отправлена в Tuya (${commands.map((c) => `${c.code}=${c.value}`).join(', ')})`);

    // Оптимистично обновляем локальное состояние
    if (on !== undefined && on !== null) state.devices.led.on = !!on;
    if (level !== undefined && level !== null) state.devices.led.level = Math.max(0, Math.min(100, Number(level)));
    state.devices.led.updatedAt = new Date().toISOString();

    // Дублируем в SmartThings
    const stDeviceId = config.get('ST_LED_DEVICE_ID');
    if (stDeviceId) {
        const events = [];
        if (on !== undefined && on !== null) events.push({ capability: 'switch', attribute: 'switch', value: on ? 'on' : 'off' });
        if (level !== undefined && level !== null) events.push({ capability: 'switchLevel', attribute: 'level', value: state.devices.led.level, unit: '%' });
        try {
            await smartthings.sendEvents(stDeviceId, events);
        } catch (error) {
            log('warn', `SmartThings не принял состояние LED: ${error.message}`);
        }
    }

    broadcastState();
    return { ...state.devices.led };
}

// ---------- Health check ----------
async function healthCheck() {
    const [tuyaResult, stResult] = await Promise.all([tuya.healthCheck(), smartthings.healthCheck()]);

    state.tuya = { connected: tuyaResult.ok, error: tuyaResult.error || null, lastCheckAt: new Date().toISOString() };
    state.smartthings = { connected: stResult.ok, error: stResult.error || null, lastCheckAt: new Date().toISOString() };

    log(tuyaResult.ok ? 'info' : 'error', `Health check Tuya: ${tuyaResult.ok ? 'OK' : tuyaResult.error} (${tuyaResult.latencyMs} мс)`);
    log(stResult.ok ? 'info' : 'error', `Health check SmartThings: ${stResult.ok ? 'OK' : stResult.error} (${stResult.latencyMs} мс)`);

    broadcastState();
    return { tuya: tuyaResult, smartthings: stResult };
}

// ---------- Планировщик ----------
function startScheduler() {
    stopScheduler();
    const minutes = Math.max(1, config.getNumber('SYNC_INTERVAL_MINUTES', 5));
    state.intervalMinutes = minutes;
    state.enabled = config.getBool('BRIDGE_ENABLED', true);

    if (!state.enabled) {
        log('warn', 'Мост выключен (BRIDGE_ENABLED=false) — фоновая синхронизация не запущена');
        return;
    }

    syncTimer = setInterval(() => {
        runSync({ trigger: 'scheduler' }).catch((error) => log('error', `Планировщик: ${error.message}`));
    }, minutes * 60 * 1000);

    if (syncTimer.unref) syncTimer.unref();
    log('info', `Планировщик запущен: синхронизация каждые ${minutes} мин.`);

    // Первый прогон через 5 секунд после старта сервера
    setTimeout(() => {
        runSync({ trigger: 'startup' }).catch((error) => log('error', `Стартовая синхронизация: ${error.message}`));
    }, 5000);
}

function stopScheduler() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}

function setSocketServer(socketServer) {
    io = socketServer;
}

module.exports = {
    setSocketServer,
    startScheduler,
    stopScheduler,
    runSync,
    healthCheck,
    setLed,
    getPublicState,
    getLogs,
    log,
    broadcastState,
    SNAPSHOT_FILE
};
