// ==========================================
// ГОЛОСОВОЕ УПРАВЛЕНИЕ
// ==========================================

import { 
    recognition, setRecognition, voiceControlEnabled, setVoiceControlEnabled, 
    isManualRestart, setIsManualRestart, lastVoiceCommandDeviceId, setLastVoiceCommandDeviceId,
    voiceCommands, setVoiceCommands, voiceCommandAudioContext, setVoiceCommandAudioContext,
    currentDevices, deviceSettings
} from './config.js';
import { controlDevice } from './devices.js';
import { updateMicrophoneIndicatorVisibility } from './indicators.js';
import { showNotification } from './notifications.js';
import { closeModal } from './utils.js';

export function initVoiceControl() {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const rec = new SpeechRecognition();
        rec.lang = 'ru-RU';
        rec.continuous = true;
        rec.interimResults = false;
        
        rec.onstart = () => {
            setTimeout(() => {
                updateMicrophoneIndicatorVisibility();
            }, 100);
        };
        
        rec.onresult = (event) => {
            const last = event.results.length - 1;
            const command = event.results[last][0].transcript.toLowerCase();
            processVoiceCommand(command);
            updateMicrophoneIndicatorVisibility();
        };
        
        rec.onerror = (event) => {
            setTimeout(() => {
                updateMicrophoneIndicatorVisibility();
            }, 100);
            
            if (event.error !== 'no-speech' && event.error !== 'aborted' && event.error !== 'not-allowed' && voiceControlEnabled && !isManualRestart) {
                setTimeout(() => {
                    if (voiceControlEnabled && !isManualRestart) {
                        startVoiceControl();
                    }
                }, 1000);
            }
        };
        
        rec.onend = () => {
            setTimeout(() => {
                updateMicrophoneIndicatorVisibility();
            }, 100);
            
            if (isManualRestart) {
                setIsManualRestart(false);
                return;
            }
            
            if (voiceControlEnabled) {
                const startTimeInput = document.getElementById('voiceControlStart');
                const endTimeInput = document.getElementById('voiceControlEnd');
                if (!startTimeInput || !endTimeInput) {
                    return;
                }
                
                const now = new Date();
                const currentTime = now.getHours() * 60 + now.getMinutes();
                const startTime = startTimeInput.value.split(':');
                const endTime = endTimeInput.value.split(':');
                
                if (startTime && endTime && startTime.length === 2 && endTime.length === 2) {
                    const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
                    const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);
                    
                    if (currentTime >= startMinutes && currentTime <= endMinutes) {
                        setTimeout(() => {
                            if (voiceControlEnabled && !isManualRestart) {
                                startVoiceControl();
                            }
                        }, 500);
                    }
                }
            }
        };
        
        setRecognition(rec);
    } else {
        console.error('Голосовое управление не поддерживается в этом браузере');
    }
}

export function setupVoiceControlTimeHandlers() {
    const voiceStartInput = document.getElementById('voiceControlStart');
    const voiceEndInput = document.getElementById('voiceControlEnd');
    
    if (voiceStartInput) {
        const currentValue = voiceStartInput.value;
        const newStartInput = voiceStartInput.cloneNode(true);
        newStartInput.value = currentValue;
        voiceStartInput.parentNode.replaceChild(newStartInput, voiceStartInput);
        newStartInput.addEventListener('change', async () => {
            await saveVoiceControlSettings(true);
        });
    }
    
    if (voiceEndInput) {
        const currentValue = voiceEndInput.value;
        const newEndInput = voiceEndInput.cloneNode(true);
        newEndInput.value = currentValue;
        voiceEndInput.parentNode.replaceChild(newEndInput, voiceEndInput);
        newEndInput.addEventListener('change', async () => {
            await saveVoiceControlSettings(true);
        });
    }
}

