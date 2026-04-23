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

- `RemoteControl-Server-<version>-Setup-<arch>.exe`
- `RemoteControl-Client-<version>-Setup-<arch>.exe`
- update metadata files (`*.yml`, `*.blockmap`)
- `SHA256SUMS.txt`
- `manifest.json`

## GitHub Releases CD

The repository includes `.github/workflows/release.yml`.

It runs automatically when a tag matching `v*` is pushed.

## Automated Version Bump

Prefer the `Release Version` workflow in GitHub Actions for normal releases. It:

1. bumps the semver version in all npm manifests and `package-lock.json`
2. updates `CHANGELOG.md`
3. runs tests and typecheck
4. commits the release bump
5. creates and pushes the `v<version>` tag

The tag then triggers `.github/workflows/release.yml`.

Local equivalent:

```bash
npm run release:prepare -- --bump patch
```

You can also use an explicit version:

```bash
npm run release:prepare -- --version 0.3.0 --notes "Add unattended access mode"
```

## GitHub Release Build

The release workflow will:

1. install dependencies
2. build both desktop apps
3. prepare release assets
4. create/update the GitHub Release for that tag
5. upload both installers, update metadata, checksums and manifest

## Windows Code Signing

Windows signing is enabled in the Electron Builder configs. To sign release installers in GitHub Actions, add these repository secrets:

- `WINDOWS_CSC_LINK` - base64-encoded `.pfx` certificate or a private HTTPS URL to it.
- `WINDOWS_CSC_KEY_PASSWORD` - password for the `.pfx` certificate.

If those secrets are not configured, the release workflow still builds unsigned installers and logs that signing was skipped.

## Notes

- The workflow currently targets `windows-latest`, because the Windows NSIS installers and update metadata are built there.
- GitHub release notes are generated automatically by GitHub; `CHANGELOG.md` is maintained by the `Release Version` workflow.
