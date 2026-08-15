// ==========================================
// js/bridge-panel.js
// Компактная панель моста поверх любого дашборда:
// температура Tuya, состояние LED-ленты, снимок с дверного звонка.
//
// Работает без правок index.html. Отключить: localStorage.setItem('bridgePanel','off')
// Включить обратно:                       localStorage.removeItem('bridgePanel')
// ==========================================

(function () {
    'use strict';

    if (window.__bridgePanelLoaded) return;
    window.__bridgePanelLoaded = true;

    try {
        if (localStorage.getItem('bridgePanel') === 'off') return;
    } catch (e) { /* localStorage может быть недоступен */ }

    var els = {};

    function css() {
        var style = document.createElement('style');
        style.textContent = [
            '#bridgePanel{position:fixed;right:16px;bottom:16px;z-index:9998;min-width:190px;',
            'background:rgba(18,18,20,.92);border:1px solid #2f2f35;border-radius:16px;padding:12px 14px;',
            'color:#f5f5f7;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
            'backdrop-filter:blur(12px);box-shadow:0 10px 30px rgba(0,0,0,.45);transition:opacity .2s;}',
            '#bridgePanel.collapsed{min-width:0;padding:8px 10px;}',
            '#bridgePanel .bp-head{display:flex;align-items:center;gap:8px;cursor:pointer;}',
            '#bridgePanel .bp-dot{width:8px;height:8px;border-radius:50%;background:#ef4444;flex:0 0 auto;}',
            '#bridgePanel .bp-dot.online{background:#22c55e;}',
            '#bridgePanel .bp-title{font-weight:600;font-size:12px;letter-spacing:.02em;opacity:.85;}',
            '#bridgePanel .bp-body{margin-top:10px;display:grid;gap:8px;}',
            '#bridgePanel.collapsed .bp-body{display:none;}',
            '#bridgePanel .bp-temp{font-size:26px;font-weight:600;line-height:1;}',
            '#bridgePanel .bp-meta{font-size:11px;opacity:.55;}',
            '#bridgePanel .bp-row{display:flex;align-items:center;gap:8px;}',
            '#bridgePanel button{flex:1;background:#26262c;border:1px solid #35353d;color:#f5f5f7;',
            'border-radius:10px;padding:6px 8px;font-size:12px;cursor:pointer;}',
            '#bridgePanel button:hover{background:#32323a;}',
            '#bridgePanel button.on{background:#2563eb;border-color:#2563eb;}',
            '#bridgePanel input[type=range]{width:100%;accent-color:#2563eb;}'
        ].join('');
        document.head.appendChild(style);
    }

    function build() {
        var panel = document.createElement('div');
        panel.id = 'bridgePanel';
        panel.innerHTML = [
            '<div class="bp-head">',
            '  <span class="bp-dot"></span>',
            '  <span class="bp-title">TUYA MOST</span>',
            '  <span class="bp-meta bp-sync" style="margin-left:auto">—</span>',
            '</div>',
            '<div class="bp-body">',
            '  <div><span class="bp-temp">--</span><span class="bp-meta" style="margin-left:6px">датчик Tuya</span></div>',
            '  <div class="bp-row">',
            '    <button class="bp-led">LED</button>',
            '    <button class="bp-bell">Звонок</button>',
            '  </div>',
            '  <input type="range" class="bp-level" min="0" max="100" value="0">',
            '  <div class="bp-row"><button class="bp-sync-btn">Синхронизировать</button></div>',
            '</div>'
        ].join('');
        document.body.appendChild(panel);

        els.panel = panel;
        els.dot = panel.querySelector('.bp-dot');
        els.sync = panel.querySelector('.bp-sync');
        els.temp = panel.querySelector('.bp-temp');
        els.led = panel.querySelector('.bp-led');
        els.level = panel.querySelector('.bp-level');
        els.bell = panel.querySelector('.bp-bell');
        els.syncBtn = panel.querySelector('.bp-sync-btn');

        panel.querySelector('.bp-head').addEventListener('click', function () {
            panel.classList.toggle('collapsed');
        });

        els.led.addEventListener('click', function () {
            var next = !els.led.classList.contains('on');
            call({ on: next });
        });

        els.level.addEventListener('change', function () {
            call({ level: Number(els.level.value) });
        });

        els.bell.addEventListener('click', function () {
            if (window.smartBridge && window.smartBridge.openDoorbell) window.smartBridge.openDoorbell();
        });

        els.syncBtn.addEventListener('click', function () {
            els.syncBtn.textContent = 'Синхронизация…';
            var done = function () {
                els.syncBtn.textContent = 'Синхронизировать';
                if (window.smartBridge) window.smartBridge.refresh();
            };
            if (window.smartBridge && window.smartBridge.syncNow) {
                window.smartBridge.syncNow().then(done).catch(done);
            } else {
                fetch('/api/sync/now', { method: 'POST' }).then(done).catch(done);
            }
        });
    }

    function call(payload) {
        if (window.smartBridge && window.smartBridge.setLed) {
            window.smartBridge.setLed(payload).catch(function () {});
            return;
        }
        fetch('/api/bridge/led', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).catch(function () {});
    }

    function time(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return '—'; }
    }

    function onTemperature(e) {
        var d = e.detail || {};
        if (!els.temp) return;
        els.temp.textContent = (d.value === null || d.value === undefined) ? '--' : d.value + '°';
    }

    function onLed(e) {
        var d = e.detail || {};
        if (!els.led) return;
        els.led.classList.toggle('on', !!d.on);
        els.led.textContent = d.on ? 'LED вкл' : 'LED выкл';
        if (d.level !== null && d.level !== undefined && document.activeElement !== els.level) {
            els.level.value = d.level;
        }
    }

    function onState(state) {
        if (!state || !els.dot) return;
        var online = !!(state.tuya && state.tuya.connected);
        els.dot.classList.toggle('online', online);
        els.sync.textContent = time(state.lastSyncAt);
        var devices = state.devices || {};
        if (devices.temperature) onTemperature({ detail: devices.temperature });
        if (devices.led) onLed({ detail: devices.led });
    }

    function init() {
        css();
        build();

        document.addEventListener('bridge:temperature', onTemperature);
        document.addEventListener('bridge:led', onLed);

        var poll = function () {
            fetch('/api/bridge/status')
                .then(function (r) { return r.json(); })
                .then(onState)
                .catch(function () {});
        };
        poll();
        setInterval(poll, 60000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
