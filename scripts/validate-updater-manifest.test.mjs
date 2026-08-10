#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const version = "0.4.1";
const repository = "DimazzzZ/namehold-wallet";
const notes = "Reviewed release notes";
const validator = fileURLToPath(new URL("./validate-updater-manifest.mjs", import.meta.url));
const platformAssets = Object.freeze({
  "darwin-aarch64": "Namehold_universal.app.tar.gz",
  "darwin-aarch64-app": "Namehold_universal.app.tar.gz",
  "darwin-x86_64": "Namehold_universal.app.tar.gz",
  "darwin-x86_64-app": "Namehold_universal.app.tar.gz",
  "linux-x86_64": `Namehold_${version}_amd64.AppImage`,
  "linux-x86_64-appimage": `Namehold_${version}_amd64.AppImage`,
  "linux-x86_64-deb": `Namehold_${version}_amd64.deb`,
  "linux-x86_64-rpm": `Namehold-${version}-1.x86_64.rpm`,
  "windows-x86_64": `Namehold_${version}_x64-setup.exe`,
  "windows-x86_64-nsis": `Namehold_${version}_x64-setup.exe`,
});

function updaterSignature() {
  return Buffer.from(
    [
      "untrusted comment: signature from tauri secret key",
      "RUQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      "trusted comment: timestamp:1786149292\tfile:Namehold",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==",
      "",
    ].join("\n"),
    "utf8",
  ).toString("base64");
}

function fixture() {
  const platforms = Object.fromEntries(
    Object.entries(platformAssets).map(([platform, asset]) => [
      platform,
      {
        signature: updaterSignature(),
        url: `https://github.com/${repository}/releases/latest/download/${asset}`,
      },
    ]),
  );
  return {
    manifest: {
      version,
      notes,
      pub_date: "2026-08-10T12:34:56.789Z",
      platforms,
    },
    assets: [
      "latest.json",
      ...new Set(Object.values(platformAssets)),
      ...[...new Set(Object.values(platformAssets))].map((name) => `${name}.sig`),
    ],
  };
}

function validate(mutator = () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "namehold-updater-gate-"));
  try {
    const value = fixture();
    mutator(value);
    const manifestPath = join(directory, "latest.json");
    const assetsPath = join(directory, "assets.txt");
    writeFileSync(manifestPath, `${JSON.stringify(value.manifest)}\n`);
    writeFileSync(assetsPath, `${value.assets.join("\n")}\n`);
    return spawnSync(process.execPath, [validator, manifestPath, assetsPath], {
      encoding: "utf8",
      env: {
        ...process.env,
        EXPECTED_VERSION: version,
        EXPECTED_REPOSITORY: repository,
        EXPECTED_NOTES: notes,
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("accepts one complete signed multi-platform release manifest", () => {
  const result = validate();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /10 platforms/u);
});

test("rejects an incomplete platform set", () => {
  const result = validate(({ manifest }) => {
    delete manifest.platforms["windows-x86_64-nsis"];
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /platform set differs/u);
});

test("rejects updater URLs outside the approved repository", () => {
  const result = validate(({ manifest }) => {
    manifest.platforms["linux-x86_64-deb"].url =
      `https://github.com/attacker/namehold-wallet/releases/latest/download/Namehold_${version}_amd64.deb`;
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /approved release channel/u);
});

test("rejects assets without their detached signature", () => {
  const result = validate((value) => {
    value.assets = value.assets.filter((name) => name !== `Namehold_${version}_x64-setup.exe.sig`);
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /draft asset inventory/u);
});
