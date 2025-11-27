// ==========================================
// ГЛАВНАЯ ИНИЦИАЛИЗАЦИЯ
// ==========================================

import { connectSocket } from './socket.js';
import { updateClock, requestWakeLock, setupScreensaverUnlock, initFullscreen } from './screensaver.js';
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
import { turnOffGroup } from './widgets.js';

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
}

// Инициализация после загрузки DOM
document.addEventListener('DOMContentLoaded', () => {
    // Обновление часов каждую секунду
    updateClock();
    setInterval(updateClock, 1000);

    // Инициализация Wake Lock
    requestWakeLock();

    // Настройка разблокировки screensaver
    setupScreensaverUnlock();

    // Подключение к серверу
    connectSocket();

    // Проверка статуса подключения каждые 30 секунд
    setInterval(checkConnectionStatus, 30000);

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
                if (serverSettings.screenSleep) {
                    const { setupScreenSleep } = await import('./screensaver.js');
                    setupScreenSleep(serverSettings.screenSleepTime || 10);
                }
                
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

