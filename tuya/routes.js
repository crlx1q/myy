// ==========================================
// Дополнительные роуты: ключи Tuya, диагностика,
// живой датчик дыма и кадры дверного звонка.
// Регистрируются РАНЬШЕ роутов server.js, поэтому перекрывают старые заглушки.
// ==========================================
const adapter = require('./adapter');
const config = require('./config');

function adminOk(req) {
    const password = (req.body && req.body.password)
        || (req.query && req.query.password)
        || req.headers['x-admin-password'];
    return password === (process.env.ADMIN_PASSWORD || '651956');
}

function register(app, express, getIo) {
    // Свой парсер JSON — server.js подключает свой позже
    app.use('/api/tuya', express.json());

    // ---------- ключи ----------
    app.get('/api/tuya/keys', (req, res) => {
        if (!adminOk(req)) return res.status(401).json({ success: false, error: 'Нужен пароль админа' });
        res.json({ success: true, keys: config.publicView() });
    });

    app.post('/api/tuya/keys', (req, res) => {
        if (!adminOk(req)) return res.status(401).json({ success: false, error: 'Нужен пароль админа' });
        try {
            const patch = { ...(req.body || {}) };
            delete patch.password;
            const keys = config.update(patch);
            adapter.api.invalidateToken();
            adapter.log('info', 'Ключи обновлены из админки');
            adapter.loadDevices(true).catch(() => {});
            res.json({ success: true, keys });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ---------- диагностика ----------
    app.get('/api/tuya/status', (req, res) => {
        res.json({ success: true, ...adapter.status(), logs: adapter.getLogs(40) });
    });

    app.all('/api/tuya/health', async (req, res) => {
        const result = await adapter.healthCheck();
        res.status(result.ok ? 200 : 502).json(result);
    });

    app.all('/api/tuya/refresh', async (req, res) => {
        try {
            const devices = await adapter.loadDevices(true);
            res.json({ success: true, devices: devices.length });
        } catch (error) {
            res.status(502).json({ success: false, error: error.message });
        }
    });

    app.get('/api/tuya/device/:deviceId/status', async (req, res) => {
        try {
            const result = await adapter.loadStatus(req.params.deviceId);
            res.json({ success: true, dp: result.map, components: result.components });
        } catch (error) {
            res.status(502).json({ success: false, error: error.message });
        }
    });

    // ---------- дверной звонок: кадры вместо потока ----------
    app.get('/api/security/doorbell', async (req, res) => {
        try {
            const state = req.query.refresh === '1'
                ? await adapter.refreshDoorbell()
                : adapter.getDoorbell();
            res.json(state);
        } catch (error) {
            res.json({ status: 'idle', hasVisitor: false, error: error.message });
        }
    });

    app.all('/api/security/doorbell/snapshot', async (req, res) => {
        try {
            const state = await adapter.refreshDoorbell();
            const io = getIo();
            if (io) io.emit('doorbell-snapshot', state);
            res.json({ success: true, ...state });
        } catch (error) {
            res.status(502).json({ success: false, error: error.message });
        }
    });

    // ---------- датчик дыма ----------
    app.get('/api/security/smoke-detector', async (req, res) => {
        try {
            const state = await adapter.getSmokeDetector({ refresh: req.query.refresh === '1' });
            res.json(state);
        } catch (error) {
            res.json({ status: 'normal', text: 'Всё в порядке', error: error.message });
        }
    });

    adapter.log('info', 'Роуты Tuya зарегистрированы');
}

module.exports = { register };
