# RemoteControl

Prototype stack for remote desktop control:

- Desktop app: Electron, React, TypeScript, electron-vite
- Screen stream: WebRTC
- Signaling: NestJS Gateway over Socket.IO
- Host input control: nut.js-compatible adapter loaded from the Electron main process
- NAT traversal: STUN by default, coturn for TURN/STUN

## Structure

```text
apps/
  desktop/   Electron renderer, preload, and main process
  server/    NestJS signaling service
packages/
  shared/    Shared protocol and control message types
infra/
  coturn/    Development coturn config
```

## Development

Install dependencies:

```bash
npm install
```

Start standalone signaling for development:

```bash
npm run dev:server
```

The default signaling port is `3001`. To use another port:

```powershell
$env:PORT='3002'; npm run dev:server
```

Start the combined desktop app in another terminal:

```bash
npm run dev:desktop
```

Or use the separated apps:

```bash
npm run dev:server-app
npm run dev:client-app
```

`dev:server-app` starts the desktop host and automatically launches the NestJS signaling backend on the first available port starting at `3001`. `dev:client-app` scans the local network and shows available RemoteControl servers in the sidebar.

For a local two-peer test, open the Server app and Client app. Use the same session code. In Client app, pick the discovered LAN server or enter the URL manually.

Build both Windows desktop apps:

```bash
npm run build:desktop-apps
```

## TURN

For local TURN testing:

```bash
docker compose -f infra/coturn/docker-compose.yml up
```

Then set server env vars:

```bash
TURN_URLS=turn:localhost:3478
TURN_USERNAME=remote
TURN_CREDENTIAL=remote-dev-secret
```

Production should replace static TURN credentials with short-lived credentials issued by the backend.

## Notes

- Host mode uses Electron `desktopCapturer` for source selection and Chromium desktop capture constraints for the stream.
- Viewer input is sent over `RTCDataChannel`; the signaling server is only used for session join and WebRTC offer/answer/ICE relay.
- The public npm package currently used for dev is `@nut-tree-fork/nut-js`. The host adapter also tries `@nut-tree/nut-js` first, so a private/official registry package can be dropped in later without changing the WebRTC flow.
