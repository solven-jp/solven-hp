#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const supplied = process.argv[2];
const bundleRoot = path.resolve(supplied || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const required = [
  "dist/index.html",
  "dist/assets/solven-logo-symbol.svg",
  "dist/favicon.svg",
  "dist/og-image.png",
  "dist/robots.txt",
  "dist/sitemap.xml",
  "server.mjs",
  "src/contracts/lead-store.mjs",
  "src/contracts/notification-outbox.mjs",
  "src/contracts/rate-limiter.mjs",
  "deploy/manifest.json",
  "config/environment.schema.json",
  ".env.example",
  "SOURCE_COMMIT_SHA",
  "RELEASE_ID",
  "release.json",
  "migration-guide.md",
  "staging-checklist.json",
  "production-checklist.json",
  "rollback-guide.md",
  "tests/adapter-contract.test.mjs",
  "scripts/validate-environment-schema.mjs",
  "sbom.cdx.json",
  "dependencies.json",
  "licenses.md",
  "known-limitations.md",
  "docs/PRODUCTION_PORT_AND_RELEASE_PLAN.md",
  "docs/RECOMMENDED_PRODUCTION_STACK.md",
  "excluded-files.md",
  "checksums.sha256"
];
const forbiddenParts = new Set(["release", "runtime", "playwright-report", "test-results", "design-concepts", "screenshots", "logs", "node_modules", "credentials"]);
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const relative = path.relative(bundleRoot, file).split(path.sep).join("/");
    assert.equal(relative.startsWith("../") || path.isAbsolute(relative), false, `path_traversal:${relative}`);
    assert.equal(forbiddenParts.has(entry.name), false, `forbidden_path:${relative}`);
    const stat = fs.lstatSync(file);
    assert.equal(stat.isSymbolicLink(), false, `symlink_forbidden:${relative}`);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`unsupported_file_type:${relative}`);
  }
}

walk(bundleRoot);
for (const relative of required) assert.equal(fs.existsSync(path.join(bundleRoot, relative)), true, `required_file_missing:${relative}`);
assert.equal(files.includes(".env"), false, "resolved_env_forbidden");
assert.equal(files.some((file) => file.endsWith(".log") || file.endsWith(".pem") || file.endsWith(".key")), false, "sensitive_extension_forbidden");

const checksumLines = fs.readFileSync(path.join(bundleRoot, "checksums.sha256"), "utf8").trim().split("\n").filter(Boolean);
const expected = new Map(checksumLines.map((line) => {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  assert.ok(match, `invalid_checksum_line:${line}`);
  return [match[2], match[1]];
}));
const contentFiles = files.filter((file) => file !== "checksums.sha256").sort();
assert.deepEqual([...expected.keys()].sort(), contentFiles, "checksum_inventory_mismatch");
for (const relative of contentFiles) {
  const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(bundleRoot, relative))).digest("hex");
  assert.equal(digest, expected.get(relative), `checksum_mismatch:${relative}`);
}

const textExtensions = new Set([".js", ".mjs", ".json", ".md", ".txt", ".html", ".css", ".example", ""]);
const secretPattern = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk_(?:live|test)_[A-Za-z0-9]{16,})/;
const absolutePathPattern = /(?:\/Users\/[^\s"'`]+|\/home\/[^\s"'`]+|[A-Za-z]:\\Users\\[^\s"']+|file:\/\/)/;
for (const relative of contentFiles) {
  if (!textExtensions.has(path.extname(relative)) && !relative.endsWith(".env.example")) continue;
  const text = fs.readFileSync(path.join(bundleRoot, relative), "utf8");
  assert.doesNotMatch(text, secretPattern, `secret_pattern:${relative}`);
  assert.doesNotMatch(text, absolutePathPattern, `absolute_path:${relative}`);
}

const release = JSON.parse(fs.readFileSync(path.join(bundleRoot, "release.json"), "utf8"));
assert.equal(release.source_commit_sha, fs.readFileSync(path.join(bundleRoot, "SOURCE_COMMIT_SHA"), "utf8").trim());
assert.equal(release.release_id, fs.readFileSync(path.join(bundleRoot, "RELEASE_ID"), "utf8").trim());
assert.match(release.source_commit_sha, /^[a-f0-9]{40,64}$/i, "release_source_commit_invalid");
assert.equal(["clean", "uncommitted-validation"].includes(release.source_tree_state), true, "release_source_tree_state_invalid");
JSON.parse(fs.readFileSync(path.join(bundleRoot, "config/environment.schema.json"), "utf8"));
JSON.parse(fs.readFileSync(path.join(bundleRoot, "deploy/manifest.json"), "utf8"));
JSON.parse(fs.readFileSync(path.join(bundleRoot, "staging-checklist.json"), "utf8"));
JSON.parse(fs.readFileSync(path.join(bundleRoot, "production-checklist.json"), "utf8"));
const runtimeConfig = JSON.parse(fs.readFileSync(path.join(bundleRoot, "dist/data/runtime-config.json"), "utf8"));
assert.equal(runtimeConfig.environment, "staging", "bundle_runtime_environment_must_be_staging");
assert.equal(runtimeConfig.analytics?.enabled, false, "bundle_ga4_must_be_disabled");
for (const relative of contentFiles.filter((file) => file.startsWith("dist/") && file.endsWith(".html"))) {
  assert.match(fs.readFileSync(path.join(bundleRoot, relative), "utf8"), /<meta name="robots" content="noindex,nofollow">/, `bundle_noindex_required:${relative}`);
}
assert.equal(fs.readFileSync(path.join(bundleRoot, "dist/robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n", "bundle_robots_must_disallow");
assert.match(fs.readFileSync(path.join(bundleRoot, "dist/sitemap.xml"), "utf8"), /<loc>https:\/\/solven\.jp\/<\/loc>/, "bundle_sitemap_origin_invalid");
const ogImage = fs.readFileSync(path.join(bundleRoot, "dist/og-image.png"));
assert.equal(ogImage.toString("hex", 0, 8), "89504e470d0a1a0a", "bundle_og_image_not_png");
assert.equal(ogImage.readUInt32BE(16), 1200, "bundle_og_image_width_invalid");
assert.equal(ogImage.readUInt32BE(20), 630, "bundle_og_image_height_invalid");
process.stdout.write(`portable-bundle: PASS (${contentFiles.length} checksummed files)\n`);
