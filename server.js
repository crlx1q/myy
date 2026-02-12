// Загружаем переменные окружения из .env файла (если есть)
require('dotenv').config();

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs-extra');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ==========================================
// НАСТРОЙКИ API (хранятся в переменных окружения)
// ==========================================
const SMARTTHINGS_API_URL = 'https://api.smartthings.com/v1';
const SMARTTHINGS_PAT = process.env.SMARTTHINGS_PAT; // Personal Access Token

const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;
const WEATHER_CITY = process.env.WEATHER_CITY;

// Интервалы обновления данных
const LIGHT_REFRESH_INTERVAL = 180000; // 3 минуты (увеличено с 2)
const HEAVY_REFRESH_INTERVAL = 1800000; // 30 минут (увеличено с 15)
const WEATHER_REFRESH_INTERVAL = 600000; // 10 минут
const STATUS_REFRESH_BATCH_SIZE = 6;
const CAPABILITY_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 часа
const API_REQUEST_DELAY = 200; // Задержка между запросами к API (мс)
const SMARTTHINGS_MAX_RETRIES = 2;
const SMARTTHINGS_AUTH_COOLDOWN_MS = 15 * 60 * 1000;

// Пути к файлам данных
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SCENES_FILE = path.join(DATA_DIR, 'scenes.json');
const AUTOMATIONS_FILE = path.join(DATA_DIR, 'automations.json');
const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const HIDDEN_DEVICES_FILE = path.join(DATA_DIR, 'hidden-devices.json');

// Создаем директорию data если её нет
fs.ensureDirSync(DATA_DIR);

// ==========================================
// ХРАНИЛИЩЕ ДАННЫХ
// ==========================================
let currentDevices = [];
let deviceStates = {}; // { deviceId: { component: { capability: { value: ... } } } }
let deviceLastSeen = {}; // { deviceId: timestamp } - время последнего успешного подключения устройства
let deviceTypes = {}; // { deviceId: { isTV: boolean, isTemperatureSensor: boolean } } - типы устройств
let deviceHealth = {}; // { deviceId: { state: 'ONLINE'|'OFFLINE', ... } } - статус здоровья устройства
let weatherData = null;
let forecastData = null;
let eventHistory = {
    events: [],
        temperature: [],
        humidity: [],
    power: [],
    notifications: []
};
let scenes = [];
let automations = [];
let schedules = [];
let hiddenDevices = []; // Список скрытых устройств (deviceId)
let settings = {
        awayMode: false,
    presenceDevices: [],
    soundNotifications: true,
    voiceControlEnabled: false,
    voiceControlStart: '07:00',
    voiceControlEnd: '23:00',
    dashboardPin: '',
    requireDashboardPin: false
};

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '651956';

// Очереди и состояние обновлений устройств
let deviceRefreshQueue = [];
let deviceQueuePosition = 0;
let priorityDeviceIds = new Set();
let lastHeavyRefresh = 0;
let lastCapabilityRefresh = 0;
let heavyRefreshInProgress = false;
let lightRefreshInProgress = false;
let weatherRefreshInProgress = false;
let smartThingsAuthBlockedUntil = 0;


function isNightModeActive(date = new Date()) {
    const hour = date.getHours();
    return hour >= 23 || hour < 8;
}

function getDisplaySleepMinutes(date = new Date()) {
    return isNightModeActive(date) ? 30 : 5;
}

function canCallSmartThings() {
    return Date.now() >= smartThingsAuthBlockedUntil;
}

function markSmartThingsAuthFailure() {
    smartThingsAuthBlockedUntil = Date.now() + SMARTTHINGS_AUTH_COOLDOWN_MS;
}

async function smartThingsRequest(endpoint, options = {}, { allowAuthCooldown = true } = {}) {
    if (!SMARTTHINGS_PAT) {
        throw new Error('SMARTTHINGS_PAT не задан в переменных окружения');
    }

    if (allowAuthCooldown && !canCallSmartThings()) {
        const waitSec = Math.ceil((smartThingsAuthBlockedUntil - Date.now()) / 1000);
        throw new Error(`SmartThings API временно заблокирован после ошибки авторизации. Повтор через ${waitSec} сек.`);
    }

    const headers = {
        'Authorization': `Bearer ${SMARTTHINGS_PAT}`,
        ...(options.headers || {})
    };

    let lastResponse = null;
    for (let attempt = 0; attempt <= SMARTTHINGS_MAX_RETRIES; attempt += 1) {
        const response = await fetch(`${SMARTTHINGS_API_URL}${endpoint}`, {
            ...options,
            headers
        });
        lastResponse = response;

        if (response.status === 401 || response.status === 403) {
            markSmartThingsAuthFailure();
            return response;
        }

        if (response.status !== 429 && response.status < 500) {
            return response;
        }

        if (attempt < SMARTTHINGS_MAX_RETRIES) {
            const retryDelay = (attempt + 1) * 1500;
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
        }
    }

    return lastResponse;
}

// ==========================================
// MIDDLEWARE (должен быть ДО определения роутов)
// ==========================================

// Middleware для парсинга JSON (важно: до определения роутов)
app.use(express.json());

// API для настроек
app.get('/api/settings', (req, res) => {
    res.json(settings);
});

