// ==========================================
// bridge/defaults.js
// Fallback-значения конфигурации моста.
// Приоритет источников (от низшего к высшему):
//   defaults.js  ->  .env (process.env)  ->  data/bridge-settings.json (из админки)
// ==========================================

module.exports = {
    // Tuya OpenAPI
    TUYA_CLIENT_ID: '3efgnhtcmqtc4h7fxk8c',
    TUYA_CLIENT_SECRET: 'd45bde1ed4a443bfa09437e52ae188ce',
    TUYA_ENDPOINT: 'https://openapi.tuyaeu.com',
    TUYA_PROJECT_CODE: 'p1786794003140jfs89g',

    // Физические устройства Tuya
    TUYA_TEMP_DEVICE_ID: 'bf92808ce982033cbaia4b',
    TUYA_LED_DEVICE_ID: 'bf44f166005ea9bfceu3bx',
    TUYA_DOORBELL_DEVICE_ID: 'bf0c1a2c570f440357gbdo',

    // SmartThings
    ST_API_URL: 'https://api.smartthings.com/v1',
    ST_PAT_TOKEN: '',
    ST_TEMP_DEVICE_ID: '4c246ef1-b9cd-454b-8917-02ea13594bff',
    ST_LED_DEVICE_ID: 'e7a5783d-5fa2-44d9-8346-c6122b35bcd5',
    ST_DOORBELL_DEVICE_ID: '4e6c4596-9d7e-439a-a908-15a028573784',

    // Общие параметры
    SYNC_INTERVAL_MINUTES: '5',
    // auto | 1 | 10 | 100 — делитель сырого значения температуры Tuya
    TUYA_TEMP_SCALE: 'auto',
    BRIDGE_ENABLED: 'true'
};
