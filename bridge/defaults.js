// ==========================================
// bridge/defaults.js
// Fallback-значения. Приоритет: data/bridge-settings.json > .env > этот файл.
// ==========================================

module.exports = {
    // Tuya OpenAPI
    TUYA_CLIENT_ID: '3efgnhtcmqtc4h7fxk8c',
    TUYA_CLIENT_SECRET: 'd45bde1ed4a443bfa09437e52ae188ce',
    TUYA_ENDPOINT: 'https://openapi.tuyaeu.com',
    TUYA_PROJECT_CODE: 'p1786794003140jfs89g',

    // Физические устройства
    TUYA_TEMP_DEVICE_ID: 'bf92808ce982033cbaia4b',
    TUYA_LED_DEVICE_ID: 'bf44f166005ea9bfceu3bx',
    TUYA_DOORBELL_DEVICE_ID: 'bf0c1a2c570f440357gbdo',

    // Общие параметры
    SYNC_INTERVAL_MINUTES: '5',
    // auto | 1 | 10 | 100 — делитель сырого значения температуры
    TUYA_TEMP_SCALE: 'auto',
    // auto | bright_value | bright_value_v2
    TUYA_BRIGHT_CODE: 'auto'
};
