# Releasing Namehold

## Prerequisites (one-time setup)

### 1. Generate the updater signing keypair

The auto-updater requires an Ed25519 keypair. The **public key** is embedded in
the app binary (via `tauri.conf.json`); the **private key** signs every release
bundle so existing installs can verify the update came from you.

```bash
pnpm tauri signer generate -w ~/.tauri/namehold.key
```

This creates:
- `~/.tauri/namehold.key` — **PRIVATE** key. Back it up offline (1Password /
  hardware / paper). **If you lose this key, no future update can reach existing
  installs.** You would have to ask every user to reinstall from scratch.
- `~/.tauri/namehold.key.pub` — public key (safe to share).

### 2. Wire the keys

1. Paste the contents of `namehold.key.pub` into
   `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
2. Add two GitHub Actions secrets to the repo:
   - `TAURI_SIGNING_PRIVATE_KEY` — the full contents of `~/.tauri/namehold.key`.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose (or empty).

---

## Cutting a release

### Release authority gate

The updater endpoint embedded in the application currently points to
`DimazzzZ/namehold-wallet`. GitHub Actions, however, creates releases in the
repository where the workflow runs. A fork or mirror therefore **must not run
the release workflow** while those repositories differ: its artifacts would not
reach existing installations and could create a second, misleading release
channel.

`release.yml` runs `scripts/check-release-authority.mjs` (also exposed locally
as `pnpm check:release-authority`) before it creates a draft. It fails unless
`${{ github.repository }}` matches the repository encoded by the updater
endpoint. Do not weaken that check. Resolve all of the following as one explicit
release-ownership decision before changing either side:

- the canonical GitHub release repository and issue tracker;
- the updater endpoint embedded in `src-tauri/tauri.conf.json`;
- custody and continuity of the updater signing key; and
- how already-installed clients move to any new endpoint or public key.

Changing a Git remote alone does not migrate the update channel.

### Procedure

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json`, and
   `src-tauri/Cargo.toml`. Run `cargo check` in `src-tauri/` to update the
   `namehold-wallet` entry in `Cargo.lock`, then run `pnpm check:version` from
   the repository root. The sidebar, About page, and browser-QA updater mock
   all derive their version from `package.json`; do not edit them separately.
   Add a CHANGELOG entry: rename `[Unreleased]` → `[X.Y.Z] - <date>` and open a
   fresh `[Unreleased]`.
2. Commit and tag:
   ```bash
   git tag vX.Y.Z
   git push <approved-release-remote> main vX.Y.Z
   ```
   Resolve `<approved-release-remote>` to the repository that passed the
   release-authority gate; do not assume a remote named `origin` is the update
   channel, and do not push every local tag. The tag must be exactly `v` plus
   the checked-in version. A manual workflow run uses that same checked-in
   version; its optional version input is only a confirmation and cannot
   override source files. If the version tag already resolves to another
   commit, the workflow fails before touching a release; bump the version
   instead of rebuilding old version metadata from new source.
3. The `release.yml` workflow:
   - Validates release authority, all checked-in version sources, and the exact
     tag/manual input before creating a release or starting a build.
   - Creates a **draft** GitHub Release.
   - Builds on macOS (universal), Linux, Windows.
   - Runs `beforeBuildCommand` to build the `namehold-syncd` sidecar binary
     per-platform (macOS universal, Linux, Windows) and stages it for bundling.
   - `tauri-action` produces the bundles (including the Windows NSIS `.exe`)
     **+ `.sig` files + `latest.json`**
     (because `createUpdaterArtifacts: true` and the signing key is set).
   - The sidecar binary is bundled into each app bundle via the `externalBin`
     configuration in `tauri.conf.json`.
   - Copies the matching CHANGELOG entry into both the GitHub Release and the
     updater manifest, then verifies `latest.json` is present.
   - Un-drafts the release (makes it public + "latest").
4. Existing installs auto-detect the new version within ~30 s of their next
   launch (or immediately when the user clicks "Check for updates" in Settings).

---

## How the updater works

- Endpoint: `https://github.com/DimazzzZ/namehold-wallet/releases/latest/download/latest.json`
- `latest.json` contains the new version, CHANGELOG notes, per-platform download
  URLs, and the Ed25519 signature of each bundle.
- The plugin verifies the signature against the embedded public key before
  installing. If the signature doesn't match, the update is rejected.
- On Windows the app exits automatically during install (OS limitation). On
  macOS/Linux the user clicks "Restart now" (or the app restarts itself).

---

## Key rotation (if ever needed)

The plugin supports setting the pubkey at runtime via `UpdaterBuilder::pubkey()`.
To rotate: ship a release signed with the OLD key that embeds the NEW pubkey,
then all subsequent releases use the new key. This is not implemented yet — the
current setup uses a single static key.
