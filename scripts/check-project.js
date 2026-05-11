const fs = require("node:fs");
const path = require("node:path");

const requiredFiles = [
  "src/main.js",
  "src/collector-extractors.js",
  "src/preload.js",
  "src/renderer/index.html",
  "src/renderer/styles.css",
  "src/renderer/renderer.js",
  "assets/icon.png",
  "docs/screenshot.png",
  "extension/manifest.json",
  "extension/background.js",
  "extension/content.js",
  "extension/popup.js",
  "extension/popup.html",
  "scripts/capture-readme-screenshot.js",
  "scripts/test-embedded-collector.js"
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(process.cwd(), file)));

if (missing.length) {
  console.error(`Missing files:\n${missing.join("\n")}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "extension/manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) {
  console.error("Extension manifest must use Manifest V3.");
  process.exit(1);
}

console.log("Project structure is valid.");
