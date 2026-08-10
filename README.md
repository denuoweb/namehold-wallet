# Namehold — a non-custodial Handshake (HNS) wallet

Namehold is a local desktop wallet for **Handshake (HNS)**: hold HNS, manage the
names you own, run the full name-auction lifecycle, and edit on-chain DNS — all
non-custodially, with your keys encrypted on your own machine. It also includes a
guided **Move from Namebase** helper for migrating names and funds off the
custodial service.

Built with Tauri v2, React + TypeScript, Rust, and SQLite.

<p align="center">
  <img src="docs/assets/wallet.png" alt="Namehold wallet" width="700" />
</p>

> ⚠️ **Beta software.** Namehold is under active development and can make mistakes.
> Transactions and Namebase transfers are **irreversible** — always test with a
> single name or a small amount and confirm it arrives **before** sending or
> transferring everything.

## Features

### Wallet (the core)
- **Create or import** a wallet from a BIP39 mnemonic, or add a **watch-only**
  wallet from an account xpub.
- **Multiple wallets** — switch between them and delete ones you no longer need.
- **Receive** — your address with a QR code, one-click copy.
- **Per-wallet balances** — each wallet shows its own balance; values persist and
  refresh on demand (no bleed between wallets).

### Send HNS
- A **build → sign → broadcast** draft flow: preview fee/change before any key is
  touched, sign in the secure window, then broadcast.
- **Send Max** to sweep a wallet.
- **Status tracking** — sent transactions move Pending → Confirmed (with block
  height), or are flagged "Not confirmed" if they never make it on-chain.

### Names & auctions
- The complete Vickrey-auction lifecycle: **open, bid, reveal, redeem, register,
  update, transfer, finalize, cancel, renew, revoke**.
- **Phase badges + countdowns** for each owned name, a **reveal-required alert**,
  and a **"Locked in Auctions"** balance for in-flight bids.
- A typed **DNS-record editor** (TXT/A/AAAA/NS/CNAME…) for register/update, with a
  raw-JSON fallback.
- **Batch operations** — renew, reveal, redeem, or finalize multiple names in a
  single transaction. Multi-select checkboxes on the Owned Names table with a
  batch action bar and a confirmation modal showing estimated fee + name list.
- **Name watchlist** — track names you don't own for monitoring. Watchlist page
  in the sidebar with add/remove, tags, CSV import/export, and "Add to
  Watchlist" buttons in name modals.
- **Paid name swaps** — atomic buyer-seller name transfer with payment. The buyer
  finalizes a TRANSFER and pays the seller in a single transaction
  (`finalizeWithPayment`). The parties arrange the name, price, addresses, and
  transfer out of band; Namehold only executes and verifies the agreed swap.
- **Recover lost bids** — if you lose your local bid data (reinstall, seed-
  restore, import from another wallet), Namehold can brute-force the bid value
  from your seed and reveal it before the window closes. See
  [`docs/RECOVER_LOST_BIDS.md`](docs/RECOVER_LOST_BIDS.md).

### Node-free reads
- Reads are **node-free by default** via the HNSFans explorer — no node required
  just to view your wallet. When your local hsd is synced, the app automatically
  switches to **node-authoritative** reads (owned names, balances, bid history)
  for faster, more reliable data. A local node is needed **only to send or
  perform name actions**.

### Move from Namebase (one feature, not the core)
- Connect with your Namebase session cookie to **list custodial domains**, see
  which are **expiring soon**, **transfer names out** to your wallet, **withdraw
  HNS**, import account history, and track transfer/withdrawal activity.

### Auto-update (since v0.2.0)
- Namehold checks for updates automatically ~30 seconds after launch. When a
  new version is available, a banner appears at the top of the window offering
  a one-click install; you can also check manually in **Settings > Updates**.
  Update bundles are **Ed25519-signed** at release and verified against the
  embedded public key before install; unsigned or tampered bundles are rejected.

### Background sync

