// ==========================================
// УПРАВЛЕНИЕ УСТРОЙСТВАМИ
// ==========================================

import { getSocket } from './socket.js';
import { brightnessThrottle, colorThrottle } from './config.js';
import { hexToRgb, rgbToHsv } from './utils.js';
import { loadDeviceSettings } from './settings.js';
import { renderAllWidgets } from './widgets.js';

export function controlDevice(deviceId, command, capability = 'switch') {
    const socket = getSocket();
    if (!socket || !socket.connected) {
        console.error('Нет подключения к серверу');
        return;
    }
    
    socket.emit('control-device', {
        deviceId: deviceId,
        command: command,
        capability: capability
    });
}

export function updateBrightness(deviceId, value) {
    const brightnessValueElement = document.getElementById(`brightnessValue-${deviceId}`);
    if (brightnessValueElement) {
        brightnessValueElement.textContent = value;
    }
    
    if (brightnessThrottle[deviceId]) {
        clearTimeout(brightnessThrottle[deviceId]);
    }
    
    brightnessThrottle[deviceId] = setTimeout(() => {
        const socket = getSocket();
        if (socket && socket.connected) {
            socket.emit('device-control-advanced', {
                deviceId: deviceId,
                command: 'setLevel',
                capability: 'switchLevel',
                arguments: [parseInt(value)]
            });
        }
        delete brightnessThrottle[deviceId];
    }, 300);
}

export function updateColor(deviceId, hexColor) {
    const rgb = hexToRgb(hexColor);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    
    if (colorThrottle[deviceId]) {
        clearTimeout(colorThrottle[deviceId]);
    }
    
    colorThrottle[deviceId] = setTimeout(() => {
        const socket = getSocket();
        if (socket && socket.connected) {
            const colorArgs = {
                hue: hsv.h,
                saturation: hsv.s
            };
            
            socket.emit('device-control-advanced', {
                deviceId: deviceId,
                command: 'setColor',
                capability: 'colorControl',
                arguments: [colorArgs]
            });
        }
        delete colorThrottle[deviceId];
    }, 500);
}

export function setColorPreset(deviceId, preset) {
    const presets = {
        warm: { hue: 30, saturation: 100 },
        cool: { hue: 200, saturation: 100 },
        white: { hue: 0, saturation: 0 }
    };
    
    const socket = getSocket();
    if (socket && socket.connected && presets[preset]) {
        const colorArgs = {
            hue: presets[preset].hue,
            saturation: presets[preset].saturation
        };
        
        socket.emit('device-control-advanced', {
            deviceId: deviceId,
            command: 'setColor',
            capability: 'colorControl',
            arguments: [colorArgs]
        });
    }
}

export function setTimer(deviceId) {
    const input = document.getElementById(`timerInput-${deviceId}`);
    const minutes = parseInt(input.value);
    if (isNaN(minutes) || minutes < 1) {
        alert('Введите корректное количество минут');
        return;
    }
    
    setTimeout(() => {
        controlDevice(deviceId, 'off');
    }, minutes * 60 * 1000);
    
    alert(`Устройство выключится через ${minutes} минут`);
    input.value = '';
}

