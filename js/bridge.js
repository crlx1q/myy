// ==========================================
// js/bridge.js
// Клиент моста для главного экрана: живые данные по WebSocket + REST.
//
// Разметка (любой элемент с атрибутом):
//   data-bridge="temperature" | "temperature-updated" | "humidity"
//   data-bridge="led-state" | "status" | "last-sync" | "doorbell-image"
//   data-bridge-led="switch" (кнопка/чекбокс) | data-bridge-led="level" (range)
//   data-bridge-doorbell (клик по виджету камеры)
//
// API: window.smartBridge.{ getState, refresh, syncNow, setLed, openDoorbell }
// ==========================================

(function () {
    if (window.__smartBridgeLoaded) return;
    window.__smartBridgeLoaded = true;

    var state = null;
    var socket = null;

    function $all(selector) {
        return Array.prototype.slice.call(document.querySelectorAll(selector));
    }

    function setText(key, value) {
        $all('[data-bridge="' + key + '"]').forEach(function (el) {
            el.textContent = value;
        });
    }

    function formatTime(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return iso;
        }
    }

    function emit(name, detail) {
        document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    }

    function renderTemperature(temp) {
        if (!temp || temp.value === null || temp.value === undefined) return;
        setText('temperature', temp.value + '\u00b0');
        setText('temperature-updated', formatTime(temp.updatedAt));
        if (temp.humidity !== null && temp.humidity !== undefined) {
            setText('humidity', temp.humidity + '%');
        }
        emit('bridge:temperature', temp);
    }

    function renderLed(led) {
        if (!led) return;
        setText('led-state', led.on === null ? '—' : (led.on ? 'Вкл' : 'Выкл'));

        $all('[data-bridge-led="switch"]').forEach(function (el) {
            if (el.type === 'checkbox') el.checked = Boolean(led.on);
            else el.setAttribute('data-state', led.on ? 'on' : 'off');
        });

        if (led.level !== null && led.level !== undefined) {
            $all('[data-bridge-led="level"]').forEach(function (el) {
                if (document.activeElement !== el) el.value = led.level;
            });
        }

        emit('bridge:led', led);
    }

    function renderDoorbell(doorbell) {
        if (!doorbell) return;
        var src = doorbell.cached ? '/api/bridge/doorbell/snapshot?ts=' + Date.now() : doorbell.imageUrl;
        $all('[data-bridge="doorbell-image"]').forEach(function (el) {
            if (src) el.setAttribute('src', src);
        });
        emit('bridge:doorbell', doorbell);
    }

    function renderState(next) {
        if (!next) return;
        state = next;
        renderTemperature(next.temperature);
        renderLed(next.led);
        renderDoorbell(next.doorbell);
        setText('status', next.lastError ? 'Ошибка' : 'Ок');
        setText('last-sync', formatTime(next.lastSuccessAt || next.lastSyncAt));
        emit('bridge:update', next);
    }

    function request(url, options) {
        return fetch(url, options).then(function (r) { return r.json(); });
    }

    function refresh() {
        return request('/api/bridge/status').then(function (data) {
            renderState(data);
            return data;
        }).catch(function () { return null; });
    }

    function syncNow() {
        return request('/api/sync/now', { method: 'POST' }).then(function (data) {
            if (data && data.state) renderState(data.state);
            return data;
        });
    }

    function setLed(payload) {
        return request('/api/bridge/led', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        }).then(function (data) {
            if (data && data.led) renderLed(data.led);
            return data;
        });
    }

    function openDoorbell() {
        var modal = document.getElementById('bridgeDoorbellModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'bridgeDoorbellModal';
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;' +
                'justify-content:center;z-index:9999;padding:24px;';
            modal.innerHTML = '<img data-bridge="doorbell-image" style="max-width:100%;max-height:100%;border-radius:12px;" />';
            modal.addEventListener('click', function () { modal.style.display = 'none'; });
            document.body.appendChild(modal);
        }
        modal.style.display = 'flex';
        renderDoorbell(state && state.doorbell ? state.doorbell : { cached: true });
    }

    function bindControls() {
        $all('[data-bridge-led="switch"]').forEach(function (el) {
            el.addEventListener('change', function () {
                setLed({ on: el.type === 'checkbox' ? el.checked : el.getAttribute('data-state') !== 'on' });
            });
            el.addEventListener('click', function () {
                if (el.type !== 'checkbox') setLed({ on: el.getAttribute('data-state') !== 'on' });
            });
        });

        $all('[data-bridge-led="level"]').forEach(function (el) {
            el.addEventListener('change', function () { setLed({ level: Number(el.value) }); });
        });

        $all('[data-bridge-doorbell]').forEach(function (el) {
            el.addEventListener('click', openDoorbell);
        });
    }

    function connect() {
        if (typeof io !== 'function') return;
        socket = io();
        socket.on('connect', function () { socket.emit('bridge-request-state'); });
        socket.on('bridge-update', renderState);
        socket.on('bridge-temperature', renderTemperature);
        socket.on('bridge-led', renderLed);
        socket.on('bridge-doorbell', renderDoorbell);
    }

    function init() {
        bindControls();
        connect();
        refresh();
        setInterval(refresh, 120000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.smartBridge = {
        getState: function () { return state; },
        refresh: refresh,
        syncNow: syncNow,
        setLed: setLed,
        openDoorbell: openDoorbell
    };
})();
