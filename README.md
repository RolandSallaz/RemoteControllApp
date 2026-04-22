# RemoteControl

Приложение для удалённого управления рабочим столом через локальную сеть или интернет. Построено на Electron, WebRTC и NestJS.

## Как это работает

Хост захватывает экран через Electron `desktopCapturer` и транслирует его по WebRTC. Клиент получает поток и отправляет события мыши/клавиатуры обратно через `RTCDataChannel`. Сигнальный сервер нужен только для WebRTC-рукопожатия (offer/answer/ICE) — видеопоток идёт напрямую между пирами.

```
[Host app]  ──WebRTC video──►  [Client app]
     ▲                               │
     └────── input events ◄──────────┘
                  │
         [Signaling server]  (только для handshake)
```

## Структура

```
apps/
  desktop/      Electron-приложение (renderer React + main + preload)
  server/       NestJS сигнальный сервер
packages/
  shared/       Общие типы протокола (ControlMessage, события)
infra/
  coturn/       Docker Compose для TURN-сервера
```

## Приложения

Проект собирается в два отдельных портативных `.exe`:

| Приложение | Режим | Описание |
|-----------|-------|----------|
| **Server App** | `host` | Захватывает экран, запускает встроенный NestJS-сервер, автоматически начинает сессию |
| **Client App** | `viewer` | Сканирует LAN, подключается к серверу, отображает удалённый экран, управляет им |

Есть также **Combined App** — одно приложение где роль выбирается вручную (для разработки).

## Возможности

- Захват любого монитора или окна
- Переключение источника захвата на лету
- Управление мышью и клавиатурой на хосте
- Авто-обнаружение серверов в локальной сети (UDP broadcast)
- Настройка FPS: 15 / 30 / 60
- Режим захвата: **Desktop** (оптимизация чёткости) / **Game** (оптимизация плавности)
- Опциональный TURN-сервер для подключений через NAT/интернет

## Разработка

```bash
npm install
```

Запустить сигнальный сервер отдельно:

```bash
npm run dev:server
```

Запустить десктопное приложение (combined mode):

```bash
npm run dev:desktop
```

Или запустить два отдельных приложения:

```bash
# Терминал 1 — хост со встроенным бэкендом
npm run dev:server-app

# Терминал 2 — клиент
npm run dev:client-app
```

Порт по умолчанию: **`47315`**. Переопределяется через переменную окружения:

```powershell
$env:PORT='47316'; npm run dev:server
```

## Сборка

```bash
# Собрать оба Windows-приложения (portable .exe)
npm run build:desktop-apps
```

Результат в `apps/desktop/release/`.

## TURN-сервер

Для работы через интернет или строгий NAT нужен TURN-сервер. В `infra/coturn/` лежит Docker Compose с coturn.

Запустить:

```bash
cd infra/coturn
docker compose up -d
```

Подключить к сигнальному серверу через переменные окружения:

```bash
TURN_URLS=turn:your-server:3478
TURN_USERNAME=remote
TURN_CREDENTIAL=your-secret
```

> В продакшне замените статические TURN-credentials на короткоживущие, генерируемые бэкендом по алгоритму RFC 8489.

## Переменные окружения

| Переменная | Где используется | Описание |
|-----------|-----------------|----------|
| `PORT` | server | Порт сигнального сервера (default: `47315`) |
| `CORS_ORIGIN` | server | Разрешённые origins через запятую |
| `TURN_URLS` | server | URL TURN-сервера |
| `TURN_USERNAME` | server | TURN username |
| `TURN_CREDENTIAL` | server | TURN credential |
| `REMOTE_CONTROL_BACKEND_PORT` | desktop (host mode) | Стартовый порт встроенного NestJS |

## Технологии

- **Electron** — оболочка десктопного приложения
- **React + TypeScript** — UI рендерера
- **electron-vite** — сборка
- **WebRTC** — p2p видеопоток и канал данных
- **Socket.IO** — сигнальный транспорт
- **NestJS** — сигнальный сервер и REST `/stats`
- **@nut-tree-fork/nut-js** — эмуляция мыши и клавиатуры на хосте
- **coturn** — TURN-сервер для NAT traversal
