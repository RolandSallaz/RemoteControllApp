# Coturn TURN Server

This folder contains a minimal TURN deployment for RemoteControl. Use it when viewer and host are behind NATs that cannot establish a direct WebRTC path.

## Deploy

1. Copy the example env file and edit the values:

```bash
cp .env.example .env
```

Required values:

- `TURN_REALM` - DNS name or stable realm for this TURN service.
- `TURN_EXTERNAL_IP` - public IPv4 address of the TURN host. If the server has the public IP directly, use that IP. If it is behind NAT, use the NAT public IP.
- `TURN_USERNAME` - static TURN username shared with the RemoteControl signaling server.
- `TURN_CREDENTIAL` - long random TURN password shared with the RemoteControl signaling server.

2. Open firewall/security-group ports on the TURN host:

- `3478/tcp`
- `3478/udp`
- `49160-49200/udp`

If you change `TURN_LISTEN_PORT`, `TURN_MIN_PORT`, or `TURN_MAX_PORT`, open the matching ports instead.

3. Start coturn:

```bash
docker compose --env-file .env up -d
```

4. Configure the RemoteControl signaling server with matching credentials:

```env
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
TURN_USERNAME=remote
TURN_CREDENTIAL=change-this-long-random-secret
```

Keep `TURN_USERNAME` and `TURN_CREDENTIAL` identical to `infra/coturn/.env`.

## Notes

- The default relay port range is intentionally small for simple firewall setup. Increase `TURN_MIN_PORT` / `TURN_MAX_PORT` if you expect many simultaneous sessions.
- TLS TURN (`turns:` on port `5349`) is not configured here. Put coturn behind a deployment that provides certificates if you need TLS.
- Do not commit `.env`; commit only `.env.example`.
