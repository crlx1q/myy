// ==========================================
// ИНДИКАТОРЫ (ПОДКЛЮЧЕНИЕ, МИКРОФОН, БАТАРЕЯ)
// ==========================================

import { connectionIndicator } from './dom.js';
import { voiceControlEnabled, recognition } from './config.js';
import { connectSocket, getSocket } from './socket.js';

// Индикатор подключения
export function updateConnectionStatus(connected) {
    if (!connectionIndicator) return;
    
    if (connected) {
        connectionIndicator.classList.remove('disconnected');
        connectionIndicator.classList.add('connected');
    } else {
        connectionIndicator.classList.remove('connected');
        connectionIndicator.classList.add('disconnected');
    }
}

// Проверка статуса подключения каждые 30 секунд
export function checkConnectionStatus() {
    const socket = getSocket();
    if (socket && socket.connected) {
        socket.emit('request-update');
        updateConnectionStatus(true);
    } else {
        updateConnectionStatus(false);
        // Попытка переподключения
        if (!socket || !socket.connected) {
            connectSocket();
        }
    }
}

// Обновление индикатора микрофона
export function updateMicrophoneIndicator(isWorking) {
    const micIndicator = document.getElementById('microphoneIndicator');
    if (!micIndicator) return;
    
    // Показываем индикатор только если голосовое управление включено
    if (voiceControlEnabled) {
        micIndicator.classList.add('visible');
        if (isWorking) {
            micIndicator.classList.remove('not-working');
            micIndicator.classList.add('working');
        } else {
            micIndicator.classList.remove('working');
            micIndicator.classList.add('not-working');
        }
    } else {
        micIndicator.classList.remove('visible', 'working', 'not-working');
    }
}

// Обновление видимости индикатора микрофона
export function updateMicrophoneIndicatorVisibility() {
    const micIndicator = document.getElementById('microphoneIndicator');
    if (!micIndicator) return;
    
    // Если голосовое управление выключено, скрываем индикатор
    if (!voiceControlEnabled) {
        micIndicator.classList.remove('visible', 'working', 'not-working');
        return;
    }
    
    // Если голосовое управление включено, но recognition еще не инициализирован
    if (!recognition) {
        micIndicator.classList.add('visible');
        micIndicator.classList.remove('working');
        micIndicator.classList.add('not-working');
        return;
    }
    
    // Проверяем текущее состояние распознавания
    try {
        const state = recognition.state;
        
        // Если recognition запущен или запускается, показываем зеленый
        if (state === 'running' || state === 'starting') {
            micIndicator.classList.add('visible');
            micIndicator.classList.remove('not-working');
            micIndicator.classList.add('working');
        } else {
            // Если recognition не запущен, проверяем период времени
            const startTimeInput = document.getElementById('voiceControlStart');
            const endTimeInput = document.getElementById('voiceControlEnd');
            
            if (startTimeInput && endTimeInput) {
                const now = new Date();
                const currentTime = now.getHours() * 60 + now.getMinutes();
                const startTime = startTimeInput.value.split(':');
                const endTime = endTimeInput.value.split(':');
                
                if (startTime && endTime && startTime.length === 2 && endTime.length === 2) {
                    const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
                    const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);
                    
                    const inPeriod = currentTime >= startMinutes && currentTime <= endMinutes;
                    
                    micIndicator.classList.add('visible');
                    if (inPeriod && state === 'idle') {
                        micIndicator.classList.remove('working');
                        micIndicator.classList.add('not-working');
                    } else if (inPeriod) {
                        micIndicator.classList.remove('not-working');
                        micIndicator.classList.add('working');
                    } else {
                        micIndicator.classList.remove('working');
                        micIndicator.classList.add('not-working');
                    }
                } else {
                    micIndicator.classList.add('visible');
                    micIndicator.classList.remove('working');
                    micIndicator.classList.add('not-working');
                }
            } else {
                micIndicator.classList.add('visible');
                if (state === 'idle' || state === 'stopped') {
                    micIndicator.classList.remove('working');
                    micIndicator.classList.add('not-working');
                } else {
                    micIndicator.classList.remove('not-working');
                    micIndicator.classList.add('working');
                }
            }
        }
    } catch (e) {
        micIndicator.classList.add('visible');
        micIndicator.classList.remove('working');
        micIndicator.classList.add('not-working');
    }
}