export async function saveVoiceControlSettings(restartAfterSave = false) {
    const startTimeInput = document.getElementById('voiceControlStart');
    const endTimeInput = document.getElementById('voiceControlEnd');
    const startTime = startTimeInput?.value || '07:00';
    const endTime = endTimeInput?.value || '23:00';
    const enabled = voiceControlEnabled;
    
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                voiceControlEnabled: enabled,
                voiceControlStart: startTime,
                voiceControlEnd: endTime
            })
        });
        
        if (response.ok && restartAfterSave && enabled && recognition) {
            const currentStartTime = startTimeInput?.value || startTime;
            const currentEndTime = endTimeInput?.value || endTime;
            
            const now = new Date();
            const currentTime = now.getHours() * 60 + now.getMinutes();
            const startParts = currentStartTime.split(':');
            const endParts = currentEndTime.split(':');
            
            let shouldRestart = false;
            if (startParts.length === 2 && endParts.length === 2) {
                const startMinutes = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
                const endMinutes = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
                shouldRestart = (currentTime >= startMinutes && currentTime <= endMinutes);
            }
            
            setIsManualRestart(true);
            
            try {
                if (recognition.state === 'running' || recognition.state === 'starting') {
                    recognition.stop();
                }
            } catch (e) {
                // Игнорируем ошибки
            }
            
            if (shouldRestart) {
                setTimeout(() => {
                    if (voiceControlEnabled && recognition) {
                        startVoiceControl();
                        setTimeout(() => {
                            setIsManualRestart(false);
                        }, 200);
                    } else {
                        setIsManualRestart(false);
                    }
                }, 1000);
            } else {
                setTimeout(() => {
                    setIsManualRestart(false);
                }, 300);
            }
        }
    } catch (error) {
        console.error('Ошибка сохранения настроек голосового управления:', error);
        showNotification('Ошибка', 'Не удалось сохранить настройки голосового управления', 'error');
    }
}

export async function toggleVoiceControl(enabled) {
    setVoiceControlEnabled(enabled);
    updateMicrophoneIndicatorVisibility();
    await saveVoiceControlSettings(false);
    
    if (enabled) {
        if (!recognition) {
            initVoiceControl();
            setTimeout(() => {
                if (recognition && voiceControlEnabled) {
                    startVoiceControl();
                    updateMicrophoneIndicatorVisibility();
                }
            }, 300);
        } else {
            try {
                const state = recognition.state;
                if (state === 'running' || state === 'starting') {
                    setIsManualRestart(true);
                    recognition.stop();
                    setTimeout(() => {
                        setIsManualRestart(false);
                        if (voiceControlEnabled && recognition) {
                            startVoiceControl();
                            updateMicrophoneIndicatorVisibility();
                        }
                    }, 600);
                } else {
                    setIsManualRestart(false);
                    startVoiceControl();
                    updateMicrophoneIndicatorVisibility();
                }
            } catch (e) {
                setIsManualRestart(false);
                setTimeout(() => {
                    if (voiceControlEnabled && recognition) {
                        startVoiceControl();
                        updateMicrophoneIndicatorVisibility();
                    }
                }, 300);
            }
        }
    } else {
        stopVoiceControl();
        updateMicrophoneIndicatorVisibility();
    }
}

export function startVoiceControl() {
    if (!recognition || !voiceControlEnabled) {
        updateMicrophoneIndicatorVisibility();
        return;
    }
    
    const startTimeInput = document.getElementById('voiceControlStart');
    const endTimeInput = document.getElementById('voiceControlEnd');
    if (!startTimeInput || !endTimeInput) {
        updateMicrophoneIndicatorVisibility();
        return;
    }
    
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const startTime = startTimeInput.value.split(':');
    const endTime = endTimeInput.value.split(':');
    
    if (!startTime || !endTime || startTime.length !== 2 || endTime.length !== 2) {
        updateMicrophoneIndicatorVisibility();
        return;
    }
    
    const startMinutes = parseInt(startTime[0]) * 60 + parseInt(startTime[1]);
    const endMinutes = parseInt(endTime[0]) * 60 + parseInt(endTime[1]);
    
    if (currentTime >= startMinutes && currentTime <= endMinutes) {
        try {
            const state = recognition.state;
            if (state === 'idle' || state === 'stopped') {
                recognition.start();
            } else if (state !== 'running' && state !== 'starting') {
                recognition.start();
            } else {
                setTimeout(() => {
                    updateMicrophoneIndicatorVisibility();
                }, 100);
            }
        } catch (error) {
            setTimeout(() => {
                updateMicrophoneIndicatorVisibility();
            }, 100);
            
            if (error.name !== 'InvalidStateError' && error.name !== 'NotAllowedError') {
                setTimeout(() => {
                    if (voiceControlEnabled && recognition && !isManualRestart) {
                        try {
                            const state = recognition.state;
                            if (state === 'idle' || state === 'stopped') {
                                recognition.start();
                            }
                        } catch (e) {
                            setTimeout(() => {
                                updateMicrophoneIndicatorVisibility();
                            }, 100);
                        }
                    }
                }, 1000);
            }
        }
    } else {
        setTimeout(() => {
            updateMicrophoneIndicatorVisibility();
        }, 100);
    }
}

