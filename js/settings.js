// ==========================================
// НАСТРОЙКИ И КАЛИБРОВКА
// ==========================================

import { currentDevices, deviceStates, deviceSettings, setDeviceSettings, voiceControlEnabled, setVoiceControlEnabled, recognition, setRecognition } from './config.js';
import { showNotification } from './notifications.js';
import { updateMicrophoneIndicatorVisibility } from './indicators.js';
import { initVoiceControl, startVoiceControl, stopVoiceControl, setupVoiceControlTimeHandlers, saveVoiceControlSettings } from './voice.js';
import { setupScreenSleep, clearScreenSleep } from './screensaver.js';
import { changeMusicService } from './music.js';

export async function loadDeviceSettings() {
    try {
        const response = await fetch('/api/device/settings');
        const settings = await response.json();
        setDeviceSettings(settings);
        return settings;
    } catch (error) {
        console.error('Ошибка загрузки настроек устройств:', error);
        return {};
    }
}

export async function saveDeviceSettings() {
    try {
        const response = await fetch('/api/device/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deviceSettings)
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result;
    } catch (error) {
        console.error('Ошибка сохранения настроек устройств:', error);
        throw error;
    }
}

export async function loadSettings() {
    try {
        const response = await fetch('/api/system/info');
        const data = await response.json();
        renderSystemInfo(data);
        
        const settingsResponse = await fetch('/api/settings');
        const serverSettings = await settingsResponse.json();
        const soundToggle = document.getElementById('soundNotificationsToggle');
        if (soundToggle) soundToggle.checked = serverSettings.soundNotifications !== false;
        
        const screenSleep = serverSettings.screenSleep === true;
        const screenSleepToggle = document.getElementById('screenSleepToggle');
        if (screenSleepToggle) screenSleepToggle.checked = screenSleep;
        const screenSleepTime = serverSettings.screenSleepTime || 10;
        const screenSleepTimeInput = document.getElementById('screenSleepTime');
        if (screenSleepTimeInput) screenSleepTimeInput.value = screenSleepTime;
        
        renderSensorCalibration();
        
        const voiceEnabled = serverSettings.voiceControlEnabled === true;
        const voiceToggle = document.getElementById('voiceControlToggle');
        if (voiceToggle) voiceToggle.checked = voiceEnabled;
        setVoiceControlEnabled(voiceEnabled);
        
        const voiceStart = serverSettings.voiceControlStart || '07:00';
        const voiceEnd = serverSettings.voiceControlEnd || '23:00';
        const voiceStartInput = document.getElementById('voiceControlStart');
        const voiceEndInput = document.getElementById('voiceControlEnd');
        
        if (voiceStartInput) {
            voiceStartInput.value = voiceStart;
        }
        if (voiceEndInput) {
            voiceEndInput.value = voiceEnd;
        }
        
        setupVoiceControlTimeHandlers();
        
        if (voiceEnabled) {
            if (!recognition) {
                initVoiceControl();
            }
            setTimeout(() => {
                if (recognition && voiceControlEnabled) {
                    startVoiceControl();
                    setTimeout(() => {
                        updateMicrophoneIndicatorVisibility();
                    }, 500);
                } else {
                    updateMicrophoneIndicatorVisibility();
                }
            }, 1000);
        } else {
            updateMicrophoneIndicatorVisibility();
        }
        
        const musicService = serverSettings.musicService || 'spotify';
        const musicSelect = document.getElementById('musicServiceSelect');
        if (musicSelect) {
            musicSelect.value = musicService;
            changeMusicService(musicService);
        }
        
        if (screenSleep) {
            setupScreenSleep(screenSleepTime);
        }
    } catch (error) {
        console.error('Ошибка загрузки настроек:', error);
    }
}

export function renderSystemInfo(data) {
    const systemInfo = document.getElementById('systemInfo');
    if (!systemInfo) return;
    
    let ipAddress = 'Не определен';
    if (data.ip) {
        const interfaces = Object.values(data.ip).flat();
        const ipv4 = interfaces.find(iface => iface.family === 'IPv4' && !iface.internal);
        if (ipv4) {
            ipAddress = ipv4.address;
        }
    }
    
    const uptimeSeconds = Math.floor(data.uptime);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeStr = `${hours}ч ${minutes}м ${seconds}с`;
    
    systemInfo.innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-lg">IP-адрес</span>
            <span class="text-lg font-mono">${ipAddress}</span>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-lg">Время работы</span>
            <span class="text-lg">${uptimeStr}</span>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-lg">Версия</span>
            <span class="text-lg">${data.version || '1.0.0'}</span>
        </div>
        <div class="flex justify-between items-center">
            <span class="text-lg">Node.js версия</span>
            <span class="text-lg">${data.nodeVersion || 'N/A'}</span>
        </div>
    `;
}

export async function toggleSoundNotifications(enabled) {
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ soundNotifications: enabled })
        });
    } catch (error) {
        console.error('Ошибка сохранения настроек уведомлений:', error);
    }
}

export async function toggleScreenSleep(enabled) {
    const timeInput = document.getElementById('screenSleepTime');
    const time = timeInput ? parseInt(timeInput.value) || 10 : 10;
    
    try {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                screenSleep: enabled,
                screenSleepTime: time
            })
        });
    } catch (error) {
        console.error('Ошибка сохранения настроек режима сна:', error);
    }
    
    if (enabled) {
        setupScreenSleep(time);
    } else {
        clearScreenSleep();
    }
}

export async function renderSensorCalibration() {
    const sensorCalibration = document.getElementById('sensorCalibration');
    if (!sensorCalibration) return;
    
    const sensors = currentDevices.filter(device => {
        const status = deviceStates[device.deviceId];
        const settings = deviceSettings[device.deviceId] || {};
        if (settings.hidden) return false;
        return status && status.main && 
               (status.main.temperatureMeasurement || status.main.relativeHumidityMeasurement);
    });
    
    if (sensors.length === 0) {
        sensorCalibration.innerHTML = '<p class="text-gray-400">Нет датчиков для калибровки</p>';
        return;
    }
    
    await loadDeviceSettings();
    
    let calibration = {};
    try {
        const response = await fetch('/api/sensor-calibration');
        calibration = await response.json();
    } catch (error) {
        console.error('Ошибка загрузки калибровки:', error);
    }
    
    let html = '';
    sensors.forEach(device => {
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || device.label;
        const calib = calibration[device.deviceId] || { tempOffset: 0, humidityOffset: 0 };
        
        html += `
            <div class="bg-gray-700 rounded-lg p-4">
                <h3 class="text-lg font-semibold mb-3">${customName}</h3>
                <div class="space-y-3">
                    ${deviceStates[device.deviceId]?.main?.temperatureMeasurement ? `
                        <div>
                            <label class="block text-sm text-gray-400 mb-1">Смещение температуры (°C)</label>
                            <input type="number" id="tempOffset-${device.deviceId}" 
                                   value="${calib.tempOffset}" step="0.1"
                                   onchange="updateSensorCalibration('${device.deviceId}', 'temp', this.value)"
                                   class="w-full px-4 py-2 bg-gray-800 rounded-lg">
                        </div>
                    ` : ''}
                    ${deviceStates[device.deviceId]?.main?.relativeHumidityMeasurement ? `
                        <div>
                            <label class="block text-sm text-gray-400 mb-1">Смещение влажности (%)</label>
                            <input type="number" id="humidityOffset-${device.deviceId}" 
                                   value="${calib.humidityOffset}" step="0.1"
                                   onchange="updateSensorCalibration('${device.deviceId}', 'humidity', this.value)"
                                   class="w-full px-4 py-2 bg-gray-800 rounded-lg">
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    });
    sensorCalibration.innerHTML = html;
}

export async function updateSensorCalibration(deviceId, type, value) {
    try {
        const calibrationData = {};
        calibrationData[deviceId] = {
            [type === 'temp' ? 'tempOffset' : 'humidityOffset']: parseFloat(value) || 0
        };
        
        await fetch('/api/sensor-calibration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(calibrationData)
        });
    } catch (error) {
        console.error('Ошибка сохранения калибровки:', error);
    }
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.toggleSoundNotifications = toggleSoundNotifications;
    window.toggleScreenSleep = toggleScreenSleep;
    window.updateSensorCalibration = updateSensorCalibration;
}

