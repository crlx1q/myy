// ==========================================
// ГЛАВНАЯ ИНИЦИАЛИЗАЦИЯ
// ==========================================

import { connectSocket } from './socket.js';
import { updateClock, requestWakeLock, setupScreensaverUnlock, initFullscreen, setupScreenSleep } from './screensaver.js';
import { checkConnectionStatus, initBatteryMonitoring, updateMicrophoneIndicatorVisibility, initOfflineDevicesIndicator, updateOfflineDevicesIndicator } from './indicators.js';
import { loadEventHistory } from './notifications.js';
import { loadVoiceCommands, initVoiceControl, startVoiceControl, stopVoiceControl, initAudioContextOnInteraction } from './voice.js';
import { loadDeviceSettings } from './settings.js';
import { voiceControlEnabled, recognition, setVoiceControlEnabled } from './config.js';
import { loadScenes } from './scenes.js';

// Экспортируем функции в глобальную область видимости для использования в HTML
import { controlDevice, openDeviceControl, updateBrightness, updateColor, setColorPreset, setTimer, updateDeviceName, toggleDeviceVisibility, closeDeviceControlModal } from './devices.js';
import { showSection } from './navigation.js';
import { executeScene, showCreateSceneModal, saveScene, showCreateScheduleModal, saveSchedule, showCreateAutomationModal, updateAutomationConditionUI, updateAutomationSensorUI, saveAutomation, toggleSchedule, deleteSchedule, toggleAutomation, deleteAutomation } from './scenes.js';
import { toggleAwayMode, setPresenceStatus, openSecurityDeviceSettings, saveSecurityDeviceSettings, showHiddenDevicesInSecurity } from './security.js';
import { toggleSoundNotifications, toggleScreenSleep, updateSensorCalibration } from './settings.js';
import { changeMusicService } from './music.js';
import { showAddVoiceCommandModal, saveVoiceCommand, deleteVoiceCommand, toggleVoiceControl } from './voice.js';
import { closeModal } from './utils.js';
import { closeNotification } from './notifications.js';
import { lockScreen, toggleFullscreen } from './screensaver.js';
import { turnOffGroup, turnOffAllDevices } from './widgets.js';

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.controlDevice = controlDevice;
    window.openDeviceControl = openDeviceControl;
    window.updateBrightness = updateBrightness;
    window.updateColor = updateColor;
    window.setColorPreset = setColorPreset;
    window.setTimer = setTimer;
    window.updateDeviceName = updateDeviceName;
    window.toggleDeviceVisibility = toggleDeviceVisibility;
    window.closeDeviceControlModal = closeDeviceControlModal;
    window.showSection = showSection;
    window.executeScene = executeScene;
    window.showCreateSceneModal = showCreateSceneModal;
    window.saveScene = saveScene;
    window.showCreateScheduleModal = showCreateScheduleModal;
    window.saveSchedule = saveSchedule;
    window.showCreateAutomationModal = showCreateAutomationModal;
    window.updateAutomationConditionUI = updateAutomationConditionUI;
    window.updateAutomationSensorUI = updateAutomationSensorUI;
    window.saveAutomation = saveAutomation;
    window.toggleSchedule = toggleSchedule;
    window.deleteSchedule = deleteSchedule;
    window.toggleAutomation = toggleAutomation;
    window.deleteAutomation = deleteAutomation;
    window.toggleAwayMode = toggleAwayMode;
    window.setPresenceStatus = setPresenceStatus;
    window.openSecurityDeviceSettings = openSecurityDeviceSettings;
    window.saveSecurityDeviceSettings = saveSecurityDeviceSettings;
    window.showHiddenDevicesInSecurity = showHiddenDevicesInSecurity;
    window.toggleSoundNotifications = toggleSoundNotifications;
    window.toggleScreenSleep = toggleScreenSleep;
    window.updateSensorCalibration = updateSensorCalibration;
    window.changeMusicService = changeMusicService;
    window.showAddVoiceCommandModal = showAddVoiceCommandModal;
    window.saveVoiceCommand = saveVoiceCommand;
    window.deleteVoiceCommand = deleteVoiceCommand;
    window.toggleVoiceControl = toggleVoiceControl;
    window.closeModal = closeModal;
    window.closeNotification = closeNotification;
    window.lockScreen = lockScreen;
    window.toggleFullscreen = toggleFullscreen;
    window.turnOffGroup = turnOffGroup;
    window.turnOffAllDevices = turnOffAllDevices;
}


async function loadDisplayConfig() {
    try {
        const response = await fetch('/api/display-config');
        if (!response.ok) {
            throw new Error('display config failed');
        }
        const config = await response.json();
        setupScreenSleep(config.sleepMinutes || 5);
        if (config.nightMode) {
            document.body.classList.add('night-mode');
        } else {
            document.body.classList.remove('night-mode');
        }
    } catch (error) {
        setupScreenSleep(5);
    }
}

