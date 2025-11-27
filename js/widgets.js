// ==========================================
// ОТРИСОВКА ВИДЖЕТОВ
// ==========================================

import { deviceWidgets, dashboardLoader, insideTemp, insideHumidity } from './dom.js';
import { currentDevices, deviceStates, deviceSettings } from './config.js';
import { loadDeviceSettings } from './settings.js';
import { controlDevice } from './devices.js';
import { openDeviceControl } from './devices.js';

export async function renderAllWidgets() {
    if (!deviceWidgets) return;
    
    deviceWidgets.innerHTML = '';
    if (dashboardLoader) dashboardLoader.classList.add('hidden');
    
    let insideTempFound = false;
    let insideHumidityFound = false;

    await loadDeviceSettings();

    const visibleDevices = currentDevices.filter(device => {
        const deviceLabel = (device.label || '').toLowerCase();
        const settings = deviceSettings[device.deviceId] || {};
        
        if (deviceLabel.includes('outlet')) {
            return false;
        }
        
        if (settings.hidden) {
            return false;
        }
        
        return true;
    });

    const groups = {
        'Освещение': [],
        'Энергия': [],
        'Безопасность': [],
        'Комфорт': []
    };

    visibleDevices.forEach(device => {
        const status = deviceStates[device.deviceId];
        if (!status || !status.main) return;

        const deviceLabel = device.label || 'Устройство';
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || deviceLabel;
        
        let group = 'Комфорт';
        
        if (status.main.switchLevel || status.main.colorControl || 
            (status.main.switch && (deviceLabel.toLowerCase().includes('лампа') || 
             deviceLabel.toLowerCase().includes('свет') || 
             deviceLabel.toLowerCase().includes('лента')))) {
            group = 'Освещение';
        } else if (status.main.powerMeter || 
                  deviceLabel.toLowerCase().includes('tv') || 
                  deviceLabel.toLowerCase().includes('аристон') ||
                  deviceLabel.toLowerCase().includes('samsung')) {
            group = 'Энергия';
        } else if (status.main.contactSensor || status.main.lock || status.main.presenceSensor) {
            group = 'Безопасность';
        } else if (status.main.switch) {
            if (deviceLabel.toLowerCase().includes('вентилятор') || 
                deviceLabel.toLowerCase().includes('fan')) {
                group = 'Комфорт';
            } else {
                group = 'Энергия';
            }
        }

        groups[group].push({ device, status, customName });
    });

    Object.keys(groups).forEach(groupName => {
        const groupDevices = groups[groupName];
        if (groupDevices.length === 0) return;

        const groupId = groupName.toLowerCase().replace(/\s+/g, '-');
        const hasSwitches = groupDevices.some(item => item.status.main.switch);
        
        let groupHTML = `
            <div class="col-span-full mb-4">
                <div class="flex justify-between items-center">
                    <h3 class="text-xl font-semibold text-gray-300">${groupName}</h3>
                    ${hasSwitches ? `
                        <button onclick="turnOffGroup('${groupId}')" 
                                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors">
                            Выключить всё
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        deviceWidgets.innerHTML += groupHTML;

        groupDevices.forEach(({ device, status, customName }) => {
            let widgetHTML = '';
            const deviceLabel = customName;

            if (status.main.switch) {
                const state = status.main.switch.switch.value;
                const isChecked = state === 'on' ? 'checked' : '';
                const isOn = state === 'on';
                const iconUrl = isOn 
                    ? 'https://img.icons8.com/fluency-systems-filled/96/facc15/light-on.png'
                    : 'https://img.icons8.com/fluency-systems-filled/96/6b7280/light-on.png';
                
                const hasBrightness = status.main.switchLevel !== undefined;
                const currentBrightness = hasBrightness ? (status.main.switchLevel.level?.value || 0) : 0;
                
                const cardClass = isOn 
                    ? `bg-gray-800 border-2 border-yellow-400 p-4 rounded-2xl flex flex-col justify-between h-36 transform transition-transform hover:scale-105 device-card ${hasBrightness ? 'brightness-capable' : ''}`
                    : `bg-gray-800 p-4 rounded-2xl flex flex-col justify-between h-36 transform transition-transform hover:scale-105 device-card ${hasBrightness ? 'brightness-capable' : ''}`;
                
                const brightnessIndicator = hasBrightness ? `
                    <div class="brightness-indicator-container">
                        <div class="brightness-indicator-fill" id="brightness-indicator-${device.deviceId}" style="width: ${isOn ? currentBrightness : 0}%"></div>
                    </div>
                ` : '';
                    
                widgetHTML = `
                    <div class="${cardClass} device-card-wrapper" data-device-id="${device.deviceId}" data-has-brightness="${hasBrightness}" style="cursor: pointer; position: relative;">
                        <div class="device-content">
                            <img src="${iconUrl}" class="h-10 w-10">
                            <h3 class="text-xl font-semibold mt-2 truncate">${deviceLabel}</h3>
                        </div>
                        <div class="relative inline-block w-14 align-middle select-none transition duration-200 ease-in mt-2 device-toggle" onclick="event.stopPropagation()">
                            <input type="checkbox" onchange="controlDevice('${device.deviceId}', this.checked ? 'on' : 'off')" 
                                   id="toggle-${device.deviceId}" ${isChecked} 
                                   class="toggle-checkbox absolute block w-7 h-7 rounded-full bg-white border-4 border-gray-600 appearance-none cursor-pointer transition-all"/>
                            <label for="toggle-${device.deviceId}" class="toggle-label block overflow-hidden h-7 rounded-full bg-gray-600 cursor-pointer"></label>
                        </div>
                        ${brightnessIndicator}
                    </div>
                `;
            }

            if (status.main.temperatureMeasurement) {
                const temp = status.main.temperatureMeasurement.temperature.value;
                const unit = status.main.temperatureMeasurement.temperature.unit || 'C';
                
                widgetHTML = `
                    <div class="bg-gray-800 p-4 rounded-2xl flex flex-col justify-between h-36">
                        <div>
                            <img src="https://img.icons8.com/fluency-systems-filled/96/3b82f6/thermometer.png" class="h-10 w-10">
                            <h3 class="text-xl font-semibold mt-2 truncate">${deviceLabel}</h3>
                        </div>
                        <p class="text-4xl font-bold">${temp}°${unit}</p>
                    </div>
                `;
                
                if (!insideTempFound && insideTemp) {
                    insideTemp.textContent = `${temp}°${unit}`;
                    insideTempFound = true;
                }
            }
            
            if (status.main.relativeHumidityMeasurement) {
                const humidity = status.main.relativeHumidityMeasurement.humidity.value;
                if (!insideHumidityFound && insideHumidity) {
                    insideHumidity.textContent = `${humidity}%`;
                    insideHumidityFound = true;
                }
                
                if (!widgetHTML) {
                    widgetHTML = `
                        <div class="bg-gray-800 p-4 rounded-2xl flex flex-col justify-between h-36">
                            <div>
                                <img src="https://img.icons8.com/fluency-systems-filled/96/3b82f6/hygrometer.png" class="h-10 w-10">
                                <h3 class="text-xl font-semibold mt-2 truncate">${deviceLabel}</h3>
                            </div>
                            <p class="text-4xl font-bold">${humidity}%</p>
                        </div>
                    `;
                }
            }
            
            if (status.main.contactSensor) {
                const state = status.main.contactSensor.contact.value;
                const text = state === 'open' ? 'Открыто' : 'Закрыто';
                const iconUrl = state === 'open'
                    ? 'https://img.icons8.com/fluency-systems-filled/96/ef4444/door-opened.png'
                    : 'https://img.icons8.com/fluency-systems-filled/96/22c55e/door-closed.png';
                    
                widgetHTML = `
                    <div class="bg-gray-800 p-4 rounded-2xl flex flex-col justify-between h-36">
                        <div>
                            <img src="${iconUrl}" class="h-10 w-10">
                            <h3 class="text-xl font-semibold mt-2 truncate">${deviceLabel}</h3>
                        </div>
                        <p class="text-3xl font-bold ${state === 'open' ? 'text-red-400' : 'text-green-400'}">${text}</p>
                    </div>
                `;
            }
            
            if (status.main.lock) {
                const state = status.main.lock.lock.value;
                const isLocked = state === 'locked';
                const text = isLocked ? 'Закрыто' : 'Открыто';
                const buttonText = isLocked ? 'Нажмите, чтобы открыть' : 'Нажмите, чтобы закрыть';
                const iconUrl = isLocked
                    ? 'https://img.icons8.com/fluency-systems-filled/96/22c55e/lock.png'
                    : 'https://img.icons8.com/fluency-systems-filled/96/ef4444/unlock.png';
                const buttonClass = isLocked ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700';
                const newCommand = isLocked ? 'unlock' : 'lock';

                widgetHTML = `
                    <div class="bg-gray-800 p-4 rounded-2xl flex flex-col justify-between h-36 transform transition-transform hover:scale-105">
                        <div>
                            <img src="${iconUrl}" class="h-10 w-10">
                            <h3 class="text-xl font-semibold mt-2 truncate">${deviceLabel}</h3>
                            <p class="text-lg font-medium ${isLocked ? 'text-green-400' : 'text-red-400'}">${text}</p>
                        </div>
                        <button onclick="controlDevice('${device.deviceId}', '${newCommand}', 'lock')" 
                                class="w-full text-sm p-2 rounded-lg font-medium ${buttonClass} transition-colors">
                            ${buttonText}
                        </button>
                    </div>
                `;
            }

            if (widgetHTML) {
                deviceWidgets.innerHTML += widgetHTML;
            }
        });
    });
    
    if (!insideTempFound && insideTemp) {
        insideTemp.textContent = '--°C';
    }
    if (!insideHumidityFound && insideHumidity) {
        insideHumidity.textContent = '--%';
    }

    if (deviceWidgets.innerHTML === '') {
        deviceWidgets.innerHTML = '<p class="text-gray-400 col-span-full">Не найдено устройств с поддержкой (switch, temperature). Проверьте API.</p>';
    }
    
    // Инициализируем управление яркостью для устройств с поддержкой
    initializeBrightnessControls();
}