- Namehold can keep your wallet data fresh even when the app is closed. A
  lightweight background daemon (`namehold-syncd`) wakes every 60 seconds and
  syncs all wallet profiles (UTXOs, name states, transactions) from the local
  hsd node into the shared SQLite database.
- Controlled by a Settings checkbox **"Sync in background"** (default ON).
- When enabled, hsd stays running after you close the app so the daemon can
  query it; the next app launch adopts the running node (no duplicate spawned).
- Crash recovery: if the daemon dies, the app respawns it on startup.
- The daemon is **read-only** — it never signs transactions or broadcasts.

### SPV mode

- An opt-in **lightweight alternative** to the full node mode. SPV downloads only
  block headers, so its storage and initial-sync requirements are substantially
  lower than an indexed full node. Exact sizes vary with chain growth.
- **Balance and name data come from the explorer** — sending is blocked in SPV mode
  (read-only).
- Controlled via a **"Node mode"** dropdown in Settings → Connections (default:
  Full node). When using SPV, hsd runs with `--spv` instead of `--index-address
  --index-tx`.
- **Explorer failover** — all explorer HTTP requests support automatic failover to a
  configurable fallback URL.
- **SPV indicator** in the StatusStrip — shows "Explorer (SPV)" when in SPV mode.

## Scope and ecosystem boundaries

Namehold is a **value-capable desktop wallet**. With an unlocked signer and a
reachable, synced, address-indexed hsd node, it can construct, sign, and
broadcast irreversible HNS payments and name covenants.

It does **not** expose HNSA service-authority/provider controls, operate an HNSR
relay or rendezvous role, or provide peer/order discovery, matching,
negotiation, escrow, or a P2P marketplace. The paid-swap flow is an atomic
execution helper for a transfer the buyer and seller have already arranged; it
is not a marketplace or offer-discovery network.

## How it works

- **Reads are node-free.** Balances and names come from the explorer and are cached
  locally per wallet.
- **Sending needs a node.** Broadcasting and coin/owner discovery use a local
  **hsd** node over RPC. The app can start/stop hsd for you (Settings → Connections).
- **Secrets stay in a secure window.** Your mnemonic/passphrase is only ever typed
  into — and your backup phrase only ever shown in — a small **Rust-owned window**;
  it never passes through the web UI. At rest it's an **encrypted vault**
  (Argon2id + AES-256-GCM) inside the local database.
- **Write-capability gating.** Spend/name actions are enabled only when the signer
  is unlocked **and** the node is reachable, synced, and address-indexed — with a
  precise reason shown when any condition isn't met.
- **Background sync daemon.** When "Sync in background" is enabled (Settings →
  Connections, default ON), a separate Rust binary syncs all profiles every 60s.
  A cross-process DB lock table (`sync_locks`) coordinates the app's manual Sync
  and the daemon via heartbeats (10s) and stale-lock takeover (30s) so they never
  write the same profile concurrently. The daemon writes its PID to
  `~/.namehold/syncd.pid` for lifecycle tracking.

## Security

For a detailed threat model, attack surfaces, and mitigations, see [SECURITY.md](./SECURITY.md).

- **Non-custodial** — your keys live on your device, encrypted; nothing is custodied.
- **Wallet signing secrets never reach the web layer** — mnemonic/passphrase
  entry and display happen in the secure window, and signing happens in Rust.
- **Local-first** — wallet signing material stays on your device and is
  encrypted at rest. Configured service credentials have narrower boundaries:
  the hsd RPC API key is stored locally without application-layer encryption,
  while the optional Namebase cookie is encrypted at rest and sent to Namebase
  only when that migration helper is used. By default, balance and name lookups
  query the public HNSFans explorer, which sees your wallet addresses and
  tracked names. Run your own hsd node (Settings) to keep those lookups local.
  Namehold has no account/backend service and no telemetry.
- **Auto-lock** — the unlocked signer times out after a configurable idle period.
- **Namebase migration** — optional in-app helper for transferring domains from
  Namebase. The session cookie is initially entered in the main UI and crosses
  IPC to the Rust backend; the UI copy is cleared after a successful handoff,
  the stored cookie is encrypted at rest, and it is never returned to the web
  layer. See [SECURITY.md](./SECURITY.md) for the full threat model and a
  lower-risk alternative.

## Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 11+ (CI pins `11.17.0` via the `packageManager`
  field; run `corepack enable` to match it locally)
- [Rust](https://www.rust-lang.org/tools/install) 1.97.0 (the toolchain pinned
  by CI; edition 2021)
- [hsd](https://github.com/handshake-org/hsd) — **only needed for sending / name
  actions** (reads work without it). Run it with `--index-address`.

## Quick start

```bash
git clone <repo-url>
cd namehold-wallet
pnpm install
pnpm tauri dev
```

## Running a node (only to send)

Reads need no node. To send HNS or perform name actions, run an **address-indexed**
hsd node:

```bash
hsd --index-address --index-tx --api-key=<your-key>
# mainnet node RPC: http://127.0.0.1:12037
```

- `--index-address` is **required** (the wallet finds your coins by address);
  `--index-tx` backs transaction history + confirmation tracking.
- The app can manage hsd for you — set the **data directory** and (if needed) the
  **hsd binary path** in **Settings → Connections**, then click **Start hsd**.
- **hsd can't add an index to an already-synced chain.** If your existing chain
  was synced without these indexes, the app detects it and offers a **one-click
  re-sync** (it moves the old chain to a backup and re-syncs with the right indexes).

| Network | Node RPC port |
|---------|---------------|
| Mainnet | 12037         |
| Testnet | 13037         |
| Regtest | 14037         |

See [`docs/NODE_SETUP.md`](docs/NODE_SETUP.md) and
[`docs/REGTEST_TESTING.md`](docs/REGTEST_TESTING.md) for details.

## Move from Namebase

A guided migration helper (not the wallet's core function). In **Move from
Namebase**, paste your Namebase session cookie to connect, then:

<p align="center">
  <img src="docs/assets/namebase-migration.png" alt="Namebase migration" width="700" />
</p>

- review your custodial domains and which are **expiring soon**,
- **transfer** names out to your own wallet address,
- **withdraw HNS** to an address,
- optionally import the current TLD list and account history locally, and
- track domain-transfer and HNS-withdrawal activity.

On-chain finalization of transfers uses the same node-backed write path as the
rest of the wallet.

## Build for production

```bash
pnpm tauri build
```

Output in `src-tauri/target/release/bundle/` — macOS `.app`/`.dmg`, Windows NSIS
`.exe`, Linux `.AppImage`/`.deb`. CI (PR tests), a dependency-audit gate (`cargo audit` +
`pnpm audit`), and the cross-platform release pipeline live in
[`.github/workflows`](.github/workflows).

## macOS

Local macOS builds are unsigned unless you provide Apple signing credentials.
Verify the signing/notarization status of a downloaded release artifact before
installing it. An unsigned build may show:

> "Namehold" can't be opened because Apple cannot check it for malicious software.

To remove the quarantine flag, run:

```bash
xattr -cr /Applications/Namehold.app
```

Then open the app normally.

## Data location

All app data lives in one SQLite file in your home folder (pairs with hsd's `~/.hsd`),
on every platform:

- `~/.namehold/portfolio.db`
- `~/.namehold/syncd.pid` — background sync daemon's process ID (present only
  while the daemon is running)

It holds wallet profiles, the encrypted vault, local chain/sync state, optional
Namebase migration/history data, saved swap offers, and the audit log.

## Tech stack

- **Tauri v2** — desktop shell
- **React 19 + TypeScript** — frontend
- **Vite** — build tool
- **TanStack Query / Table / Virtual** — async state and reusable tabular UI
- **Zustand** — client state
- **Zod** — validation
- **SQLite (rusqlite)** — local database
- **reqwest** — HTTP client (explorer + hsd RPC)
- **secp256k1 · bip39 · argon2 · aes-gcm · zeroize** — keys, mnemonics, vault crypto
- **Tailwind CSS** — styling
