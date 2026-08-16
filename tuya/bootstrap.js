// ==========================================
// Подмена источника устройств: SmartThings → Tuya Cloud
//
// server.js не трогаем вообще. Вместо этого подменяем модули,
// которые он загружает:
//   node-fetch      — все вызовы api.smartthings.com/v1/* уезжают в Tuya OpenAPI
//   ./token-manager — OAuth SmartThings больше не нужен
//   express         — чтобы добавить свои роуты ДО роутов server.js
//   socket.io       — чтобы рассылать события звонка и дыма
// ==========================================
const Module = require('module');

const realFetch = require('node-fetch');
const adapter = require('./adapter');
const routes = require('./routes');

const ST_PREFIX = 'https://api.smartthings.com/v1';
const POLL_INTERVAL_MS = 60 * 1000;

let io = null;
let routesRegistered = false;
let pollTimer = null;

// ---------- 1. fetch: SmartThings → Tuya ----------
async function patchedFetch(url, options = {}) {
    const target = typeof url === 'string' ? url : (url && url.href) || (url && url.url) || '';
    if (target.indexOf(ST_PREFIX) === 0) {
        const endpoint = target.slice(ST_PREFIX.length) || '/';
        return adapter.request(endpoint, options);
    }
    return realFetch(url, options);
}
Object.keys(realFetch).forEach(key => { patchedFetch[key] = realFetch[key]; });
patchedFetch.default = patchedFetch;

// ---------- 2. заглушка token-manager ----------
const tokenManagerStub = {
    getCurrentToken: () => 'tuya-cloud',
    startAutoRefresh: () => {},
    exchangeCodeAndSave: async () => ({ ok: false, error: 'SmartThings больше не используется' }),
    createOAuthApp: async () => ({ ok: false, error: 'SmartThings больше не используется' }),
    ST_SCOPES: []
};

// ---------- 3. опрос звонка и датчика дыма ----------
function startPolling() {
    if (pollTimer) return;

    const tick = () => {
        adapter.refreshDoorbell().then(state => {
            if (io && state && state.snapshotAt) io.emit('doorbell-snapshot', state);
        }).catch(() => {});

        adapter.getSmokeDetector({ refresh: true }).then(state => {
            if (io) io.emit('smoke-detector', state);
            if (state && state.status === 'smoke') {
                adapter.log('error', 'Датчик дыма сработал!');
                if (io) io.emit('notification', {
                    title: 'Дым!',
                    message: 'Датчик дыма сработал',
                    severity: 'critical',
                    timestamp: new Date().toISOString()
                });
            }
        }).catch(() => {});
    };

    pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    setTimeout(tick, 5000);
}

// ---------- 4. сама подмена загрузки модулей ----------
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
    if (request === 'node-fetch') {
        return patchedFetch;
    }

    if (request === './token-manager' || request === './token-manager.js') {
        return tokenManagerStub;
    }

    if (request === 'express') {
        const realExpress = originalLoad.apply(this, arguments);
        if (realExpress.__tuyaWrapped) return realExpress;

        const wrapped = function (...args) {
            const app = realExpress(...args);
            if (!routesRegistered) {
                routesRegistered = true;
                try {
                    routes.register(app, realExpress, () => io);
                } catch (error) {
                    console.error('[tuya] Не удалось зарегистрировать роуты:', error.message);
                }
            }
            return app;
        };
        Object.keys(realExpress).forEach(key => { wrapped[key] = realExpress[key]; });
        wrapped.__tuyaWrapped = true;
        return wrapped;
    }

    if (request === 'socket.io') {
        const realSocketIo = originalLoad.apply(this, arguments);
        if (realSocketIo.__tuyaWrapped) return realSocketIo;

        const wrapped = function (...args) {
            const instance = new realSocketIo.Server(...args);
            io = instance;
            startPolling();
            return instance;
        };
        Object.keys(realSocketIo).forEach(key => { wrapped[key] = realSocketIo[key]; });
        wrapped.__tuyaWrapped = true;
        return wrapped;
    }

    return originalLoad.apply(this, arguments);
};

// ---------- 5. стартовая проверка ----------
adapter.healthCheck().then(result => {
    if (result.ok) {
        console.log(`[tuya] Подключено к Tuya Cloud. Устройств в аккаунте: ${result.devices}`);
    } else {
        console.error(`[tuya] Нет связи с Tuya Cloud: ${result.error}`);
        console.error('[tuya] Проверь Client ID / Secret и дата-центр в /admin');
    }
}).catch(() => {});

module.exports = { adapter, getIo: () => io };
