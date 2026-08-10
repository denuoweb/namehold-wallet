#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"),
);

const repository = process.env.RELEASE_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
  console.error(
    "release authority check failed: set RELEASE_REPOSITORY (or GITHUB_REPOSITORY) to owner/repository",
  );
  process.exit(1);
}

const endpoints = config.plugins?.updater?.endpoints;
if (!Array.isArray(endpoints) || endpoints.length !== 1) {
  console.error(
    `release authority check failed: expected exactly one updater endpoint; found ${
      Array.isArray(endpoints) ? endpoints.length : 0
    }`,
  );
  process.exit(1);
}

let endpoint;
try {
  endpoint = new URL(endpoints[0]);
} catch {
  console.error("release authority check failed: updater endpoint is not a valid URL");
  process.exit(1);
}

const match = endpoint.pathname.match(
  /^\/([^/]+)\/([^/]+)\/releases\/(?:latest\/download|download\/[^/]+)\//,
);
if (endpoint.protocol !== "https:" || endpoint.hostname !== "github.com" || !match) {
  console.error(
    "release authority check failed: updater endpoint must be an HTTPS GitHub Release download URL",
  );
  process.exit(1);
}

const updateRepository = `${match[1]}/${match[2]}`;
if (updateRepository.toLowerCase() !== repository.toLowerCase()) {
  console.error(
    `release authority check failed: workflow repository ${repository} does not match updater repository ${updateRepository}`,
  );
  console.error(
    "Resolve repository ownership, updater URL, and signing-key continuity before releasing; do not publish a parallel update channel.",
  );
  process.exit(1);
}

console.log(`release authority check passed: ${repository}`);
