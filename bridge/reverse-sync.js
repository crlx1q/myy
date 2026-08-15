// ==========================================
// bridge/reverse-sync.js
// Обратная синхронизация: SmartThings -> Tuya.
//
// Зачем: виртуальное устройство в SmartThings — это только "зеркало".
// Когда ты жмёшь ВКЛ в приложении SmartThings, команда НИКУДА не уходит —
// меняется только атрибут самого виртуального устройства. Чтобы физическая
// LED-лента Tuya реагировала, мост опрашивает статус виртуалки и прокидывает
// изменения в Tuya OpenAPI.
//
// Отключить:      ST_REVERSE_SYNC=false
// Интервал опроса: ST_POLL_SECONDS=20 (минимум 10)
// ==========================================

const config = require('./config-store');
const smartthings = require('./smartthings');
const engine = require('./sync-engine');

let timer = null;
let primed = false;
let last = { switch: null, level: null };
let lastPollAt = null;
let lastPollError = null;

function isEnabled() {
    if (String(process.env.ST_REVERSE_SYNC || '').toLowerCase() === 'false') return false;
    try {
        if (config.getBool && config.getBool('ST_REVERSE_SYNC', true) === false) return false;
    } catch (error) { /* ключ может быть не описан в config-store */ }
    return true;
}

function pollSeconds() {
    const fromEnv = Number(process.env.ST_POLL_SECONDS);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.max(10, fromEnv);
    return 20;
}

function readAttribute(components, capability, attribute) {
    const main = (components && components.main) || {};
    const cap = main[capability];
    if (!cap || !cap[attribute]) return null;
    const value = cap[attribute].value;
    return value === undefined ? null : value;
}

async function tick() {
    if (!isEnabled()) return;

    const deviceId = config.get('ST_LED_DEVICE_ID');
    if (!deviceId) return;
    if (smartthings.isAuthBlocked()) return;

    try {
        const status = await smartthings.getDeviceStatus(deviceId);
        lastPollAt = new Date().toISOString();
        lastPollError = null;

        const switchValue = readAttribute(status.components, 'switch', 'switch');
        const levelValue = readAttribute(status.components, 'switchLevel', 'level');

        if (!primed) {
            last = { switch: switchValue, level: levelValue };
            primed = true;
            return;
        }

        const payload = {};
        if (switchValue !== null && switchValue !== last.switch) payload.on = switchValue === 'on';
        if (levelValue !== null && Number(levelValue) !== Number(last.level)) payload.level = Number(levelValue);

        last = { switch: switchValue, level: levelValue };

        if (Object.keys(payload).length) {
            engine.log('info', `SmartThings -> Tuya: ${JSON.stringify(payload)}`);
            await engine.setLed(payload);
        }
    } catch (error) {
        lastPollError = error.message;
        engine.log('warn', `Обратная синхронизация SmartThings: ${error.message}`);
    }
}

function start() {
    stop();
    if (!isEnabled()) {
        engine.log('warn', 'Обратная синхронизация SmartThings -> Tuya выключена');
        return;
    }

    const seconds = pollSeconds();
    timer = setInterval(() => {
        tick().catch(() => {});
    }, seconds * 1000);
    if (timer.unref) timer.unref();

    engine.log('info', `Обратная синхронизация SmartThings -> Tuya: опрос каждые ${seconds} с`);
}

function stop() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    primed = false;
}

function getState() {
    return {
        enabled: isEnabled(),
        pollSeconds: pollSeconds(),
        lastPollAt,
        lastPollError,
        lastKnown: { ...last }
    };
}

module.exports = { start, stop, tick, getState };
