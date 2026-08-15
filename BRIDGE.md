# Мост Tuya OpenAPI -> локальный дашборд

Сервер сам ходит в Tuya Cloud, забирает показания физических устройств и транслирует их
на экран по WebSocket. SmartThings больше не участвует.

## Запуск

```
npm start          # node app.js — server.js + мост
npm run start:legacy   # node server.js — без моста
```

На Koyeb команда запуска должна быть `npm start`. В логах после старта должны быть строки:

```
[bridge] Планировщик запущен: синхронизация каждые 5 мин.
[bridge] Мост Tuya инициализирован
[bridge] Мост Tuya подключён поверх server.js
```

## Где хранятся ключи

Приоритет: `data/bridge-settings.json` (админка) > `.env` / переменные Koyeb > `bridge/defaults.js`.

Важно: файловая система Koyeb эфемерна — всё, что сохранено через админку, исчезнет
при следующем деплое. Постоянные значения держи в переменных окружения Koyeb.

## REST API

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/bridge/status` | текущее состояние всех устройств |
| GET | `/api/bridge/logs?limit=100` | логи моста |
| GET | `/api/bridge/history?limit=200` | история температуры |
| POST | `/api/sync/now` | синхронизировать сейчас |
| GET/POST | `/api/bridge/health` | проверка подключения к Tuya |
| GET | `/api/settings/keys` | ключи (секреты замаскированы) |
| POST | `/api/settings/keys` | сохранить ключи (нужен пароль админа) |
| POST | `/api/bridge/led` | `{ "on": true, "level": 60 }` |
| GET | `/api/bridge/doorbell/snapshot` | последний кадр со звонка |
| GET | `/api/bridge/tuya/:deviceId/status` | сырые DP-коды устройства |

## WebSocket-события

`bridge-update`, `bridge-temperature`, `bridge-led`, `bridge-doorbell`, `bridge-log`.

## Разметка на своём экране

Любому элементу в `index.html` можно добавить атрибут, и он сам начнёт обновляться:

```html
<span data-bridge="temperature"></span>
<span data-bridge="temperature-updated"></span>
<button data-bridge-led="switch">Лента</button>
<input type="range" min="1" max="100" data-bridge-led="level">
<img data-bridge="doorbell-image">
<div data-bridge-doorbell>Камера</div>
```

Плавающая панель показывается только на `index.html` (не на `index mini.html`).
Выключить: `localStorage.setItem('bridgePanel','off')`.

## Google Home

Код для этого НЕ НУЖЕН. У Google нет серверного API для управления чужими устройствами:
Home APIs — только SDK под Android/iOS, Smart Device Management API — только устройства Nest.

Рабочий путь: в приложении Google Home -> Добавить -> Работает с Google Home -> найти
«Tuya Smart» (или «Smart Life») -> войти тем же аккаунтом. Все устройства Tuya появятся
в Google Home с голосовым управлением и автоматизациями. Этот сервер работает параллельно
и никак ей не мешает: оба говорят с одним и тем же Tuya Cloud.

## Диагностика

- `GET /api/bridge/health` — жива ли Tuya, онлайн ли каждое устройство.
- `GET /api/bridge/tuya/<deviceId>/status` — реальные DP-коды. Если температура или яркость
  не читаются — посмотри здесь имена кодов и поправь `TUYA_TEMP_SCALE` / `TUYA_BRIGHT_CODE`.
- Типовые ошибки Tuya: `1004 sign invalid` (неверный secret), `1106 permission deny`
  (устройство не привязано к проекту или нет подписки IoT Core / Device Control).
