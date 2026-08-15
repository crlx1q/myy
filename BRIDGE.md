# Мост-Агрегатор Tuya ⇄ SmartThings ⇄ Local Dashboard

Модуль `bridge/` превращает локальный сервер экрана в автономный мост: раз в N минут он забирает
статусы физических устройств Tuya, транслирует их в виртуальные устройства SmartThings, рассылает
по WebSocket на дашборд и пишет историю в `data/history.json`.

## 1. Подключение к `server.js`

Добавь **две строки** в `server.js` сразу после `app.use(express.json());`:

```js
// ==========================================
// МОСТ Tuya <-> SmartThings <-> Dashboard
// ==========================================
const { initBridge } = require('./bridge');
initBridge({ app, io });
```

Больше ничего в `server.js` менять не нужно: мост регистрирует собственный роутер, свои
socket.io-обработчики и планировщик. Новых npm-зависимостей нет — используются уже
установленные `express`, `socket.io`, `node-fetch`, `fs-extra`, `dotenv` и встроенный `crypto`.

## 2. Конфигурация

Приоритет: `bridge/defaults.js` → `.env` → `data/bridge-settings.json` (правится из админки,
зеркалится в `data/settings.json` в поле `bridge`).

```bash
cp .env.example .env
```

| Ключ | Назначение |
|---|---|
| `TUYA_CLIENT_ID` / `TUYA_CLIENT_SECRET` | доступ к Tuya OpenAPI |
| `TUYA_ENDPOINT` | регион (`https://openapi.tuyaeu.com`) |
| `TUYA_TEMP_DEVICE_ID` / `TUYA_LED_DEVICE_ID` / `TUYA_DOORBELL_DEVICE_ID` | физические устройства |
| `ST_PAT_TOKEN` | Personal Access Token SmartThings |
| `ST_TEMP_DEVICE_ID` / `ST_LED_DEVICE_ID` / `ST_DOORBELL_DEVICE_ID` | виртуальные устройства |
| `SYNC_INTERVAL_MINUTES` | период фоновой синхронизации (по умолчанию 5) |
| `TUYA_TEMP_SCALE` | `auto` \| `1` \| `10` \| `100` — делитель сырого значения температуры |
| `BRIDGE_ENABLED` | `false` полностью отключает планировщик |

## 3. REST API

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/bridge/status` | статус Tuya/SmartThings, время последней синхронизации, текущие значения |
| `POST` | `/api/sync/now` | ручная синхронизация |
| `GET`/`POST` | `/api/bridge/health` | health check обоих облаков |
| `GET` | `/api/settings/keys` | ключи в замаскированном виде |
| `POST` | `/api/settings/keys` | сохранение ключей (нужен `password` администратора) |
| `POST` | `/api/bridge/led` | `{ on?: boolean, level?: 0..100 }` — Tuya + SmartThings + UI |
| `GET` | `/api/bridge/doorbell/snapshot` | последний закешированный кадр звонка |
| `GET` | `/api/bridge/logs?limit=100` | последние логи моста |
| `GET` | `/api/bridge/tuya/:deviceId/status` | сырой статус устройства (диагностика) |

## 4. WebSocket-события

| Событие | Направление | Payload |
|---|---|---|
| `bridge-update` | server → client | полное состояние моста |
| `bridge-temperature` | server → client | `{ value, humidity, updatedAt, online }` |
| `bridge-led` | server → client | `{ on, level, workMode, updatedAt }` |
| `doorbell-snapshot` | server → client | `{ url, at }` |
| `bridge-log` | server → client | live-лог для админки |
| `bridge-sync-start` / `bridge-sync-end` | server → client | границы цикла синхронизации |
| `bridge-request-state` | client → server | запросить текущее состояние |
| `bridge-sync-now` | client → server | запустить синхронизацию |
| `bridge-led-set` | client → server | `{ on, level }` |

## 5. Фронтенд

Подключи на главном экране (`index.html`, после `socket.io.js`):

```html
<script src="js/bridge.js"></script>
```

Разметка привязывается декларативно:

```html
<span data-bridge="temperature">--</span>
<span data-bridge="temperature-updated"></span>
<button data-bridge-doorbell>Камера</button>
<input type="checkbox" data-bridge-led="switch">
<input type="range" min="0" max="100" data-bridge-led="level">
```

Доступен и программный API: `window.smartBridge.getState() / .syncNow() / .setLed({on, level}) / .openDoorbell()`,
а также DOM-события `bridge:temperature`, `bridge:led`, `bridge:doorbell` — удобно вызывать из
`js/indicators.js` и `js/devices.js`.

## 6. Надёжность

- Tuya: авто-получение и обновление `access_token`, повтор запроса при кодах `1010–1013`, таймаут 12 с.
- Офлайн устройства не роняют сервер: ошибка пишется в `state.devices.*.error` и в лог.
- SmartThings: ретраи при `429` с учётом `Retry-After` и при `5xx`, 15-минутный кулдаун при `401/403`.
- Секреты в API отдаются только замаскированными; запись ключей требует пароль администратора.

> ⚠️ Репозиторий публичный: ключи Tuya из ТЗ лежат в `bridge/defaults.js` как fallback.
> Для продакшена перевыпусти секрет в Tuya IoT Platform и держи его только в `.env`.
