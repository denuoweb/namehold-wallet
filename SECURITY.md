# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please email the maintainer directly
(see the repo's commit history for contact) with:

- A clear description of the issue
- Steps to reproduce (if applicable)
- The impact and severity you assess
- Any suggested fixes

We aim to acknowledge reports within 48 hours and provide an initial assessment
within one week. Vulnerabilities are not disclosed publicly until a fix is
available and users have had reasonable time to upgrade.

---

## Threat model

### What the wallet protects

| Asset | At-rest protection | In-memory protection | Renderer isolation |
|-------|-------------------|---------------------|-------------------|
| BIP39 seed phrase | Argon2id + AES-256-GCM under user passphrase (`noncustodial/vault.rs`) | Time-boxed session; zeroized on lock (`noncustodial/session.rs`) | Never crosses into the webview |
| Namebase session cookie | AES-256-GCM under OS-keyring-held DEK (`noncustodial/cookie_vault.rs`) | Initially entered in the renderer and sent over IPC; the UI copy is cleared after successful handoff, then the backend holds it only for requests | Stored value is redacted from `get_settings` and cannot be written through generic `update_setting` |
| hsd node RPC api-key | Stored in the local SQLite settings (or read from `hsd.conf`) without application-layer encryption | Held in `NodeRpcClient`; redacted from `get_settings` responses, though the Settings UI can submit a replacement | Existing values are never returned to the webview |
| hsd node RPC api-key (transport) | N/A (not stored encrypted) | `guard_transport` rejects remote cleartext HTTP when a key is set; HTTPS required per [hsd API guidance](https://hsd-dev.org/api-docs/#authentication) | N/A |
| Background sync daemon (`namehold-syncd`) | Has no wallet signing material; it reads the locally stored hsd RPC API key from shared settings | Holds the RPC API key in its Rust process while performing read-only hsd requests; never signs or broadcasts | Rust binary — never touches the webview |

### Product and ecosystem boundary

This is a value-capable desktop wallet: an unlocked signer plus a synced,
address-indexed hsd node can authorize and broadcast irreversible HNS payments
and name covenants. Namehold does not implement an HNSA service authority or
provider role, an HNSR relay/rendezvous role, or peer/offer discovery, matching,
negotiation, or escrow. Its paid-swap path only atomically executes and verifies
terms that the buyer and seller arranged out of band; it is not a marketplace.

---

## The Namebase migration feature

### Why the cookie is required

Namebase Sunset (the custodial domain registry) offers no API-token or OAuth
mechanism. The session cookie is the only bearer credential Namebase accepts
programmatically. This is a limitation of Namebase, not a design choice by
Namehold.

### Attack surfaces and mitigations

#### 1. Compromised main webview (XSS, malicious extension)

**Mitigations (3 layers):**

- The initial cookie is necessarily typed into the main renderer and could be
  captured if that renderer is already compromised. After a successful backend
  handoff, Namehold clears the React input state.
- Stored cookie is never returned to the renderer: `get_settings` redacts the
  raw value and emits only `__has_namebase_cookie: "true"`
  (`commands/settings.rs`).
- Renderer cannot write the cookie or base URL: both keys are in
  `RENDERER_WRITE_DENYLIST` (`security.rs`); generic `update_setting` rejects
  writes before any DB mutation. Initial connection uses the dedicated,
  validated `connect_namebase` command.
- Per-transaction confirmation in a separate Rust-owned window: before signing
  any transaction, `sign_tx_draft` requires explicit user confirmation
  (`commands/tx.rs`) showing action, recipient, amount, fee, txid, and
  warnings

#### 2. Local disk read (malware, laptop theft, backup snapshot)

**Mitigation:** The cookie is encrypted at rest under an OS-keyring-held DEK
(data-encryption key). The DEK is stored in the OS keyring (macOS Keychain /
Windows Credential Manager / Linux Secret Service) and cannot be extracted
without the user's OS-login credentials.

Blob format: `NBC1(4) || nonce(12) || AES-256-GCM(cookie || tag)`, hex-encoded
in the `namebase_cookie_v1` setting. The ciphertext is useless without the DEK.

**Residual risk (honest disclosure):** An attacker with concurrent code
execution as the logged-in user CAN read the DEK from the OS keyring (the OS
trusts the logged-in user). Encryption-at-rest defeats *offline* attackers, not
attackers who have already compromised the running user session. This is the
standard threat model for OS-keyring-backed secrets (Signal Desktop, Bitwarden,
VS Code, etc.).

#### 3. Network redirect (poisoned `namebase_base_url` setting)

**Mitigations:**

- Release builds: `test_base_url_override` returns empty
  (`commands/namebase.rs`); the base URL is compile-time locked to
  `https://sunset.namebase.io`
- Debug/test builds: `validate_base_url` (`namebase/client.rs`) enforces a
  strict host allowlist + HTTPS requirement; loopback accepted only under
  `cfg(debug_assertions)`
- Renderer cannot write the setting: `namebase_base_url` is in
  `RENDERER_WRITE_DENYLIST`

#### 4. hsd node RPC api-key sent over cleartext HTTP

The [hsd API documentation](https://hsd-dev.org/api-docs/#authentication)
explicitly states: *"If you intend to use API via network and setup api-key,
make sure to setup ssl too."*

**Mitigation:** `guard_transport` (`noncustodial/rpc.rs`) enforces this
requirement:

- `https://` is accepted for any host (key retained)
- `http://` is accepted only for loopback addresses (`127.0.0.1`, `::1`,
  `localhost`)
- Remote `http://` with a non-empty api-key is **rejected** with a clear error
- If `NodeRpcClient::new` is called with a remote HTTP URL, it blanks the
  api-key defensively (`noncustodial/rpc.rs`) so the key is never sent cleartext
  even if the guard is somehow bypassed

This fully complies with the hsd node API's security guidance.

### The lower-risk alternative (documented, not enforced)

Users who want zero credential exposure on their device can use Namebase's own
web UI to initiate transfers/withdrawals to an address generated in Namehold,
then use Namehold's chain-monitoring to confirm arrival. This workflow:

- Requires no session cookie to be stored locally
- Trades batch operations and in-app visibility for zero credential exposure
- Is fully supported by Namehold's core functionality (address generation,
  chain monitoring, name tracking)

### Feature scope (bounding the blast radius)

The Namebase session cookie is used **only** by the migration helper
(`commands/namebase.rs`). It is **never** needed for the wallet's core
non-custodial operation (holding keys, signing transactions, broadcasting via
hsd RPC, tracking owned names). A user who disconnects Namebase loses zero
wallet functionality.

---

## Background sync daemon

### What the daemon does

The background sync daemon (`namehold-syncd`) is a separate Rust binary that:

- Runs every 60 seconds when "Sync in background" is enabled (Settings →
  Connections, default ON).
- Reads wallet profiles (UTXOs, name states, transactions) from the local hsd
  node via RPC.
- Reads the configured hsd RPC API key into its Rust process for those requests;
  it never receives wallet signing keys, mnemonic material, or passphrases.
- Writes sync data to the shared SQLite database (`~/.namehold/portfolio.db`).
- Writes its process ID to `~/.namehold/syncd.pid` for lifecycle tracking.
- **Never signs transactions, never broadcasts, and never receives wallet
  signing material.**

### Attack surfaces and mitigations

#### 1. Daemon crashes or becomes unresponsive

**Mitigation:** The app detects a dead daemon on startup and respawns it (if
"Sync in background" is ON). A cross-process DB lock table (`sync_locks`) uses
heartbeats (every 10 seconds) and stale-lock takeover (after 30 seconds) to
detect and recover from crashes.

#### 2. Orphaned hsd after app exit

**Behavior (not a vulnerability):** When "Sync in background" is ON, hsd is not
killed when the app closes. The daemon keeps it alive for background syncing.
This is intentional — the next app launch adopts the running hsd. To stop hsd,
disable "Sync in background" or manually click **Stop hsd** in Settings →
Connections.

**Residual risk (honest disclosure):** An attacker with local code execution as
the app user could potentially interact with the orphaned hsd node (e.g., via
RPC) if they know the API key. This is no worse than if the user left hsd
running manually. Mitigations: run hsd on loopback only (`127.0.0.1`), use a
strong API key, and disable "Sync in background" if you're concerned about
orphaned processes.

#### 3. Daemon reads stale or corrupted sync data

**Mitigation:** The DB lock table ensures only one reader/writer is active at a
time. The app's manual Sync and the daemon coordinate via heartbeats and stale
takeover.

#### 4. Daemon has no wallet signing path

**Code boundary:** The shipped daemon has no wallet-signing API or signing
material, never signs transactions, and never broadcasts. It does hold the hsd
RPC API key while running and can read and write sync data. Compromise of the
daemon or the app's OS account can therefore expose that credential and wallet
metadata; do not treat daemon compromise as harmless or as a substitute for OS
account security.

---

## SPV mode

### What SPV mode does

SPV (Simplified Payment Verification) mode runs hsd with `--spv` instead of
`--index-address --index-tx`. This means:

- **No address indexing** — the node doesn't track which coins belong to which address.
- **No transaction indexing** — the node doesn't store full transaction details.
- **Read-only** — the wallet cannot send transactions in SPV mode.
- **Explorer-dependent** — balance and name data come from the configured explorer.

### Security implications

1. **Explorer trust**: In SPV mode, the wallet trusts the explorer for balance and
   name data. If the explorer is compromised, it could show incorrect data. Mitigation:
   configure a trusted explorer and optionally set a fallback URL.

2. **No local verification**: Unlike full node mode, SPV mode doesn't verify
   transactions locally against the full chain. The explorer is the source of truth
   for reads.

3. **Read-only guarantee**: SPV mode blocks all write operations (sending, name
   actions) at the write-capability check level. Even if the explorer is compromised,
   it cannot trick the wallet into signing malicious transactions.

4. **hsd still runs locally**: The SPV node still runs on your machine and handles
   block header verification. The explorer is only used for data reads, not for
   transaction validation.

### When to use SPV mode

- **Quick setup**: When you want to see your balance immediately without waiting for
  full sync.
- **Low-disk environments**: When an indexed full chain will not fit comfortably.
- **Monitoring**: When you only need to watch names/auctions without sending.

### When NOT to use SPV mode

- **Sending transactions**: Switch to full node mode to send.
- **High-security requirements**: Full node mode provides stronger security guarantees.

---

## Mitigations reference table

| Concern | Mitigation | Location | Tests |
|---------|-----------|----------|-------|
| Renderer reads cookie | Redacted; presence marker only | `commands/settings.rs` | `settings_cmd_tests` |
| Renderer writes cookie | `RENDERER_WRITE_DENYLIST` | `security.rs` | `settings_cmd_tests` |
| Renderer writes base URL | `RENDERER_WRITE_DENYLIST` | `security.rs` | `settings_cmd_tests` |
| Base URL redirect (production) | Release build ignores setting | `commands/namebase.rs` | `namebase.rs::tests` |
| Cookie on disk (offline attacker) | AES-256-GCM under OS-keyring DEK | `cookie_vault.rs` | `cookie_vault::tests` |
| Signing without confirmation | Rust-owned secure window | `commands/tx.rs` | `tx_lifecycle_tests` |
| RPC api-key sent cleartext | `guard_transport` rejects remote HTTP | `noncustodial/rpc.rs` | `rpc.rs::tests` |
| Audit log leaks secrets | Redacted to `***` on write; re-redacted on read | `commands/settings.rs` | `settings_cmd_tests` |
| Daemon crashes mid-sync | Heartbeat every 10s; stale-lock takeover after 30s; app respawns daemon on next startup | `db/sync_lock.rs`, `commands/daemon_ctl.rs` | `sync_lock` tests |
| Concurrent writes by app + daemon | Cross-process `sync_locks` table; app acquires with priority, daemon preempts stale locks | `db/sync_lock.rs`, `commands/sync.rs` | `sync_lock`, `sync_race` tests |
| Daemon signs / broadcasts (would-be) | Daemon has no wallet signing material or signing paths — it only reads hsd and writes sync data | `bin/namehold-syncd.rs`, `daemon/mod.rs` | (compile-time — no signing API in daemon build) |
| hsd left running after app exit | Intentional when "Sync in background" ON; hsd bound to loopback + api-key required | `lib.rs` (setup/exit hooks) | `settings-background-sync` tests |

---

## Dependency auditing

CI runs an advisory-only audit job (`cargo audit` + `pnpm audit --prod`) on
pull requests, main pushes, and manual qualification runs to surface
newly-disclosed CVEs in the dependency graph.

### Suppressed advisories

A suppressed advisory is one we have reviewed and determined does not apply to
this app (or is unfixable because it is frozen inside an upstream dependency's
transitive graph). Every suppression MUST be justified here.

#### Frontend (`pnpm audit`)

Suppressions live in `pnpm-workspace.yaml` under `auditConfig.ignoreGhsas`.

| Advisory | Package | Rationale |
|----------|---------|-----------|
| [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) | `react-router` | CSRF bypass that the advisory states "only affects your application if you are using the unstable RSC APIs". Namehold is a Tauri single-page app with client-side routing only — it does not use React Server Components, so the vulnerable code path is never reached. Revisit when upgrading to `react-router@>=8.3.0`. |

#### Backend (`cargo audit`)

Suppressions live in `src-tauri/.cargo/audit.toml` under `[advisories] ignore`.
Every crate below is a transitive dependency of Tauri v2 — none are direct
dependencies of this crate.

| Advisory | Package | Kind | Rationale |
|----------|---------|------|-----------|
| [RUSTSEC-2026-0194](https://rustsec.org/advisories/RUSTSEC-2026-0194), [RUSTSEC-2026-0195](https://rustsec.org/advisories/RUSTSEC-2026-0195) | `quick-xml 0.39.4` | vuln (DoS) | Fixed only in `>=0.41.0` (semver-major). Pinned to `0.39.x` by `plist` (`^0.39.2`) and `wayland-scanner` (`^0.39`) inside Tauri v2. Not exposed to untrusted XML at runtime: `plist` parses the app's own macOS `Info.plist` at bundle time; `wayland-scanner` parses local Wayland protocol XML at build time. Revisit when Tauri's tree admits quick-xml `>=0.41`. |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429) | `glib 0.18.5` | unsound | Unsound `VariantStrIter` iterators. Pulled in by Tauri v2's wry/tao GTK3 Linux backend; not reachable from app code. |
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370) | `proc-macro-error 1.0.4` | unmaintained | Compile-time-only proc-macro helper via `glib-macros` / `gtk3-macros`. No runtime code. |
| [RUSTSEC-2024-0411](https://rustsec.org/advisories/RUSTSEC-2024-0411) through [-0420](https://rustsec.org/advisories/RUSTSEC-2024-0420) | gtk-rs GTK3 bindings (`atk`, `atk-sys`, `gdk`, `gdk-sys`, `gdkwayland-sys`, `gdkx11`, `gdkx11-sys`, `gtk`, `gtk-sys`, `gtk3-macros`, all `0.18.2`) | unmaintained | Tauri v2 Linux windowing depends on the GTK3 stack. A fix requires Tauri migrating to GTK4/webkitgtk-6 upstream. |
| [RUSTSEC-2025-0075](https://rustsec.org/advisories/RUSTSEC-2025-0075), [-0080](https://rustsec.org/advisories/RUSTSEC-2025-0080), [-0081](https://rustsec.org/advisories/RUSTSEC-2025-0081), [-0098](https://rustsec.org/advisories/RUSTSEC-2025-0098), [-0100](https://rustsec.org/advisories/RUSTSEC-2025-0100) | `unic-*` (`unic-char-range`, `unic-common`, `unic-char-property`, `unic-ucd-version`, `unic-ucd-ident`, all `0.9.0`) | unmaintained | Pulled in transitively via `urlpattern` <- `tauri-utils`. No direct use. |

> `anyhow` (RUSTSEC-2026-0190) was fixed by bumping to `1.0.104` rather than
> suppressed, since it had a semver-compatible patch.

---

## Disclosure policy

- Vulnerabilities are not disclosed publicly until a fix is available
- Security updates are released as soon as feasible
- Researchers who report responsibly are credited (unless they prefer anonymity)

---

## Additional resources

- [README](./README.md) -- feature overview and architecture
- [User Manual](./docs/USER_MANUAL.md) -- user-facing security guidance
- [CHANGELOG](./CHANGELOG.md) -- security fixes and improvements
- [hsd API docs](https://hsd-dev.org/api-docs/) -- Handshake node RPC reference
