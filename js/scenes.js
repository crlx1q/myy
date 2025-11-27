// ==========================================
// СЦЕНЫ, РАСПИСАНИЯ И АВТОМАТИЗАЦИЯ
// ==========================================

import { currentDevices, deviceStates, deviceSettings, scenes, schedules, automations, setScenes, setSchedules, setAutomations } from './config.js';
import { loadDeviceSettings } from './settings.js';
import { controlDevice } from './devices.js';
import { getSocket } from './socket.js';
import { showNotification } from './notifications.js';
import { closeModal } from './utils.js';

export async function loadScenes() {
    try {
        const response = await fetch('/api/scenes');
        const scenesData = await response.json();
        setScenes(scenesData);
        renderScenes(scenesData);
    } catch (error) {
        console.error('Ошибка загрузки сцен:', error);
    }
    
    try {
        const response = await fetch('/api/schedules');
        const schedulesData = await response.json();
        setSchedules(schedulesData);
        renderSchedules(schedulesData);
    } catch (error) {
        console.error('Ошибка загрузки расписаний:', error);
    }
    
    try {
        const response = await fetch('/api/automations');
        const automationsData = await response.json();
        setAutomations(automationsData);
        renderAutomations(automationsData);
    } catch (error) {
        console.error('Ошибка загрузки автоматизаций:', error);
    }
}

export async function executeScene(sceneId) {
    if (sceneId === 'home' || sceneId === 'night' || sceneId === 'wake' || sceneId === 'away') {
        currentDevices.forEach(device => {
            const status = deviceStates[device.deviceId];
            if (!status || !status.main || !status.main.switch) return;
            
            const deviceLabel = (device.label || '').toLowerCase();
            
            if (sceneId === 'home') {
                if (deviceLabel.includes('лампа') || deviceLabel.includes('свет') || 
                    deviceLabel.includes('лента') || deviceLabel.includes('pc') ||
                    deviceLabel.includes('пк')) {
                    controlDevice(device.deviceId, 'on');
                }
            } else if (sceneId === 'night') {
                controlDevice(device.deviceId, 'off');
            } else if (sceneId === 'away') {
                if (deviceLabel.includes('outlet') || deviceLabel.includes('лампа') || 
                    deviceLabel.includes('свет')) {
                    controlDevice(device.deviceId, 'off');
                }
            }
        });
    } else {
        const localScenes = JSON.parse(localStorage.getItem('scenes') || '[]');
        const scene = localScenes.find(s => s.id === sceneId);
        const socket = getSocket();
        if (scene && socket && socket.connected) {
            socket.emit('scene-execute', { sceneId: scene.id });
        }
    }
}

export function renderScenes(scenesData) {
    const scenesContent = document.getElementById('scenesContent');
    if (!scenesContent) return;
    
    const customScenesHTML = scenesData.map(scene => `
        <button onclick="executeScene('${scene.id}')" 
                class="bg-gray-800 hover:bg-gray-700 rounded-2xl p-6 text-left transition-colors">
            <h3 class="text-xl font-semibold mb-2">${scene.name}</h3>
            <p class="text-sm text-gray-400">${scene.actions.length} действий</p>
        </button>
    `).join('');
    
    const scenesSection = scenesContent.querySelector('.mb-6');
    if (scenesSection && customScenesHTML) {
        const existingGrid = scenesSection.querySelector('.grid');
        if (existingGrid) {
            existingGrid.innerHTML += customScenesHTML;
        }
    }
}