// Инициализация мониторинга батареи
export function initBatteryMonitoring() {
    // Проверяем поддержку Battery API
    if ('getBattery' in navigator) {
        navigator.getBattery().then(function(battery) {
            updateBatteryIndicator(battery);
            
            battery.addEventListener('chargingchange', function() {
                updateBatteryIndicator(battery);
            });
            
            battery.addEventListener('levelchange', function() {
                updateBatteryIndicator(battery);
            });
        }).catch(function(error) {
            console.error('Ошибка получения информации о батарее:', error);
            const batteryIndicator = document.getElementById('batteryIndicator');
            if (batteryIndicator) {
                batteryIndicator.style.display = 'none';
            }
        });
    } else {
        if (navigator.battery) {
            updateBatteryIndicator(navigator.battery);
            navigator.battery.addEventListener('chargingchange', function() {
                updateBatteryIndicator(navigator.battery);
            });
            navigator.battery.addEventListener('levelchange', function() {
                updateBatteryIndicator(navigator.battery);
            });
        } else {
            const batteryIndicator = document.getElementById('batteryIndicator');
            if (batteryIndicator) {
                batteryIndicator.style.display = 'none';
            }
        }
    }
}

// Обновление индикатора батареи
export function updateBatteryIndicator(battery) {
    const batteryIndicator = document.getElementById('batteryIndicator');
    const batteryLevel = document.getElementById('batteryLevel');
    
    if (!batteryIndicator || !batteryLevel) return;
    
    const level = Math.round(battery.level * 100);
    batteryLevel.textContent = level + '%';
    
    batteryIndicator.classList.remove('high', 'medium', 'low');
    if (level > 50) {
        batteryIndicator.classList.add('high');
    } else if (level > 20) {
        batteryIndicator.classList.add('medium');
    } else {
        batteryIndicator.classList.add('low');
    }
    
    const batteryFill = document.getElementById('batteryFill');
    if (batteryFill) {
        const fillWidth = (level / 100) * 12;
        batteryFill.setAttribute('width', Math.max(0, Math.min(12, fillWidth)));
        if (level > 0) {
            batteryFill.style.display = 'block';
        } else {
            batteryFill.style.display = 'none';
        }
    }
    
    if (battery.charging) {
        batteryIndicator.setAttribute('title', 'Заряжается: ' + level + '%');
    } else {
        batteryIndicator.setAttribute('title', 'Уровень заряда: ' + level + '%');
    }
}

// ==========================================
// ИНДИКАТОР ОФФЛАЙН УСТРОЙСТВ
// ==========================================

// Форматирование относительного времени
function formatRelativeTime(timestamp) {
    if (!timestamp) {
        return 'Неизвестно';
    }
    
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} назад`;
    } else if (hours > 0) {
        return `${hours} ${hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов'} назад`;
    } else if (minutes > 0) {
        return `${minutes} ${minutes === 1 ? 'минуту' : minutes < 5 ? 'минуты' : 'минут'} назад`;
    } else {
        return 'только что';
    }
}