export function stopVoiceControl() {
    if (recognition) {
        try {
            recognition.stop();
        } catch (error) {
            // Игнорируем ошибки
        }
    }
    updateMicrophoneIndicatorVisibility();
}

export function playErrorSound() {
    const soundToggle = document.getElementById('soundNotificationsToggle');
    const soundEnabled = soundToggle ? soundToggle.checked : true;
    
    if (!soundEnabled) return;
    
    const playBeep = (delay) => {
        setTimeout(() => {
            try {
                const audio = new Audio('voice.mp3');
                audio.volume = 0.7;
                audio.play().catch(error => {
                    // Игнорируем ошибки
                });
            } catch (error) {
                // Игнорируем ошибки
            }
        }, delay);
    };
    
    playBeep(300);
    playBeep(600);
}

function initVoiceCommandAudioContext() {
    if (!voiceCommandAudioContext) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            setVoiceCommandAudioContext(ctx);
        } catch (error) {
            console.log('AudioContext not supported');
        }
    }
}

export function playVoiceCommandBeep() {
    const soundToggle = document.getElementById('soundNotificationsToggle');
    const soundEnabled = soundToggle ? soundToggle.checked : true;
    
    if (!soundEnabled) return;
    
    try {
        if (!voiceCommandAudioContext) {
            initVoiceCommandAudioContext();
        }
        
        if (voiceCommandAudioContext && voiceCommandAudioContext.state === 'suspended') {
            voiceCommandAudioContext.resume().then(() => {
                playBeepSound();
            }).catch(() => {
                playBeepSound();
            });
        } else {
            playBeepSound();
        }
    } catch (error) {
        console.log('Web Audio API error:', error);
    }
}

function playBeepSound() {
    if (!voiceCommandAudioContext) return;
    
    try {
        const oscillator = voiceCommandAudioContext.createOscillator();
        const gainNode = voiceCommandAudioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(voiceCommandAudioContext.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        
        const now = voiceCommandAudioContext.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.25, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.1);
        
        oscillator.start(now);
        oscillator.stop(now + 0.1);
    } catch (error) {
        console.log('Error playing beep:', error);
    }
}

export function triggerVoiceCommandAnimation() {
    const animationContainer = document.getElementById('voiceCommandAnimation');
    if (!animationContainer) return;
    
    const strips = animationContainer.querySelectorAll('.voice-strip');
    
    animationContainer.classList.remove('active');
    strips.forEach(strip => {
        strip.style.animation = 'none';
        strip.style.opacity = '0';
        strip.style.height = '0';
    });
    
    void animationContainer.offsetWidth;
    
    requestAnimationFrame(() => {
        animationContainer.classList.add('active');
        strips.forEach(strip => {
            strip.style.animation = '';
            strip.style.opacity = '';
            strip.style.height = '';
        });
    });
    
    setTimeout(() => {
        animationContainer.classList.remove('active');
        strips.forEach(strip => {
            strip.style.animation = 'none';
            strip.style.opacity = '0';
            strip.style.height = '0';
        });
    }, 1300);
}

export function processVoiceCommand(command) {
    for (const cmd of voiceCommands) {
        if (command.includes(cmd.text.toLowerCase())) {
            setLastVoiceCommandDeviceId(cmd.deviceId);
            playVoiceCommandBeep();
            triggerVoiceCommandAnimation();
            
            if (cmd.action === 'on') {
                controlDevice(cmd.deviceId, 'on');
            } else if (cmd.action === 'off') {
                controlDevice(cmd.deviceId, 'off');
            }
            break;
        }
    }
}

