// ==========================================
// js/bridge.js
// Клиентский модуль моста: живая температура, снимок звонка, переключатель LED.
// Подключение (обычный скрипт, без сборки):
//   <script src="/socket.io/socket.io.js"></script>
//   <script src="js/bridge.js"></script>
//
// Разметка:
//   <span data-bridge="temperature">--</span>
//   <span data-bridge="temperature-updated"></span>
//   <img  data-bridge="doorbell-image" />
//   <button data-bridge-doorbell>Камера</button>
//   <input type="checkbox" data-bridge-led="switch">
//   <input type="range" min="0" max="100" data-bridge-led="level">
// ==========================================

(function () {
    'use strict';

    var socket = null;
    var state = null;

    function $all(selector) {
        return Array.prototype.slice.call(document.querySelectorAll(selector));
    }

    function formatTime(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return iso;
        }
    }

    function renderTemperature(data) {
        if (!data) return;
        $all('[data-bridge="temperature"]').forEach(function (el) {
            el.textContent = (data.value === null || data.value === undefined) ? '--' : data.value + '°';
            el.classList.toggle('offline', data.online === false);
        });
        $all('[data-bridge="temperature-updated"]').forEach(function (el) {
            el.textContent = formatTime(data.updatedAt);
        });
        if (data.humidity !== null && data.humidity !== undefined) {
            $all('[data-bridge="humidity"]').forEach(function (el) {
                el.textContent = data.humidity + '%';
            });
        }
        document.dispatchEvent(new CustomEvent('bridge:temperature', { detail: data }));
    }

    function renderLed(led) {
        if (!led) return;
        $all('[data-bridge-led="switch"]').forEach(function (el) {
            if (el.type === 'checkbox') el.checked = !!led.on;
            else el.classList.toggle('active', !!led.on);
        });
        $all('[data-bridge-led="level"]').forEach(function (el) {
            if (document.activeElement !== el && led.level !== null && led.level !== undefined) {
                el.value = led.level;
            }
        });
        $all('[data-bridge="led-state"]').forEach(function (el) {
            el.textContent = led.on ? 'Вкл' : 'Выкл';
        });
        document.dispatchEvent(new CustomEvent('bridge:led', { detail: led }));
    }

    function renderDoorbell(doorbell) {
        if (!doorbell) return;
        var url = doorbell.snapshotUrl || (doorbell.hasSnapshot ? '/api/bridge/doorbell/snapshot?ts=' + Date.now() : null);
        if (!url) return;
        $all('[data-bridge="doorbell-image"]').forEach(function (el) { el.src = url; });
        document.dispatchEvent(new CustomEvent('bridge:doorbell', { detail: doorbell }));
    }

    function renderState(next) {
        state = next;
        if (!next) return;
        var devices = next.devices || {};
        renderTemperature(devices.temperature);
        renderLed(devices.led);
        renderDoorbell(devices.doorbell);

        var online = !!(next.tuya && next.tuya.connected);
        $all('[data-bridge="status"]').forEach(function (el) {
            el.textContent = online ? 'Мост активен' : 'Мост offline';
            el.classList.toggle('online', online);
            el.classList.toggle('offline', !online);
        });
        $all('[data-bridge="last-sync"]').forEach(function (el) {
            el.textContent = formatTime(next.lastSyncAt);
        });
    }

    function openDoorbellModal() {
        var existing = document.getElementById('bridgeDoorbellModal');
        if (existing) existing.remove();

        var modal = document.createElement('div');
        modal.id = 'bridgeDoorbellModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;padding:24px;';
        modal.innerHTML =
            '<div style="max-width:90vw;max-height:90vh;text-align:center;color:#fff;font-family:inherit;">' +
            '<img src="/api/bridge/doorbell/snapshot?ts=' + Date.now() + '" ' +
            'onerror="this.replaceWith(Object.assign(document.createElement(\'p\'),{textContent:\'Снимок ещё не получен\'}))" ' +
            'style="max-width:90vw;max-height:80vh;border-radius:16px;border:1px solid #333;" />' +
            '<p style="margin-top:12px;opacity:.7;">Дверной звонок · обновлено ' +
            formatTime(state && state.devices && state.devices.doorbell ? state.devices.doorbell.snapshotAt : null) +
            '</p></div>';
        modal.addEventListener('click', function () { modal.remove(); });
        document.body.appendChild(modal);
    }

    function setLed(payload) {
        return fetch('/api/bridge/led', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && data.success) renderLed(data.led);
            return data;
        });
    }

    function bindControls() {
        $all('[data-bridge-led="switch"]').forEach(function (el) {
            el.addEventListener('change', function () {
                var on = el.type === 'checkbox' ? el.checked : !el.classList.contains('active');
                setLed({ on: on });
            });
        });
        $all('[data-bridge-led="level"]').forEach(function (el) {
            el.addEventListener('change', function () { setLed({ level: Number(el.value) }); });
        });
        $all('[data-bridge-doorbell]').forEach(function (el) {
            el.addEventListener('click', openDoorbellModal);
        });
    }

    function connect() {
        if (typeof io === 'undefined') {
            console.warn('[bridge] Socket.IO не загружен — работаем только по REST');
            return;
        }
        socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity });
        socket.on('connect', function () { socket.emit('bridge-request-state'); });
        socket.on('bridge-update', renderState);
        socket.on('bridge-temperature', renderTemperature);
        socket.on('bridge-led', renderLed);
        socket.on('doorbell-snapshot', function (data) {
            renderDoorbell({ snapshotUrl: data.url, snapshotAt: data.at, hasSnapshot: true });
        });
    }

    function init() {
        bindControls();
        connect();
        fetch('/api/bridge/status').then(function (r) { return r.json(); }).then(renderState).catch(function () {});
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.smartBridge = {
        getState: function () { return state; },
        refresh: function () {
            return fetch('/api/bridge/status').then(function (r) { return r.json(); }).then(function (data) {
                renderState(data);
                return data;
            });
        },
        syncNow: function () {
            return fetch('/api/sync/now', { method: 'POST' }).then(function (r) { return r.json(); });
        },
        setLed: setLed,
        openDoorbell: openDoorbellModal
    };
})();