app.post('/api/settings', (req, res) => {
    try {
        // Сохраняем все переданные настройки
        const newSettings = req.body || {};
        
        // Обновляем настройки, сохраняя существующие значения
        if (typeof newSettings === 'object' && newSettings !== null) {
            // Обновляем все переданные поля
            Object.keys(newSettings).forEach(key => {
                if (newSettings[key] !== undefined) {
                    settings[key] = newSettings[key];
                }
            });
            
            // Убеждаемся, что все поля голосового управления сохраняются
            if (newSettings.hasOwnProperty('voiceControlStart') && newSettings.voiceControlStart !== undefined) {
                settings.voiceControlStart = newSettings.voiceControlStart;
            }
            if (newSettings.hasOwnProperty('voiceControlEnd') && newSettings.voiceControlEnd !== undefined) {
                settings.voiceControlEnd = newSettings.voiceControlEnd;
            }
            if (newSettings.hasOwnProperty('voiceControlEnabled') && newSettings.voiceControlEnabled !== undefined) {
                settings.voiceControlEnabled = newSettings.voiceControlEnabled;
            }
        }
        
        saveDataFile(SETTINGS_FILE, settings);
        res.json({ success: true, settings: settings });
    } catch (error) {
        console.error('Ошибка сохранения настроек:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


app.get('/api/display-config', (req, res) => {
    const now = new Date();
    const nightMode = isNightModeActive(now);
    res.json({
        nightMode,
        sleepMinutes: getDisplaySleepMinutes(now),
        movePixelsMin: 5,
        movePixelsMax: 10
    });
});

app.get('/api/dashboard/pin-config', (req, res) => {
    res.json({ required: !!settings.requireDashboardPin });
});

app.post('/api/dashboard/unlock', (req, res) => {
    const pin = String((req.body && req.body.pin) || '').trim();
    if (!settings.requireDashboardPin) {
        return res.json({ success: true });
    }

    if (!settings.dashboardPin) {
        return res.status(400).json({ success: false, error: 'PIN не настроен в админке' });
    }

    if (pin === String(settings.dashboardPin)) {
        return res.json({ success: true });
    }

    return res.status(401).json({ success: false, error: 'Неверный PIN' });
});

app.post('/api/admin/verify', (req, res) => {
    const password = String((req.body && req.body.password) || '').trim();
    if (password === ADMIN_PASSWORD) {
        return res.json({ success: true });
    }
    return res.status(401).json({ success: false, error: 'Неверный пароль администратора' });
});

app.post('/api/admin/pin', (req, res) => {
    const password = String((req.body && req.body.password) || '').trim();
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: 'Неверный пароль администратора' });
    }

    const requireDashboardPin = !!(req.body && req.body.requireDashboardPin);
    const dashboardPin = String((req.body && req.body.dashboardPin) || '').trim();

    if (requireDashboardPin && !dashboardPin) {
        return res.status(400).json({ success: false, error: 'Введите PIN для включенной защиты' });
    }

    settings.requireDashboardPin = requireDashboardPin;
    settings.dashboardPin = dashboardPin;
    saveDataFile(SETTINGS_FILE, settings);

    return res.json({
        success: true,
        requireDashboardPin: settings.requireDashboardPin
    });
});



// API для управления устройством (включая цвет)
app.post('/api/device/control', async (req, res) => {
    const { deviceId, capability, command, arguments: args } = req.body;
    try {
        await controlDevice(deviceId, command, capability, args || []);
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка управления устройством:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Загружаем данные из файлов при старте
function loadDataFiles() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            eventHistory = fs.readJsonSync(HISTORY_FILE);
        }
        if (fs.existsSync(SETTINGS_FILE)) {
            settings = { ...settings, ...fs.readJsonSync(SETTINGS_FILE) };
        }
        if (fs.existsSync(SCENES_FILE)) {
            scenes = fs.readJsonSync(SCENES_FILE);
        }
        if (fs.existsSync(AUTOMATIONS_FILE)) {
            automations = fs.readJsonSync(AUTOMATIONS_FILE);
        }
        if (fs.existsSync(SCHEDULES_FILE)) {
            schedules = fs.readJsonSync(SCHEDULES_FILE);
        }
        if (fs.existsSync(HIDDEN_DEVICES_FILE)) {
            hiddenDevices = fs.readJsonSync(HIDDEN_DEVICES_FILE);
        }
    } catch (error) {
        console.error('Ошибка загрузки данных:', error);
    }
}

// Сохраняем данные в файлы
function saveDataFile(filename, data) {
    try {
        fs.writeJsonSync(filename, data, { spaces: 2 });
    } catch (error) {
        console.error(`Ошибка сохранения ${filename}:`, error);
    }
}

function updateDeviceRefreshQueue() {
    deviceRefreshQueue = currentDevices.map(device => device.deviceId);
    if (deviceRefreshQueue.length === 0) {
        deviceQueuePosition = 0;
        return;
    }
    if (deviceQueuePosition >= deviceRefreshQueue.length) {
        deviceQueuePosition = deviceQueuePosition % deviceRefreshQueue.length;
    }
}

function markDeviceAsPriority(deviceId) {
    if (deviceId) {
        priorityDeviceIds.add(deviceId);
    }
}

function getDeviceBatchForLightRefresh(batchSize = STATUS_REFRESH_BATCH_SIZE) {
    if (!deviceRefreshQueue.length) {
        return [];
    }

    const selected = [];
    // Добавляем приоритетные устройства
    const priorityIds = Array.from(priorityDeviceIds);
    for (const id of priorityIds) {
        if (selected.length >= batchSize) {
            break;
        }
        if (deviceRefreshQueue.includes(id)) {
            selected.push(id);
        }
        priorityDeviceIds.delete(id);
    }

    // Дополняем из очереди
    const queueLength = deviceRefreshQueue.length;
    const maxAttempts = queueLength * 2 || batchSize;
    let attempts = 0;
    while (selected.length < batchSize && queueLength > 0 && attempts < maxAttempts) {
        const candidate = deviceRefreshQueue[deviceQueuePosition];
        deviceQueuePosition = (deviceQueuePosition + 1) % queueLength;
        attempts += 1;
        if (!candidate) {
            continue;
        }
        if (selected.includes(candidate)) {
            continue;
        }
        selected.push(candidate);
    }

    return selected;
}

function cloneState(state) {
    if (state === null || state === undefined) {
        return null;
    }
    return JSON.parse(JSON.stringify(state));
}

// Инициализация данных
loadDataFiles();

// ==========================================
// ФУНКЦИИ ЗАПРОСОВ К SMARTTHINGS
// ==========================================

function determineTypeByLabel(label = '') {
    const labelLower = label.toLowerCase();
    let isTV = false;
    let isTemperatureSensor = false;

    const tvBrands = ['samsung', 'lg', 'sony', 'panasonic', 'philips', 'toshiba', 'sharp', 'hisense', 'tcl'];
    const tvKeywords = ['tv', 'телевизор', 'television'];
    const tvModelKeywords = ['series', 'qled', 'oled', 'led', 'smart tv', 'android tv'];

    const hasTVBrand = tvBrands.some(brand => labelLower.includes(brand));
    const hasTVKeyword = tvKeywords.some(keyword => labelLower.includes(keyword));
    const hasTVModel = tvModelKeywords.some(keyword => labelLower.includes(keyword));

    isTV = hasTVKeyword || (hasTVBrand && (hasTVModel || labelLower.includes('series') || labelLower.match(/\d+\s*(series|дюйм|inch)/i)));

    if (!isTV && hasTVBrand) {
        const notTVKeywords = ['лампочка', 'bulb', 'light', 'розетка', 'outlet', 'socket', 'switch', 'датчик', 'sensor'];
        const isNotTV = notTVKeywords.some(keyword => labelLower.includes(keyword));
        if (!isNotTV) {
            isTV = true;
        }
    }

    isTemperatureSensor = labelLower.includes('температур') ||
        labelLower.includes('temperature') ||
        labelLower.includes('датчик температ') ||
        (labelLower.includes('датчик') && (labelLower.includes('темп') || labelLower.includes('temp'))) ||
        (labelLower.includes('sensor') && (labelLower.includes('temp') || labelLower.includes('темп'))) ||
        labelLower.includes('термометр') ||
        labelLower.includes('thermometer');

    return { isTV, isTemperatureSensor };
}

async function enrichDeviceCapabilities(device, { force = false } = {}) {
    if (!force && deviceTypes[device.deviceId]) {
        return deviceTypes[device.deviceId];
    }

    let hasPowerMeter = false;
    let hasTemperatureMeasurement = false;
    let detailLoaded = false;

    try {
        const deviceDetailResponse = await smartThingsRequest(`/devices/${device.deviceId}`, {
            method: 'GET'
        });

        if (deviceDetailResponse.ok) {
            const deviceDetail = await deviceDetailResponse.json();
            detailLoaded = true;
            if (deviceDetail.components && Array.isArray(deviceDetail.components)) {
                deviceDetail.components.forEach(component => {
                    if (component.capabilities && Array.isArray(component.capabilities)) {
                        component.capabilities.forEach(cap => {
                            const capId = typeof cap === 'string' ? cap : (cap.id || cap);
                            if (capId === 'powerMeter' || capId === 'powerMeterPowerConsumption') {
                                hasPowerMeter = true;
                            }
                            if (capId === 'temperatureMeasurement') {
                                hasTemperatureMeasurement = true;
                            }
                        });
                    }
                });
            }
        }
    } catch (error) {
        // Игнорируем ошибки при получении детальной информации
    }

    if (!detailLoaded) {
        const existingState = deviceStates[device.deviceId];
        if (existingState?.main?.powerMeter) {
            hasPowerMeter = true;
        }
        if (existingState?.main?.temperatureMeasurement) {
            hasTemperatureMeasurement = true;
        }
    }

    const typeByLabel = determineTypeByLabel(device.label || '');
    const typeInfo = {
        isTV: hasPowerMeter || typeByLabel.isTV,
        isTemperatureSensor: hasTemperatureMeasurement || typeByLabel.isTemperatureSensor
    };
    deviceTypes[device.deviceId] = typeInfo;
    return typeInfo;
}

async function fetchDevicesList(includeCapabilities = false) {
    try {
        const response = await smartThingsRequest('/devices', {
            method: 'GET'
        });

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                console.error('Ошибка авторизации SmartThings API. Проверьте токен (SMARTTHINGS_PAT) в файле server.js');
                console.error('Токен может быть недействителен или истек. Получите новый токен на https://account.smartthings.com/tokens');
                currentDevices = [];
                updateDeviceRefreshQueue();
                return false;
            }
            throw new Error(`Ошибка API: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const devices = data.items || [];
        const newDeviceIds = new Set(devices.map(d => d.deviceId));

        Object.keys(deviceStates).forEach(deviceId => {
            if (!newDeviceIds.has(deviceId)) {
                delete deviceStates[deviceId];
                delete previousDeviceStates[deviceId];
                delete deviceHealth[deviceId];
                delete deviceTypes[deviceId];
                delete deviceLastSeen[deviceId];
                priorityDeviceIds.delete(deviceId);
            }
        });

        currentDevices = devices;
        updateDeviceRefreshQueue();

        for (const device of currentDevices) {
            const shouldForce = includeCapabilities || !deviceTypes[device.deviceId];
            if (shouldForce) {
                await enrichDeviceCapabilities(device, { force: includeCapabilities });
                // Задержка между запросами к API для избежания rate limiting
                await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY));
            } else if (!deviceTypes[device.deviceId]) {
                deviceTypes[device.deviceId] = determineTypeByLabel(device.label || '');
            }
        }

        if (includeCapabilities) {
            lastCapabilityRefresh = Date.now();
        }

        return true;
    } catch (error) {
        console.error('Ошибка при загрузке устройств:', error.message || error);
        currentDevices = [];
        updateDeviceRefreshQueue();
        return false;
    }
}

// Получение статуса здоровья устройства (онлайн/оффлайн)
async function getDeviceHealth(deviceId) {
    try {
        const response = await smartThingsRequest(`/devices/${deviceId}/health`, {
            method: 'GET'
        });
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                return null;
            }
            // Если эндпоинт health недоступен, возвращаем null
            if (response.status === 404) {
                return null;
            }
            return null;
        }
        
        const healthData = await response.json();
        deviceHealth[deviceId] = healthData;
        return healthData;
    } catch (error) {
        // Игнорируем ошибки health endpoint
        return null;
    }
}

async function getDeviceStatus(deviceId) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 секунд таймаут
        
        const response = await smartThingsRequest(`/devices/${deviceId}/status`, {
            method: 'GET',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                // Ошибка авторизации - не логируем для каждого устройства
                deviceStates[deviceId] = null;
                return { error: 'auth' };
            }
            // Если статус недоступен (404, 500, 503 или другая ошибка), устройство скорее всего оффлайн
            deviceStates[deviceId] = null;
            return { error: response.status, offline: true };
        }
        
        const data = await response.json();
        deviceStates[deviceId] = data.components;
        // Обновляем время последнего успешного подключения
        deviceLastSeen[deviceId] = Date.now();
        
        // Сохраняем тип устройства для определения при оффлайне
        if (data.components && data.components.main) {
            const device = currentDevices.find(d => d.deviceId === deviceId);
            const deviceLabel = device ? device.label.toLowerCase() : '';
            const hasPowerMeter = data.components.main.powerMeter !== undefined;
            const hasTemperatureMeasurement = data.components.main.temperatureMeasurement !== undefined;
            
            deviceTypes[deviceId] = {
                isTV: deviceLabel.includes('tv') || deviceLabel.includes('телевизор') || hasPowerMeter,
                isTemperatureSensor: hasTemperatureMeasurement
            };
        }
        return { success: true };
    } catch (error) {
        // Ошибка сети, таймаут или другая ошибка - устройство может быть оффлайн
        deviceStates[deviceId] = null;
        return { error: 'network', offline: true };
    }
}

async function refreshDeviceStatuses(deviceIds, { includeHealth = false } = {}) {
    const refreshed = [];
    for (const deviceId of deviceIds) {
        const device = currentDevices.find(d => d.deviceId === deviceId);
        if (!device) {
            continue;
        }

        if (includeHealth) {
            await getDeviceHealth(deviceId);
            // Задержка между запросами к API
            await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY));
        }

        await getDeviceStatus(deviceId);
        refreshed.push(deviceId);
        
        // Задержка между запросами к API для избежания rate limiting
        await new Promise(resolve => setTimeout(resolve, API_REQUEST_DELAY));
    }
    return refreshed;
}

function processDeviceStateUpdates(deviceIds) {
    deviceIds.forEach(deviceId => {
        const device = currentDevices.find(d => d.deviceId === deviceId);
        if (!device) {
            delete previousDeviceStates[deviceId];
            return;
        }

        const status = deviceStates[deviceId];
        const previousState = previousDeviceStates[deviceId];

        if (status && status.main) {
            const temperatureValue = status.main.temperatureMeasurement?.temperature?.value;
            if (temperatureValue !== undefined) {
                logEvent('temperature', {
                    deviceId,
                    value: temperatureValue
                });
            }

            const humidityValue = status.main.relativeHumidityMeasurement?.humidity?.value;
            if (humidityValue !== undefined) {
                logEvent('humidity', {
                    deviceId,
                    value: humidityValue
                });
            }

            const powerValue = status.main.powerMeter?.power?.value;
            if (powerValue !== undefined) {
                logEvent('power', {
                    deviceId,
                    value: powerValue
                });
            }
        }

        if (settings.awayMode && status?.main?.contactSensor) {
            const currentContact = status.main.contactSensor.contact?.value;
            const previousContact = previousState?.main?.contactSensor?.contact?.value;
            if (previousContact && currentContact !== previousContact && currentContact === 'open') {
                io.emit('notification', {
                    title: 'Безопасность',
                    message: `Дверь "${device.label}" открыта в режиме отсутствия!`,
                    type: 'warning'
                });
            }
        }

        automations.forEach(automation => {
            if (!automation.enabled) {
                return;
            }

            if (automation.condition.type !== 'device' && automation.condition.type !== 'sensor') {
                return;
            }

            if (automation.condition.deviceId !== deviceId) {
                return;
            }

            const currentState = status;
            if (!previousState || !currentState) {
                return;
            }

            let stateChanged = false;

            if (automation.condition.type === 'device') {
                const prevSwitch = previousState.main?.switch?.switch?.value;
                const currSwitch = currentState.main?.switch?.switch?.value;
                stateChanged = prevSwitch !== currSwitch;
            } else if (automation.condition.type === 'sensor') {
                if (automation.condition.sensorType === 'contact') {
                    const prevContact = previousState.main?.contactSensor?.contact?.value;
                    const currContact = currentState.main?.contactSensor?.contact?.value;
                    stateChanged = prevContact !== currContact;
                } else if (automation.condition.sensorType === 'temperature') {
                    const prevTemp = previousState.main?.temperatureMeasurement?.temperature?.value;
                    const currTemp = currentState.main?.temperatureMeasurement?.temperature?.value;
                    stateChanged = prevTemp !== currTemp;
                }
            }

            if (stateChanged && checkAutomationConditions(automation)) {
                controlDevice(automation.action.deviceId, automation.action.command, automation.action.capability || 'switch');
            }
        });

        previousDeviceStates[deviceId] = cloneState(status);
    });
}

async function controlDevice(deviceId, command, capability = 'switch', arguments = []) {
    try {
        // Для colorControl команда setColor требует специального формата
        let payload;
        if (capability === 'colorControl' && command === 'setColor' && arguments.length > 0) {
            payload = {
                commands: [{
                    component: 'main',
                    capability: capability,
                    command: command,
                    arguments: arguments
                }]
            };
        } else {
            payload = {
                commands: [{
                    component: 'main',
                    capability: capability,
                    command: command,
                    arguments: arguments
                }]
            };
        }

        const response = await smartThingsRequest(`/devices/${deviceId}/commands`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        }, { allowAuthCooldown: false });
        
        if (!response.ok) {
            const errorText = await response.text();
            // Если получили 429, извлекаем информацию о задержке
            if (response.status === 429) {
                let retryAfter = 30000; // По умолчанию 30 секунд
                try {
                    const errorData = JSON.parse(errorText);
                    if (errorData.error && errorData.error.details && errorData.error.details[0]) {
                        const retryMatch = errorData.error.details[0].message.match(/retry in (\d+) millis/);
                        if (retryMatch) {
                            retryAfter = parseInt(retryMatch[1]);
                        }
                    }
                } catch (e) {
                    // Если не удалось распарсить, используем значение по умолчанию
                }
                throw new Error(`API ошибка: 429 Too Many Requests - повторите попытку через ${Math.ceil(retryAfter / 1000)} секунд`);
            }
            throw new Error(`API ошибка: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        const data = await response.json();
        // Проверяем различные форматы успешного ответа
        const isAccepted = data.results && data.results.length > 0 && 
                          (data.results[0].status === 'ACCEPTED' || 
                           data.results[0].status === 'COMPLETED' ||
                           response.ok);
        
        if (isAccepted || response.ok) {
            // Логируем событие
            logEvent('device-control', {
                deviceId,
                command,
                capability,
                timestamp: new Date().toISOString()
            });
            
            // Обновляем статус устройства через 1.5 сек
            markDeviceAsPriority(deviceId);
            setTimeout(async () => {
                await getDeviceStatus(deviceId);
                broadcastDeviceUpdate();
            }, 1500);
            return { success: true };
        } else {
            // Если ответ получен, но статус не ACCEPTED, все равно считаем успешным если HTTP статус OK
            if (response.ok) {
                logEvent('device-control', {
                    deviceId,
                    command,
                    capability,
                    timestamp: new Date().toISOString()
                });
                markDeviceAsPriority(deviceId);
                setTimeout(async () => {
                    await getDeviceStatus(deviceId);
                    broadcastDeviceUpdate();
                }, 1500);
                return { success: true };
            }
            const errorDetails = data.results && data.results[0] ? 
                JSON.stringify(data.results[0]) : 'Неизвестная ошибка';
            throw new Error(`Команда не принята: ${errorDetails}`);
        }
    } catch (error) {
        console.error(`Ошибка управления ${deviceId}:`, error);
        return { success: false, error: error.message };
    }
}

// Логирование событий
function logEvent(type, data) {
    const event = {
        type,
        ...data,
        timestamp: new Date().toISOString()
    };
    
    eventHistory.events.push(event);
    
    // Ограничиваем размер истории (последние 1000 событий)
    if (eventHistory.events.length > 1000) {
        eventHistory.events = eventHistory.events.slice(-1000);
    }
    
    // Сохраняем в файл
    saveDataFile(HISTORY_FILE, eventHistory);
    
    // Логируем специфичные данные
    if (type === 'temperature') {
        eventHistory.temperature.push({
            value: data.value,
            deviceId: data.deviceId,
            timestamp: event.timestamp
        });
        if (eventHistory.temperature.length > 1000) {
            eventHistory.temperature = eventHistory.temperature.slice(-1000);
        }
    } else if (type === 'humidity') {
        eventHistory.humidity.push({
            value: data.value,
            deviceId: data.deviceId,
            timestamp: event.timestamp
        });
        if (eventHistory.humidity.length > 1000) {
            eventHistory.humidity = eventHistory.humidity.slice(-1000);
        }
    } else if (type === 'power') {
        eventHistory.power.push({
            value: data.value,
            deviceId: data.deviceId,
            timestamp: event.timestamp
        });
        if (eventHistory.power.length > 1000) {
            eventHistory.power = eventHistory.power.slice(-1000);
        }
    }
}

// ==========================================
// ФУНКЦИИ ЗАПРОСОВ К OPENWEATHERMAP
// ==========================================

async function getWeather() {
    try {
        const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=${WEATHER_CITY}&appid=${OPENWEATHER_KEY}&units=metric&lang=ru`);
        if (!response.ok) throw new Error(`Ошибка API погоды: ${response.statusText}`);
        
        const data = await response.json();
        const weatherMain = data.weather[0].main.toLowerCase();
        const icon = data.weather[0].icon;
        
        weatherData = {
            temp: Math.round(data.main.temp),
            humidity: data.main.humidity,
            icon: icon,
            main: weatherMain, // 'rain', 'snow', 'clear', etc.
            description: data.weather[0].description
        };
        return true;
    } catch (error) {
        console.error('Ошибка загрузки погоды:', error);
        return false;
    }
}

async function getForecast() {
    try {
        // Запрашиваем прогноз на 24 часа (8 интервалов по 3 часа = 24 часа)
        const response = await fetch(`https://api.openweathermap.org/data/2.5/forecast?q=${WEATHER_CITY}&appid=${OPENWEATHER_KEY}&units=metric&lang=ru&cnt=8`);
        if (!response.ok) throw new Error(`Ошибка API прогноза: ${response.statusText}`);
        
        const data = await response.json();
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        forecastData = (data.list || []).map(item => {
            const date = new Date(item.dt * 1000);
            const itemDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
            const isToday = itemDay.getTime() === today.getTime();
            
            return {
                time: date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                date: date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
                dayTimestamp: itemDay.getTime(),
                isToday: isToday,
                icon: item.weather[0].icon,
                temp: Math.round(item.main.temp),
                description: item.weather[0].description,
                timestamp: item.dt * 1000
            };
        });
        return true;
    } catch (error) {
        console.error('Ошибка загрузки прогноза:', error);
        return false;
    }
}

async function refreshWeatherData() {
    if (weatherRefreshInProgress) {
        return;
    }

    weatherRefreshInProgress = true;
    try {
        const weatherLoaded = await getWeather();
        const forecastLoaded = await getForecast();
        if (weatherLoaded || forecastLoaded) {
            broadcastWeatherUpdate();
        }
    } catch (error) {
        console.error('Ошибка обновления погодных данных:', error);
    } finally {
        weatherRefreshInProgress = false;
    }
}

// ==========================================
// ФУНКЦИИ РАССЫЛКИ ДАННЫХ
// ==========================================

function broadcastDeviceUpdate() {
    io.emit('devices-update', {
        devices: currentDevices,
        deviceStates: deviceStates
    });
}

function broadcastWeatherUpdate() {
    io.emit('weather-update', {
        weather: weatherData,
        forecast: forecastData
    });
}

function broadcastAllData() {
    io.emit('data-update', {
        devices: currentDevices,
        deviceStates: deviceStates,
        weather: weatherData,
        forecast: forecastData
    });
}

// ==========================================
// ОБНОВЛЕНИЕ ДАННЫХ ПО РАСПИСАНИЮ
// ==========================================

// Храним предыдущие состояния для отслеживания изменений
let previousDeviceStates = {};

async function refreshAllData({ mode = 'light', forceCapabilities = false } = {}) {
    if (mode === 'heavy') {
        if (heavyRefreshInProgress) {
            return;
        }

        heavyRefreshInProgress = true;
        try {
            // Обновляем capabilities только если прошло 24 часа или принудительно
            const shouldRefreshCapabilities = forceCapabilities || (Date.now() - lastCapabilityRefresh > CAPABILITY_REFRESH_INTERVAL);
            const devicesLoaded = await fetchDevicesList(shouldRefreshCapabilities);
            lastHeavyRefresh = Date.now();

            if (!devicesLoaded || currentDevices.length === 0) {
                await refreshWeatherData();
                return;
            }

            const deviceIds = currentDevices.map(device => device.deviceId);
            const refreshedIds = await refreshDeviceStatuses(deviceIds, { includeHealth: true });
            if (refreshedIds.length) {
                processDeviceStateUpdates(refreshedIds);
                broadcastDeviceUpdate();
            }
        } catch (error) {
            console.error('Ошибка тяжелого обновления устройств:', error);
        } finally {
            heavyRefreshInProgress = false;
        }

        await refreshWeatherData();
        return;
    }

    if (lightRefreshInProgress || heavyRefreshInProgress) {
        return;
    }

    lightRefreshInProgress = true;
    try {
        const requiresHeavyRefresh = !currentDevices.length || (Date.now() - lastHeavyRefresh) > HEAVY_REFRESH_INTERVAL * 1.5;
        if (requiresHeavyRefresh) {
            await refreshAllData({ mode: 'heavy', forceCapabilities });
            return;
        }

        const deviceIds = getDeviceBatchForLightRefresh(STATUS_REFRESH_BATCH_SIZE);
        if (!deviceIds.length) {
            return;
        }

        const refreshedIds = await refreshDeviceStatuses(deviceIds);
        if (refreshedIds.length) {
            processDeviceStateUpdates(refreshedIds);
            broadcastDeviceUpdate();
        }
    } catch (error) {
        console.error('Ошибка легкого обновления устройств:', error);
    } finally {
        lightRefreshInProgress = false;
    }
}

// Первая загрузка данных
refreshAllData({ mode: 'heavy', forceCapabilities: true });

// Легкие обновления статусов устройств
setInterval(() => refreshAllData({ mode: 'light' }), LIGHT_REFRESH_INTERVAL);

// Периодические тяжелые обновления списка устройств и здоровья
setInterval(() => refreshAllData({ mode: 'heavy' }), HEAVY_REFRESH_INTERVAL);

// Периодическое обновление погоды
setInterval(() => refreshWeatherData(), WEATHER_REFRESH_INTERVAL);

// ==========================================
// WEB SOCKET СОЕДИНЕНИЯ
// ==========================================

io.on('connection', (socket) => {
    // Отправляем все данные новому клиенту
    socket.emit('data-update', {
        devices: currentDevices,
        deviceStates: deviceStates,
        weather: weatherData,
        forecast: forecastData
    });
    
    // Обработка команд управления устройствами
    socket.on('control-device', async (data) => {
        const { deviceId, command, capability } = data;
        const result = await controlDevice(deviceId, command, capability);
        // Добавляем deviceId в результат для отслеживания ошибок голосовых команд
        result.deviceId = deviceId;
        socket.emit('control-result', result);
    });
    
    // Расширенное управление устройствами (brightness, color, timer)
    socket.on('device-control-advanced', async (data) => {
        try {
            const { deviceId, command, capability, arguments: args } = data;
            const result = await controlDevice(deviceId, command, capability, args || []);
            if (result.success) {
                socket.emit('control-result', result);
            } else {
                socket.emit('control-error', { 
                    deviceId, 
                    error: result.error || 'Неизвестная ошибка',
                    message: `Ошибка управления ${deviceId}: ${result.error || 'Неизвестная ошибка'}`
                });
            }
        } catch (error) {
            console.error('Ошибка управления устройством:', error);
            socket.emit('control-error', { 
                deviceId: data.deviceId, 
                error: error.message,
                message: `Ошибка управления ${data.deviceId}: ${error.message}`
            });
        }
    });
    
    // Выполнение сцены
    socket.on('scene-execute', async (data) => {
        const { sceneId } = data;
        const scene = scenes.find(s => s.id === sceneId);
        if (scene) {
            for (const action of scene.actions) {
                await controlDevice(action.deviceId, action.command, action.capability || 'switch', action.arguments || []);
                await new Promise(resolve => setTimeout(resolve, 500)); // Задержка между командами
            }
            socket.emit('scene-result', { success: true });
        } else {
            socket.emit('scene-result', { success: false, error: 'Сцена не найдена' });
        }
    });
    
    // Обработка запроса обновления данных
    socket.on('request-update', () => {
        socket.emit('data-update', {
            devices: currentDevices,
            deviceStates: deviceStates,
            weather: weatherData,
            forecast: forecastData
        });
    });
    
    socket.on('disconnect', () => {
        // Клиент отключен
    });
});

// ==========================================
// HTTP РОУТЫ
// ==========================================

// Раздача статических файлов
app.use(express.static(path.join(__dirname)));

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Роут для проверки статуса сервера
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'ok',
        connectedClients: io.sockets.sockets.size,
        devicesCount: currentDevices.length,
        lastUpdate: new Date().toISOString()
    });
});