// Загрузка данных об оффлайн устройствах
export async function loadOfflineDevices() {
    try {
        const response = await fetch('/api/offline-devices');
        if (!response.ok) {
            throw new Error('Ошибка загрузки оффлайн устройств');
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Ошибка загрузки оффлайн устройств:', error);
        return { devices: [], sensors: [], other: [], total: 0 };
    }
}

// Обновление индикатора оффлайн устройств
export async function updateOfflineDevicesIndicator() {
    const indicator = document.getElementById('offlineDevicesIndicator');
    const countElement = document.getElementById('offlineDevicesCount');
    
    if (!indicator) {
        console.warn('Индикатор оффлайн устройств не найден в DOM');
        return;
    }
    if (!countElement) {
        console.warn('Элемент счетчика оффлайн устройств не найден в DOM');
        return;
    }
    
    const data = await loadOfflineDevices();
    const total = data.total || 0;
    
    if (total > 0) {
        indicator.classList.remove('hidden');
        countElement.textContent = total;
        indicator.setAttribute('title', `Оффлайн устройств: ${total}`);
    } else {
        indicator.classList.add('hidden');
    }
}

// Отображение модального окна с оффлайн устройствами
export async function showOfflineDevicesModal() {
    // Проверяем, заблокирован ли экран - модальное окно показываем только на разблокированном
    const screensaverView = document.getElementById('screensaverView');
    const isLocked = screensaverView && !screensaverView.classList.contains('hidden');
    if (isLocked) {
        showOfflineDevicesPopup();
        return;
    }
    
    const modal = document.getElementById('offlineDevicesModal');
    const content = document.getElementById('offlineDevicesContent');
    
    if (!modal) {
        console.error('Модальное окно оффлайн устройств не найдено в DOM');
        return;
    }
    if (!content) {
        console.error('Контент модального окна оффлайн устройств не найден в DOM');
        return;
    }
    
    const data = await loadOfflineDevices();
    
    let html = '';
    
    if (data.devices && data.devices.length > 0) {
        html += '<div class="mb-4">';
        html += '<h3 class="text-lg font-semibold text-white mb-2">Устройства (TV)</h3>';
        html += '<div class="space-y-2">';
        data.devices.forEach(device => {
            const lastSeen = formatRelativeTime(device.lastSeen);
            html += `
                <div class="bg-gray-700 rounded-lg p-3 flex justify-between items-center">
                    <div class="flex-1">
                        <div class="text-white font-medium">${device.label}</div>
                        <div class="text-gray-400 text-sm mt-1">Последний раз в сети: ${lastSeen}</div>
                    </div>
                    <button onclick="hideDevice('${device.deviceId}')" class="ml-3 px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors" title="Скрыть устройство">
                        Скрыть
                    </button>
                </div>
            `;
        });
        html += '</div>';
        html += '</div>';
    }
    
    if (data.sensors && data.sensors.length > 0) {
        html += '<div class="mb-4">';
        html += '<h3 class="text-lg font-semibold text-white mb-2">Датчики температуры</h3>';
        html += '<div class="space-y-2">';
        data.sensors.forEach(sensor => {
            const lastSeen = formatRelativeTime(sensor.lastSeen);
            html += `
                <div class="bg-gray-700 rounded-lg p-3 flex justify-between items-center">
                    <div class="flex-1">
                        <div class="text-white font-medium">${sensor.label}</div>
                        <div class="text-gray-400 text-sm mt-1">Последний раз в сети: ${lastSeen}</div>
                    </div>
                    <button onclick="hideDevice('${sensor.deviceId}')" class="ml-3 px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors" title="Скрыть устройство">
                        Скрыть
                    </button>
                </div>
            `;
        });
        html += '</div>';
        html += '</div>';
    }
    
    // Другие оффлайн устройства (лампочки, розетки, вентиляторы и т.д.)
    if (data.other && data.other.length > 0) {
        // Группируем по подтипам
        const groupedByType = {};
        data.other.forEach(device => {
            const subType = device.subType || 'other';
            if (!groupedByType[subType]) {
                groupedByType[subType] = [];
            }
            groupedByType[subType].push(device);
        });
        
        // Названия подтипов
        const subTypeNames = {
            'light': 'Освещение',
            'outlet': 'Розетки',
            'fan': 'Вентиляторы',
            'sensor': 'Датчики',
            'other': 'Другие устройства'
        };
        
        Object.keys(groupedByType).forEach(subType => {
            const devices = groupedByType[subType];
            const typeName = subTypeNames[subType] || 'Другие устройства';
            html += '<div class="mb-4">';
            html += `<h3 class="text-lg font-semibold text-white mb-2">${typeName}</h3>`;
            html += '<div class="space-y-2">';
            devices.forEach(device => {
                const lastSeen = formatRelativeTime(device.lastSeen);
                html += `
                    <div class="bg-gray-700 rounded-lg p-3 flex justify-between items-center">
                        <div class="flex-1">
                            <div class="text-white font-medium">${device.label}</div>
                            <div class="text-gray-400 text-sm mt-1">Последний раз в сети: ${lastSeen}</div>
                        </div>
                        <button onclick="hideDevice('${device.deviceId}')" class="ml-3 px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors" title="Скрыть устройство">
                            Скрыть
                        </button>
                    </div>
                `;
            });
            html += '</div>';
            html += '</div>';
        });
    }
    
    if (html === '') {
        html = '<div class="text-gray-400 text-center py-4">Все устройства и датчики в сети</div>';
    }
    
    content.innerHTML = html;
    modal.classList.remove('hidden');
    
    // Добавляем обработчик клика вне модального окна для закрытия
    const closeOnBackdropClick = (e) => {
        if (e.target === modal) {
            closeOfflineDevicesModal();
            modal.removeEventListener('click', closeOnBackdropClick);
        }
    };
    modal.addEventListener('click', closeOnBackdropClick);
}

// Закрытие модального окна оффлайн устройств
export function closeOfflineDevicesModal() {
    const modal = document.getElementById('offlineDevicesModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Функция для скрытия устройства
export async function hideDevice(deviceId) {
    try {
        const response = await fetch('/api/device/hide', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ deviceId })
        });
        
        if (!response.ok) {
            throw new Error('Ошибка скрытия устройства');
        }
        
        // Обновляем индикатор и модальное окно
        await updateOfflineDevicesIndicator();
        await showOfflineDevicesModal();
    } catch (error) {
        console.error('Ошибка скрытия устройства:', error);
        alert('Не удалось скрыть устройство');
    }
}

