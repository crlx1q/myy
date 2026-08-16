# Tuya вместо SmartThings

Дашборд больше никуда не ходит за SmartThings. Все устройства, статусы и команды — Tuya Cloud (Smart Life).

## Как устроено

```
браузер (index.html / index mini.html)
        │  те же самые /api/... и socket.io, что и раньше
     server.js  (запускается через index.js)
        │  все HTTP-вызовы к api.smartthings.com перехватываются на уровне модулей
   tuya/bootstrap.js — подмена node-fetch / token-manager / express / socket.io
   tuya/adapter.js   — понимает /devices, /devices/{id}, /status, /health, /commands
        ├─ tuya/api.js      — OpenAPI: подпись HMAC-SHA256, access_token, ретраи
        ├─ tuya/mapper.js   — DP-коды Tuya ↔ capabilities дашборда
        ├─ tuya/routes.js   — ключи, диагностика, звонок, датчик дыма
        └─ tuya/config.js   — ключи: админка > env > фолбэк в коде
```

Смысл рефакторинга: подменён только слой данных. Сцены, расписания, автоматизации,
голос, статистика, скрытие устройств, mini-версия — работают без изменений.

## Маппинг DP → дашборд

| Tuya DP | Стало |
|---|---|
| `switch_led`, `switch`, `switch_1` | `switch.switch` = on/off |
| `bright_value`, `bright_value_v2` | `switchLevel.level` в % |
| `temp_value(_v2)` | `colorTemperature` в Кельвинах |
| `colour_data(_v2)` | `colorControl.hue/saturation` |
| `va_temperature`, `temp_current` | `temperatureMeasurement.temperature` (делитель auto) |
| `va_humidity`, `humidity_value` | `relativeHumidityMeasurement.humidity` |
| `battery_percentage`, `residual_electricity` | `battery.battery` |
| `smoke_sensor_status` | `smokeDetector.smoke` = clear/detected |
| `co_state` | `carbonMonoxideDetector` |
| `pir`, `presence_state` | `motionSensor.motion` |
| `doorcontact_state` | `contactSensor.contact` |
| `watersensor_state` | `waterSensor.water` |
| `cur_power` | `powerMeter.power` (Вт) |
| `doorbell_pic`, `movement_detect_pic` | кадр звонка |

Сырые DP всегда доступны в `components.main.tuyaRaw.dp` — удобно для отладки.
Любой DP можно дёрнуть напрямую: `POST /api/device/control` с `capability: "tuyaRaw"`,
`command: "<имя DP>"`, `arguments: [значение]`.

## Датчик дыма

`GET /api/security/smoke-detector` отдаёт `{status, text, battery, online}`.
Пока тревоги нет — на карточке зелёное «Всё в порядке». Если датчика в аккаунте нет,
карточка всё равно показывает норму.
Сработка раз в минуту рассылается событием socket.io `smoke-detector` и пишется в уведомления.

## Дверной звонок: почему кадры, а не поток

Tuya не отдаёт прямой RTSP/HLS по обычному Cloud-проекту: поток идёт через их WebRTC/IPC SDK,
а тот требует современный браузер. Galaxy Ace GT-S5830 (Android 2.3) не воспроизведёт ни WebRTC,
ни HLS — поэтому сделано через кадры:

1. Звонок кладёт снимок в DP `doorbell_pic` / `movement_detect_pic`.
2. Сервер раз в минуту опрашивает звонок, скачивает кадр в `data/snapshots/`
   (всегда есть `doorbell-latest.jpg`, хранятся последние 20 штук).
3. На странице «Безопасность» — последний кадр и время снимка; обновить вручную —
   `POST /api/security/doorbell/snapshot`, плюс socket-событие `doorbell-snapshot`.

Если потом захочется живое видео — нужен посредник (например ffmpeg, перегоняющий
поток в MJPEG), и только MJPEG старый Android осилит. На Koyeb это будет очень дорого по CPU.

## Настройка

1. `/admin` → пароль админа → блок «Tuya Cloud».
2. Вставить Access ID / Access Secret из [iot.tuya.com](https://iot.tuya.com) → Cloud → проект → Overview.
3. Выбрать дата-центр (для нас — Europe).
4. «Проверить подключение» → должно показать количество устройств и зелёный индикатор.
5. «Обновить устройства» → список подтянется на дашборд.

Важно: в Tuya IoT Platform в проекте должны быть подключены API-пакеты
**IoT Core**, **Authorization** и (для звонка) **Smart Home Devices Management**,
а аккаунт Smart Life привязан в Cloud → Devices → Link Tuya App Account.

Если список устройств пуст — сервер автоматически подхватит те device_id, что указаны в полях админки.

## Google Home

Кода не требуется. Приложение Google Home → Добавить → «Работает с Google Home» → **Tuya Smart**
(или Smart Life) → войти тем же аккаунтом. Дашборд и Google Home работают параллельно
с одним и тем же Tuya Cloud и не конфликтуют.

## Диагностика

| Куда смотреть | Зачем |
|---|---|
| `GET /api/tuya/status` | токен, количество устройств, последняя ошибка, логи |
| `POST /api/tuya/health` | проверка ключей |
| `POST /api/tuya/refresh` | перечитать все устройства |
| `GET /api/tuya/device/<id>/status` | сырые DP конкретного устройства |

Коды ошибок Tuya: `1004` — кривая подпись (проверь secret), `1106` — нет прав
(не подключён API-пакет или устройство вне проекта), `1010`–`1013` — токен протух (повтор автоматический),
`2406` — проект не того типа (нужен Smart Home / Custom с IoT Core).

## На Koyeb

- Команда запуска: `npm start` (= `node index.js`). Важно: именно index.js, иначе Tuya не подключится.
- Переменные `ST_*` / `SMARTTHINGS_PAT` можно удалить — они больше не читаются.
- Файловая система эфемерная: `data/tuya-keys.json` и кадры звонка исчезают при рестарте,
  поэтому постоянные ключи держи в переменных окружения Koyeb.
