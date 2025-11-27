// ==========================================
// НАСТРОЙКИ И КОНФИГУРАЦИЯ
// ==========================================

export const SERVER_URL = window.location.origin; // Автоматически определяем URL сервера

// Глобальные переменные состояния
export let socket = null;
export let currentDevices = [];
export let deviceStates = {};
export let wakeLock = null; // Для Wake Lock API

// Переменные для анимаций погоды
export let currentAnimation = 'none';
export let currentLevel = 2;
export let lastAnimationType = null;
export let lastAnimationLevel = null;

// Глобальные переменные для данных
export let deviceSettings = {};
export let scenes = [];
export let schedules = [];
export let automations = [];
export let voiceCommands = [];

// Переменные для голосового управления
export let recognition = null;
export let voiceControlEnabled = false;
export let isManualRestart = false;
export let lastVoiceCommandDeviceId = null;

// Переменные для графиков
export let temperatureChartInstance = null;
export let humidityChartInstance = null;
export let powerChartInstance = null;

// Переменные для режима сна экрана
export let screenSleepTimer = null;
export let lastActivityTime = Date.now();
export let screenSleepOverlay = null;

// Переменные для throttle
export const brightnessThrottle = {};
export const colorThrottle = {};

// Переменные для AudioContext
export let voiceCommandAudioContext = null;

// История событий
export let eventHistory = null;

// Текущее редактируемое устройство
export let currentEditingDeviceId = null;

// Функции для установки значений
export function setSocket(value) {
    socket = value;
}

export function setCurrentDevices(value) {
    currentDevices = value;
}

export function setDeviceStates(value) {
    deviceStates = value;
}

export function setWakeLock(value) {
    wakeLock = value;
}

export function setCurrentAnimation(value) {
    currentAnimation = value;
}

export function setCurrentLevel(value) {
    currentLevel = value;
}

export function setLastAnimationType(value) {
    lastAnimationType = value;
}

export function setLastAnimationLevel(value) {
    lastAnimationLevel = value;
}

export function setDeviceSettings(value) {
    deviceSettings = value;
}

export function setScenes(value) {
    scenes = value;
}

export function setSchedules(value) {
    schedules = value;
}

export function setAutomations(value) {
    automations = value;
}

export function setVoiceCommands(value) {
    voiceCommands = value;
}

export function setRecognition(value) {
    recognition = value;
}

export function setVoiceControlEnabled(value) {
    voiceControlEnabled = value;
}

export function setIsManualRestart(value) {
    isManualRestart = value;
}

export function setLastVoiceCommandDeviceId(value) {
    lastVoiceCommandDeviceId = value;
}

export function setTemperatureChartInstance(value) {
    temperatureChartInstance = value;
}

export function setHumidityChartInstance(value) {
    humidityChartInstance = value;
}

export function setPowerChartInstance(value) {
    powerChartInstance = value;
}

export function setScreenSleepTimer(value) {
    screenSleepTimer = value;
}

export function setLastActivityTime(value) {
    lastActivityTime = value;
}

export function setScreenSleepOverlay(value) {
    screenSleepOverlay = value;
}

export function setVoiceCommandAudioContext(value) {
    voiceCommandAudioContext = value;
}

export function setEventHistory(value) {
    eventHistory = value;
}

export function setCurrentEditingDeviceId(value) {
    currentEditingDeviceId = value;
}

