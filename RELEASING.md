# Releasing

## Local release build

Build both Windows executables and prepare release assets:

```bash
npm run build:release
```

The prepared assets will be collected in:

```text
apps/desktop/release-artifacts/v<version>/
```

That folder contains:

- `RemoteControl-Server-<version>-windows-<arch>.exe`
- `RemoteControl-Client-<version>-windows-<arch>.exe`
- `SHA256SUMS.txt`
- `manifest.json`

## GitHub Releases CD

The repository includes `.github/workflows/release.yml`.

It runs automatically when a tag matching `v*` is pushed, for example:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow will:

1. install dependencies
2. build both desktop apps
3. prepare release assets
4. create/update the GitHub Release for that tag
5. upload both `.exe` files plus checksums and manifest

## Notes

- The workflow currently targets `windows-latest`, because Electron portable `.exe` artifacts are built for Windows.
- Code signing is not configured.
- The release notes are generated automatically by GitHub.
