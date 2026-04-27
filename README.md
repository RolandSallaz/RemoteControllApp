# RemoteControl

MVP remote desktop app for Windows.

Run **Server App** on the PC you want to control, run **Client App** on another PC, connect over LAN or by server URL, and control the remote desktop through WebRTC.

## Download

Ready-to-use builds are available in **GitHub Releases**.

Download:

- `RemoteControl Server` - install/run on the host PC.
- `RemoteControl Client` - install/run on the viewer PC.

After starting the Server App, open the Client App and either select the discovered LAN server or enter the server URL manually.
You can also open the server URL in a browser, for example `http://192.168.1.10:47315`, and connect as a web viewer.

## MVP Features

- WebRTC desktop streaming.
- Mouse and keyboard control.
- LAN server discovery.
- Browser-based viewer served by the host app.
- Fullscreen viewer with draggable `RC` settings overlay.
- Monitor switching.
- Optional server password.
- Stream FPS and audio toggles.
- Local input capture mode.
- File transfer.
- Optional TURN support for stricter networks.

## Default Shortcuts

- Switch monitor: `Ctrl+Alt+Shift+M`
- Disconnect: `Ctrl+Alt+Shift+D`
- Exit input capture: `Ctrl+Alt+Shift+Esc`

## TURN For NAT Traversal

For stricter NATs, deploy the bundled coturn setup in `infra/coturn` and configure the signaling server with the same `TURN_URLS`, `TURN_USERNAME`, and `TURN_CREDENTIAL` values.

```bash
cd infra/coturn
cp .env.example .env
docker compose --env-file .env up -d
```

See `infra/coturn/README.md` for required ports and server environment variables.

## Development

Requirements:

- Node.js `>=20.19.0`
- npm

Install:

```bash
npm install
```

Run host app:

```bash
npm run dev:server-app
```

Run client app:

```bash
npm run dev:client-app
```

Typecheck:

```bash
npm run typecheck
```

Build both Windows apps:

```bash
npm run build:desktop-apps
```

Artifacts are written to:

```text
apps/desktop/release-server/
apps/desktop/release-client/
```

## Project Structure

```text
apps/desktop   Electron app
apps/server    NestJS signaling server
packages/shared shared protocol types
infra/coturn   optional TURN server
```
