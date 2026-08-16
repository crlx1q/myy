// ==========================================
// Маппинг Tuya ↔ модель устройств дашборда (components/capabilities)
// Фронтенд остался без изменений: он ждёт такую же структуру, что и раньше
// ==========================================
const config = require('./config');

const SWITCH_CODES = ['switch_led', 'switch', 'switch_1', 'switch_2', 'led_switch'];
const BRIGHT_CODES = ['bright_value_v2', 'bright_value'];
const TEMP_CODES = ['va_temperature', 'temp_current', 'temperature', 'temp_indoor'];
const HUMIDITY_CODES = ['va_humidity', 'humidity_value', 'humidity_current', 'humidity'];
const BATTERY_CODES = ['battery_percentage', 'residual_electricity', 'va_battery', 'battery_state'];
const SMOKE_CODES = ['smoke_sensor_status', 'smoke_sensor_state', 'smoke_sensor_value', 'smoke_state'];
const MOTION_CODES = ['pir', 'presence_state', 'movement_detect_pic'];
const DOORBELL_PIC_CODES = ['doorbell_pic', 'movement_detect_pic', 'ipc_pic'];
const POWER_CODES = ['cur_power'];
const CONTACT_CODES = ['doorcontact_state'];
const WATER_CODES = ['watersensor_state'];
const CO_CODES = ['co_state', 'co_status'];

function statusToMap(statusArray) {
    const map = {};
    (statusArray || []).forEach(item => {
        if (item && item.code !== undefined) map[item.code] = item.value;
    });
    return map;
}

function pick(map, codes) {
    for (const code of codes) {
        if (map[code] !== undefined && map[code] !== null && map[code] !== '') {
            return { code, value: map[code] };
        }
    }
    return null;
}

function scaleTemperature(raw) {
    const mode = String(config.get('TUYA_TEMP_SCALE') || 'auto').toLowerCase();
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (mode === '1') return value;
    if (mode === '10') return value / 10;
    if (mode === '100') return value / 100;
    // auto: подбираем делитель по порядку величины
    const abs = Math.abs(value);
    if (abs > 800) return value / 100;
    if (abs > 80) return value / 10;
    return value;
}

function brightnessToPercent(code, raw) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (code === 'bright_value_v2') return Math.round(value / 10);
    if (value > 255) return Math.round(value / 10);
    return Math.round(value / 2.55);
}

function percentToBrightness(code, percent) {
    const clamped = Math.max(1, Math.min(100, Number(percent) || 0));
    if (code === 'bright_value_v2') return Math.max(10, Math.round(clamped * 10));
    return Math.max(25, Math.round(clamped * 2.55));
}

function isTruthy(value) {
    if (typeof value === 'boolean') return value;
    const text = String(value).toLowerCase();
    return text === 'true' || text === '1' || text === 'on';
}

// Tuya-статус → components.main.{capability:{attribute:{value}}}
function statusToComponents(statusArray, device = {}) {
    const map = statusToMap(statusArray);
    const main = {};
    const set = (capability, attribute, value, unit) => {
        if (value === null || value === undefined) return;
        main[capability] = main[capability] || {};
        main[capability][attribute] = unit ? { value, unit } : { value };
    };

    const sw = pick(map, SWITCH_CODES);
    if (sw) set('switch', 'switch', isTruthy(sw.value) ? 'on' : 'off');

    const bright = pick(map, BRIGHT_CODES);
    if (bright) {
        const percent = brightnessToPercent(bright.code, bright.value);
        if (percent !== null) set('switchLevel', 'level', percent, '%');
    }

    if (map.temp_value_v2 !== undefined || map.temp_value !== undefined) {
        const raw = map.temp_value_v2 !== undefined ? map.temp_value_v2 : map.temp_value;
        const kelvin = 2700 + Math.round((Number(raw) / (map.temp_value_v2 !== undefined ? 1000 : 255)) * (6500 - 2700));
        set('colorTemperature', 'colorTemperature', kelvin, 'K');
    }

    const colour = map.colour_data_v2 || map.colour_data;
    if (colour) {
        try {
            const parsed = typeof colour === 'string' ? JSON.parse(colour) : colour;
            if (parsed && parsed.h !== undefined) {
                set('colorControl', 'hue', Math.round((Number(parsed.h) / 360) * 100));
                set('colorControl', 'saturation', Math.round(Number(parsed.s) / 10));
            }
        } catch (error) { /* игнорируем кривой JSON */ }
    }

    const temp = pick(map, TEMP_CODES);
    if (temp) set('temperatureMeasurement', 'temperature', scaleTemperature(temp.value), 'C');

    const humidity = pick(map, HUMIDITY_CODES);
    if (humidity) {
        const value = Number(humidity.value);
        set('relativeHumidityMeasurement', 'humidity', value > 100 ? Math.round(value / 10) : value, '%');
    }

    const battery = pick(map, BATTERY_CODES);
    if (battery && Number.isFinite(Number(battery.value))) {
        set('battery', 'battery', Number(battery.value), '%');
    }

    const power = pick(map, POWER_CODES);
    if (power) set('powerMeter', 'power', Number(power.value) / 10, 'W');

    const smoke = pick(map, SMOKE_CODES);
    if (smoke) {
        const raw = String(smoke.value).toLowerCase();
        const detected = raw === 'alarm' || raw === '1' || raw === 'true' || raw === 'smoke';
        set('smokeDetector', 'smoke', detected ? 'detected' : 'clear');
    }

    const co = pick(map, CO_CODES);
    if (co) {
        const raw = String(co.value).toLowerCase();
        set('carbonMonoxideDetector', 'carbonMonoxide', (raw === 'alarm' || raw === '1') ? 'detected' : 'clear');
    }

    const motion = pick(map, MOTION_CODES);
    if (motion) {
        const raw = String(motion.value).toLowerCase();
        const active = raw === 'pir' || raw === 'presence' || raw === 'motion' || raw === 'true' || raw === '1';
        set('motionSensor', 'motion', active ? 'active' : 'inactive');
    }

    const contact = pick(map, CONTACT_CODES);
    if (contact) set('contactSensor', 'contact', isTruthy(contact.value) ? 'open' : 'closed');

    const water = pick(map, WATER_CODES);
    if (water) set('waterSensor', 'water', isTruthy(water.value) ? 'wet' : 'dry');

    const pic = pick(map, DOORBELL_PIC_CODES);
    if (pic) set('imageCapture', 'image', String(pic.value));

    // Всегда отдаём сырые DP — удобно для отладки и редких функций
    main.tuyaRaw = { dp: { value: map } };
    main.refresh = {};
    main.healthCheck = { checkInterval: { value: 60 } };

    if (device && device.online !== undefined) {
        main.healthCheck.healthStatus = { value: device.online ? 'online' : 'offline' };
    }

    return { main };
}