export async function updateDeviceName(deviceId, newName) {
    const settings = {};
    settings[deviceId] = { customName: newName };
    
    try {
        await fetch('/api/device/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        await loadDeviceSettings();
        renderAllWidgets();
    } catch (error) {
        console.error('Ошибка сохранения имени:', error);
    }
}

export async function toggleDeviceVisibility(deviceId, hidden) {
    const settings = {};
    settings[deviceId] = { hidden: hidden };
    
    try {
        await fetch('/api/device/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        await loadDeviceSettings();
        renderAllWidgets();
    } catch (error) {
        console.error('Ошибка сохранения видимости:', error);
    }
}

export function openDeviceControl(deviceId) {
    // Импортируем динамически, чтобы избежать циклических зависимостей
    import('./config.js').then(({ currentDevices, deviceStates, deviceSettings: settings }) => {
        const device = currentDevices.find(d => d.deviceId === deviceId);
        if (!device) return;
        
        const status = deviceStates[deviceId];
        if (!status || !status.main) return;
        
        const deviceSettings = JSON.parse(localStorage.getItem('deviceSettings') || '{}');
        const customName = deviceSettings[deviceId]?.customName || device.label || 'Устройство';
        
        const modal = document.getElementById('deviceControlModal');
        const modalDeviceName = document.getElementById('modalDeviceName');
        const modalDeviceContent = document.getElementById('modalDeviceContent');
        
        if (!modal || !modalDeviceName || !modalDeviceContent) return;
        
        modalDeviceName.textContent = customName;
        
        let contentHTML = '';
        
        if (status.main.switch) {
            const isOn = status.main.switch.switch.value === 'on';
            contentHTML += `
                <div class="mb-6">
                    <label class="flex items-center justify-between">
                        <span class="text-lg font-semibold">Состояние</span>
                        <div class="relative inline-block w-14 align-middle select-none transition duration-200 ease-in">
                            <input type="checkbox" onchange="controlDevice('${deviceId}', this.checked ? 'on' : 'off')" 
                                   id="modal-toggle-${deviceId}" ${isOn ? 'checked' : ''} 
                                   class="toggle-checkbox absolute block w-7 h-7 rounded-full bg-white border-4 border-gray-600 appearance-none cursor-pointer transition-all"/>
                            <label for="modal-toggle-${deviceId}" class="toggle-label block overflow-hidden h-7 rounded-full bg-gray-600 cursor-pointer"></label>
                        </div>
                    </label>
                </div>
            `;
        }
        
        if (status.main.switchLevel) {
            const brightness = status.main.switchLevel.level.value || 0;
            contentHTML += `
                <div class="mb-6">
                    <label class="block text-lg font-semibold mb-2">Яркость: <span id="brightnessValue-${deviceId}">${brightness}</span>%</label>
                    <input type="range" min="0" max="100" value="${brightness}" 
                           oninput="updateBrightness('${deviceId}', this.value)"
                           class="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer">
                </div>
            `;
        }
        
        if (status.main.colorControl) {
            contentHTML += `
                <div class="mb-6">
                    <label class="block text-lg font-semibold mb-2">Цвет</label>
                    <input type="color" id="colorPicker-${deviceId}" 
                           onchange="updateColor('${deviceId}', this.value)"
                           class="w-full h-12 rounded-lg cursor-pointer">
                    <div class="mt-2 flex gap-2">
                        <button onclick="setColorPreset('${deviceId}', 'warm')" 
                                class="px-4 py-2 bg-orange-500 rounded-lg hover:bg-orange-600 transition-colors">
                            Тёплый
                        </button>
                        <button onclick="setColorPreset('${deviceId}', 'cool')" 
                                class="px-4 py-2 bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">
                            Холодный
                        </button>
                        <button onclick="setColorPreset('${deviceId}', 'white')" 
                                class="px-4 py-2 bg-white rounded-lg hover:bg-gray-200 transition-colors">
                            Белый
                        </button>
                    </div>
                </div>
            `;
        }
        
        if (status.main.switch) {
            contentHTML += `
                <div class="mb-6">
                    <label class="block text-lg font-semibold mb-2">Таймер (минуты)</label>
                    <div class="flex gap-2">
                        <input type="number" id="timerInput-${deviceId}" min="1" max="1440" 
                               placeholder="Минуты" class="flex-1 px-4 py-2 bg-gray-700 rounded-lg">
                        <button onclick="setTimer('${deviceId}')" 
                                class="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors">
                            Установить
                        </button>
                    </div>
                    <p class="text-sm text-gray-400 mt-2">Устройство автоматически выключится через указанное время</p>
                </div>
            `;
        }
        
        contentHTML += `
            <div class="mb-6 border-t border-gray-700 pt-4">
                <h3 class="text-lg font-semibold mb-3">Настройки устройства</h3>
                <div class="space-y-3">
                    <div>
                        <label class="block text-sm text-gray-400 mb-1">Имя устройства</label>
                        <input type="text" id="deviceNameInput-${deviceId}" value="${customName}" 
                               onchange="updateDeviceName('${deviceId}', this.value)"
                               class="w-full px-4 py-2 bg-gray-700 rounded-lg">
                    </div>
                    <label class="flex items-center">
                        <input type="checkbox" id="deviceHidden-${deviceId}" 
                               ${deviceSettings[deviceId]?.hidden ? 'checked' : ''}
                               onchange="toggleDeviceVisibility('${deviceId}', this.checked)"
                               class="mr-2">
                        <span class="text-sm">Скрыть устройство</span>
                    </label>
                </div>
            </div>
        `;
        
        modalDeviceContent.innerHTML = contentHTML;
        modal.classList.remove('hidden');
    });
}

export function closeDeviceControlModal() {
    const modal = document.getElementById('deviceControlModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.controlDevice = controlDevice;
    window.updateBrightness = updateBrightness;
    window.updateColor = updateColor;
    window.setColorPreset = setColorPreset;
    window.setTimer = setTimer;
    window.updateDeviceName = updateDeviceName;
    window.toggleDeviceVisibility = toggleDeviceVisibility;
    window.openDeviceControl = openDeviceControl;
    window.closeDeviceControlModal = closeDeviceControlModal;
}

