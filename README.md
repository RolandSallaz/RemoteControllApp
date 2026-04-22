# RemoteControl

MVP remote desktop app for Windows.

Run **Server App** on the PC you want to control, run **Client App** on another PC, connect over LAN or by server URL, and control the remote desktop through WebRTC.

## Download

Ready-to-use builds are available in **GitHub Releases**.

Download:

- `RemoteControl Server` - install/run on the host PC.
- `RemoteControl Client` - install/run on the viewer PC.

After starting the Server App, open the Client App and either select the discovered LAN server or enter the server URL manually.

## MVP Features

- WebRTC desktop streaming.
- Mouse and keyboard control.
- LAN server discovery.
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
apps/desktop/release/
```

## Project Structure

```text
apps/desktop   Electron app
apps/server    NestJS signaling server
packages/shared shared protocol types
infra/coturn   optional TURN server
```