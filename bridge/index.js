// ==========================================
// bridge/index.js
// Точка интеграции моста:
//
//   const { initBridge } = require('./bridge');
//   initBridge({ app, io });
//
// При запуске через app.js это делается автоматически.
// ==========================================

const fs = require('fs-extra');
const express = require('express');

const config = require('./config-store');
const tuya = require('./tuya');
const smartthings = require('./smartthings');
const engine = require('./sync-engine');
const reverse = require('./reverse-sync');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '651956';

function requireAdmin(req, res) {
    const password = String((req.body && req.body.password) || req.get('x-admin-password') || '').trim();
    if (password !== ADMIN_PASSWORD) {
        res.status(401).json({ success: false, error: 'Неверный пароль администратора' });
        return false;
    }
    return true;
}

function buildRouter() {
    const router = express.Router();
    router.use(express.json());

    // ---------- Статус моста ----------
    router.get('/api/bridge/status', (req, res) => {
        res.json({ success: true, ...engine.getPublicState(), reverseSync: reverse.getState() });
    });

    router.get('/api/bridge/logs', (req, res) => {
        const limit = Math.min(200, Number(req.query.limit) || 100);
        res.json({ success: true, logs: engine.getLogs(limit) });
    });

    // ---------- Диагностика ----------
    router.get('/api/bridge/diagnostics', async (req, res) => {
        try {
            const [tuyaResult, stResult, stDevices] = await Promise.all([
                tuya.healthCheck(),
                smartthings.healthCheck(),
                smartthings.diagnose().catch((error) => ({ error: error.message }))
            ]);
            res.json({
                success: true,
                tuya: tuyaResult,
                smartthings: stResult,
                smartthingsDevices: stDevices,
                reverseSync: reverse.getState(),
                keys: config.getMasked()
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ---------- Ручная синхронизация ----------
    router.post('/api/sync/now', async (req, res) => {
        try {
            const result = await engine.runSync({ trigger: 'manual' });
            res.json({ success: result.success !== false, ...result, logs: engine.getLogs(30) });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ---------- Health check ----------
    const health = async (req, res) => {
        try {
            const result = await engine.healthCheck();
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    };
    router.post('/api/bridge/health', health);
    router.get('/api/bridge/health', health);

    // ---------- Ключи и настройки ----------
    router.get('/api/settings/keys', (req, res) => {
        res.json({ success: true, keys: config.getMasked() });
    });

    router.post('/api/settings/keys', (req, res) => {
        if (!requireAdmin(req, res)) return;
        try {
            const payload = { ...(req.body || {}) };
            delete payload.password;
            const keys = config.save(payload);

            tuya.invalidateToken();
            engine.startScheduler();
            reverse.start();
            engine.log('info', 'Ключи обновлены через админ-панель');

            res.json({ success: true, keys });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ---------- Управление LED ----------
    router.post('/api/bridge/led', async (req, res) => {
        try {
            const { on, level } = req.body || {};
            const result = await engine.setLed({ on, level });
            res.json({ success: true, led: result });
        } catch (error) {
            engine.log('error', `Управление LED: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ---------- Кадр с дверного звонка ----------
    router.get('/api/bridge/doorbell/snapshot', (req, res) => {
        if (!fs.existsSync(engine.SNAPSHOT_FILE)) {
            return res.status(404).json({ success: false, error: 'Снимок ещё не получен' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(engine.SNAPSHOT_FILE);
    });

    // ---------- Сырой статус устройства Tuya (диагностика) ----------
    router.get('/api/bridge/tuya/:deviceId/status', async (req, res) => {
        try {
            const status = await tuya.getDeviceStatus(req.params.deviceId);
            res.json({ success: true, status });
        } catch (error) {
            res.status(502).json({ success: false, error: error.message });
        }
    });

    return router;
}

function initBridge({ app, io } = {}) {
    if (!app) throw new Error('initBridge: не передан экземпляр express-приложения');

    app.use(buildRouter());

    if (io) {
        engine.setSocketServer(io);
        io.on('connection', (socket) => {
            socket.emit('bridge-update', engine.getPublicState());

            socket.on('bridge-request-state', () => {
                socket.emit('bridge-update', engine.getPublicState());
            });

            socket.on('bridge-sync-now', async () => {
                await engine.runSync({ trigger: 'socket' }).catch(() => {});
            });

            socket.on('bridge-led-set', async (payload = {}) => {
                try {
                    const led = await engine.setLed({ on: payload.on, level: payload.level });
                    socket.emit('bridge-led-result', { success: true, led });
                } catch (error) {
                    socket.emit('bridge-led-result', { success: false, error: error.message });
                }
            });
        });
    }

    engine.startScheduler();
    reverse.start();
    engine.log('info', 'Мост Tuya <-> SmartThings инициализирован');

    return { config, tuya, smartthings, engine, reverse };
}

module.exports = {
    initBridge,
    config,
    tuya,
    smartthings,
    engine,
    reverse
};