async function initPinGate() {
    try {
        const response = await fetch('/api/dashboard/pin-config');
        if (!response.ok) return;
        const data = await response.json();
        if (!data.required) return;

        const overlay = document.createElement('div');
        overlay.id = 'pinGateOverlay';
        overlay.className = 'fixed inset-0 bg-black bg-opacity-95 z-[10000] flex items-center justify-center';
        overlay.innerHTML = `
            <div class="bg-gray-900 rounded-2xl p-8 w-full max-w-sm mx-4">
                <h2 class="text-2xl font-bold mb-4">Введите PIN</h2>
                <input id="pinGateInput" type="password" inputmode="numeric" class="w-full px-4 py-3 rounded-lg bg-gray-800 border border-gray-700 mb-4" placeholder="PIN" />
                <button id="pinGateSubmit" class="w-full px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-700">Открыть</button>
                <p id="pinGateError" class="text-red-400 mt-3 hidden">Неверный PIN</p>
            </div>
        `;
        document.body.appendChild(overlay);

        const submit = document.getElementById('pinGateSubmit');
        const input = document.getElementById('pinGateInput');
        const errorEl = document.getElementById('pinGateError');

        const tryUnlock = async () => {
            const pin = (input.value || '').trim();
            const unlockResponse = await fetch('/api/dashboard/unlock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            if (unlockResponse.ok) {
                overlay.remove();
                return;
            }
            errorEl.classList.remove('hidden');
        };

        submit.addEventListener('click', tryUnlock);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                tryUnlock();
            }
        });
    } catch (error) {
        console.error('PIN gate init error:', error);
    }
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    // Обновление часов каждую секунду
    updateClock();
    initPinGate();
    loadDisplayConfig();
    setInterval(updateClock, 1000);

    // Инициализация Wake Lock
    requestWakeLock();

    // Настройка разблокировки screensaver
    setupScreensaverUnlock();

    // Подключение к серверу
    connectSocket();

    // Проверка статуса подключения каждые 30 секунд
    setInterval(checkConnectionStatus, 30000);
    setInterval(loadDisplayConfig, 60000);

    // Инициализация мониторинга батареи
    initBatteryMonitoring();

    // Инициализация индикатора оффлайн устройств
    initOfflineDevicesIndicator();

    // Инициализация полноэкранного режима
    initFullscreen();

    // Инициализация AudioContext при первом взаимодействии
    initAudioContextOnInteraction();

    // Загружаем все данные с сервера
    async function loadAllDataFromServer() {
        try {
            await loadDeviceSettings();
            await loadVoiceCommands();
            await loadScenes();
            await loadEventHistory();
            
            // Загружаем настройки
            try {
                const response = await fetch('/api/settings');
                const serverSettings = await response.json();
                
                // Применяем настройки
                await loadDisplayConfig();
                
                if (serverSettings.voiceControlEnabled) {
                    setVoiceControlEnabled(true);
                    if (!recognition) {
                        initVoiceControl();
                    }
                    setTimeout(() => {
                        startVoiceControl();
                        updateMicrophoneIndicatorVisibility();
                    }, 1000);
                } else {
                    updateMicrophoneIndicatorVisibility();
                }
            } catch (error) {
                console.error('Ошибка загрузки настроек:', error);
            }
        } catch (error) {
            console.error('Ошибка загрузки данных:', error);
        }
    }

    // Загружаем данные после небольшой задержки
    setTimeout(loadAllDataFromServer, 500);

    // Периодическая проверка состояния микрофона и времени для голосового управления
    setInterval(() => {
        if (voiceControlEnabled && recognition) {
            const startTimeInput = document.getElementById('voiceControlStart');
            const endTimeInput = document.getElementById('voiceControlEnd');
            if (!startTimeInput || !endTimeInput) {
                updateMicrophoneIndicatorVisibility();
                return;
            }
            
            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();
            const startTime = startTimeInput.value.split(':');
            const endTime = endTimeInput.value.split(':');
            
            if (startTime && endTime && startTime.length === 2 && endTime.length === 2) {
                const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
                const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);
                
                try {
                    const isRunning = recognition.state === 'running' || recognition.state === 'starting';
                    
                    if (currentTime >= startMinutes && currentTime <= endMinutes) {
                        if (!isRunning) {
                            startVoiceControl();
                        }
                    } else {
                        if (isRunning) {
                            stopVoiceControl();
                        }
                    }
                } catch (e) {
                    // Игнорируем ошибки
                }
            }
        }
        
        updateMicrophoneIndicatorVisibility();
    }, 5000);

    // Загружаем историю событий каждые 5 минут
    setInterval(loadEventHistory, 300000);
});