export function renderSchedules(schedulesData) {
    const schedulesList = document.getElementById('schedulesList');
    if (!schedulesList) return;
    
    if (schedulesData.length === 0) {
        schedulesList.innerHTML = '<p class="text-gray-400">Нет расписаний</p>';
        return;
    }
    
    const daysNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    
    schedulesList.innerHTML = schedulesData.map(schedule => {
        const device = currentDevices.find(d => d.deviceId === schedule.deviceId);
        const deviceName = device ? device.label : schedule.deviceId;
        const daysStr = schedule.days.map(d => daysNames[d - 1]).join(', ');
        
        return `
            <div class="bg-gray-700 rounded-lg p-4 flex justify-between items-center">
                <div>
                    <div class="font-semibold">${schedule.name}</div>
                    <div class="text-sm text-gray-400">${schedule.time} • ${daysStr}</div>
                    <div class="text-sm text-gray-400">${deviceName} → ${schedule.command === 'on' ? 'Включить' : 'Выключить'}</div>
                </div>
                <div class="flex gap-2">
                    <label class="relative inline-block w-12 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" ${schedule.enabled ? 'checked' : ''} 
                               onchange="toggleSchedule('${schedule.id}', this.checked)"
                               class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-2 border-gray-600 appearance-none cursor-pointer transition-all"/>
                        <label class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-600 cursor-pointer"></label>
                    </label>
                    <button onclick="deleteSchedule('${schedule.id}')" 
                            class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors">
                        Удалить
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

export function renderAutomations(automationsData) {
    const automationsList = document.getElementById('automationsList');
    if (!automationsList) return;
    
    if (automationsData.length === 0) {
        automationsList.innerHTML = '<p class="text-gray-400">Нет автоматизаций</p>';
        return;
    }
    
    automationsList.innerHTML = automationsData.map(automation => {
        let conditionText = '';
        if (automation.condition.type === 'time') {
            conditionText = `Время: ${automation.condition.value}`;
        } else if (automation.condition.type === 'device') {
            const device = currentDevices.find(d => d.deviceId === automation.condition.deviceId);
            conditionText = `Устройство "${device ? device.label : automation.condition.deviceId}" = ${automation.condition.state}`;
        } else if (automation.condition.type === 'sensor') {
            const sensor = currentDevices.find(d => d.deviceId === automation.condition.deviceId);
            if (automation.condition.sensorType === 'contact') {
                conditionText = `Датчик "${sensor ? sensor.label : automation.condition.deviceId}" = ${automation.condition.state}`;
            } else if (automation.condition.sensorType === 'temperature') {
                conditionText = `Температура ${automation.condition.comparison === 'above' ? '>' : '<'} ${automation.condition.value}°C`;
            }
        }
        
        const actionDevice = currentDevices.find(d => d.deviceId === automation.action.deviceId);
        const actionText = `${actionDevice ? actionDevice.label : automation.action.deviceId} → ${automation.action.command === 'on' ? 'Включить' : 'Выключить'}`;
        
        return `
            <div class="bg-gray-700 rounded-lg p-4">
                <div class="font-semibold mb-2">${automation.name}</div>
                <div class="text-sm text-gray-400 mb-2">Если: ${conditionText}</div>
                <div class="text-sm text-gray-400 mb-3">То: ${actionText}</div>
                <div class="flex gap-2">
                    <label class="relative inline-block w-12 align-middle select-none transition duration-200 ease-in">
                        <input type="checkbox" ${automation.enabled ? 'checked' : ''} 
                               onchange="toggleAutomation('${automation.id}', this.checked)"
                               class="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-2 border-gray-600 appearance-none cursor-pointer transition-all"/>
                        <label class="toggle-label block overflow-hidden h-6 rounded-full bg-gray-600 cursor-pointer"></label>
                    </label>
                    <button onclick="deleteAutomation('${automation.id}')" 
                            class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors">
                        Удалить
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

export async function toggleSchedule(scheduleId, enabled) {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (schedule) {
        schedule.enabled = enabled;
        try {
            await fetch('/api/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(schedule)
            });
            await loadScenes();
        } catch (error) {
            console.error('Ошибка обновления расписания:', error);
        }
    }
}

export async function deleteSchedule(scheduleId) {
    try {
        await fetch(`/api/schedule/${scheduleId}`, {
            method: 'DELETE'
        });
        await loadScenes();
    } catch (error) {
        console.error('Ошибка удаления расписания:', error);
    }
}

export async function toggleAutomation(automationId, enabled) {
    const automation = automations.find(a => a.id === automationId);
    if (automation) {
        automation.enabled = enabled;
        try {
            await fetch('/api/automation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(automation)
            });
            await loadScenes();
        } catch (error) {
            console.error('Ошибка обновления автоматизации:', error);
        }
    }
}

export async function deleteAutomation(automationId) {
    try {
        await fetch(`/api/automation/${automationId}`, {
            method: 'DELETE'
        });
        await loadScenes();
    } catch (error) {
        console.error('Ошибка удаления автоматизации:', error);
    }
}

export async function showCreateSceneModal() {
    const nameInput = document.getElementById('sceneNameInput');
    if (nameInput) nameInput.value = '';
    
    const devices = currentDevices.filter(device => {
        const status = deviceStates[device.deviceId];
        const settings = deviceSettings[device.deviceId] || {};
        if (settings.hidden) return false;
        return status && status.main && status.main.switch;
    });
    
    if (devices.length === 0) {
        showNotification('Ошибка', 'Нет устройств для добавления в сцену', 'error');
        return;
    }
    
    const devicesList = document.getElementById('sceneDevicesList');
    if (!devicesList) return;
    
    devicesList.innerHTML = devices.map(device => {
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || device.label;
        return `
            <label class="flex items-center bg-gray-700 rounded-lg p-3 cursor-pointer hover:bg-gray-600 transition-colors">
                <input type="checkbox" class="mr-3 scene-device-checkbox" 
                       data-device-id="${device.deviceId}"
                       data-device-name="${customName}">
                <div class="flex-1">
                    <div class="font-semibold">${customName}</div>
                    <div class="text-xs text-gray-400">${device.label}</div>
                </div>
                <select class="ml-2 px-2 py-1 bg-gray-600 rounded text-sm scene-device-action" 
                        data-device-id="${device.deviceId}">
                    <option value="on">Включить</option>
                    <option value="off">Выключить</option>
                </select>
            </label>
        `;
    }).join('');
    
    const modal = document.getElementById('createSceneModal');
    if (modal) modal.classList.remove('hidden');
}

export async function saveScene() {
    const nameInput = document.getElementById('sceneNameInput');
    const name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
        showNotification('Ошибка', 'Введите название сцены', 'error');
        return;
    }
    
    const checkboxes = document.querySelectorAll('.scene-device-checkbox:checked');
    if (checkboxes.length === 0) {
        showNotification('Ошибка', 'Выберите хотя бы одно устройство', 'error');
        return;
    }
    
    const actions = [];
    checkboxes.forEach(checkbox => {
        const deviceId = checkbox.dataset.deviceId;
        const actionSelect = document.querySelector(`.scene-device-action[data-device-id="${deviceId}"]`);
        const action = actionSelect ? actionSelect.value : 'on';
        actions.push({
            deviceId: deviceId,
            command: action,
            capability: 'switch'
        });
    });
    
    const newScene = {
        id: Date.now().toString(),
        name: name,
        actions: actions
    };
    
    try {
        await fetch('/api/scenes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newScene)
        });
        
        closeModal('createSceneModal');
        await loadScenes();
    } catch (error) {
        console.error('Ошибка сохранения сцены:', error);
        showNotification('Ошибка', 'Не удалось сохранить сцену', 'error');
    }
}

