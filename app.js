// ==========================================
// app.js — единая точка входа проекта.
//
// Зачем нужен: чтобы подключить мост Tuya, НЕ трогая server.js
// (2100+ строк рабочей логики). Здесь мы:
//   1) перехватываем создание express-приложения и socket.io-сервера,
//   2) запускаем оригинальный server.js как есть,
//   3) поверх него монтируем маршруты моста и клиентский скрипт.
//
// Запуск: npm start   (node app.js)
// Старый способ:      npm run start:legacy  (node server.js, без моста)
// ==========================================

require('dotenv').config();

const path = require('path');

const captured = { app: null, io: null };

// ---------- 1. Перехват express ----------
function patchExpress() {
    const expressPath = require.resolve('express');
    const original = require('express');
    if (original.__bridgePatched) return;

    const wrapped = function (...args) {
        const app = original.apply(this, args);
        if (!captured.app) captured.app = app;
        return app;
    };

    Object.setPrototypeOf(wrapped, original);
    Object.assign(wrapped, original);
    wrapped.__bridgePatched = true;

    require.cache[expressPath].exports = wrapped;
}

// ---------- 2. Перехват socket.io ----------
function patchSocketIo() {
    let sioPath;
    try {
        sioPath = require.resolve('socket.io');
    } catch (e) {
        return; // socket.io не установлен — работаем только по REST
    }

    const original = require('socket.io');
    if (original.__bridgePatched) return;

    const OriginalServer = original.Server || original;

    const wrapped = function (...args) {
        const io = new OriginalServer(...args);
        if (!captured.io) captured.io = io;
        return io;
    };

    Object.setPrototypeOf(wrapped, OriginalServer);
    Object.assign(wrapped, original);
    wrapped.prototype = OriginalServer.prototype;
    wrapped.Server = wrapped;
    wrapped.__bridgePatched = true;

    require.cache[sioPath].exports = wrapped;
}

patchExpress();
patchSocketIo();

// ---------- 3. Запуск оригинального сервера ----------
require('./server.js');

// ---------- 4. Монтирование моста ----------
function mountBridge() {
    const app = captured.app;

    if (!app) {
        console.error('[bridge] Не удалось перехватить express-приложение из server.js.');
        console.error('[bridge] Мост не запущен. Добавьте вручную в server.js после app.use(express.json()):');
        console.error("[bridge]   const { initBridge } = require('./bridge'); initBridge({ app, io });");
        return;
    }

    const { initBridge } = require('./bridge');
    const { injectClientScript } = require('./bridge/html-inject');

    const stack = () => (app._router && app._router.stack) || [];
    const before = stack().length;

    app.use(injectClientScript({ rootDir: __dirname }));
    initBridge({ app, io: captured.io });

    // Поднимаем слои моста в начало стека, чтобы их не перехватили
    // express.static и возможные catch-all маршруты server.js.
    const layers = stack();
    if (layers.length > before) {
        const added = layers.splice(before, layers.length - before);
        layers.splice(Math.min(2, layers.length), 0, ...added);
    }

    if (!captured.io) {
        console.warn('[bridge] socket.io не перехвачен — данные будут обновляться только по REST.');
    }

    console.log('[bridge] Мост Tuya подключён поверх server.js');
}

setImmediate(() => {
    try {
        mountBridge();
    } catch (error) {
        console.error('[bridge] Ошибка инициализации моста:', error.message);
    }
});

// ---------- 5. Мост не должен ронять процесс ----------
process.on('unhandledRejection', (reason) => {
    console.error('[bridge] Необработанный rejection:', reason && reason.message ? reason.message : reason);
});

module.exports = { captured, rootDir: path.resolve(__dirname) };
