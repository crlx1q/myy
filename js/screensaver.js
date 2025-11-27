// ==========================================
// SCREENSAVER (ЗАСТАВКА)
// ==========================================

import { screensaverView, dashboardView, clockTime, clockDate } from './dom.js';
import { setWakeLock, wakeLock, screenSleepTimer, setScreenSleepTimer, lastActivityTime, setLastActivityTime, screenSleepOverlay, setScreenSleepOverlay } from './config.js';
import { pauseWeatherAnimation, resumeWeatherAnimation } from './weather.js';

const SCREEN_SLEEP_PAUSE_REASON = 'screen-sleep';

// WAKE LOCK API (для Android)
export async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            const lock = await navigator.wakeLock.request('screen');
            setWakeLock(lock);
            console.error('Wake Lock активирован - экран не будет гаснуть');
            
            lock.addEventListener('release', () => {
                console.error('Wake Lock был освобожден');
            });
            
            document.addEventListener('visibilitychange', async () => {
                const currentLock = wakeLock;
                if (currentLock !== null && document.visibilityState === 'visible') {
                    try {
                        const newLock = await navigator.wakeLock.request('screen');
                        setWakeLock(newLock);
                    } catch (err) {
                        console.error('Ошибка восстановления Wake Lock:', err);
                    }
                }
            });
        } catch (err) {
            console.error('Ошибка активации Wake Lock:', err);
        }
    } else {
        console.error('Wake Lock API не поддерживается в этом браузере');
    }
}

// Обновление часов
export function updateClock() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const dateString = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
    
    if (clockTime) clockTime.textContent = timeString;
    if (clockDate) clockDate.textContent = dateString.charAt(0).toUpperCase() + dateString.slice(1);
}

// Полноэкранный режим
function getFullscreenElement() {
    return document.fullscreenElement || 
           document.webkitFullscreenElement || 
           document.mozFullScreenElement || 
           document.msFullscreenElement;
}

function isFullscreen() {
    return !!getFullscreenElement();
}

function isFullscreenSupported() {
    return !!(
        document.fullscreenEnabled ||
        document.webkitFullscreenEnabled ||
        document.mozFullScreenEnabled ||
        document.msFullscreenEnabled
    );
}

function enterFullscreen() {
    if (!isFullscreenSupported()) {
        console.log('Fullscreen API не поддерживается');
        return;
    }
    
    const element = document.documentElement;
    
    try {
        if (element.requestFullscreen) {
            element.requestFullscreen().catch(err => {
                console.log('Ошибка входа в полноэкранный режим:', err);
            });
        } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
        } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
        } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
        }
    } catch (error) {
        console.log('Ошибка входа в полноэкранный режим:', error);
    }
}

function exitFullscreen() {
    try {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => {
                console.log('Ошибка выхода из полноэкранного режима:', err);
            });
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    } catch (error) {
        console.log('Ошибка выхода из полноэкранного режима:', error);
    }
}

export function toggleFullscreen() {
    if (!isFullscreenSupported()) {
        console.log('Fullscreen API не поддерживается');
        return;
    }
    
    if (isFullscreen()) {
        exitFullscreen();
    } else {
        enterFullscreen();
    }
}

function updateFullscreenButton() {
    const fullscreenButton = document.getElementById('fullscreenButton');
    const fullscreenEnterIcon = document.getElementById('fullscreenEnterIcon');
    const fullscreenExitIcon = document.getElementById('fullscreenExitIcon');
    
    if (!fullscreenButton || !fullscreenEnterIcon || !fullscreenExitIcon) return;
    
    if (isFullscreen()) {
        fullscreenEnterIcon.style.display = 'none';
        fullscreenExitIcon.style.display = 'block';
        fullscreenButton.setAttribute('title', 'Выйти из полноэкранного режима');
    } else {
        fullscreenEnterIcon.style.display = 'block';
        fullscreenExitIcon.style.display = 'none';
        fullscreenButton.setAttribute('title', 'Полноэкранный режим');
    }
}

function handleFullscreenChange() {
    updateFullscreenButton();
}

function setupFullscreenHandlers() {
    if (!isFullscreenSupported()) {
        const fullscreenButton = document.getElementById('fullscreenButton');
        if (fullscreenButton) {
            fullscreenButton.style.display = 'none';
        }
        return;
    }
    
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    
    setTimeout(() => {
        updateFullscreenButton();
    }, 100);
}

