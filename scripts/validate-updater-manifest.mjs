#!/usr/bin/env node

import { readFileSync } from "node:fs";

const requiredPlatforms = Object.freeze([
  "darwin-aarch64",
  "darwin-aarch64-app",
  "darwin-x86_64",
  "darwin-x86_64-app",
  "linux-x86_64",
  "linux-x86_64-appimage",
  "linux-x86_64-deb",
  "linux-x86_64-rpm",
  "windows-x86_64",
  "windows-x86_64-nsis",
]);

function fail(message) {
  throw new Error(`updater manifest validation failed: ${message}`);
}

function normalizedText(value) {
  return value.replace(/\r\n/g, "\n").replace(/\n+$/u, "");
}

function readJson(path, label) {
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  return value;
}

function samePlatform(left, right) {
  return left.url === right.url && left.signature === right.signature;
}

function validate() {
  const [manifestPath, assetNamesPath, ...extra] = process.argv.slice(2);
  if (!manifestPath || !assetNamesPath || extra.length !== 0) {
    fail("usage: validate-updater-manifest.mjs MANIFEST RELEASE_ASSET_NAMES");
  }

  const expectedVersion = process.env.EXPECTED_VERSION;
  const expectedRepository = process.env.EXPECTED_REPOSITORY;
  const expectedNotes = process.env.EXPECTED_NOTES;
  const semanticVersion =
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
  if (!expectedVersion || !semanticVersion.test(expectedVersion)) {
    fail("EXPECTED_VERSION must be one semantic version");
  }
  if (!expectedRepository || !/^[^/\s]+\/[^/\s]+$/u.test(expectedRepository)) {
    fail("EXPECTED_REPOSITORY must be owner/repository");
  }
  if (typeof expectedNotes !== "string" || normalizedText(expectedNotes).length === 0) {
    fail("EXPECTED_NOTES must contain the reviewed CHANGELOG section");
  }

  const manifest = readJson(manifestPath, "latest.json");
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("latest.json must contain one object");
  }
  const topLevelKeys = Object.keys(manifest).sort();
  const expectedTopLevelKeys = ["notes", "platforms", "pub_date", "version"];
  if (JSON.stringify(topLevelKeys) !== JSON.stringify(expectedTopLevelKeys)) {
    fail(`latest.json keys differ: ${topLevelKeys.join(", ")}`);
  }
  if (manifest.version !== expectedVersion) {
    fail(`version is ${JSON.stringify(manifest.version)}; expected ${expectedVersion}`);
  }
  if (typeof manifest.notes !== "string" || normalizedText(manifest.notes) !== normalizedText(expectedNotes)) {
    fail("notes do not exactly match the reviewed CHANGELOG section");
  }
  if (
    typeof manifest.pub_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(manifest.pub_date) ||
    Number.isNaN(Date.parse(manifest.pub_date)) ||
    new Date(manifest.pub_date).toISOString() !== manifest.pub_date
  ) {
    fail("pub_date is not a canonical UTC timestamp");
  }
  if (!manifest.platforms || typeof manifest.platforms !== "object" || Array.isArray(manifest.platforms)) {
    fail("platforms must be an object");
  }

  const platformKeys = Object.keys(manifest.platforms).sort();
  const expectedPlatformKeys = [...requiredPlatforms].sort();
  if (JSON.stringify(platformKeys) !== JSON.stringify(expectedPlatformKeys)) {
    fail(`platform set differs: ${platformKeys.join(", ")}`);
  }

  const assetNames = new Set(
    readFileSync(assetNamesPath, "utf8")
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!assetNames.has("latest.json")) {
    fail("release asset inventory does not include latest.json");
  }

  const [expectedOwner, expectedName] = expectedRepository.split("/");
  for (const platform of requiredPlatforms) {
    const entry = manifest.platforms[platform];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${platform} is not an updater entry`);
    }
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["signature", "url"])) {
      fail(`${platform} has unexpected fields`);
    }
    if (typeof entry.signature !== "string" || entry.signature.length === 0 || entry.signature.length > 16_384) {
      fail(`${platform} has no bounded signature`);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(entry.signature)) {
      fail(`${platform} signature is not canonical base64 text`);
    }
    const signatureBytes = Buffer.from(entry.signature, "base64");
    if (signatureBytes.toString("base64") !== entry.signature) {
      fail(`${platform} signature is not canonical base64 text`);
    }
    const decodedSignature = signatureBytes.toString("utf8");
    if (
      !decodedSignature.startsWith("untrusted comment: signature from tauri secret key\n") ||
      !decodedSignature.includes("\ntrusted comment: timestamp:")
    ) {
      fail(`${platform} signature is not a Tauri updater signature envelope`);
    }

    let url;
    try {
      url = new URL(entry.url);
    } catch {
      fail(`${platform} URL is invalid`);
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      fail(`${platform} URL is not a plain HTTPS GitHub release download`);
    }
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const prefixMatches =
      segments.length >= 6 &&
      segments[0].toLowerCase() === expectedOwner.toLowerCase() &&
      segments[1].toLowerCase() === expectedName.toLowerCase() &&
      segments[2] === "releases";
    const latestDownload = segments[3] === "latest" && segments[4] === "download";
    const taggedDownload =
      segments[3] === "download" && segments[4] === `v${expectedVersion}`;
    if (!prefixMatches || (!latestDownload && !taggedDownload) || segments.length !== 6) {
      fail(`${platform} URL does not belong to the approved release channel`);
    }
    const assetName = segments[5];
    if (!assetNames.has(assetName) || !assetNames.has(`${assetName}.sig`)) {
      fail(`${platform} URL or signature does not resolve to the draft asset inventory`);
    }
  }

  const sameGroups = [
    ["darwin-aarch64", "darwin-aarch64-app"],
    ["darwin-aarch64", "darwin-x86_64"],
    ["darwin-aarch64", "darwin-x86_64-app"],
    ["linux-x86_64", "linux-x86_64-appimage"],
    ["windows-x86_64", "windows-x86_64-nsis"],
  ];
  for (const [left, right] of sameGroups) {
    if (!samePlatform(manifest.platforms[left], manifest.platforms[right])) {
      fail(`${left} and ${right} do not describe the same signed updater asset`);
    }
  }

  console.log(
    `updater manifest validation passed: ${expectedVersion}, ${requiredPlatforms.length} platforms, ${assetNames.size} release assets`,
  );
}

try {
  validate();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