// API для статистики
app.get('/api/statistics', (req, res) => {
    res.json(eventHistory);
});

// API для настроек устройства
app.post('/api/device/settings', (req, res) => {
    const deviceSettings = req.body;
    // Сохраняем настройки устройств в JSON файл
    const DEVICE_SETTINGS_FILE = path.join(DATA_DIR, 'deviceSettings.json');
    try {
        let allSettings = {};
        if (fs.existsSync(DEVICE_SETTINGS_FILE)) {
            allSettings = fs.readJsonSync(DEVICE_SETTINGS_FILE);
        }
        // Обновляем настройки для конкретного устройства
        Object.keys(deviceSettings).forEach(deviceId => {
            if (!allSettings[deviceId]) {
                allSettings[deviceId] = {};
            }
            allSettings[deviceId] = { ...allSettings[deviceId], ...deviceSettings[deviceId] };
        });
        fs.writeJsonSync(DEVICE_SETTINGS_FILE, allSettings, { spaces: 2 });
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка сохранения настроек устройства:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для получения настроек устройств
app.get('/api/device/settings', (req, res) => {
    const DEVICE_SETTINGS_FILE = path.join(DATA_DIR, 'deviceSettings.json');
    try {
        if (fs.existsSync(DEVICE_SETTINGS_FILE)) {
            const settings = fs.readJsonSync(DEVICE_SETTINGS_FILE);
            res.json(settings);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Ошибка загрузки настроек устройства:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для голосовых команд
app.get('/api/voice-commands', (req, res) => {
    const VOICE_COMMANDS_FILE = path.join(DATA_DIR, 'voiceCommands.json');
    try {
        if (fs.existsSync(VOICE_COMMANDS_FILE)) {
            const commands = fs.readJsonSync(VOICE_COMMANDS_FILE);
            res.json(commands);
        } else {
            res.json([]);
        }
    } catch (error) {
        console.error('Ошибка загрузки голосовых команд:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/voice-commands', (req, res) => {
    const commands = req.body;
    const VOICE_COMMANDS_FILE = path.join(DATA_DIR, 'voiceCommands.json');
    try {
        fs.writeJsonSync(VOICE_COMMANDS_FILE, commands, { spaces: 2 });
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка сохранения голосовых команд:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для калибровки датчиков
const SENSOR_CALIBRATION_FILE = path.join(DATA_DIR, 'sensorCalibration.json');

app.get('/api/sensor-calibration', (req, res) => {
    try {
        if (fs.existsSync(SENSOR_CALIBRATION_FILE)) {
            const calibration = fs.readJsonSync(SENSOR_CALIBRATION_FILE);
            res.json(calibration);
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Ошибка загрузки калибровки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/sensor-calibration', (req, res) => {
    const calibrationData = req.body;
    try {
        let allCalibration = {};
        if (fs.existsSync(SENSOR_CALIBRATION_FILE)) {
            allCalibration = fs.readJsonSync(SENSOR_CALIBRATION_FILE);
        }
        // Обновляем калибровку
        Object.keys(calibrationData).forEach(deviceId => {
            if (!allCalibration[deviceId]) {
                allCalibration[deviceId] = { tempOffset: 0, humidityOffset: 0 };
            }
            allCalibration[deviceId] = { ...allCalibration[deviceId], ...calibrationData[deviceId] };
        });
        fs.writeJsonSync(SENSOR_CALIBRATION_FILE, allCalibration, { spaces: 2 });
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка сохранения калибровки:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для получения сцен
app.get('/api/scenes', (req, res) => {
    res.json(scenes);
});

// API для создания/обновления сцены
app.post('/api/scenes', (req, res) => {
    const scene = req.body;
    const index = scenes.findIndex(s => s.id === scene.id);
    if (index >= 0) {
        scenes[index] = scene;
    } else {
        scenes.push(scene);
    }
    saveDataFile(SCENES_FILE, scenes);
    res.json({ success: true });
});

// API для удаления сцены
app.delete('/api/scenes/:id', (req, res) => {
    const { id } = req.params;
    scenes = scenes.filter(s => s.id !== id);
    saveDataFile(SCENES_FILE, scenes);
    res.json({ success: true });
});

// API для выполнения сцены
app.post('/api/scene/execute', async (req, res) => {
    const { sceneId } = req.body;
    const scene = scenes.find(s => s.id === sceneId);
    if (scene) {
        for (const action of scene.actions) {
            await controlDevice(action.deviceId, action.command, action.capability || 'switch', action.arguments || []);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: 'Сцена не найдена' });
    }
});

// API для получения автоматизаций
app.get('/api/automations', (req, res) => {
    res.json(automations);
});

// API для создания/обновления автоматизации
app.post('/api/automation', (req, res) => {
    const automation = req.body;
    const index = automations.findIndex(a => a.id === automation.id);
    if (index >= 0) {
        automations[index] = automation;
    } else {
        automations.push(automation);
    }
    saveDataFile(AUTOMATIONS_FILE, automations);
    
    // Создаем/обновляем cron задачу для автоматизации
    setupAutomationCron(automation);
    
    res.json({ success: true });
});

// API для удаления автоматизации
app.delete('/api/automation/:id', (req, res) => {
    const { id } = req.params;
    const automation = automations.find(a => a.id === id);
    if (automation) {
        const existingTask = cronTasks.find(t => t.id === id);
        if (existingTask) {
            existingTask.task.stop();
            cronTasks = cronTasks.filter(t => t.id !== id);
        }
    }
    automations = automations.filter(a => a.id !== id);
    saveDataFile(AUTOMATIONS_FILE, automations);
    res.json({ success: true });
});

// API для получения расписаний
app.get('/api/schedules', (req, res) => {
    res.json(schedules);
});

// API для создания/обновления расписания
app.post('/api/schedule', (req, res) => {
    const schedule = req.body;
    const index = schedules.findIndex(s => s.id === schedule.id);
    if (index >= 0) {
        schedules[index] = schedule;
    } else {
        schedules.push(schedule);
    }
    saveDataFile(SCHEDULES_FILE, schedules);
    
    // Создаем/обновляем cron задачу для расписания
    setupScheduleCron(schedule);
    
    res.json({ success: true });
});

// API для удаления расписания
app.delete('/api/schedule/:id', (req, res) => {
    const { id } = req.params;
    const schedule = schedules.find(s => s.id === id);
    if (schedule) {
        const existingTask = cronTasks.find(t => t.id === id);
        if (existingTask) {
            existingTask.task.stop();
            cronTasks = cronTasks.filter(t => t.id !== id);
        }
    }
    schedules = schedules.filter(s => s.id !== id);
    saveDataFile(SCHEDULES_FILE, schedules);
    res.json({ success: true });
});

// Настройка cron задачи для расписания
function setupScheduleCron(schedule) {
    if (!schedule.enabled) return;
    
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const cronPattern = `${minutes} ${hours} * * ${schedule.days.join(',')}`;
    
    // Удаляем предыдущую задачу если есть
    const existingTask = cronTasks.find(t => t.id === schedule.id);
    if (existingTask) {
        existingTask.task.stop();
        cronTasks = cronTasks.filter(t => t.id !== schedule.id);
    }
    
    // Создаем новую задачу
    const task = cron.schedule(cronPattern, () => {
        controlDevice(schedule.deviceId, schedule.command, schedule.capability || 'switch');
    });
    
    cronTasks.push({ id: schedule.id, task: task, type: 'schedule' });
}

// Настройка cron задачи для автоматизации
function setupAutomationCron(automation) {
    if (!automation.enabled) return;
    
    // Пока что автоматизации с условиями времени обрабатываем через cron
    if (automation.condition.type === 'time') {
        const [hours, minutes] = automation.condition.value.split(':').map(Number);
        const cronPattern = `${minutes} ${hours} * * *`; // Каждый день
        
        // Удаляем предыдущую задачу если есть
        const existingTask = cronTasks.find(t => t.id === automation.id);
        if (existingTask) {
            existingTask.task.stop();
            cronTasks = cronTasks.filter(t => t.id !== automation.id);
        }
        
        // Создаем новую задачу
        const task = cron.schedule(cronPattern, () => {
            // Проверяем другие условия если есть
            if (checkAutomationConditions(automation)) {
                controlDevice(automation.action.deviceId, automation.action.command, automation.action.capability || 'switch');
            }
        });
        
        cronTasks.push({ id: automation.id, task: task, type: 'automation' });
    }
}

// Проверка условий автоматизации
function checkAutomationConditions(automation) {
    if (automation.condition.type === 'device') {
        const status = deviceStates[automation.condition.deviceId];
        if (status && status.main && status.main.switch) {
            const currentState = status.main.switch.switch.value;
            return currentState === automation.condition.state;
        }
    } else if (automation.condition.type === 'sensor') {
        const status = deviceStates[automation.condition.deviceId];
        if (automation.condition.sensorType === 'contact') {
            if (status && status.main && status.main.contactSensor) {
                const currentState = status.main.contactSensor.contact.value;
                return currentState === automation.condition.state;
            }
        } else if (automation.condition.sensorType === 'temperature') {
            if (status && status.main && status.main.temperatureMeasurement) {
                const currentTemp = status.main.temperatureMeasurement.temperature.value;
                if (automation.condition.comparison === 'above') {
                    return currentTemp > automation.condition.value;
                } else {
                    return currentTemp < automation.condition.value;
                }
            }
        }
    }
    return true;
}

// Хранилище cron задач
let cronTasks = [];

// Загружаем и настраиваем расписания и автоматизации при старте
function setupAllCronTasks() {
    schedules.forEach(schedule => {
        if (schedule.enabled) {
            setupScheduleCron(schedule);
        }
    });
    
    automations.forEach(automation => {
        if (automation.enabled && automation.condition.type === 'time') {
            setupAutomationCron(automation);
        }
    });
}

// Настраиваем все задачи после загрузки данных
setTimeout(setupAllCronTasks, 2000);


// API для системной информации
app.get('/api/system/info', (req, res) => {
    const os = require('os');
    res.json({
        ip: os.networkInterfaces(),
        uptime: process.uptime(),
        version: '1.0.0',
        nodeVersion: process.version
    });
});

// API для статуса присутствия
app.get('/api/presence', async (req, res) => {
    // Получаем устройства presence из SmartThings
    const presenceDevices = currentDevices.filter(device => {
        const status = deviceStates[device.deviceId];
        return status && status.main && status.main.presenceSensor;
    });
    
    // Загружаем настройки устройств для проверки скрытых пользователей
    const DEVICE_SETTINGS_FILE = path.join(DATA_DIR, 'deviceSettings.json');
    let deviceSettings = {};
    try {
        if (fs.existsSync(DEVICE_SETTINGS_FILE)) {
            deviceSettings = fs.readJsonSync(DEVICE_SETTINGS_FILE);
        }
    } catch (error) {
        console.error('Ошибка загрузки настроек устройств:', error);
    }
    
    const presenceStatus = {};
    presenceDevices.forEach(device => {
        const status = deviceStates[device.deviceId];
        if (status && status.main && status.main.presenceSensor) {
            const settings = deviceSettings[device.deviceId] || {};
            // Включаем информацию о скрытых пользователях, чтобы frontend мог их обработать
            presenceStatus[device.deviceId] = {
                label: device.label,
                presence: status.main.presenceSensor.presence.value,
                hiddenInPresence: settings.hiddenInPresence || false
            };
        }
    });
    
    res.json(presenceStatus);
});

// API для режима отсутствия
app.post('/api/away-mode', (req, res) => {
    const { enabled } = req.body;
    settings.awayMode = enabled;
    saveDataFile(SETTINGS_FILE, settings);
    io.emit('away-mode-update', { enabled });
    res.json({ success: true, awayMode: enabled });
});

// API для получения списка оффлайн устройств и датчиков
app.get('/api/offline-devices', (req, res) => {
    const offlineDevices = []; // TV и другие устройства
    const offlineSensors = []; // Датчики температуры
    const offlineOther = []; // Другие устройства (лампочки, розетки, вентиляторы и т.д.)
    
    currentDevices.forEach(device => {
        const deviceId = device.deviceId;
        
        // Пропускаем скрытые устройства
        if (hiddenDevices.includes(deviceId)) {
            return;
        }
        
        const status = deviceStates[deviceId];
        const lastSeen = deviceLastSeen[deviceId];
        const health = deviceHealth[deviceId];
        const deviceLabel = device.label || 'Устройство';
        const deviceType = deviceTypes[deviceId] || { isTV: false, isTemperatureSensor: false };
        const labelLower = deviceLabel.toLowerCase();
        
        // Используем сохраненный тип устройства (определяется при загрузке)
        const isTV = deviceType.isTV;
        const isTemperatureSensor = deviceType.isTemperatureSensor;
        
        // Проверяем, является ли устройство оффлайн по health (самый надежный источник)
        let isOffline = false;
        if (health) {
            let healthState = health.state || health.deviceHealth || health.status;
            if (!healthState && health.device && typeof health.device === 'object') {
                healthState = health.device.state || health.device.deviceHealth || health.device.status;
            }
            if (healthState && typeof healthState === 'string') {
                const healthStateUpper = healthState.toUpperCase();
                isOffline = (healthStateUpper === 'OFFLINE' || healthStateUpper === 'UNKNOWN');
            }
        }
        
        // Если устройство оффлайн - добавляем его в соответствующий список
        if (isOffline) {
            const deviceInfo = {
                deviceId: deviceId,
                label: deviceLabel,
                lastSeen: lastSeen || null
            };
            
            if (isTV) {
                offlineDevices.push(deviceInfo);
            } else if (isTemperatureSensor) {
                offlineSensors.push(deviceInfo);
            } else {
                // Определяем подтип для других устройств
                let subType = 'other';
                if (labelLower.includes('лампа') || labelLower.includes('лампочка') || labelLower.includes('bulb') || labelLower.includes('light')) {
                    subType = 'light';
                } else if (labelLower.includes('лента') || labelLower.includes('strip') || labelLower.includes('led')) {
                    subType = 'light';
                } else if (labelLower.includes('розетка') || labelLower.includes('outlet') || labelLower.includes('socket') || labelLower.includes('plug')) {
                    subType = 'outlet';
                } else if (labelLower.includes('вентилятор') || labelLower.includes('fan')) {
                    subType = 'fan';
                } else if (labelLower.includes('датчик') || labelLower.includes('sensor') || labelLower.includes('контакт') || labelLower.includes('contact')) {
                    subType = 'sensor';
                }
                
                offlineOther.push({ ...deviceInfo, subType });
            }
        }
    });
    
    res.json({
        devices: offlineDevices,
        sensors: offlineSensors,
        other: offlineOther,
        total: offlineDevices.length + offlineSensors.length + offlineOther.length
    });
});

// API для скрытия устройства
app.post('/api/device/hide', (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'deviceId is required' });
        }
        
        if (!hiddenDevices.includes(deviceId)) {
            hiddenDevices.push(deviceId);
            saveDataFile(HIDDEN_DEVICES_FILE, hiddenDevices);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка скрытия устройства:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для показа устройства
app.post('/api/device/show', (req, res) => {
    try {
        const { deviceId } = req.body;
        if (!deviceId) {
            return res.status(400).json({ success: false, error: 'deviceId is required' });
        }
        
        const index = hiddenDevices.indexOf(deviceId);
        if (index > -1) {
            hiddenDevices.splice(index, 1);
            saveDataFile(HIDDEN_DEVICES_FILE, hiddenDevices);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка показа устройства:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для получения списка скрытых устройств
app.get('/api/hidden-devices', (req, res) => {
    res.json({ devices: hiddenDevices });
});

// ==========================================
// API ДЛЯ УСТРОЙСТВ БЕЗОПАСНОСТИ
// ==========================================

const SECURITY_DATA_FILE = path.join(DATA_DIR, 'security.json');

// Инициализация данных безопасности
let securityData = {
    cameras: [],
    doorbell: {
        name: 'Дверной звонок',
        streamUrl: null,
        microphoneEnabled: false,
        speakerEnabled: false,
        volume: 50,
        hasVisitor: false,
        status: 'idle'
    },
    smokeDetector: {
        status: 'normal',
        sensitivity: 5,
        notifications: true
    }
};

// Загрузка данных безопасности
function loadSecurityData() {
    try {
        if (fs.existsSync(SECURITY_DATA_FILE)) {
            securityData = { ...securityData, ...fs.readJsonSync(SECURITY_DATA_FILE) };
        }
    } catch (error) {
        console.error('Ошибка загрузки данных безопасности:', error);
    }
}

// Сохранение данных безопасности
function saveSecurityData() {
    try {
        fs.writeJsonSync(SECURITY_DATA_FILE, securityData, { spaces: 2 });
    } catch (error) {
        console.error('Ошибка сохранения данных безопасности:', error);
    }
}

// Загружаем данные при старте
loadSecurityData();

// API для получения списка камер
app.get('/api/security/cameras', (req, res) => {
    res.json({ cameras: securityData.cameras });
});

// API для управления PTZ камеры
app.post('/api/security/camera/ptz', (req, res) => {
    const { cameraId, direction, value } = req.body;
    try {
        const camera = securityData.cameras.find(c => c.id === cameraId);
        if (!camera) {
            return res.status(404).json({ success: false, error: 'Камера не найдена' });
        }
        
        if (!camera.ptz) {
            camera.ptz = { pan: 0, tilt: 0, zoom: 1 };
        }
        
        if (direction === 'pan') {
            camera.ptz.pan = Math.max(-180, Math.min(180, camera.ptz.pan + value));
        } else if (direction === 'tilt') {
            camera.ptz.tilt = Math.max(-90, Math.min(90, camera.ptz.tilt + value));
        } else if (direction === 'zoom') {
            camera.ptz.zoom = Math.max(0.1, Math.min(10, camera.ptz.zoom + value));
        }
        
        saveSecurityData();
        res.json({ success: true, ptz: camera.ptz });
    } catch (error) {
        console.error('Ошибка управления PTZ:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для настроек камеры
app.post('/api/security/camera/settings', (req, res) => {
    const { cameraId, name, streamUrl } = req.body;
    try {
        let camera = securityData.cameras.find(c => c.id === cameraId);
        if (!camera) {
            camera = {
                id: cameraId,
                name: name || 'IP Камера',
                status: 'online',
                streamUrl: streamUrl || null,
                ptz: { pan: 0, tilt: 0, zoom: 1 }
            };
            securityData.cameras.push(camera);
        } else {
            if (name !== undefined) camera.name = name;
            if (streamUrl !== undefined) camera.streamUrl = streamUrl;
        }
        
        saveSecurityData();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка сохранения настроек камеры:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для получения данных дверного звонка
app.get('/api/security/doorbell', (req, res) => {
    res.json(securityData.doorbell);
});

// API для ответа на дверной звонок
app.post('/api/security/doorbell/answer', (req, res) => {
    try {
        securityData.doorbell.status = 'connected';
        securityData.doorbell.hasVisitor = false;
        saveSecurityData();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка ответа на звонок:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для управления микрофоном дверного звонка
app.post('/api/security/doorbell/microphone', (req, res) => {
    const { enabled } = req.body;
    try {
        securityData.doorbell.microphoneEnabled = enabled;
        saveSecurityData();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка управления микрофоном:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для управления динамиком дверного звонка
app.post('/api/security/doorbell/speaker', (req, res) => {
    const { enabled } = req.body;
    try {
        securityData.doorbell.speakerEnabled = enabled;
        saveSecurityData();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка управления динамиком:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для установки громкости дверного звонка
app.post('/api/security/doorbell/volume', (req, res) => {
    const { volume } = req.body;
    try {
        securityData.doorbell.volume = Math.max(0, Math.min(100, volume));
        saveSecurityData();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка установки громкости:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для настроек дверного звонка
app.post('/api/security/doorbell/settings', (req, res) => {
    const { name, streamUrl } = req.body;
    try {
        if (name !== undefined) securityData.doorbell.name = name;
        if (streamUrl !== undefined) securityData.doorbell.streamUrl = streamUrl;
        saveSecurityData();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка сохранения настроек дверного звонка:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для получения данных датчика дыма
app.get('/api/security/smoke-detector', (req, res) => {
    res.json({ status: securityData.smokeDetector.status });
});

// API для теста датчика дыма
app.post('/api/security/smoke-detector/test', (req, res) => {
    try {
        securityData.smokeDetector.status = 'test';
        saveSecurityData();
        
        // Через 3 секунды возвращаем в нормальное состояние
        setTimeout(() => {
            securityData.smokeDetector.status = 'normal';
            saveSecurityData();
        }, 3000);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка теста датчика дыма:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API для настроек датчика дыма
app.post('/api/security/smoke-detector/settings', (req, res) => {
    const { sensitivity, notifications } = req.body;
    try {
        if (sensitivity !== undefined) {
            securityData.smokeDetector.sensitivity = Math.max(1, Math.min(10, sensitivity));
        }
        if (notifications !== undefined) {
            securityData.smokeDetector.notifications = notifications;
        }
        saveSecurityData();
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка сохранения настроек датчика дыма:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// API ДЛЯ СТАРЫХ УСТРОЙСТВ (Android 4.x)
// ==========================================

// Простой REST API endpoint для mini версии сайта
// Использует XMLHttpRequest polling вместо Socket.IO
app.get('/api/mini/data', (req, res) => {
    // Устанавливаем заголовки для совместимости со старыми браузерами
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    
    res.json({
        devices: currentDevices,
        deviceStates: deviceStates,
        weather: weatherData,
        forecast: forecastData,
        timestamp: Date.now(),
        displayConfig: {
            nightMode: isNightModeActive(),
            sleepMinutes: getDisplaySleepMinutes(),
            movePixelsMin: 5,
            movePixelsMax: 10
        },
        pinRequired: !!settings.requireDashboardPin
    });
});

// Endpoint для управления устройствами (для старых браузеров)
app.get('/api/mini/control', async (req, res) => {
    const { deviceId, command, capability } = req.query;
    
    if (!deviceId || !command) {
        return res.json({ success: false, error: 'Missing parameters' });
    }
    
    try {
        const result = await controlDevice(deviceId, command, capability || 'switch');
        res.json({ success: result.success, error: result.error || null });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// ==========================================
// ЗАПУСК СЕРВЕРА
// ==========================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // Слушаем на всех интерфейсах для доступа по IP
server.listen(PORT, HOST, () => {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    let localIP = 'localhost';
    
    // Находим локальный IP адрес
    for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
                localIP = iface.address;
                break;
            }
        }
        if (localIP !== 'localhost') break;
    }
    
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Локальный доступ: http://localhost:${PORT}`);
    console.log(`Сетевой доступ: http://${localIP}:${PORT}`);
    console.log(`Доступ по IP: http://192.168.100.13:${PORT} (если настроен)`);
});