export async function loadVoiceCommands() {
    try {
        const response = await fetch('/api/voice-commands');
        const commands = await response.json();
        setVoiceCommands(commands);
        renderVoiceCommands();
    } catch (error) {
        console.error('Ошибка загрузки голосовых команд:', error);
        setVoiceCommands([]);
    }
}

export function renderVoiceCommands() {
    const commandsList = document.getElementById('voiceCommandsList');
    if (!commandsList) return;
    
    if (voiceCommands.length === 0) {
        commandsList.innerHTML = '<p class="text-gray-400 text-sm">Нет команд</p>';
        return;
    }
    
    commandsList.innerHTML = voiceCommands.map((cmd, index) => {
        const device = currentDevices.find(d => d.deviceId === cmd.deviceId);
        const deviceName = device ? device.label : cmd.deviceId;
        return `
            <div class="bg-gray-700 rounded-lg p-3 flex justify-between items-center">
                <div>
                    <span class="text-sm font-semibold">"${cmd.text}"</span>
                    <span class="text-xs text-gray-400 ml-2">→ ${deviceName} (${cmd.action})</span>
                </div>
                <button onclick="deleteVoiceCommand(${index})" 
                        class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors">
                    Удалить
                </button>
            </div>
        `;
    }).join('');
}

export async function showAddVoiceCommandModal() {
    const textInput = document.getElementById('voiceCommandTextInput');
    if (textInput) textInput.value = '';
    
    const devices = currentDevices.filter(device => {
        const status = deviceStates[device.deviceId];
        const settings = deviceSettings[device.deviceId] || {};
        if (settings.hidden) return false;
        return status && status.main && status.main.switch;
    });
    
    const deviceSelect = document.getElementById('voiceCommandDeviceSelect');
    if (!deviceSelect) return;
    
    deviceSelect.innerHTML = devices.map(device => {
        const settings = deviceSettings[device.deviceId] || {};
        const customName = settings.customName || device.label;
        return `<option value="${device.deviceId}">${customName}</option>`;
    }).join('');
    
    const modal = document.getElementById('addVoiceCommandModal');
    if (modal) modal.classList.remove('hidden');
}

export async function saveVoiceCommand() {
    const textInput = document.getElementById('voiceCommandTextInput');
    const deviceSelect = document.getElementById('voiceCommandDeviceSelect');
    const actionSelect = document.getElementById('voiceCommandActionSelect');
    
    const text = textInput ? textInput.value.trim() : '';
    if (!text) {
        showNotification('Ошибка', 'Введите текст команды', 'error');
        return;
    }
    
    if (!deviceSelect || !actionSelect) return;
    
    const deviceId = deviceSelect.value;
    const action = actionSelect.value;
    
    const newCommand = {
        text: text,
        deviceId: deviceId,
        action: action
    };
    
    const updatedCommands = [...voiceCommands, newCommand];
    setVoiceCommands(updatedCommands);
    
    try {
        await fetch('/api/voice-commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedCommands)
        });
        
        closeModal('addVoiceCommandModal');
        await loadVoiceCommands();
    } catch (error) {
        console.error('Ошибка сохранения команды:', error);
        showNotification('Ошибка', 'Не удалось сохранить команду', 'error');
    }
}

export async function deleteVoiceCommand(index) {
    const updatedCommands = voiceCommands.slice();
    updatedCommands.splice(index, 1);
    setVoiceCommands(updatedCommands);
    
    try {
        await fetch('/api/voice-commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedCommands)
        });
        
        await loadVoiceCommands();
    } catch (error) {
        console.error('Ошибка удаления команды:', error);
    }
}

export function initAudioContextOnInteraction() {
    if (!voiceCommandAudioContext) {
        const initAudio = () => {
            initVoiceCommandAudioContext();
            document.removeEventListener('click', initAudio);
            document.removeEventListener('touchstart', initAudio);
        };
        
        document.addEventListener('click', initAudio, { once: true });
        document.addEventListener('touchstart', initAudio, { once: true });
    }
}

// Делаем функции доступными глобально
if (typeof window !== 'undefined') {
    window.toggleVoiceControl = toggleVoiceControl;
    window.showAddVoiceCommandModal = showAddVoiceCommandModal;
    window.saveVoiceCommand = saveVoiceCommand;
    window.deleteVoiceCommand = deleteVoiceCommand;
}

