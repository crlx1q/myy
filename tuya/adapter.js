// ==========================================
// Адаптер Tuya → внутренний API дашборда
// Заменяет слой SmartThings: отвечает теми же структурами,
// что и раньше приходили из SmartThings REST API.
// ==========================================
const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');

const api = require('./api');
const config = require('./config');
const mapper = require('./mapper');

const SNAPSHOT_DIR = path.join(__dirname, '..', 'data', 'snapshots');
const SNAPSHOT_KEEP = 20;
const DEVICE_LIST_TTL_MS = 5 * 60 * 1000;
const LOG_LIMIT = 200;

let deviceCache = [];
let deviceCacheAt = 0;
let statusCache = {};   // { deviceId: { map, components, at } }
let doorbellState = { lastRing: null, snapshot: null, snapshotAt: null, history: [] };
let logs = [];

fs.ensureDirSync(SNAPSHOT_DIR);

function log(level, message) {
    const entry = { level, message, at: new Date().toISOString() };
    logs.push(entry);
    if (logs.length > LOG_LIMIT) logs = logs.slice(-LOG_LIMIT);
    const prefix = level === 'error' ? '[tuya][ошибка]' : '[tuya]';
    if (level === 'error') console.error(prefix, message);
    else console.log(prefix, message);
    return entry;
}

function getLogs(limit = 60) {
    return logs.slice(-limit);
}

// ---------- Устройства ----------

async function loadDevices(force = false) {
    if (!force && deviceCache.length && (Date.now() - deviceCacheAt) < DEVICE_LIST_TTL_MS) {
        return deviceCache;
    }

    let devices = [];
    try {
        devices = await api.listDevices();
    } catch (error) {
        log('error', `Список устройств из облака не загрузился: ${error.message}`);
    }

    // Фолбэк: точечно тянем известные device_id из настроек
    if (!devices.length) {
        const ids = config.knownDeviceIds();
        for (const id of ids) {
            try {
                const info = await api.getDeviceInfo(id);
                if (info) devices.push(info);
            } catch (error) {
                log('error', `Устройство ${id} недоступно: ${error.message}`);
            }
        }
        if (devices.length) {
            log('info', `Список собран из настроек: ${devices.length} устройств(а)`);
        }
    } else {
        log('info', `Из Tuya Cloud получено устройств: ${devices.length}`);
    }

    deviceCache = devices;
    deviceCacheAt = Date.now();
    return deviceCache;
}

function findDevice(deviceId) {
    return deviceCache.find(device => device.id === deviceId) || null;
}

async function loadStatus(deviceId) {
    const statusArray = await api.getDeviceStatus(deviceId);
    const map = mapper.statusToMap(statusArray);
    const device = findDevice(deviceId) || { id: deviceId };
    const components = mapper.statusToComponents(statusArray, device);
    statusCache[deviceId] = { map, components, at: Date.now() };

    await maybeHandleDoorbell(deviceId, map);

    return statusCache[deviceId];
}

// ---------- Дверной звонок: скриншоты вместо потока ----------
// Потоковое видео (RTSP/HLS) на Galaxy Ace (Android 2.3) не воспроизведётся,
// поэтому берём кадры, которые звонок сам кладёт в облако.

function doorbellDeviceId() {
    return config.get('TUYA_DOORBELL_DEVICE_ID');
}

