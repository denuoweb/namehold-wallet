#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const fail = (message) => {
  console.error(`version consistency check failed: ${message}`);
  process.exitCode = 1;
};

function tomlPackageVersion(source, packageName, path) {
  const blocks = source.split(/^\[\[package\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const name = block.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (name === packageName) {
      const version = block.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
      if (version) return version;
      throw new Error(`${path}: package ${packageName} has no version`);
    }
  }
  throw new Error(`${path}: package ${packageName} was not found`);
}

function cargoManifestVersion(source, path) {
  const start = source.indexOf("[package]");
  const end = source.indexOf("\n[", start + "[package]".length);
  const packageSection = start >= 0 ? source.slice(start, end >= 0 ? end : undefined) : "";
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error(`${path}: [package] version was not found`);
  return version;
}

const packageJson = JSON.parse(read("package.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const canonicalVersion = packageJson.version;
const semver = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (typeof canonicalVersion !== "string" || !semver.test(canonicalVersion)) {
  fail(`package.json version ${JSON.stringify(canonicalVersion)} is not valid semver`);
}

const versions = new Map([
  ["package.json", canonicalVersion],
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  [
    "src-tauri/Cargo.toml",
    cargoManifestVersion(read("src-tauri/Cargo.toml"), "src-tauri/Cargo.toml"),
  ],
  [
    "src-tauri/Cargo.lock (namehold-wallet)",
    tomlPackageVersion(
      read("src-tauri/Cargo.lock"),
      "namehold-wallet",
      "src-tauri/Cargo.lock",
    ),
  ],
]);

for (const [source, version] of versions) {
  if (version !== canonicalVersion) {
    fail(`${source} is ${JSON.stringify(version)}; expected ${canonicalVersion}`);
  }
}

const frontendVersionSource = read("src/lib/appVersion.ts");
if (
  !frontendVersionSource.includes('from "../../package.json"') ||
  !frontendVersionSource.includes("export const APP_VERSION = packageMetadata.version")
) {
  fail("src/lib/appVersion.ts must export APP_VERSION directly from package.json");
}

const frontendConsumers = [
  {
    path: "src/components/Layout.tsx",
    import: 'from "../lib/appVersion"',
    use: "v{APP_VERSION}",
  },
  {
    path: "src/components/AboutPage.tsx",
    import: 'from "../lib/appVersion"',
    use: "Version {APP_VERSION}",
  },
  {
    path: "src/lib/webqa-mock.ts",
    import: 'from "./appVersion"',
    use: "current_version: () => APP_VERSION",
  },
];

for (const consumer of frontendConsumers) {
  const source = read(consumer.path);
  if (!source.includes(consumer.import) || !source.includes(consumer.use)) {
    fail(`${consumer.path} must render/report the shared APP_VERSION`);
  }
}

const expectedVersion = process.env.EXPECTED_VERSION;
if (expectedVersion && expectedVersion !== canonicalVersion) {
  fail(`EXPECTED_VERSION is ${expectedVersion}; checked-in version is ${canonicalVersion}`);
}

const releaseTag =
  process.env.RELEASE_TAG ||
  (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
if (releaseTag && releaseTag !== `v${canonicalVersion}`) {
  fail(`release tag is ${releaseTag}; expected v${canonicalVersion}`);
}

if (!process.exitCode) {
  console.log(`version consistency check passed: ${canonicalVersion}`);
}
