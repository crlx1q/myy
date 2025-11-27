// ==========================================
// БЕЗОПАСНОСТЬ И ПРИСУТСТВИЕ
// ==========================================

import { currentDevices, deviceStates, deviceSettings, setCurrentEditingDeviceId, currentEditingDeviceId } from './config.js';
import { loadDeviceSettings, saveDeviceSettings } from './settings.js';
import { renderAllWidgets } from './widgets.js';
import { showNotification } from './notifications.js';
import { closeModal } from './utils.js';
import { controlDevice } from './devices.js';
import { getSocket } from './socket.js';

export async function loadSecurity() {
    try {
        const presenceResponse = await fetch('/api/presence');
        const presenceData = await presenceResponse.json();
        await renderPresenceStatus(presenceData);
        renderSecuritySensors();
        renderSecurityCameras();
        renderDoorbell();
    } catch (error) {
        console.error('Ошибка загрузки данных безопасности:', error);
    }
}

export async function renderPresenceStatus(presenceData) {
    const presenceStatus = document.getElementById('presenceStatus');
    if (!presenceStatus) return;
    
    await loadDeviceSettings();
    
    const presenceDevices = Object.keys(presenceData);
    const visibleDevices = presenceDevices.filter(deviceId => {
        const settings = deviceSettings[deviceId] || {};
        return !settings.hiddenInPresence;
    });
    
    if (visibleDevices.length === 0) {
        presenceStatus.innerHTML = '<p class="text-gray-400">Нет устройств присутствия</p>';
        return;
    }
    
    let html = '<div class="space-y-2">';
    visibleDevices.forEach(deviceId => {
        const device = presenceData[deviceId];
        const isPresent = device.presence === 'present';
        const settings = deviceSettings[deviceId] || {};
        const customName = settings.customName || device.label;
        html += `
            <div class="flex items-center justify-between bg-gray-700 rounded-lg p-3">
                <div class="flex items-center gap-3 flex-1">
                    <span class="text-lg">${customName}</span>
                    <span class="text-xs text-gray-400">${device.label}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-3 py-1 rounded-lg ${isPresent ? 'bg-green-600' : 'bg-red-600'}">
                        ${isPresent ? 'Дома' : 'Вне дома'}
                    </span>
                    <button onclick="togglePresenceUserVisibility('${deviceId}')" 
                            class="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs transition-colors flex items-center justify-center"
                            title="Скрыть пользователя">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                    </button>
                </div>
            </div>
        `;
    });
    
    const hiddenDevices = presenceDevices.filter(deviceId => {
        const settings = deviceSettings[deviceId] || {};
        return settings.hiddenInPresence === true;
    });
    
    if (hiddenDevices.length > 0) {
        html += `
            <div class="mt-4 pt-4 border-t border-gray-700">
                <p class="text-sm text-gray-400 mb-2">Скрытые пользователи (${hiddenDevices.length})</p>
                <div class="space-y-2">
        `;
        hiddenDevices.forEach(deviceId => {
            const device = presenceData[deviceId];
            const settings = deviceSettings[deviceId] || {};
            const customName = settings.customName || device.label;
            html += `
                <div class="flex items-center justify-between bg-gray-800 rounded-lg p-2 opacity-60">
                    <span class="text-sm text-gray-400">${customName}</span>
                    <button onclick="togglePresenceUserVisibility('${deviceId}')" 
                            class="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs transition-colors flex items-center justify-center"
                            title="Показать пользователя">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                    </button>
                </div>
            `;
        });
        html += '</div></div>';
    }
    
    html += '</div>';
    presenceStatus.innerHTML = html;
}