// Всплывающий блок для заблокированного экрана
export async function showOfflineDevicesPopup() {
    const popup = document.getElementById('offlineDevicesPopup');
    const popupContent = document.getElementById('offlineDevicesPopupContent');
    
    if (!popup || !popupContent) {
        return;
    }
    
    const data = await loadOfflineDevices();
    
    let html = '';
    
    if (data.devices && data.devices.length > 0) {
        html += '<div class="mb-3">';
        html += '<h4 class="text-sm font-semibold text-white mb-1">Устройства (TV)</h4>';
        data.devices.forEach(device => {
            const lastSeen = formatRelativeTime(device.lastSeen);
            html += `
                <div class="bg-gray-700 rounded p-2 mb-1 text-xs">
                    <div class="text-white font-medium">${device.label}</div>
                    <div class="text-gray-400 text-xs">${lastSeen}</div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    if (data.sensors && data.sensors.length > 0) {
        html += '<div class="mb-3">';
        html += '<h4 class="text-sm font-semibold text-white mb-1">Датчики</h4>';
        data.sensors.forEach(sensor => {
            const lastSeen = formatRelativeTime(sensor.lastSeen);
            html += `
                <div class="bg-gray-700 rounded p-2 mb-1 text-xs">
                    <div class="text-white font-medium">${sensor.label}</div>
                    <div class="text-gray-400 text-xs">${lastSeen}</div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    // Другие оффлайн устройства (показываем компактно для всплывающего блока)
    if (data.other && data.other.length > 0) {
        html += '<div class="mb-3">';
        html += '<h4 class="text-sm font-semibold text-white mb-1">Другие устройства</h4>';
        data.other.forEach(device => {
            const lastSeen = formatRelativeTime(device.lastSeen);
            html += `
                <div class="bg-gray-700 rounded p-2 mb-1 text-xs">
                    <div class="text-white font-medium">${device.label}</div>
                    <div class="text-gray-400 text-xs">${lastSeen}</div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    if (html === '') {
        html = '<div class="text-gray-400 text-center py-2 text-xs">Все устройства в сети</div>';
    }
    
    popupContent.innerHTML = html;
    popup.classList.remove('hidden');
    
    // Закрываем всплывающий блок при клике вне его или через 5 секунд
    const closePopup = () => {
        popup.classList.add('hidden');
        document.removeEventListener('click', closePopupOnOutsideClick);
    };
    
    const closePopupOnOutsideClick = (e) => {
        if (!popup.contains(e.target)) {
            closePopup();
        }
    };
    
    // Закрытие при клике вне блока
    setTimeout(() => {
        document.addEventListener('click', closePopupOnOutsideClick);
    }, 100);
    
    // Автоматическое закрытие через 5 секунд
    setTimeout(() => {
        closePopup();
    }, 5000);
}

// Инициализация индикатора оффлайн устройств
export function initOfflineDevicesIndicator() {
    const indicator = document.getElementById('offlineDevicesIndicator');
    if (!indicator) {
        console.warn('Индикатор оффлайн устройств не найден в DOM при инициализации');
        return;
    }
    
    // Функция для открытия модального окна или всплывающего блока
    const openModal = async (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        // Проверяем, заблокирован ли экран
        const screensaverView = document.getElementById('screensaverView');
        const isLocked = screensaverView && !screensaverView.classList.contains('hidden');
        
        if (isLocked) {
            showOfflineDevicesPopup();
        } else {
            showOfflineDevicesModal();
        }
    };
    
    // Обработчик клика на индикатор
    indicator.addEventListener('click', openModal);
    
    // Также добавляем обработчик на внутренний div для надежности
    const innerDiv = indicator.querySelector('.relative');
    if (innerDiv) {
        innerDiv.addEventListener('click', openModal);
    }
    
    // Обработчик на SVG и badge
    const svg = indicator.querySelector('svg');
    if (svg) {
        svg.addEventListener('click', openModal);
        svg.style.pointerEvents = 'auto'; // Убеждаемся, что SVG принимает клики
    }
    
    const badge = indicator.querySelector('.offline-devices-badge');
    if (badge) {
        badge.addEventListener('click', openModal);
        badge.style.pointerEvents = 'auto'; // Убеждаемся, что badge принимает клики
    }
    
    // Обновляем индикатор при загрузке
    updateOfflineDevicesIndicator();
    
    // Обновляем индикатор каждые 30 секунд
    setInterval(() => {
        updateOfflineDevicesIndicator();
    }, 30000);
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.closeOfflineDevicesModal = closeOfflineDevicesModal;
    window.showOfflineDevicesModal = showOfflineDevicesModal;
    window.hideDevice = hideDevice;
}