// Инициализация управления яркостью жестом удержания и свайпа
function initializeBrightnessControls() {
    const brightnessCapableCards = document.querySelectorAll('.device-card[data-has-brightness="true"]');
    
    brightnessCapableCards.forEach(card => {
        const deviceId = card.getAttribute('data-device-id');
        if (!deviceId) return;
        
        let holdTimer = null;
        let isHolding = false;
        let startX = 0;
        let startY = 0;
        let startBrightness = 0;
        let isBrightnessControl = false;
        let hasMoved = false;
        let clickTimer = null;
        
        const brightnessIndicator = card.querySelector(`#brightness-indicator-${deviceId}`);
        const deviceContent = card.querySelector('.device-content');
        const toggleElement = card.querySelector('.device-toggle');
        
        // Получаем текущую яркость из состояния устройства
        const getCurrentBrightness = () => {
            const status = deviceStates[deviceId];
            if (status && status.main && status.main.switchLevel) {
                return status.main.switchLevel.level?.value || 0;
            }
            return 0;
        };
        
        // Обновляем индикатор яркости
        const updateBrightnessIndicator = (brightness) => {
            if (brightnessIndicator) {
                brightnessIndicator.style.width = `${brightness}%`;
            }
        };
        
        // Начало удержания (для тач-устройств)
        const handleTouchStart = (e) => {
            // Игнорируем если кликнули на toggle
            if (toggleElement && (toggleElement.contains(e.target) || toggleElement.contains(e.target.closest('.device-toggle')))) {
                return;
            }
            
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startBrightness = getCurrentBrightness();
            isHolding = false;
            isBrightnessControl = false;
            hasMoved = false;
            
            // Запускаем таймер для определения удержания (300мс)
            holdTimer = setTimeout(() => {
                isHolding = true;
                isBrightnessControl = true;
                card.classList.add('brightness-active');
                updateBrightnessIndicator(startBrightness);
            }, 300);
        };
        
        // Движение при удержании (для тач-устройств)
        const handleTouchMove = (e) => {
            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            const deltaX = currentX - startX;
            const deltaY = currentY - startY;
            const absDeltaX = Math.abs(deltaX);
            const absDeltaY = Math.abs(deltaY);
            
            // Если движение достаточно большое, считаем что пользователь двигает палец
            if (absDeltaX > 5 || absDeltaY > 5) {
                hasMoved = true;
            }
            
            // Если горизонтальное движение достаточно большое, активируем управление яркостью
            if (!isBrightnessControl && absDeltaX > 10 && absDeltaX > absDeltaY) {
                if (holdTimer) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
                isHolding = true;
                isBrightnessControl = true;
                card.classList.add('brightness-active');
                updateBrightnessIndicator(startBrightness);
            }
            
            if (isBrightnessControl) {
                e.preventDefault();
                const cardRect = card.getBoundingClientRect();
                const cardWidth = cardRect.width;
                
                // Вычисляем изменение яркости на основе горизонтального движения
                const brightnessChange = (deltaX / cardWidth) * 100;
                let newBrightness = Math.max(0, Math.min(100, startBrightness + brightnessChange));
                
                // Округляем до целого числа
                newBrightness = Math.round(newBrightness);
                
                updateBrightnessIndicator(newBrightness);
                
                // Используем updateBrightness из devices.js
                if (typeof window.updateBrightness === 'function') {
                    window.updateBrightness(deviceId, newBrightness);
                }
            }
        };
        
        // Конец удержания (для тач-устройств)
        const handleTouchEnd = (e) => {
            if (holdTimer) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
            
            if (isBrightnessControl) {
                // Завершаем управление яркостью
                card.classList.remove('brightness-active');
            } else if (!hasMoved && !isHolding) {
                // Если не было движения и не было удержания, открываем меню устройства
                // Небольшая задержка, чтобы не конфликтовать с toggle
                clickTimer = setTimeout(() => {
                    openDeviceControl(deviceId);
                }, 50);
            }
            
            isHolding = false;
            isBrightnessControl = false;
            hasMoved = false;
        };
        
        // Начало удержания (для мыши)
        const handleMouseDown = (e) => {
            // Игнорируем если кликнули на toggle или правой кнопкой
            if (toggleElement && (toggleElement.contains(e.target) || toggleElement.contains(e.target.closest('.device-toggle'))) || e.button !== 0) {
                return;
            }
            
            startX = e.clientX;
            startY = e.clientY;
            startBrightness = getCurrentBrightness();
            isHolding = false;
            isBrightnessControl = false;
            hasMoved = false;
            
            // Добавляем обработчики для движения и отпускания мыши
            const handleMouseMove = (e) => {
                const currentX = e.clientX;
                const currentY = e.clientY;
                const deltaX = currentX - startX;
                const deltaY = currentY - startY;
                const absDeltaX = Math.abs(deltaX);
                const absDeltaY = Math.abs(deltaY);
                
                // Если движение достаточно большое, считаем что пользователь двигает мышь
                if (absDeltaX > 5 || absDeltaY > 5) {
                    hasMoved = true;
                }
                
                // Если горизонтальное движение достаточно большое, активируем управление яркостью
                if (!isBrightnessControl && absDeltaX > 10 && absDeltaX > absDeltaY) {
                    if (holdTimer) {
                        clearTimeout(holdTimer);
                        holdTimer = null;
                    }
                    isHolding = true;
                    isBrightnessControl = true;
                    card.classList.add('brightness-active');
                    updateBrightnessIndicator(startBrightness);
                }
                
                if (isBrightnessControl) {
                    e.preventDefault();
                    const cardRect = card.getBoundingClientRect();
                    const cardWidth = cardRect.width;
                    
                    // Вычисляем изменение яркости на основе горизонтального движения
                    const brightnessChange = (deltaX / cardWidth) * 100;
                    let newBrightness = Math.max(0, Math.min(100, startBrightness + brightnessChange));
                    
                    // Округляем до целого числа
                    newBrightness = Math.round(newBrightness);
                    
                    updateBrightnessIndicator(newBrightness);
                    
                    // Используем updateBrightness из devices.js
                    if (typeof window.updateBrightness === 'function') {
                        window.updateBrightness(deviceId, newBrightness);
                    }
                }
            };
            
            const handleMouseUp = (e) => {
                if (holdTimer) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
                
                if (isBrightnessControl) {
                    // Завершаем управление яркостью
                    card.classList.remove('brightness-active');
                } else if (!hasMoved && !isHolding) {
                    // Если не было движения и не было удержания, открываем меню устройства
                    // Небольшая задержка, чтобы не конфликтовать с toggle
                    clickTimer = setTimeout(() => {
                        openDeviceControl(deviceId);
                    }, 50);
                }
                
                isHolding = false;
                isBrightnessControl = false;
                hasMoved = false;
                
                // Удаляем обработчики
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
            
            // Запускаем таймер для определения удержания (300мс)
            holdTimer = setTimeout(() => {
                if (!isBrightnessControl) {
                    isHolding = true;
                    isBrightnessControl = true;
                    card.classList.add('brightness-active');
                    updateBrightnessIndicator(startBrightness);
                }
            }, 300);
            
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        };
        
        // Добавляем обработчики событий
        card.addEventListener('touchstart', handleTouchStart, { passive: false });
        card.addEventListener('touchmove', handleTouchMove, { passive: false });
        card.addEventListener('touchend', handleTouchEnd);
        card.addEventListener('touchcancel', handleTouchEnd);
        card.addEventListener('mousedown', handleMouseDown);
        
        // Предотвращаем контекстное меню при долгом нажатии
        card.addEventListener('contextmenu', (e) => {
            if (isBrightnessControl) {
                e.preventDefault();
            }
        });
    });
}

export async function turnOffGroup(groupId) {
    const groupName = groupId.split('-').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    
    await loadDeviceSettings();
    
    const visibleDevices = currentDevices.filter(device => {
        const deviceLabel = (device.label || '').toLowerCase();
        const settings = deviceSettings[device.deviceId] || {};
        if (deviceLabel.includes('outlet') || settings.hidden) return false;
        return true;
    });

    visibleDevices.forEach(device => {
        const status = deviceStates[device.deviceId];
        if (!status || !status.main || !status.main.switch) return;

        let deviceGroup = 'Комфорт';
        const deviceLabel = (device.label || '').toLowerCase();
        
        if (status.main.switchLevel || status.main.colorControl || 
            deviceLabel.includes('лампа') || deviceLabel.includes('свет') || deviceLabel.includes('лента')) {
            deviceGroup = 'Освещение';
        } else if (status.main.powerMeter || deviceLabel.includes('tv') || 
                  deviceLabel.includes('аристон') || deviceLabel.includes('samsung')) {
            deviceGroup = 'Энергия';
        } else if (status.main.contactSensor || status.main.lock || status.main.presenceSensor) {
            deviceGroup = 'Безопасность';
        } else if (deviceLabel.includes('вентилятор') || deviceLabel.includes('fan')) {
            deviceGroup = 'Комфорт';
        } else {
            deviceGroup = 'Энергия';
        }

        if (deviceGroup === groupName && status.main.switch.switch.value === 'on') {
            controlDevice(device.deviceId, 'off');
        }
    });
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.turnOffGroup = turnOffGroup;
}

