// ==========================================
// ПОГОДА И АНИМАЦИИ
// ==========================================

import { outsideTemp, outsideHumidity, outsideWeatherIcon, hourlyForecast, weatherAnimation } from './dom.js';
import { 
    currentAnimation, currentLevel, lastAnimationType, lastAnimationLevel,
    setCurrentAnimation, setCurrentLevel, setLastAnimationType, setLastAnimationLevel
} from './config.js';

const WEATHER_PAUSED_CLASS = 'weather-paused';
const pauseReasons = new Set();

function isWeatherAnimationPaused() {
    return pauseReasons.size > 0;
}

function applyPauseState() {
    if (!weatherAnimation) return;
    if (isWeatherAnimationPaused()) {
        weatherAnimation.classList.add(WEATHER_PAUSED_CLASS);
        weatherAnimation.dataset.animationPaused = 'true';
    } else {
        weatherAnimation.classList.remove(WEATHER_PAUSED_CLASS);
        delete weatherAnimation.dataset.animationPaused;
    }
}

export function pauseWeatherAnimation(reason = 'manual') {
    pauseReasons.add(reason);
    applyPauseState();
}

export function resumeWeatherAnimation(reason = 'manual') {
    if (reason === undefined || reason === null) {
        pauseReasons.clear();
    } else {
        pauseReasons.delete(reason);
    }
    applyPauseState();
}

export function updateWeather(weather) {
    if (!weather) return;
    
    if (outsideTemp) outsideTemp.textContent = `${weather.temp}°C`;
    if (outsideHumidity) outsideHumidity.textContent = `${weather.humidity}%`;
    if (outsideWeatherIcon) outsideWeatherIcon.src = `https://openweathermap.org/img/wn/${weather.icon}@4x.png`;
    
    autoSetWeatherAnimation(weather.icon, weather.main, weather.description);
}

// Автоматическая установка анимации по типу погоды
function autoSetWeatherAnimation(iconCode, weatherMain, description) {
    let animationType = 'none';
    let level = 2;
    
    if (weatherMain) {
        if (weatherMain.includes('snow')) {
            animationType = 'snow';
            level = 2;
        } else if (weatherMain.includes('rain') || weatherMain.includes('drizzle') || weatherMain.includes('shower') || weatherMain.includes('thunderstorm')) {
            animationType = 'rain';
            const desc = (description || '').toLowerCase();
            if (iconCode && (iconCode === '09d' || iconCode === '09n' || iconCode === '11d' || iconCode === '11n')) {
                level = 3;
            } else if (desc.includes('heavy') || desc.includes('shower') || desc.includes('thunderstorm')) {
                level = 3;
            } else if (desc.includes('light') || desc.includes('drizzle')) {
                level = 1;
            } else {
                level = 2;
            }
        } else if (weatherMain.includes('clear') || weatherMain.includes('sun')) {
            const hour = new Date().getHours();
            if ((iconCode === '01d' || iconCode === '02d') && hour >= 6 && hour <= 11) {
                animationType = 'sunlight';
                level = 2;
            }
        }
    } else {
        if (iconCode && (iconCode.includes('snow') || iconCode === '13d' || iconCode === '13n')) {
            animationType = 'snow';
            level = 2;
        } else if (iconCode && (iconCode === '09d' || iconCode === '09n' || iconCode === '11d' || iconCode === '11n')) {
            animationType = 'rain';
            level = 3;
        } else if (iconCode && (iconCode === '10d' || iconCode === '10n')) {
            animationType = 'rain';
            level = 2;
        } else if (iconCode && (iconCode === '01d' || iconCode === '02d')) {
            const hour = new Date().getHours();
            if (hour >= 6 && hour <= 11) {
                animationType = 'sunlight';
                level = 2;
            }
        }
    }
    
    if (lastAnimationType !== animationType || lastAnimationLevel !== level) {
        setCurrentLevel(level);
        setAnimation(animationType);
        setLastAnimationType(animationType);
        setLastAnimationLevel(level);
    }
}