export async function showCreateScheduleModal() {
    const nameInput = document.getElementById('scheduleNameInput');
    const timeInput = document.getElementById('scheduleTimeInput');
    if (nameInput) nameInput.value = '';
    if (timeInput) timeInput.value = '23:00';
    
    const daysList = document.getElementById('scheduleDaysList');
    if (!daysList) return;
    
    const daysNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    daysList.innerHTML = daysNames.map((day, index) => `
        <label class="flex items-center justify-center bg-gray-700 rounded-lg p-2 cursor-pointer hover:bg-gray-600 transition-colors">
            <input type="checkbox" class="mr-1 schedule-day-checkbox" value="${index + 1}">
            <span class="text-sm">${day}</span>
        </label>
    `).join('');
    
    const devices = currentDevices.filter(device => {
        const status = deviceStates[device.deviceId];
        const settings = deviceSettings[device.deviceId] || {};
        if (settings.hidden) return false;
        return status && status.main && status.main.switch;
    });
    
    const deviceSelect = document.getElementById('scheduleDeviceSelect');
    if (!deviceSelect) return;
    
    deviceSelect.innerHTML = devices.map(device => {
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || device.label;
        return `<option value="${device.deviceId}">${customName}</option>`;
    }).join('');
    
    const modal = document.getElementById('createScheduleModal');
    if (modal) modal.classList.remove('hidden');
}

export async function saveSchedule() {
    const nameInput = document.getElementById('scheduleNameInput');
    const timeInput = document.getElementById('scheduleTimeInput');
    const name = nameInput ? nameInput.value.trim() : '';
    const time = timeInput ? timeInput.value : '';
    
    if (!name) {
        showNotification('Ошибка', 'Введите название расписания', 'error');
        return;
    }
    
    if (!time) {
        showNotification('Ошибка', 'Выберите время', 'error');
        return;
    }
    
    const selectedDays = Array.from(document.querySelectorAll('.schedule-day-checkbox:checked'))
        .map(cb => parseInt(cb.value));
    
    if (selectedDays.length === 0) {
        showNotification('Ошибка', 'Выберите хотя бы один день', 'error');
        return;
    }
    
    const deviceSelect = document.getElementById('scheduleDeviceSelect');
    const actionSelect = document.getElementById('scheduleActionSelect');
    if (!deviceSelect || !actionSelect) return;
    
    const deviceId = deviceSelect.value;
    const action = actionSelect.value;
    
    const newSchedule = {
        id: Date.now().toString(),
        name: name,
        time: time,
        days: selectedDays,
        deviceId: deviceId,
        command: action,
        capability: 'switch',
        enabled: true
    };
    
    try {
        await fetch('/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newSchedule)
        });
        
        closeModal('createScheduleModal');
        await loadScenes();
    } catch (error) {
        console.error('Ошибка сохранения расписания:', error);
        showNotification('Ошибка', 'Не удалось сохранить расписание', 'error');
    }
}