export function initFullscreen() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setupFullscreenHandlers();
        });
    } else {
        setupFullscreenHandlers();
    }
}

export function lockScreen() {
    if (dashboardView) dashboardView.classList.add('hidden');
    if (screensaverView) {
        screensaverView.classList.remove('hidden');
        screensaverView.style.opacity = '1';
    }
    // Анимации должны продолжать работать на заставке
}

export async function unlockScreen() {
    if (screensaverView) {
        screensaverView.style.opacity = '0';
        setTimeout(() => {
            screensaverView.classList.add('hidden');
        }, 300);
    }
    if (dashboardView) dashboardView.classList.remove('hidden');
    // Анимации продолжают работать
}

// Настройка разблокировки (только вертикальный свайп вверх)
export function setupScreensaverUnlock() {
    if (!screensaverView) return;
    
    screensaverView.addEventListener('click', unlockScreen);
    
    let touchStartX = 0;
    let touchStartY = 0;
    let isScrollingForecast = false;
    
    screensaverView.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isScrollingForecast = false;
    }, { passive: true });
    
    screensaverView.addEventListener('touchmove', (e) => {
        if (!touchStartX || !touchStartY) return;
        
        const touchCurrentX = e.touches[0].clientX;
        const touchCurrentY = e.touches[0].clientY;
        
        const diffX = Math.abs(touchCurrentX - touchStartX);
        const diffY = Math.abs(touchCurrentY - touchStartY);
        
        if (diffX > diffY && diffX > 10) {
            isScrollingForecast = true;
        }
    }, { passive: true });
    
    screensaverView.addEventListener('touchend', (e) => {
        if (!touchStartX || !touchStartY) return;
        
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        
        const diffX = Math.abs(touchEndX - touchStartX);
        const diffY = touchStartY - touchEndY;
        
        if (!isScrollingForecast && diffY > 50 && diffY > diffX) {
            unlockScreen();
        }
        
        touchStartX = 0;
        touchStartY = 0;
        isScrollingForecast = false;
    }, { passive: true });
}

// Режим сна экрана
export function createScreenSleepOverlay() {
    if (screenSleepOverlay) return screenSleepOverlay;

    const overlay = document.createElement('div');
    overlay.id = 'screenSleepOverlay';
    overlay.className = 'fixed inset-0 bg-black z-[9999] hidden';
    document.body.appendChild(overlay);
    setScreenSleepOverlay(overlay);
    return overlay;
}

export function setupScreenSleep(minutes) {
    clearScreenSleep();
    createScreenSleepOverlay();

    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    const resetTimer = () => {
        setLastActivityTime(Date.now());
        if (screenSleepOverlay) {
            screenSleepOverlay.classList.add('hidden');
        }
        resumeWeatherAnimation(SCREEN_SLEEP_PAUSE_REASON);
    };

    activityEvents.forEach(event => {
        document.addEventListener(event, resetTimer, { passive: true });
    });

    setScreenSleepTimer(setInterval(() => {
        const inactiveTime = (Date.now() - lastActivityTime) / 1000 / 60;
        if (inactiveTime >= minutes) {
            // Экран заснул - показываем overlay и ставим анимации на паузу
            if (screenSleepOverlay && screenSleepOverlay.classList.contains('hidden')) {
                screenSleepOverlay.classList.remove('hidden');
                pauseWeatherAnimation(SCREEN_SLEEP_PAUSE_REASON);
            }
        } else {
            // Экран активен - скрываем overlay и возобновляем анимации
            if (screenSleepOverlay && !screenSleepOverlay.classList.contains('hidden')) {
                screenSleepOverlay.classList.add('hidden');
                resumeWeatherAnimation(SCREEN_SLEEP_PAUSE_REASON);
            }
        }
    }, 10000)); // Проверяем каждые 10 секунд для более быстрой реакции
}

export function clearScreenSleep() {
    if (screenSleepTimer) {
        clearInterval(screenSleepTimer);
        setScreenSleepTimer(null);
    }
    if (screenSleepOverlay) {
        screenSleepOverlay.classList.add('hidden');
    }
    setLastActivityTime(Date.now());
    resumeWeatherAnimation(SCREEN_SLEEP_PAUSE_REASON);
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.lockScreen = lockScreen;
    window.unlockScreen = unlockScreen;
    window.toggleFullscreen = toggleFullscreen;
}

