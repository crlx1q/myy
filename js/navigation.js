// ==========================================
// НАВИГАЦИЯ МЕЖДУ РАЗДЕЛАМИ
// ==========================================

import { loadStatistics } from './statistics.js';
import { loadSecurity } from './security.js';
import { loadScenes } from './scenes.js';
import { loadSettings } from './settings.js';

export function showSection(sectionName) {
    document.querySelectorAll('.section-content').forEach(section => {
        section.classList.add('hidden');
    });
    
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('bg-gray-800', 'text-gray-300');
    });
    
    const sectionElement = document.getElementById(`section-${sectionName}`);
    if (sectionElement) {
        sectionElement.classList.remove('hidden');
    }
    
    const navBtn = document.getElementById(`nav-${sectionName}`);
    if (navBtn) {
        navBtn.classList.remove('bg-gray-800', 'text-gray-300');
        navBtn.classList.add('bg-blue-600', 'text-white');
    }
    
    if (sectionName === 'statistics') {
        loadStatistics();
    } else if (sectionName === 'security') {
        loadSecurity();
    } else if (sectionName === 'scenes') {
        loadScenes();
    } else if (sectionName === 'settings') {
        loadSettings();
    }
}

// Делаем функцию доступной глобально
if (typeof window !== 'undefined') {
    window.showSection = showSection;
}

