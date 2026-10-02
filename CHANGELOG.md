# Current application source

## [0.4.0]

- The macOS close-to-tray action explains that the app remains in the menu bar.
  Reopening from the Dock or tray restores the window and Dock icon.
- **Launch at login** uses the required Tauri autostart capability.
- Windows releases use NSIS; macOS releases stage the universal sidecar.
- Application-version consumers derive from the checked-in package version.
  Release tags and manual version inputs must match it.
- Release workflows pin third-party GitHub Actions, require main-branch CI,
  verify distribution authority, and reject source changes under an existing tag.
- Publication requires exact source, draft, platform, and asset identity.
  Updater-manifest assembly is serialized; completed releases are immutable.
- The updater manifest and GitHub Release use the same reviewed notes.
- Renderer state clears the submitted Namebase session cookie once the Rust
  backend accepts and encrypts it.
- The release workflow caches compiler artifacts and Rust targets.

These notes describe the current source candidate. Publishing requires the
[release procedure](docs/RELEASING.md) and explicit release authorization.
