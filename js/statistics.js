// ==========================================
// СТАТИСТИКА И ГРАФИКИ
// ==========================================

import { 
    temperatureChartInstance, humidityChartInstance, powerChartInstance,
    setTemperatureChartInstance, setHumidityChartInstance, setPowerChartInstance,
    currentDevices, deviceSettings
} from './config.js';

export async function loadStatistics() {
    try {
        const response = await fetch('/api/statistics');
        const data = await response.json();
        
        renderTemperatureChart(data.temperature || []);
        renderHumidityChart(data.humidity || []);
        renderPowerChart(data.power || []);
        renderEventsList(data.events || []);
    } catch (error) {
        console.error('Ошибка загрузки статистики:', error);
    }
}

export function renderTemperatureChart(data) {
    const ctx = document.getElementById('temperatureChart');
    if (!ctx) return;
    
    if (temperatureChartInstance) {
        temperatureChartInstance.destroy();
    }
    
    const hourlyData = {};
    data.forEach(item => {
        const date = new Date(item.timestamp);
        const hour = date.getHours();
        const key = `${date.getDate()}.${date.getMonth() + 1} ${hour}:00`;
        if (!hourlyData[key]) {
            hourlyData[key] = { sum: 0, count: 0 };
        }
        hourlyData[key].sum += item.value;
        hourlyData[key].count++;
    });
    
    const labels = Object.keys(hourlyData).sort();
    const values = labels.map(key => Math.round(hourlyData[key].sum / hourlyData[key].count));
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Температура (°C)',
                data: values,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'white'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: 'white', maxRotation: 45, minRotation: 45 },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });
    
    setTemperatureChartInstance(chart);
}

export function renderHumidityChart(data) {
    const ctx = document.getElementById('humidityChart');
    if (!ctx) return;
    
    if (humidityChartInstance) {
        humidityChartInstance.destroy();
    }
    
    const hourlyData = {};
    data.forEach(item => {
        const date = new Date(item.timestamp);
        const hour = date.getHours();
        const key = `${date.getDate()}.${date.getMonth() + 1} ${hour}:00`;
        if (!hourlyData[key]) {
            hourlyData[key] = { sum: 0, count: 0 };
        }
        hourlyData[key].sum += item.value;
        hourlyData[key].count++;
    });
    
    const labels = Object.keys(hourlyData).sort();
    const values = labels.map(key => Math.round(hourlyData[key].sum / hourlyData[key].count));
    
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Влажность (%)',
                data: values,
                borderColor: 'rgb(34, 197, 94)',
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'white'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: 'white', maxRotation: 45, minRotation: 45 },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });
    
    setHumidityChartInstance(chart);
}

export function renderPowerChart(data) {
    const ctx = document.getElementById('powerChart');
    if (!ctx) return;
    
    if (powerChartInstance) {
        powerChartInstance.destroy();
    }
    
    if (data.length === 0) {
        if (ctx.parentElement) {
            ctx.parentElement.innerHTML = '<p class="text-gray-400">Нет данных об энергопотреблении</p>';
        }
        return;
    }
    
    const hourlyData = {};
    data.forEach(item => {
        const date = new Date(item.timestamp);
        const hour = date.getHours();
        const key = `${date.getDate()}.${date.getMonth() + 1} ${hour}:00`;
        if (!hourlyData[key]) {
            hourlyData[key] = { sum: 0, count: 0 };
        }
        hourlyData[key].sum += item.value;
        hourlyData[key].count++;
    });
    
    const labels = Object.keys(hourlyData).sort();
    const values = labels.map(key => Math.round(hourlyData[key].sum / hourlyData[key].count));
    
    const chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Энергопотребление (Вт)',
                data: values,
                backgroundColor: 'rgba(251, 191, 36, 0.5)',
                borderColor: 'rgb(251, 191, 36)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: 'white'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                },
                x: {
                    ticks: { color: 'white', maxRotation: 45, minRotation: 45 },
                    grid: { color: 'rgba(255, 255, 255, 0.1)' }
                }
            }
        }
    });
    
    setPowerChartInstance(chart);
}

export function renderEventsList(events) {
    const eventsList = document.getElementById('eventsList');
    if (!eventsList) return;
    
    if (events.length === 0) {
        eventsList.innerHTML = '<p class="text-gray-400">Нет событий</p>';
        return;
    }
    
    const sortedEvents = events.slice().sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    ).slice(0, 50);
    
    eventsList.innerHTML = sortedEvents.map(event => {
        const date = new Date(event.timestamp);
        const timeStr = date.toLocaleString('ru-RU');
        let eventText = '';
        
        if (event.type === 'device-control') {
            // Находим устройство по deviceId и используем его название
            const device = currentDevices.find(d => d.deviceId === event.deviceId);
            let deviceName = event.deviceId; // По умолчанию используем ID
            
            if (device) {
                // Проверяем, есть ли кастомное название в настройках
                const settings = deviceSettings[event.deviceId];
                deviceName = settings?.customName || device.label || event.deviceId;
            }
            
            // Преобразуем команду в читаемый формат
            const commandText = event.command === 'on' ? 'включено' : event.command === 'off' ? 'выключено' : event.command;
            eventText = `${deviceName}: ${commandText}`;
        } else if (event.type === 'temperature') {
            eventText = `Температура: ${event.value}°C`;
        } else if (event.type === 'humidity') {
            eventText = `Влажность: ${event.value}%`;
        } else if (event.type === 'power') {
            eventText = `Энергопотребление: ${event.value} Вт`;
        } else {
            eventText = JSON.stringify(event);
        }
        
        return `
            <div class="bg-gray-700 rounded-lg p-3 flex justify-between items-center">
                <span class="text-sm">${eventText}</span>
                <span class="text-xs text-gray-400">${timeStr}</span>
            </div>
        `;
    }).join('');
}