// Управление анимациями
function setAnimation(type) {
    setCurrentAnimation(type);
    if (!weatherAnimation) return;
    
    weatherAnimation.innerHTML = '';
    weatherAnimation.className = 'weather-animation';
    
    if (type === 'none') {
        // Ничего не делаем
    } else if (type === 'snow') {
        weatherAnimation.classList.add(`snow-${getLevelName()}`);
        createSnowAnimation();
    } else if (type === 'rain') {
        weatherAnimation.classList.add(`rain-${getLevelName()}`);
        createRainAnimation();
    } else if (type === 'sunlight') {
        weatherAnimation.classList.add(`sunlight-${getLevelName()}`);
        createSunlightAnimation();
    }

    applyPauseState();
}

function getLevelName() {
    const levels = ['', 'light', 'medium', 'heavy'];
    return levels[currentLevel];
}

function createSnowAnimation() {
    if (!weatherAnimation) return;
    
    const count = currentLevel === 1 ? 40 : currentLevel === 2 ? 70 : 100;
    const snowflakes = ['❄', '❅', '❆'];
    
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < count; i++) {
        const snowflake = document.createElement('div');
        snowflake.className = 'snowflake';
        snowflake.textContent = snowflakes[Math.floor(Math.random() * snowflakes.length)];
        snowflake.style.left = Math.random() * 100 + '%';
        snowflake.style.top = -(Math.random() * 100) + 'px';
        snowflake.style.animationDelay = Math.random() * 12 + 's';
        snowflake.style.fontSize = (Math.random() * 8 + 12) + 'px';
        snowflake.style.opacity = Math.random() * 0.4 + 0.4;
        fragment.appendChild(snowflake);
    }
    
    weatherAnimation.appendChild(fragment);
}

function createRainAnimation() {
    if (!weatherAnimation) return;
    
    const count = currentLevel === 1 ? 25 : currentLevel === 2 ? 50 : 80;
    
    const fragment = document.createDocumentFragment();
    
    for (let i = 0; i < count; i++) {
        const raindrop = document.createElement('div');
        raindrop.className = 'raindrop';
        raindrop.style.left = Math.random() * 100 + '%';
        raindrop.style.top = -(Math.random() * 200) + 'px';
        raindrop.style.animationDelay = Math.random() * 2 + 's';
        fragment.appendChild(raindrop);
    }
    
    weatherAnimation.appendChild(fragment);
}

function createSunlightAnimation() {
    if (!weatherAnimation) return;
    
    const sunrays = document.createElement('div');
    sunrays.className = 'sunrays';
    weatherAnimation.appendChild(sunrays);
}

export function updateForecast(forecast) {
    if (!hourlyForecast) return;
    
    if (!forecast || forecast.length === 0) {
        const scrollContainer = hourlyForecast.querySelector('.hourly-forecast-scroll');
        if (scrollContainer) {
            scrollContainer.innerHTML = `
                <div class="hourly-forecast-item">
                    <span class="hourly-forecast-time">Загрузка...</span>
                </div>
            `;
        }
        return;
    }
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    let lastDayShown = null;
    
    let forecastHTML = '';
    forecast.forEach((item, index) => {
        const itemDate = new Date(item.timestamp);
        const itemDay = item.dayTimestamp || new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate()).getTime();
        const isToday = item.isToday !== undefined ? item.isToday : (itemDay === today.getTime());
        const isTomorrow = itemDay === tomorrow.getTime();
        const isNewDay = !isToday && itemDay !== lastDayShown;
        
        const timeStr = item.time || itemDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        let dayLabel = '';
        
        if (isNewDay) {
            if (isTomorrow) {
                dayLabel = 'Завтра';
            } else {
                dayLabel = item.date || itemDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
            }
            lastDayShown = itemDay;
        }
        
        forecastHTML += `
            <div class="hourly-forecast-item">
                ${dayLabel ? `<span class="hourly-forecast-day">${dayLabel}</span>` : ''}
                <span class="hourly-forecast-time">${timeStr}</span>
                <img src="https://openweathermap.org/img/wn/${item.icon}@2x.png" alt="${item.description || ''}" class="hourly-forecast-icon">
                <span class="hourly-forecast-temp">${item.temp}°</span>
            </div>
        `;
    });
    
    const scrollContainer = hourlyForecast.querySelector('.hourly-forecast-scroll');
    if (scrollContainer) {
        scrollContainer.innerHTML = forecastHTML;
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            pauseWeatherAnimation('document-hidden');
        } else {
            resumeWeatherAnimation('document-hidden');
        }
    });
}