export async function togglePresenceUserVisibility(deviceId) {
    await loadDeviceSettings();
    if (!deviceSettings[deviceId]) {
        deviceSettings[deviceId] = {};
    }
    deviceSettings[deviceId].hiddenInPresence = !deviceSettings[deviceId].hiddenInPresence;
    
    try {
        await saveDeviceSettings();
        const presenceResponse = await fetch('/api/presence');
        const presenceData = await presenceResponse.json();
        await renderPresenceStatus(presenceData);
        showNotification('Успех', deviceSettings[deviceId].hiddenInPresence ? 'Пользователь скрыт' : 'Пользователь показан', 'success');
    } catch (error) {
        console.error('Ошибка сохранения настроек:', error);
        showNotification('Ошибка', 'Не удалось сохранить настройки', 'error');
    }
}

export async function renderSecuritySensors() {
    const securitySensors = document.getElementById('securitySensors');
    if (!securitySensors) return;
    
    await loadDeviceSettings();
    
    const sensors = currentDevices.filter(device => {
        const status = deviceStates[device.deviceId];
        const settings = deviceSettings[device.deviceId] || {};
        if (settings.hidden) return false;
        return status && status.main && 
               (status.main.contactSensor || status.main.lock);
    });
    
    // Получаем данные о датчике дыма
    const smokeDetectorData = await fetch('/api/security/smoke-detector').then(r => r.json()).catch(() => ({ status: 'normal' }));
    
    let html = '';
    
    // Добавляем датчик дыма
    const smokeStatus = smokeDetectorData.status || 'normal';
    const isSmokeDetected = smokeStatus === 'smoke' || smokeStatus === 'alarm';
    html += `
        <div class="bg-gray-700 rounded-xl p-4 mb-3">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-3">
                    <img src="${isSmokeDetected ? 'https://img.icons8.com/fluency-systems-filled/96/ef4444/fire-alarm.png' : 'https://img.icons8.com/fluency-systems-filled/96/22c55e/fire-alarm.png'}" 
                         class="h-10 w-10">
                    <div>
                        <div class="text-lg font-semibold">Датчик дыма</div>
                        <div class="text-xs text-gray-400">Система безопасности</div>
                    </div>
                </div>
                <span class="px-3 py-1 rounded-lg ${isSmokeDetected ? 'bg-red-600 animate-pulse' : 'bg-green-600'} font-medium">
                    ${isSmokeDetected ? 'Обнаружен дым!' : 'Норма'}
                </span>
            </div>
            <div class="flex gap-2 mt-2">
                <button onclick="testSmokeDetector()" 
                        class="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">
                    Тест
                </button>
                <button onclick="openSmokeDetectorSettings()" 
                        class="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">
                    Настройки
                </button>
            </div>
        </div>
    `;
    
    // Добавляем остальные датчики
    sensors.forEach(device => {
        const status = deviceStates[device.deviceId];
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || device.label;
        const originalName = device.label;
        
        if (status.main.contactSensor) {
            const state = status.main.contactSensor.contact.value;
            const isOpen = state === 'open';
            html += `
                <div class="bg-gray-700 rounded-xl p-4 mb-3">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-3">
                            <img src="${isOpen ? 'https://img.icons8.com/fluency-systems-filled/96/ef4444/door-opened.png' : 'https://img.icons8.com/fluency-systems-filled/96/22c55e/door-closed.png'}" 
                                 class="h-10 w-10">
                            <div>
                                <div class="text-lg font-semibold">${customName}</div>
                                <div class="text-xs text-gray-400">${originalName}</div>
                            </div>
                        </div>
                        <span class="px-3 py-1 rounded-lg ${isOpen ? 'bg-red-600' : 'bg-green-600'} font-medium">
                            ${isOpen ? 'Открыто' : 'Закрыто'}
                        </span>
                    </div>
                    <div class="flex gap-2 mt-2">
                        <button onclick="openSecurityDeviceSettings('${device.deviceId}')" 
                                class="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">
                            Настройки
                        </button>
                    </div>
                </div>
            `;
        } else if (status.main.lock) {
            const state = status.main.lock.lock.value;
            const isLocked = state === 'locked';
            html += `
                <div class="bg-gray-700 rounded-xl p-4 mb-3">
                    <div class="flex items-center justify-between mb-2">
                        <div class="flex items-center gap-3">
                            <img src="${isLocked ? 'https://img.icons8.com/fluency-systems-filled/96/22c55e/lock.png' : 'https://img.icons8.com/fluency-systems-filled/96/ef4444/unlock.png'}" 
                                 class="h-10 w-10">
                            <div>
                                <div class="text-lg font-semibold">${customName}</div>
                                <div class="text-xs text-gray-400">${originalName}</div>
                            </div>
                        </div>
                        <span class="px-3 py-1 rounded-lg ${isLocked ? 'bg-green-600' : 'bg-red-600'} font-medium">
                            ${isLocked ? 'Закрыто' : 'Открыто'}
                        </span>
                    </div>
                    <div class="flex gap-2 mt-2">
                        <button onclick="openSecurityDeviceSettings('${device.deviceId}')" 
                                class="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">
                            Настройки
                        </button>
                    </div>
                </div>
            `;
        }
    });
    
    if (html.trim() === '') {
        securitySensors.innerHTML = '<p class="text-gray-400">Нет датчиков безопасности</p>';
    } else {
        securitySensors.innerHTML = html;
    }
}