export async function showCreateAutomationModal() {
    const nameInput = document.getElementById('automationNameInput');
    const conditionTypeSelect = document.getElementById('automationConditionType');
    if (nameInput) nameInput.value = '';
    if (conditionTypeSelect) conditionTypeSelect.value = 'time';
    
    const actionDevices = currentDevices.filter(device => {
        const status = deviceStates[device.deviceId];
        const settings = deviceSettings[device.deviceId] || {};
        if (settings.hidden) return false;
        return status && status.main && status.main.switch;
    });
    
    const actionDeviceSelect = document.getElementById('automationActionDeviceSelect');
    if (!actionDeviceSelect) return;
    
    actionDeviceSelect.innerHTML = actionDevices.map(device => {
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || device.label;
        return `<option value="${device.deviceId}">${customName}</option>`;
    }).join('');
    
    updateAutomationConditionUI();
    const modal = document.getElementById('createAutomationModal');
    if (modal) modal.classList.remove('hidden');
}

export function updateAutomationConditionUI() {
    const conditionTypeSelect = document.getElementById('automationConditionType');
    const conditionContent = document.getElementById('automationConditionContent');
    if (!conditionTypeSelect || !conditionContent) return;
    
    const conditionType = conditionTypeSelect.value;
    
    if (conditionType === 'time') {
        conditionContent.innerHTML = `
            <input type="time" id="automationTimeInput" 
                   class="w-full px-4 py-2 bg-gray-700 rounded-lg">
        `;
    } else if (conditionType === 'device') {
        const devices = currentDevices.filter(device => {
            const status = deviceStates[device.deviceId];
            const settings = deviceSettings[device.deviceId] || {};
            if (settings.hidden) return false;
            return status && status.main && status.main.switch;
        });
        
        conditionContent.innerHTML = `
            <select id="automationConditionDeviceSelect" class="w-full px-4 py-2 bg-gray-700 rounded-lg mb-2">
                ${devices.map(device => {
                    const settings = deviceSettings[device.deviceId] || {};
                    const customName = settings.customName || device.label;
                    return `<option value="${device.deviceId}">${customName}</option>`;
                }).join('')}
            </select>
            <select id="automationConditionDeviceState" class="w-full px-4 py-2 bg-gray-700 rounded-lg">
                <option value="on">Включено</option>
                <option value="off">Выключено</option>
            </select>
        `;
    } else if (conditionType === 'sensor') {
        const sensors = currentDevices.filter(device => {
            const status = deviceStates[device.deviceId];
            const settings = deviceSettings[device.deviceId] || {};
            if (settings.hidden) return false;
            return status && status.main && 
                   (status.main.contactSensor || status.main.temperatureMeasurement);
        });
        
        conditionContent.innerHTML = `
            <select id="automationConditionSensorSelect" onchange="updateAutomationSensorUI()" 
                    class="w-full px-4 py-2 bg-gray-700 rounded-lg mb-2">
                ${sensors.map(device => {
                    const settings = deviceSettings[device.deviceId] || {};
                    const customName = settings.customName || device.label;
                    return `<option value="${device.deviceId}">${customName}</option>`;
                }).join('')}
            </select>
            <div id="automationSensorConditionContent">
                <!-- Будет добавлено динамически -->
            </div>
        `;
        updateAutomationSensorUI();
    }
}

