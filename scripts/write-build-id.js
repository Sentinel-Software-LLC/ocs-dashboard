#!/usr/bin/env node
/**
 * A5: Writes build ID to public/build-id.json for DApp allowlist.
 * Run as postbuild. Reads .next/BUILD_ID (from generateBuildId).
 */
const fs = require('fs');
const path = require('path');

const nextDir = path.join(process.cwd(), '.next');
const buildIdPath = path.join(nextDir, 'BUILD_ID');
const outPath = path.join(process.cwd(), 'public', 'build-id.json');

let buildId;
try {
  buildId = fs.readFileSync(buildIdPath, 'utf8').trim();
} catch {
  try {
    const { execSync } = require('child_process');
    buildId = execSync('git rev-parse HEAD').toString().trim().slice(0, 12);
  } catch {
    buildId = `build-${Date.now()}`;
  }
}

const publicDir = path.dirname(outPath);
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ buildId }, null, 2));
console.log('A5: Wrote build-id.json:', buildId);