export function openSecurityDeviceSettings(deviceId) {
    setCurrentEditingDeviceId(deviceId);
    const device = currentDevices.find(d => d.deviceId === deviceId);
    if (!device) return;
    
    loadDeviceSettings().then(() => {
        const settings = deviceSettings[deviceId] || {};
        const customName = settings.customName || device.label;
        const hidden = settings.hidden || false;
        
        const nameInput = document.getElementById('securityDeviceNameInput');
        const hiddenCheckbox = document.getElementById('securityDeviceHiddenCheckbox');
        if (nameInput) nameInput.value = customName;
        if (hiddenCheckbox) hiddenCheckbox.checked = hidden;
        
        const modal = document.getElementById('securityDeviceSettingsModal');
        if (modal) modal.classList.remove('hidden');
    });
}

export async function saveSecurityDeviceSettings() {
    if (!currentEditingDeviceId) return;
    
    const nameInput = document.getElementById('securityDeviceNameInput');
    const hiddenCheckbox = document.getElementById('securityDeviceHiddenCheckbox');
    const customName = nameInput ? nameInput.value : '';
    const hidden = hiddenCheckbox ? hiddenCheckbox.checked : false;
    
    if (!customName.trim()) {
        showNotification('Ошибка', 'Введите имя устройства', 'error');
        return;
    }
    
    try {
        const settings = {};
        settings[currentEditingDeviceId] = {
            customName: customName,
            hidden: hidden
        };
        
        await fetch('/api/device/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        closeModal('securityDeviceSettingsModal');
        await loadDeviceSettings();
        renderSecuritySensors();
        renderAllWidgets();
    } catch (error) {
        console.error('Ошибка сохранения настроек:', error);
        showNotification('Ошибка', 'Не удалось сохранить настройки', 'error');
    }
}

export function setPresenceStatus(status) {
    const btnHome = document.getElementById('btn-home');
    const btnAway = document.getElementById('btn-away');
    
    if (status === 'home') {
        if (btnHome) {
            btnHome.classList.add('bg-green-600', 'hover:bg-green-700');
            btnHome.classList.remove('bg-gray-700', 'hover:bg-gray-600');
        }
        if (btnAway) {
            btnAway.classList.add('bg-gray-700', 'hover:bg-gray-600');
            btnAway.classList.remove('bg-green-600', 'hover:bg-green-700');
        }
    } else {
        if (btnAway) {
            btnAway.classList.add('bg-green-600', 'hover:bg-green-700');
            btnAway.classList.remove('bg-gray-700', 'hover:bg-gray-600');
        }
        if (btnHome) {
            btnHome.classList.add('bg-gray-700', 'hover:bg-gray-600');
            btnHome.classList.remove('bg-green-600', 'hover:bg-green-700');
        }
    }
}

export async function toggleAwayMode(enabled) {
    try {
        const response = await fetch('/api/away-mode', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enabled })
        });
        const data = await response.json();
        if (data.success) {
            if (enabled) {
                currentDevices.forEach(device => {
                    const status = deviceStates[device.deviceId];
                    if (status && status.main && status.main.switch) {
                        const deviceLabel = (device.label || '').toLowerCase();
                        if (deviceLabel.includes('outlet') || 
                            deviceLabel.includes('лампа') || 
                            deviceLabel.includes('свет')) {
                            controlDevice(device.deviceId, 'off');
                        }
                    }
                });
            }
        }
    } catch (error) {
        console.error('Ошибка переключения режима отсутствия:', error);
    }
}

