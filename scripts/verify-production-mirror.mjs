#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mirrorRoot = path.join(repositoryRoot, "production-mirror");
const baselineCommit = "29eecdf381407e5be51e4e97a032e70f1e011170";
const baselineTree = "56c1256bb5c5ed778c1176ae596a9199312c268d";
const expectedFileCount = 22;
const scopeControlPaths = [
  ".gitattributes",
  ".github/workflows/production-mirror-integrity.yml",
  "MIRROR_OPERATIONS.md",
  "production-mirror/INDEPENDENT_REVIEW_RECEIPT.md",
  "production-mirror/README.md",
  "production-mirror/checksums.sha256",
  "production-mirror/release-manifest.json",
  "scripts/verify-production-mirror.mjs"
];
const retiredScopePaths = [".github/CODEOWNERS"];

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function scopeHash(relative, content) {
  if (relative.startsWith("production-mirror/site/")) return sha256(content);
  return sha256(Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"), "utf8"));
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith("--"), `missing_argument:${name}`);
  return value;
}

function relativePath(root, file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  assert.equal(relative.startsWith("../") || path.isAbsolute(relative), false, `path_escape:${relative}`);
  return relative;
}

function walk(root) {
  const files = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const relative = relativePath(root, file);
      const stat = fs.lstatSync(file);
      assert.equal(stat.isSymbolicLink(), false, `symlink_forbidden:${relative}`);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`unsupported_file_type:${relative}`);
    }
  }
  return files.sort();
}

function parseChecksumFile(file) {
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.endsWith("\n"), true, "checksums_newline_required");
  const entries = text.trim().split("\n").filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (site\/(?!.*(?:^|\/)\.\.?(?:\/|$)).+)$/);
    assert.ok(match, `invalid_checksum_line:${line}`);
    return { hash: match[1], path: match[2] };
  });
  assert.equal(entries.length, expectedFileCount, "unexpected_checksum_count");
  const paths = entries.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort(), "checksums_must_be_sorted_by_path");
  assert.equal(new Set(paths).size, paths.length, "duplicate_checksum_path");
  return { text, entries };
}

function decodeCloudflareEmail(encoded) {
  assert.match(encoded, /^(?:[a-f0-9]{2})+$/i, "cloudflare_email_encoding_invalid");
  const key = Number.parseInt(encoded.slice(0, 2), 16);
  let decoded = "";
  for (let index = 2; index < encoded.length; index += 2) {
    decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16) ^ key);
  }
  return decoded;
}

function normalizeCloudflareHtml(buffer) {
  let html = buffer.toString("utf8");
  html = html.replace(/<a\s+[^>]*class="__cf_email__"[^>]*data-cfemail="([a-f0-9]+)"[^>]*>[\s\S]*?<\/a>/gi, (_match, encoded) => decodeCloudflareEmail(encoded));
  html = html.replace(/<script\s+[^>]*data-cfasync="false"[^>]*src="\/cdn-cgi\/scripts\/[^\"]*\/cloudflare-static\/email-decode\.min\.js"[^>]*><\/script>/gi, "");
  return Buffer.from(html, "utf8");
}

function normalizeCloudflareRobots(buffer) {
  let robots = buffer.toString("utf8");
  if (/# BEGIN Cloudflare Managed Content/im.test(robots)) {
    const endMarker = /^# END Cloudflare Managed Content\r?\n\r?\n/im.exec(robots);
    assert.ok(endMarker, "cloudflare_robots_end_marker_missing");
    robots = robots.slice(endMarker.index + endMarker[0].length);
  }
  return Buffer.from(robots, "utf8");
}

function normalizeCloudflareArtifact(entryPath, buffer) {
  if (entryPath.endsWith(".html")) return normalizeCloudflareHtml(buffer);
  if (entryPath === "site/robots.txt") return normalizeCloudflareRobots(buffer);
  return buffer;
}