function capabilitiesFromComponents(components) {
    return Object.keys((components && components.main) || {}).map(id => ({ id, version: 1 }));
}

function categoryLabel(device) {
    const category = String(device.category || '').toLowerCase();
    const map = {
        dj: 'Лампа', dd: 'Лента', dc: 'Гирлянда', xdd: 'Люстра',
        kg: 'Выключатель', cz: 'Розетка', pc: 'Удлинитель',
        wsdcg: 'Датчик температуры', wnykq: 'ИК-пульт',
        ywbj: 'Датчик дыма', cobj: 'Датчик CO', sj: 'Датчик протечки',
        mcs: 'Датчик открытия', pir: 'Датчик движения',
        sp: 'Камера', mk: 'Домофон'
    };
    return map[category] || '';
}

// Tuya-устройство → объект устройства для дашборда
function deviceToDashboard(device, components = null) {
    const label = device.name || device.custom_name || categoryLabel(device) || device.id;
    return {
        deviceId: device.id,
        name: device.product_name || label,
        label,
        deviceTypeName: categoryLabel(device) || device.product_name || 'Tuya',
        deviceManufacturerCode: 'Tuya',
        manufacturerName: 'Tuya',
        presentationId: device.product_id || device.category || 'tuya',
        roomId: device.room_id || null,
        online: device.online !== false,
        tuya: {
            category: device.category || null,
            productName: device.product_name || null,
            ip: device.ip || null,
            model: device.model || null
        },
        components: [{
            id: 'main',
            capabilities: components ? capabilitiesFromComponents(components) : [{ id: 'refresh', version: 1 }],
            categories: [{ name: 'Other', categoryType: 'manufacturer' }]
        }]
    };
}

// Команда дашборда → команды Tuya DP
function commandToTuya(capability, command, args = [], statusMap = {}) {
    const switchCode = (pick(statusMap, SWITCH_CODES) || { code: 'switch_led' }).code;
    const brightCode = (pick(statusMap, BRIGHT_CODES) || { code: 'bright_value_v2' }).code;

    if (capability === 'switch' || command === 'on' || command === 'off') {
        if (command === 'on' || command === 'off') {
            return [{ code: switchCode, value: command === 'on' }];
        }
        if (command === 'toggle') {
            const current = isTruthy(statusMap[switchCode]);
            return [{ code: switchCode, value: !current }];
        }
    }

    if (capability === 'switchLevel' && command === 'setLevel') {
        const percent = Number(args[0]);
        const commands = [{ code: switchCode, value: true }];
        if (statusMap.work_mode !== undefined) commands.push({ code: 'work_mode', value: 'white' });
        commands.push({ code: brightCode, value: percentToBrightness(brightCode, percent) });
        return commands;
    }

    if (capability === 'colorControl' && command === 'setColor') {
        const color = args[0] || {};
        const hue = Math.round(((Number(color.hue) || 0) / 100) * 360);
        const saturation = Math.round((Number(color.saturation) || 0) * 10);
        const value = Math.round((Number(color.level) || 100) * 10);
        const code = statusMap.colour_data_v2 !== undefined ? 'colour_data_v2' : 'colour_data';
        return [
            { code: switchCode, value: true },
            { code: 'work_mode', value: 'colour' },
            { code, value: JSON.stringify({ h: hue, s: Math.min(1000, saturation), v: Math.min(1000, value) }) }
        ];
    }

    if (capability === 'colorTemperature' && command === 'setColorTemperature') {
        const kelvin = Math.max(2700, Math.min(6500, Number(args[0]) || 4000));
        const ratio = (kelvin - 2700) / (6500 - 2700);
        const code = statusMap.temp_value_v2 !== undefined ? 'temp_value_v2' : 'temp_value';
        return [
            { code: switchCode, value: true },
            { code: 'work_mode', value: 'white' },
            { code, value: Math.round(ratio * (code === 'temp_value_v2' ? 1000 : 255)) }
        ];
    }

    if (capability === 'refresh' || command === 'refresh') {
        return [];
    }

    // Проброс сырого DP: capability = 'tuyaRaw', command = имя DP
    if (capability === 'tuyaRaw' && command) {
        return [{ code: command, value: args.length ? args[0] : true }];
    }

    return null;
}

module.exports = {
    statusToMap,
    statusToComponents,
    deviceToDashboard,
    commandToTuya,
    brightnessToPercent,
    percentToBrightness,
    scaleTemperature,
    DOORBELL_PIC_CODES,
    SMOKE_CODES
};