export async function showHiddenDevicesInSecurity() {
    await loadDeviceSettings();
    const hiddenDevices = currentDevices.filter(device => {
        const settings = deviceSettings[device.deviceId] || {};
        return settings.hidden;
    });
    
    if (hiddenDevices.length === 0) {
        showNotification('Информация', 'Нет скрытых устройств', 'info');
        return;
    }
    
    let html = '<div class="space-y-2">';
    hiddenDevices.forEach((device, index) => {
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || device.label;
        html += `
            <button onclick="unhideDevice('${device.deviceId}')" 
                    class="w-full bg-gray-700 hover:bg-gray-600 rounded-lg p-3 text-left transition-colors">
                <div class="font-semibold">${customName}</div>
                <div class="text-sm text-gray-400">${device.label}</div>
            </button>
        `;
    });
    html += '</div>';
    
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-2xl font-bold">Скрытые устройства</h2>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
            ${html}
        </div>
    `;
    document.body.appendChild(modal);
}

export async function unhideDevice(deviceId) {
    try {
        const settings = {};
        settings[deviceId] = { hidden: false };
        
        await fetch('/api/device/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });
        
        document.querySelectorAll('.fixed').forEach(modal => {
            if (modal.querySelector('.text-2xl')?.textContent === 'Скрытые устройства') {
                modal.remove();
            }
        });
        
        await loadDeviceSettings();
        renderSecuritySensors();
        renderAllWidgets();
    } catch (error) {
        console.error('Ошибка:', error);
    }
}

// Отображение IP камер
export async function renderSecurityCameras() {
    const camerasContainer = document.getElementById('securityCameras');
    if (!camerasContainer) return;
    
    try {
        const camerasData = await fetch('/api/security/cameras').then(r => r.json()).catch(() => ({ cameras: [] }));
        const cameras = camerasData.cameras || [];
        
        if (cameras.length === 0) {
            // Добавляем заглушку для будущей IP камеры
            cameras.push({
                id: 'ip-camera-1',
                name: 'IP Камера',
                status: 'online',
                streamUrl: null,
                ptz: { pan: 0, tilt: 0, zoom: 1 }
            });
        }
        
        let html = '';
        cameras.forEach(camera => {
            const isOnline = camera.status === 'online';
            html += `
                <div class="bg-gray-700 rounded-xl p-4 mb-3">
                    <div class="flex items-center justify-between mb-3">
                        <div class="flex items-center gap-3">
                            <img src="https://img.icons8.com/fluency-systems-filled/96/3b82f6/security-camera.png" 
                                 class="h-10 w-10">
                            <div>
                                <div class="text-lg font-semibold">${camera.name}</div>
                                <div class="text-xs text-gray-400">IP камера с PTZ</div>
                            </div>
                        </div>
                        <span class="px-3 py-1 rounded-lg ${isOnline ? 'bg-green-600' : 'bg-red-600'} font-medium">
                            ${isOnline ? 'Онлайн' : 'Оффлайн'}
                        </span>
                    </div>
                    ${camera.streamUrl ? `
                        <div class="mb-3 bg-black rounded-lg overflow-hidden">
                            <img src="${camera.streamUrl}" alt="Камера" class="w-full h-48 object-cover">
                        </div>
                    ` : `
                        <div class="mb-3 bg-black rounded-lg h-48 flex items-center justify-center">
                            <p class="text-gray-500">Видеопоток недоступен</p>
                        </div>
                    `}
                    <div class="flex gap-2 flex-wrap">
                        <button onclick="openCameraControl('${camera.id}')" 
                                class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs transition-colors">
                            Управление PTZ
                        </button>
                        <button onclick="openCameraSettings('${camera.id}')" 
                                class="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">
                            Настройки
                        </button>
                        ${camera.streamUrl ? `
                            <button onclick="openCameraFullscreen('${camera.id}')" 
                                    class="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">
                                Полный экран
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        });
        
        camerasContainer.innerHTML = html;
    } catch (error) {
        console.error('Ошибка загрузки камер:', error);
        camerasContainer.innerHTML = '<p class="text-gray-400">Ошибка загрузки камер</p>';
    }
}

// Отображение дверного звонка
export async function renderDoorbell() {
    const doorbellContainer = document.getElementById('doorbellContainer');
    if (!doorbellContainer) return;
    
    try {
        const doorbellData = await fetch('/api/security/doorbell').then(r => r.json()).catch(() => ({ 
            status: 'idle',
            hasVisitor: false
        }));
        
        const hasVisitor = doorbellData.hasVisitor || false;
        const status = doorbellData.status || 'idle';
        
        let html = `
            <div class="bg-gray-700 rounded-xl p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-3">
                        <img src="https://img.icons8.com/fluency-systems-filled/96/3b82f6/doorbell.png" 
                             class="h-10 w-10">
                        <div>
                            <div class="text-lg font-semibold">Дверной звонок</div>
                            <div class="text-xs text-gray-400">Камера с микрофоном</div>
                        </div>
                    </div>
                    ${hasVisitor ? `
                        <span class="px-3 py-1 rounded-lg bg-yellow-600 animate-pulse font-medium">
                            Посетитель
                        </span>
                    ` : `
                        <span class="px-3 py-1 rounded-lg bg-green-600 font-medium">
                            Ожидание
                        </span>
                    `}
                </div>
                ${doorbellData.streamUrl ? `
                    <div class="mb-3 bg-black rounded-lg overflow-hidden">
                        <img src="${doorbellData.streamUrl}" alt="Дверной звонок" class="w-full h-48 object-cover">
                    </div>
                ` : `
                    <div class="mb-3 bg-black rounded-lg h-48 flex items-center justify-center">
                        <p class="text-gray-500">Видеопоток недоступен</p>
                    </div>
                `}
                <div class="flex gap-2 flex-wrap">
                    <button onclick="openDoorbellControl()" 
                            class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs transition-colors">
                        Управление
                    </button>
                    <button onclick="openDoorbellSettings()" 
                            class="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded-lg text-xs transition-colors">
                        Настройки
                    </button>
                    ${hasVisitor ? `
                        <button onclick="answerDoorbell()" 
                                class="px-3 py-1 bg-green-600 hover:bg-green-700 rounded-lg text-xs transition-colors">
                            Ответить
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
        
        doorbellContainer.innerHTML = html;
    } catch (error) {
        console.error('Ошибка загрузки дверного звонка:', error);
        doorbellContainer.innerHTML = '<p class="text-gray-400">Ошибка загрузки дверного звонка</p>';
    }
}

// Управление PTZ камеры
export async function controlCameraPTZ(cameraId, direction, value) {
    try {
        const response = await fetch('/api/security/camera/ptz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cameraId, direction, value })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', 'Камера перемещена', 'success');
            renderSecurityCameras();
        } else {
            showNotification('Ошибка', data.error || 'Не удалось управлять камерой', 'error');
        }
    } catch (error) {
        console.error('Ошибка управления камерой:', error);
        showNotification('Ошибка', 'Не удалось управлять камерой', 'error');
    }
}

// Открытие управления камерой
export function openCameraControl(cameraId) {
    const modal = document.getElementById('cameraControlModal');
    if (!modal) return;
    
    // Устанавливаем текущую камеру
    modal.setAttribute('data-camera-id', cameraId);
    modal.classList.remove('hidden');
}

// Открытие настроек камеры
export function openCameraSettings(cameraId) {
    const modal = document.getElementById('cameraSettingsModal');
    if (!modal) return;
    
    modal.setAttribute('data-camera-id', cameraId);
    modal.classList.remove('hidden');
}

// Открытие управления дверным звонком
export function openDoorbellControl() {
    const modal = document.getElementById('doorbellControlModal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
}

// Открытие настроек дверного звонка
export function openDoorbellSettings() {
    const modal = document.getElementById('doorbellSettingsModal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
}

// Ответ на дверной звонок
export async function answerDoorbell() {
    try {
        const response = await fetch('/api/security/doorbell/answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', 'Соединение установлено', 'success');
            renderDoorbell();
        } else {
            showNotification('Ошибка', data.error || 'Не удалось ответить', 'error');
        }
    } catch (error) {
        console.error('Ошибка ответа на звонок:', error);
        showNotification('Ошибка', 'Не удалось ответить на звонок', 'error');
    }
}

// Тест датчика дыма
export async function testSmokeDetector() {
    try {
        const response = await fetch('/api/security/smoke-detector/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', 'Тест датчика выполнен', 'success');
            renderSecuritySensors();
        } else {
            showNotification('Ошибка', data.error || 'Не удалось выполнить тест', 'error');
        }
    } catch (error) {
        console.error('Ошибка теста датчика:', error);
        showNotification('Ошибка', 'Не удалось выполнить тест', 'error');
    }
}

// Открытие настроек датчика дыма
export function openSmokeDetectorSettings() {
    const modal = document.getElementById('smokeDetectorSettingsModal');
    if (!modal) return;
    
    modal.classList.remove('hidden');
}

// Полноэкранный режим камеры
export function openCameraFullscreen(cameraId) {
    const modal = document.getElementById('cameraFullscreenModal');
    if (!modal) return;
    
    modal.setAttribute('data-camera-id', cameraId);
    modal.classList.remove('hidden');
}

// Управление микрофоном дверного звонка
export async function toggleDoorbellMicrophone(enabled) {
    try {
        const response = await fetch('/api/security/doorbell/microphone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', enabled ? 'Микрофон включен' : 'Микрофон выключен', 'success');
        } else {
            showNotification('Ошибка', data.error || 'Не удалось изменить состояние микрофона', 'error');
        }
    } catch (error) {
        console.error('Ошибка управления микрофоном:', error);
        showNotification('Ошибка', 'Не удалось изменить состояние микрофона', 'error');
    }
}

// Управление динамиком дверного звонка
export async function toggleDoorbellSpeaker(enabled) {
    try {
        const response = await fetch('/api/security/doorbell/speaker', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', enabled ? 'Динамик включен' : 'Динамик выключен', 'success');
        } else {
            showNotification('Ошибка', data.error || 'Не удалось изменить состояние динамика', 'error');
        }
    } catch (error) {
        console.error('Ошибка управления динамиком:', error);
        showNotification('Ошибка', 'Не удалось изменить состояние динамика', 'error');
    }
}

// Установка громкости дверного звонка
export async function setDoorbellVolume(volume) {
    try {
        const volumeValue = document.getElementById('doorbellVolumeValue');
        if (volumeValue) volumeValue.textContent = `${volume}%`;
        
        const response = await fetch('/api/security/doorbell/volume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ volume: parseInt(volume) })
        });
        const data = await response.json();
        if (!data.success) {
            showNotification('Ошибка', data.error || 'Не удалось установить громкость', 'error');
        }
    } catch (error) {
        console.error('Ошибка установки громкости:', error);
    }
}

// Сохранение настроек камеры
export async function saveCameraSettings() {
    const modal = document.getElementById('cameraSettingsModal');
    if (!modal) return;
    
    const cameraId = modal.getAttribute('data-camera-id');
    const nameInput = document.getElementById('cameraNameInput');
    const streamUrlInput = document.getElementById('cameraStreamUrlInput');
    
    try {
        const response = await fetch('/api/security/camera/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cameraId,
                name: nameInput?.value || '',
                streamUrl: streamUrlInput?.value || ''
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', 'Настройки камеры сохранены', 'success');
            closeModal('cameraSettingsModal');
            renderSecurityCameras();
        } else {
            showNotification('Ошибка', data.error || 'Не удалось сохранить настройки', 'error');
        }
    } catch (error) {
        console.error('Ошибка сохранения настроек камеры:', error);
        showNotification('Ошибка', 'Не удалось сохранить настройки', 'error');
    }
}

// Сохранение настроек дверного звонка
export async function saveDoorbellSettings() {
    const nameInput = document.getElementById('doorbellNameInput');
    const streamUrlInput = document.getElementById('doorbellStreamUrlInput');
    
    try {
        const response = await fetch('/api/security/doorbell/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: nameInput?.value || '',
                streamUrl: streamUrlInput?.value || ''
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', 'Настройки дверного звонка сохранены', 'success');
            closeModal('doorbellSettingsModal');
            renderDoorbell();
        } else {
            showNotification('Ошибка', data.error || 'Не удалось сохранить настройки', 'error');
        }
    } catch (error) {
        console.error('Ошибка сохранения настроек дверного звонка:', error);
        showNotification('Ошибка', 'Не удалось сохранить настройки', 'error');
    }
}

// Установка чувствительности датчика дыма
export function setSmokeDetectorSensitivity(value) {
    const sensitivityValue = document.getElementById('smokeDetectorSensitivityValue');
    if (sensitivityValue) sensitivityValue.textContent = value;
}

// Сохранение настроек датчика дыма
export async function saveSmokeDetectorSettings() {
    const sensitivitySlider = document.getElementById('smokeDetectorSensitivitySlider');
    const notificationsCheckbox = document.getElementById('smokeDetectorNotificationsCheckbox');
    
    try {
        const response = await fetch('/api/security/smoke-detector/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sensitivity: parseInt(sensitivitySlider?.value || 5),
                notifications: notificationsCheckbox?.checked || false
            })
        });
        const data = await response.json();
        if (data.success) {
            showNotification('Успех', 'Настройки датчика дыма сохранены', 'success');
            closeModal('smokeDetectorSettingsModal');
        } else {
            showNotification('Ошибка', data.error || 'Не удалось сохранить настройки', 'error');
        }
    } catch (error) {
        console.error('Ошибка сохранения настроек датчика дыма:', error);
        showNotification('Ошибка', 'Не удалось сохранить настройки', 'error');
    }
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.setPresenceStatus = setPresenceStatus;
    window.toggleAwayMode = toggleAwayMode;
    window.showHiddenDevicesInSecurity = showHiddenDevicesInSecurity;
    window.unhideDevice = unhideDevice;
    window.togglePresenceUserVisibility = togglePresenceUserVisibility;
    window.openSecurityDeviceSettings = openSecurityDeviceSettings;
    window.saveSecurityDeviceSettings = saveSecurityDeviceSettings;
    window.openCameraControl = openCameraControl;
    window.openCameraSettings = openCameraSettings;
    window.openDoorbellControl = openDoorbellControl;
    window.openDoorbellSettings = openDoorbellSettings;
    window.answerDoorbell = answerDoorbell;
    window.testSmokeDetector = testSmokeDetector;
    window.openSmokeDetectorSettings = openSmokeDetectorSettings;
    window.openCameraFullscreen = openCameraFullscreen;
    window.controlCameraPTZ = controlCameraPTZ;
    window.toggleDoorbellMicrophone = toggleDoorbellMicrophone;
    window.toggleDoorbellSpeaker = toggleDoorbellSpeaker;
    window.setDoorbellVolume = setDoorbellVolume;
    window.saveCameraSettings = saveCameraSettings;
    window.saveDoorbellSettings = saveDoorbellSettings;
    window.setSmokeDetectorSensitivity = setSmokeDetectorSensitivity;
    window.saveSmokeDetectorSettings = saveSmokeDetectorSettings;
}