async function downloadSnapshot(url) {
    const response = await fetch(url, { timeout: 15000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.buffer();
    const fileName = `doorbell-${Date.now()}.jpg`;
    await fs.writeFile(path.join(SNAPSHOT_DIR, fileName), buffer);
    await fs.writeFile(path.join(SNAPSHOT_DIR, 'doorbell-latest.jpg'), buffer);

    // Чистим старые кадры
    try {
        const files = (await fs.readdir(SNAPSHOT_DIR))
            .filter(name => /^doorbell-\d+\.jpg$/.test(name))
            .sort();
        while (files.length > SNAPSHOT_KEEP) {
            const oldest = files.shift();
            await fs.remove(path.join(SNAPSHOT_DIR, oldest));
        }
    } catch (error) { /* не критично */ }

    return fileName;
}

async function maybeHandleDoorbell(deviceId, map) {
    if (deviceId !== doorbellDeviceId()) return;

    let picUrl = null;
    for (const code of mapper.DOORBELL_PIC_CODES) {
        if (map[code]) { picUrl = String(map[code]); break; }
    }
    if (!picUrl || !/^https?:\/\//.test(picUrl)) return;
    if (doorbellState.snapshotSource === picUrl) return;

    try {
        const fileName = await downloadSnapshot(picUrl);
        doorbellState.snapshotSource = picUrl;
        doorbellState.snapshot = `/data/snapshots/${fileName}`;
        doorbellState.snapshotAt = new Date().toISOString();
        doorbellState.lastRing = doorbellState.snapshotAt;
        doorbellState.history.unshift({ file: doorbellState.snapshot, at: doorbellState.snapshotAt });
        doorbellState.history = doorbellState.history.slice(0, SNAPSHOT_KEEP);
        log('info', 'Звонок: получен новый кадр');
    } catch (error) {
        log('error', `Не удалось скачать кадр звонка: ${error.message}`);
    }
}

async function refreshDoorbell() {
    const id = doorbellDeviceId();
    if (!id) return getDoorbell();
    try {
        await loadStatus(id);
    } catch (error) {
        log('error', `Звонок не ответил: ${error.message}`);
    }
    return getDoorbell();
}

function getDoorbell() {
    const id = doorbellDeviceId();
    const cached = statusCache[id];
    const map = (cached && cached.map) || {};
    const device = findDevice(id);
    const latest = doorbellState.snapshot
        ? `/data/snapshots/doorbell-latest.jpg?t=${Date.parse(doorbellState.snapshotAt || 0) || Date.now()}`
        : null;

    return {
        deviceId: id || null,
        name: (device && (device.name || device.custom_name)) || 'Дверной звонок',
        online: device ? device.online !== false : null,
        // потока нет — только кадры (фронтенд рисует их в том же блоке, где был поток)
        mode: 'snapshot',
        streamUrl: latest,
        snapshotUrl: latest,
        snapshotAt: doorbellState.snapshotAt,
        lastRing: doorbellState.lastRing,
        history: doorbellState.history,
        battery: map.battery_percentage !== undefined ? Number(map.battery_percentage) : null,
        hasVisitor: !!(doorbellState.lastRing && (Date.now() - Date.parse(doorbellState.lastRing)) < 60 * 1000),
        status: 'idle'
    };
}

// ---------- Датчик дыма ----------

function findSmokeDevice() {
    const configured = config.get('TUYA_SMOKE_DEVICE_ID');
    if (configured) return configured;
    const byCategory = deviceCache.find(device => ['ywbj', 'cobj'].includes(String(device.category || '')));
    if (byCategory) return byCategory.id;
    const byStatus = Object.keys(statusCache).find(id => {
        const map = statusCache[id].map || {};
        return mapper.SMOKE_CODES.some(code => map[code] !== undefined);
    });
    return byStatus || null;
}

async function getSmokeDetector({ refresh = false } = {}) {
    const id = findSmokeDevice();
    if (!id) {
        // Датчика в аккаунте нет — показываем "всё в порядке"
        return { status: 'normal', text: 'Всё в порядке', deviceId: null, source: 'none', online: null, battery: null, updatedAt: new Date().toISOString() };
    }

    if (refresh || !statusCache[id]) {
        try {
            await loadStatus(id);
        } catch (error) {
            log('error', `Датчик дыма не ответил: ${error.message}`);
        }
    }

    const cached = statusCache[id];
    const smoke = cached && cached.components && cached.components.main && cached.components.main.smokeDetector;
    const detected = smoke && smoke.smoke && smoke.smoke.value === 'detected';
    const map = (cached && cached.map) || {};
    const device = findDevice(id);

    return {
        deviceId: id,
        source: 'tuya',
        status: detected ? 'smoke' : 'normal',
        text: detected ? 'Дым обнаружен' : 'Всё в порядке',
        online: device ? device.online !== false : null,
        battery: map.battery_percentage !== undefined ? Number(map.battery_percentage)
            : (map.residual_electricity !== undefined ? Number(map.residual_electricity) : null),
        updatedAt: cached ? new Date(cached.at).toISOString() : null
    };
}

// ---------- Совместимый слой вместо smartThingsRequest ----------
// Понимает те же пути, что и раньше: /devices, /devices/{id},
// /devices/{id}/status, /devices/{id}/health, /devices/{id}/commands

function makeResponse(status, payload) {
    const body = JSON.stringify(payload === undefined ? {} : payload);
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : (status === 404 ? 'Not Found' : 'Error'),
        json: async () => JSON.parse(body),
        text: async () => body
    };
}

async function request(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const cleanPath = String(endpoint).split('?')[0];

    try {
        if (cleanPath === '/devices' && method === 'GET') {
            const devices = await loadDevices(true);
            const items = devices.map(device => {
                const cached = statusCache[device.id];
                return mapper.deviceToDashboard(device, cached ? cached.components : null);
            });
            return makeResponse(200, { items });
        }

        const match = cleanPath.match(/^\/devices\/([^/]+)(?:\/(status|health|commands))?$/);
        if (!match) {
            return makeResponse(404, { error: `Неизвестный путь ${cleanPath}` });
        }

        const deviceId = match[1];
        const action = match[2];

        if (!action && method === 'GET') {
            await loadDevices();
            let device = findDevice(deviceId);
            if (!device) {
                device = await api.getDeviceInfo(deviceId);
            }
            let components = statusCache[deviceId] && statusCache[deviceId].components;
            if (!components) {
                try { components = (await loadStatus(deviceId)).components; } catch (error) { components = null; }
            }
            return makeResponse(200, mapper.deviceToDashboard(device, components));
        }

        if (action === 'status' && method === 'GET') {
            const { components } = await loadStatus(deviceId);
            return makeResponse(200, { components });
        }

        if (action === 'health' && method === 'GET') {
            await loadDevices();
            const device = findDevice(deviceId);
            const online = device ? device.online !== false : true;
            return makeResponse(200, {
                deviceId,
                state: online ? 'ONLINE' : 'OFFLINE',
                lastUpdatedDate: new Date().toISOString()
            });
        }

        if (action === 'commands' && method === 'POST') {
            const payload = options.body ? JSON.parse(options.body) : {};
            const commands = payload.commands || [];
            const cached = statusCache[deviceId] || (await loadStatus(deviceId));
            const tuyaCommands = [];

            for (const item of commands) {
                const mapped = mapper.commandToTuya(item.capability, item.command, item.arguments || [], cached.map || {});
                if (mapped === null) {
                    log('error', `Нет маппинга для ${item.capability}/${item.command}`);
                    return makeResponse(422, { error: `Команда ${item.capability}/${item.command} не поддерживается для Tuya` });
                }
                tuyaCommands.push(...mapped);
            }

            if (!tuyaCommands.length) {
                // refresh и прочие пустые команды — просто переспрашиваем статус
                await loadStatus(deviceId);
                return makeResponse(200, { results: [{ status: 'COMPLETED' }] });
            }

            await api.sendCommands(deviceId, tuyaCommands);
            log('info', `Команда на ${deviceId}: ${tuyaCommands.map(c => `${c.code}=${c.value}`).join(', ')}`);
            return makeResponse(200, { results: [{ status: 'ACCEPTED' }] });
        }

        return makeResponse(404, { error: `Неизвестный запрос ${method} ${cleanPath}` });
    } catch (error) {
        const authError = error.tuyaCode === 1004 || error.tuyaCode === 1106 || error.tuyaCode === 1010;
        log('error', `${method} ${cleanPath}: ${error.message}`);
        return makeResponse(authError ? 401 : 502, { error: error.message });
    }
}

// ---------- Статус для админки ----------

async function healthCheck() {
    const result = await api.healthCheck();
    log(result.ok ? 'info' : 'error', result.ok
        ? `Подключение к Tuya Cloud в порядке, устройств: ${result.devices}`
        : `Проверка подключения не удалась: ${result.error}`);
    return result;
}

function status() {
    return {
        cloud: api.status(),
        devices: deviceCache.length,
        devicesLoadedAt: deviceCacheAt ? new Date(deviceCacheAt).toISOString() : null,
        statuses: Object.keys(statusCache).length,
        doorbell: getDoorbell(),
        keys: config.publicView()
    };
}

module.exports = {
    request,
    loadDevices,
    loadStatus,
    getDoorbell,
    refreshDoorbell,
    getSmokeDetector,
    healthCheck,
    status,
    getLogs,
    log,
    config,
    api,
    mapper
};
