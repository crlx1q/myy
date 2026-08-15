// ==========================================
// js/bridge-panel.js
// Плавающая панель с данными Tuya на главном экране.
// Отключить: localStorage.setItem('bridgePanel','off') и перезагрузить страницу.
// ==========================================

(function () {
    if (window.__bridgePanelLoaded) return;
    window.__bridgePanelLoaded = true;

    try {
        if (localStorage.getItem('bridgePanel') === 'off') return;
    } catch (e) { /* localStorage может быть недоступен */ }

    var STYLE = [
        '#bridgePanel{position:fixed;right:16px;bottom:16px;width:230px;background:rgba(17,17,20,.92);',
        'color:#fff;border:1px solid #2a2a30;border-radius:14px;padding:12px 14px;font:13px/1.4 system-ui,Arial,sans-serif;',
        'z-index:9998;backdrop-filter:blur(8px);}',
        '#bridgePanel .bp-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
        '#bridgePanel .bp-dot{width:8px;height:8px;border-radius:50%;background:#ef4444;}',
        '#bridgePanel .bp-dot.ok{background:#22c55e;}',
        '#bridgePanel .bp-title{font-weight:600;font-size:12px;letter-spacing:.02em;opacity:.85;}',
        '#bridgePanel .bp-temp{font-size:28px;font-weight:600;}',
        '#bridgePanel .bp-meta{opacity:.6;font-size:11px;margin-bottom:8px;}',
        '#bridgePanel .bp-row{display:flex;gap:8px;align-items:center;margin-top:8px;}',
        '#bridgePanel button{flex:1;padding:7px 8px;border:none;border-radius:8px;background:#2563eb;color:#fff;',
        'cursor:pointer;font-size:12px;}',
        '#bridgePanel button.off{background:#374151;}',
        '#bridgePanel input[type=range]{width:100%;}',
        '#bridgePanel .bp-sync{opacity:.6;font-size:11px;margin-top:8px;}'
    ].join('');

    var HTML = [
        '<div class="bp-head"><span class="bp-dot"></span><span class="bp-title">TUYA</span></div>',
        '<div class="bp-temp" data-bridge="temperature">—</div>',
        '<div class="bp-meta">обновлено <span data-bridge="temperature-updated">—</span></div>',
        '<div class="bp-row"><button class="bp-led" data-bridge-led="switch" data-state="off">Лента</button>',
        '<button class="bp-bell" data-bridge-doorbell>Звонок</button></div>',
        '<div class="bp-row"><input type="range" min="1" max="100" value="50" data-bridge-led="level" /></div>',
        '<div class="bp-sync">синхронизация: <span data-bridge="last-sync">—</span></div>',
        '<div class="bp-row"><button class="bp-sync-btn">Синхронизировать</button></div>'
    ].join('');

    function mount() {
        if (document.getElementById('bridgePanel')) return;

        var style = document.createElement('style');
        style.textContent = STYLE;
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'bridgePanel';
        panel.innerHTML = HTML;
        document.body.appendChild(panel);

        var dot = panel.querySelector('.bp-dot');
        var ledButton = panel.querySelector('.bp-led');

        panel.querySelector('.bp-sync-btn').addEventListener('click', function () {
            if (window.smartBridge) window.smartBridge.syncNow();
        });

        document.addEventListener('bridge:led', function (event) {
            var led = event.detail || {};
            ledButton.classList.toggle('off', !led.on);
            ledButton.textContent = led.on ? 'Лента вкл' : 'Лента выкл';
        });

        document.addEventListener('bridge:update', function (event) {
            var next = event.detail || {};
            dot.classList.toggle('ok', !next.lastError);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
})();