export function updateAutomationSensorUI() {
    const sensorSelect = document.getElementById('automationConditionSensorSelect');
    if (!sensorSelect) return;
    
    const sensorId = sensorSelect.value;
    const sensor = currentDevices.find(d => d.deviceId === sensorId);
    if (!sensor) return;
    
    const status = deviceStates[sensorId];
    const sensorContent = document.getElementById('automationSensorConditionContent');
    if (!sensorContent) return;
    
    if (status.main.contactSensor) {
        sensorContent.innerHTML = `
            <select id="automationConditionSensorState" class="w-full px-4 py-2 bg-gray-700 rounded-lg">
                <option value="open">Открыто</option>
                <option value="closed">Закрыто</option>
            </select>
        `;
    } else if (status.main.temperatureMeasurement) {
        sensorContent.innerHTML = `
            <div class="flex gap-2">
                <select id="automationConditionTempComparison" class="px-4 py-2 bg-gray-700 rounded-lg">
                    <option value="above">Выше</option>
                    <option value="below">Ниже</option>
                </select>
                <input type="number" id="automationConditionTempValue" step="0.1" 
                       placeholder="Температура" class="flex-1 px-4 py-2 bg-gray-700 rounded-lg">
                <span class="self-center">°C</span>
            </div>
        `;
    }
}

export async function saveAutomation() {
    const nameInput = document.getElementById('automationNameInput');
    const conditionTypeSelect = document.getElementById('automationConditionType');
    const name = nameInput ? nameInput.value.trim() : '';
    const conditionType = conditionTypeSelect ? conditionTypeSelect.value : 'time';
    
    if (!name) {
        showNotification('Ошибка', 'Введите название автоматизации', 'error');
        return;
    }
    
    let condition = {};
    
    if (conditionType === 'time') {
        const timeInput = document.getElementById('automationTimeInput');
        const time = timeInput ? timeInput.value : '';
        if (!time) {
            showNotification('Ошибка', 'Выберите время', 'error');
            return;
        }
        condition = { type: 'time', value: time };
    } else if (conditionType === 'device') {
        const deviceSelect = document.getElementById('automationConditionDeviceSelect');
        const stateSelect = document.getElementById('automationConditionDeviceState');
        if (!deviceSelect || !stateSelect) return;
        const deviceId = deviceSelect.value;
        const state = stateSelect.value;
        condition = { type: 'device', deviceId: deviceId, state: state };
    } else if (conditionType === 'sensor') {
        const sensorSelect = document.getElementById('automationConditionSensorSelect');
        if (!sensorSelect) return;
        const sensorId = sensorSelect.value;
        const sensor = currentDevices.find(d => d.deviceId === sensorId);
        const status = deviceStates[sensorId];
        
        if (status.main.contactSensor) {
            const stateSelect = document.getElementById('automationConditionSensorState');
            if (!stateSelect) return;
            const state = stateSelect.value;
            condition = { type: 'sensor', deviceId: sensorId, sensorType: 'contact', state: state };
        } else if (status.main.temperatureMeasurement) {
            const comparisonSelect = document.getElementById('automationConditionTempComparison');
            const valueInput = document.getElementById('automationConditionTempValue');
            if (!comparisonSelect || !valueInput) return;
            const comparison = comparisonSelect.value;
            const value = parseFloat(valueInput.value);
            if (isNaN(value)) {
                showNotification('Ошибка', 'Введите корректную температуру', 'error');
                return;
            }
            condition = { type: 'sensor', deviceId: sensorId, sensorType: 'temperature', value: value, comparison: comparison };
        }
    }
    
    const actionDeviceSelect = document.getElementById('automationActionDeviceSelect');
    const actionSelect = document.getElementById('automationActionSelect');
    if (!actionDeviceSelect || !actionSelect) return;
    
    const actionDeviceId = actionDeviceSelect.value;
    const action = actionSelect.value;
    
    const newAutomation = {
        id: Date.now().toString(),
        name: name,
        condition: condition,
        action: {
            deviceId: actionDeviceId,
            command: action,
            capability: 'switch'
        },
        enabled: true
    };
    
    try {
        await fetch('/api/automation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newAutomation)
        });
        
        closeModal('createAutomationModal');
        await loadScenes();
    } catch (error) {
        console.error('Ошибка сохранения автоматизации:', error);
        showNotification('Ошибка', 'Не удалось сохранить автоматизацию', 'error');
    }
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.executeScene = executeScene;
    window.toggleSchedule = toggleSchedule;
    window.deleteSchedule = deleteSchedule;
    window.toggleAutomation = toggleAutomation;
    window.deleteAutomation = deleteAutomation;
    window.showCreateSceneModal = showCreateSceneModal;
    window.saveScene = saveScene;
    window.showCreateScheduleModal = showCreateScheduleModal;
    window.saveSchedule = saveSchedule;
    window.showCreateAutomationModal = showCreateAutomationModal;
    window.updateAutomationConditionUI = updateAutomationConditionUI;
    window.updateAutomationSensorUI = updateAutomationSensorUI;
    window.saveAutomation = saveAutomation;
}

