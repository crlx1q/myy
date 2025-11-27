// ==========================================
// WEB SOCKET СОЕДИНЕНИЕ
// ==========================================

import { SERVER_URL, setSocket, setCurrentDevices, setDeviceStates, lastVoiceCommandDeviceId, setLastVoiceCommandDeviceId } from './config.js';
import { updateConnectionStatus, updateOfflineDevicesIndicator } from './indicators.js';
import { showNotification } from './notifications.js';
import { updateWeather, updateForecast } from './weather.js';
import { renderAllWidgets } from './widgets.js';
import { playErrorSound } from './voice.js';

let socketInstance = null;

export function connectSocket() {
    // Проверяем, что Socket.IO загружен
    if (typeof io === 'undefined') {
        console.error('Socket.IO не загружен! Проверьте, что скрипт Socket.IO подключен в index.html');
        return;
    }

    socketInstance = io(SERVER_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity
    });

    socketInstance.on('connect', () => {
        console.log('Подключено к серверу');
        updateConnectionStatus(true);
        // Запрашиваем обновление данных после подключения
        socketInstance.emit('request-update');
    });

    socketInstance.on('disconnect', () => {
        console.log('Отключено от сервера');
        updateConnectionStatus(false);
    });

    socketInstance.on('connect_error', (error) => {
        console.error('Ошибка подключения:', error);
        updateConnectionStatus(false);
    });

    // Получение всех данных
    socketInstance.on('data-update', (data) => {
        if (data.devices) {
            setCurrentDevices(data.devices);
        }
        if (data.deviceStates) {
            setDeviceStates(data.deviceStates);
        }
        if (data.weather) updateWeather(data.weather);
        if (data.forecast) updateForecast(data.forecast);
        renderAllWidgets();
        updateOfflineDevicesIndicator();
    });

    // Обновление устройств
    socketInstance.on('devices-update', (data) => {
        if (data.devices) {
            setCurrentDevices(data.devices);
        }
        if (data.deviceStates) {
            setDeviceStates(data.deviceStates);
        }
        renderAllWidgets();
        updateOfflineDevicesIndicator();
    });

    // Обновление погоды
    socketInstance.on('weather-update', (data) => {
        if (data.weather) updateWeather(data.weather);
        if (data.forecast) updateForecast(data.forecast);
    });

    // Результат команды управления
    socketInstance.on('control-result', (result) => {
        if (!result.success) {
            console.error('Ошибка управления устройством:', result.error);
            if (lastVoiceCommandDeviceId && result.deviceId === lastVoiceCommandDeviceId) {
                playErrorSound();
                setLastVoiceCommandDeviceId(null);
            } else {
                showNotification('Ошибка управления', result.error || 'Не удалось выполнить команду', 'error');
            }
        } else {
            setLastVoiceCommandDeviceId(null);
        }
    });
    
    // Ошибки управления устройствами
    socketInstance.on('control-error', (error) => {
        console.error('Ошибка управления устройством:', error);
        if (lastVoiceCommandDeviceId && error.deviceId === lastVoiceCommandDeviceId) {
            playErrorSound();
            setLastVoiceCommandDeviceId(null);
        } else {
            showNotification('Ошибка управления', error.message || error.error || 'Неизвестная ошибка', 'error');
        }
    });
    
    // Уведомления
    socketInstance.on('notification', (data) => {
        showNotification(data.title, data.message, data.type || 'info');
    });
    
    // Обновление режима отсутствия
    socketInstance.on('away-mode-update', (data) => {
        const toggle = document.getElementById('awayModeToggle');
        if (toggle) {
            toggle.checked = data.enabled;
        }
    });

    setSocket(socketInstance);
}

export function getSocket() {
    return socketInstance;
}

