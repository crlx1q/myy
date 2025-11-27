// ==========================================
// СИСТЕМА УВЕДОМЛЕНИЙ
// ==========================================

import { closeModal } from './utils.js';
import { eventHistory, setEventHistory } from './config.js';

// Показать уведомление
export function showNotification(title, message, type = 'info') {
    const notification = document.getElementById('screensaverNotification');
    const notificationTitle = document.getElementById('notificationTitle');
    const notificationMessage = document.getElementById('notificationMessage');
    
    if (!notification || !notificationTitle || !notificationMessage) return;
    
    notificationTitle.textContent = title;
    notificationMessage.textContent = message;
    
    notification.classList.remove('hidden');
    
    const soundEnabled = localStorage.getItem('soundNotifications') !== 'false';
    if (soundEnabled) {
        playNotificationSound();
    }
    
    setTimeout(() => {
        closeNotification();
    }, 5000);
}

// Закрыть уведомление
export function closeNotification() {
    const notification = document.getElementById('screensaverNotification');
    if (notification) {
        notification.classList.add('hidden');
    }
}

// Воспроизведение звука уведомления
export function playNotificationSound() {
    try {
        const audio = new Audio('public/sounds/notif.mp3');
        audio.play().catch(err => {
            console.error('Ошибка воспроизведения звука:', err);
        });
    } catch (error) {
        console.error('Ошибка создания аудио:', error);
    }
}

// Проверка умных уведомлений
export function checkSmartNotifications() {
    const tempHistory = eventHistory?.temperature || [];
    if (tempHistory.length >= 3) {
        const recent = tempHistory.slice(-3);
        const isDecreasing = recent.every((item, index) => {
            if (index === 0) return true;
            return item.value < recent[index - 1].value;
        });
        
        if (isDecreasing) {
            showNotification('Температура', 'Температура падает уже 3 часа подряд', 'warning');
        }
    }
    
    const humidityHistory = eventHistory?.humidity || [];
    if (humidityHistory.length > 0) {
        const lastHumidity = humidityHistory[humidityHistory.length - 1].value;
        if (lastHumidity < 35) {
            showNotification('Влажность', 'Влажность ниже 35% — возможно, воздух сухой', 'warning');
        }
    }
}

// Загружаем историю событий для проверки уведомлений
export async function loadEventHistory() {
    try {
        const response = await fetch('/api/statistics');
        const data = await response.json();
        setEventHistory(data);
        checkSmartNotifications();
    } catch (error) {
        console.error('Ошибка загрузки истории событий:', error);
    }
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.showNotification = showNotification;
    window.closeNotification = closeNotification;
}