function verifyComparison(compareRoot, entries) {
  const actualRoot = path.resolve(compareRoot);
  assert.equal(fs.statSync(actualRoot).isDirectory(), true, "compare_root_not_directory");
  for (const entry of entries) {
    const expected = fs.readFileSync(path.join(mirrorRoot, entry.path));
    const actualPath = path.join(actualRoot, entry.path.replace(/^site\//, ""));
    assert.equal(fs.existsSync(actualPath), true, `comparison_file_missing:${entry.path}`);
    const actual = normalizeCloudflareArtifact(entry.path, fs.readFileSync(actualPath));
    assert.equal(actual.equals(expected), true, `comparison_mismatch:${entry.path}`);
  }
  process.stdout.write(`production-mirror live-compare: PASS (${entries.length} files; cloudflare-edge-normalized)\n`);
}

function verifyFormalScope(entries) {
  const scopePath = path.join(mirrorRoot, "FORMAL_REVIEW_SCOPE.sha256");
  const scope = fs.readFileSync(scopePath, "utf8");
  assert.equal(scope.endsWith("\n"), true, "formal_scope_newline_required");
  const parsed = scope.trim().split("\n").filter(Boolean).map((line) => {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    assert.ok(match, `formal_scope_invalid_line:${line}`);
    assert.equal(match[2].startsWith("/") || match[2].includes(".."), false, `formal_scope_path_invalid:${match[2]}`);
    return { hash: match[1], path: match[2] };
  });
  const expectedPaths = [...scopeControlPaths, ...entries.map((entry) => `production-mirror/${entry.path}`)].sort();
  assert.deepEqual(parsed.map((entry) => entry.path), expectedPaths, "formal_scope_inventory_mismatch");
  for (const entry of parsed) {
    const file = path.join(repositoryRoot, entry.path);
    assert.equal(fs.existsSync(file), true, `formal_scope_file_missing:${entry.path}`);
    assert.equal(scopeHash(entry.path, fs.readFileSync(file)), entry.hash, `formal_scope_hash_mismatch:${entry.path}`);
  }
}

function verifyChangedScope(base) {
  if (!base) return;
  assert.match(base, /^[a-f0-9]{40}$/i, "base_sha_invalid");
  const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${base}...HEAD`], { cwd: repositoryRoot, encoding: "utf8" });
  const changed = output.split("\n").filter(Boolean).sort();
  const allowed = new Set([
    "production-mirror/FORMAL_REVIEW_SCOPE.sha256",
    ...scopeControlPaths,
    ...retiredScopePaths,
    ...walk(path.join(mirrorRoot, "site")).map((file) => `production-mirror/site/${file}`)
  ]);
  for (const file of retiredScopePaths) assert.equal(fs.existsSync(path.join(repositoryRoot, file)), false, `retired_scope_path_recreated:${file}`);
  for (const file of changed) assert.equal(allowed.has(file), true, `out_of_scope_change:${file}`);
  assert.ok(changed.length > 0, "empty_pull_request_scope");
}

const manifest = JSON.parse(fs.readFileSync(path.join(mirrorRoot, "release-manifest.json"), "utf8"));
assert.equal(manifest.schema_version, 1, "manifest_schema_version_invalid");
assert.equal(manifest.mirror_role, "deploy-only-static-bundle-mirror", "mirror_role_invalid");
assert.equal(manifest.release_mode, "post-release-source-sync-candidate", "release_mode_invalid");
assert.equal(manifest.deployment?.authorized, false, "deployment_must_remain_unauthorized");
assert.equal(manifest.source?.repository, "solven-jp/solven-windows-clean", "source_repository_invalid");
assert.equal(manifest.source?.commit, baselineCommit, "source_commit_not_pinned_baseline");
assert.equal(manifest.source?.tree, baselineTree, "source_tree_not_pinned_baseline");
assert.equal(manifest.source?.application_path, "apps/solven-owned-site", "source_application_path_invalid");
assert.equal(manifest.source?.static_output_path, "apps/solven-owned-site/dist", "source_output_path_invalid");
assert.equal(manifest.source?.build_command, "npm --prefix apps/solven-owned-site run build:preview-static", "source_build_command_invalid");
assert.deepEqual(manifest.source?.build_environment, {
  SOLVEN_RUNTIME_ENVIRONMENT: "static-preview",
  SOLVEN_NOINDEX: "true",
  SOLVEN_GA4_ENABLED: "false"
}, "source_build_environment_invalid");
assert.equal(manifest.artifact?.path, "site", "artifact_path_invalid");
assert.equal(manifest.artifact?.file_count, expectedFileCount, "artifact_file_count_invalid");
assert.equal(manifest.artifact?.checksum_algorithm, "sha256", "checksum_algorithm_invalid");
assert.equal(manifest.artifact?.checksums, "checksums.sha256", "checksum_file_invalid");
assert.equal(manifest.update_policy?.human_direct_edits, "forbidden", "direct_edit_policy_invalid");
assert.equal(manifest.update_policy?.formal_review_status, "OWNER_AND_INDEPENDENT_REVIEW_REQUIRED", "formal_review_status_invalid");
assert.equal(manifest.review_governance?.github_independent_approval_available, false, "github_independent_approval_must_not_be_claimed");
assert.equal(manifest.review_governance?.codeowners, "intentionally_absent_for_single_owner_repository", "codeowners_governance_invalid");
assert.deepEqual(manifest.review_governance?.formal_gate, [
  "independent_codex_review_receipt_for_exact_candidate_head",
  "explicit_owner_approval_for_same_head"
], "formal_gate_invalid");
assert.equal(fs.existsSync(path.join(repositoryRoot, ".github/CODEOWNERS")), false, "codeowners_must_remain_absent_without_independent_owner");

const checksumFile = path.join(mirrorRoot, "checksums.sha256");
const { text: checksumText, entries } = parseChecksumFile(checksumFile);
assert.equal(sha256(checksumText), manifest.artifact.checksum_inventory_sha256, "checksum_inventory_hash_mismatch");
const artifactFiles = walk(path.join(mirrorRoot, "site"));
assert.deepEqual(artifactFiles, entries.map((entry) => entry.path.replace(/^site\//, "")), "artifact_inventory_mismatch");
for (const entry of entries) {
  const file = path.join(mirrorRoot, entry.path);
  assert.equal(sha256(fs.readFileSync(file)), entry.hash, `artifact_checksum_mismatch:${entry.path}`);
}

const runtime = JSON.parse(fs.readFileSync(path.join(mirrorRoot, "site/data/runtime-config.json"), "utf8"));
assert.equal(runtime.environment, "static-preview", "runtime_environment_invalid");
assert.equal(runtime.analytics?.enabled, false, "analytics_must_remain_disabled");
const robots = fs.readFileSync(path.join(mirrorRoot, "site/robots.txt"), "utf8");
assert.equal(robots, "User-agent: *\nDisallow: /\n", "production_robots_invalid");
const index = fs.readFileSync(path.join(mirrorRoot, "site/index.html"), "utf8");
assert.match(index, /<meta name="robots" content="noindex,nofollow">/, "production_noindex_meta_missing");
assert.match(index, /<link rel="canonical" href="https:\/\/solven\.jp\/">/, "production_canonical_missing");

verifyFormalScope(entries);
verifyChangedScope(argument("--base"));
const compareRoot = argument("--compare-root");
if (compareRoot) verifyComparison(compareRoot, entries);
process.stdout.write(`production-mirror: PASS (${entries.length} files; source=${baselineCommit})\n`);
