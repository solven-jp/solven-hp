#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(appRoot, "../..");

function runNode(script, args = [], options = {}) {
  const result = spawnSync(process.execPath, [path.join(appRoot, script), ...args], { cwd: appRoot, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`bundle_preparation_failed:${script}:${result.stderr || result.stdout}`);
  return result;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error("source_commit_unavailable");
  return result.stdout.trim();
}

function gitDirty() {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error("source_status_unavailable");
  return result.stdout.trim().length > 0;
}

const sourceCommitSha = gitHead();
const requestedSourceSha = argument("--source-sha");
if (requestedSourceSha && requestedSourceSha !== sourceCommitSha) throw new Error("source_commit_override_mismatch");
if (!/^[a-f0-9]{40,64}$/i.test(sourceCommitSha)) throw new Error("source_commit_sha_invalid");
const sourceTreeState = gitDirty() ? "uncommitted-validation" : "clean";
if (sourceTreeState !== "clean" && !process.argv.includes("--allow-dirty")) throw new Error("bundle_source_must_be_clean");
const releaseId = argument("--release-id") || `solven-owned-site-${sourceCommitSha.slice(0, 12)}`;
if (!/^[A-Za-z0-9._-]{1,80}$/.test(releaseId)) throw new Error("release_id_invalid");

runNode("scripts/build-site.mjs", [], {
  env: {
    ...process.env,
    SOLVEN_RUNTIME_ENVIRONMENT: "staging",
    SOLVEN_NOINDEX: "true",
    SOLVEN_GA4_ENABLED: "false",
    SOLVEN_GA4_MEASUREMENT_ID: ""
  }
});
runNode("scripts/check-public-build.mjs");
const bundledRuntimeConfig = JSON.parse(fs.readFileSync(path.join(appRoot, "dist/data/runtime-config.json"), "utf8"));
if (bundledRuntimeConfig.environment !== "staging" || bundledRuntimeConfig.analytics?.enabled !== false) {
  throw new Error("bundle_dist_staging_defaults_required");
}
const defaultParent = path.join(os.tmpdir(), "solven-owned-site-portable");
fs.mkdirSync(defaultParent, { recursive: true, mode: 0o700 });
const output = path.resolve(argument("--output") || path.join(defaultParent, `${releaseId}-${crypto.randomUUID()}`));
if (output === repoRoot || output.startsWith(`${repoRoot}${path.sep}`)) throw new Error("bundle_output_must_be_outside_repository");
if (fs.existsSync(output)) throw new Error("bundle_output_already_exists");
fs.mkdirSync(output, { recursive: false, mode: 0o700 });

function copyFile(from, to) {
  const source = path.join(appRoot, from);
  const target = path.join(output, to || from);
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error(`source_symlink_forbidden:${from}`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, target);
  fs.chmodSync(target, 0o600);
}

function copyDirectory(from, to = from) {
  const sourceRoot = path.join(appRoot, from);
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const sourceRelative = path.join(from, entry.name);
    const targetRelative = path.join(to, entry.name);
    const stat = fs.lstatSync(path.join(appRoot, sourceRelative));
    if (stat.isSymbolicLink()) throw new Error(`source_symlink_forbidden:${sourceRelative}`);
    if (entry.isDirectory()) copyDirectory(sourceRelative, targetRelative);
    else if (entry.isFile()) copyFile(sourceRelative, targetRelative);
    else throw new Error(`source_type_forbidden:${sourceRelative}`);
  }
}

for (const directory of ["dist", "src", "deploy", "config"]) copyDirectory(directory);
for (const file of ["server.mjs", ".env.example"]) copyFile(file);
for (const file of [
  "ARCHITECTURE.md",
  "API_AND_DATA_CONTRACT.md",
  "PRODUCTION_ADAPTER_SPEC.md",
  "SECURITY_DEPLOYMENT_CONTRACT.md",
  "ENVIRONMENT_MATRIX.md",
  "PRODUCTION_HANDOFF_DECISION.md",
  "PRODUCTION_PORT_AND_RELEASE_PLAN.md",
  "RECOMMENDED_PRODUCTION_STACK.md"
]) copyFile(`docs/${file}`, `docs/${file}`);
copyFile("docs/MIGRATION_GUIDE.md", "migration-guide.md");
copyFile("docs/OPERATIONS_INCIDENT_ROLLBACK.md", "rollback-guide.md");
copyFile("docs/KNOWN_LIMITATIONS.md", "known-limitations.md");
copyFile("docs/LICENSES.md", "licenses.md");
copyFile("docs/EXCLUDED_FILES.md", "excluded-files.md");
copyFile("deploy/staging.checklist.json", "staging-checklist.json");
copyFile("deploy/production.checklist.json", "production-checklist.json");
copyFile("tests/adapter-contract.test.mjs", "tests/adapter-contract.test.mjs");
copyFile("tests/contracts/provider-contract.mjs", "tests/contracts/provider-contract.mjs");
copyFile("tests/helpers/create-lead-worker.mjs", "tests/helpers/create-lead-worker.mjs");
copyFile("scripts/verify-portable-bundle.mjs", "scripts/verify-portable-bundle.mjs");
copyFile("scripts/check-source-syntax.mjs", "scripts/check-source-syntax.mjs");
copyFile("scripts/validate-environment-schema.mjs", "scripts/validate-environment-schema.mjs");

const portablePackage = {
  name: "solven-owned-site-portable-release",
  private: true,
  type: "module",
  scripts: {
    check: "node scripts/check-source-syntax.mjs",
    "validate:environment": "node scripts/validate-environment-schema.mjs",
    "test:contract": "node --test tests/adapter-contract.test.mjs",
    verify: "node scripts/verify-portable-bundle.mjs ."
  }
};
fs.writeFileSync(path.join(output, "package.json"), `${JSON.stringify(portablePackage, null, 2)}\n`, { mode: 0o600 });

const release = {
  schema_version: 1,
  application: "solven-owned-site",
  presentation_version: "v2",
  release_id: releaseId,
  source_commit_sha: sourceCommitSha,
  source_tree_state: sourceTreeState,
  artifact_contract: "provider-neutral-production-handoff"
};
fs.writeFileSync(path.join(output, "release.json"), `${JSON.stringify(release, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(output, "SOURCE_COMMIT_SHA"), `${sourceCommitSha}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(output, "RELEASE_ID"), `${releaseId}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(output, "dependencies.json"), `${JSON.stringify({ runtime: [], development_required_for_bundle_verification: [] }, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(path.join(output, "sbom.cdx.json"), `${JSON.stringify({
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: { component: { type: "application", name: "solven-owned-site", version: releaseId } },
  components: []
}, null, 2)}\n`, { mode: 0o600 });

function files(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...files(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

const checksumLines = files(output).sort().map((file) => {
  const relative = path.relative(output, file).split(path.sep).join("/");
  const digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return `${digest}  ${relative}`;
});
fs.writeFileSync(path.join(output, "checksums.sha256"), `${checksumLines.join("\n")}\n`, { mode: 0o600 });

let verify = spawnSync(process.execPath, [path.join(output, "scripts/verify-portable-bundle.mjs"), output], { encoding: "utf8" });
if (verify.status !== 0) throw new Error(`bundle_verification_failed:${verify.stderr || verify.stdout}`);
const syntax = spawnSync(process.execPath, [path.join(output, "scripts/check-source-syntax.mjs")], { cwd: output, encoding: "utf8" });
if (syntax.status !== 0) throw new Error(`bundle_syntax_check_failed:${syntax.stderr || syntax.stdout}`);
const environment = spawnSync(process.execPath, [path.join(output, "scripts/validate-environment-schema.mjs")], { cwd: output, encoding: "utf8" });
if (environment.status !== 0) throw new Error(`bundle_environment_check_failed:${environment.stderr || environment.stdout}`);
const contract = spawnSync(process.execPath, ["--test", path.join(output, "tests/adapter-contract.test.mjs")], { cwd: output, encoding: "utf8" });
if (contract.status !== 0) throw new Error(`bundle_contract_test_failed:${contract.stderr || contract.stdout}`);

const archive = `${output}.tar.gz`;
const tar = spawnSync("tar", ["-czf", archive, "-C", path.dirname(output), path.basename(output)], { encoding: "utf8" });
if (tar.status !== 0) throw new Error(`bundle_archive_failed:${tar.stderr || tar.stdout}`);
const archiveSha256 = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
const archiveList = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
if (archiveList.status !== 0) throw new Error(`bundle_archive_list_failed:${archiveList.stderr || archiveList.stdout}`);
const archiveRoot = path.basename(output);
for (const entry of archiveList.stdout.split("\n").filter(Boolean)) {
  const normalized = entry.replace(/\/$/, "");
  const parts = normalized.split("/");
  if (path.posix.isAbsolute(normalized) || parts.includes("..") || parts[0] !== archiveRoot) {
    throw new Error("bundle_archive_path_traversal_detected");
  }
}
const extractionParent = fs.mkdtempSync(path.join(os.tmpdir(), "solven-bundle-extracted-"));
const extract = spawnSync("tar", ["-xzf", archive, "-C", extractionParent], { encoding: "utf8" });
if (extract.status !== 0) throw new Error(`bundle_extract_failed:${extract.stderr || extract.stdout}`);
const extractedRoot = path.join(extractionParent, path.basename(output));
verify = spawnSync(process.execPath, [path.join(extractedRoot, "scripts/verify-portable-bundle.mjs"), extractedRoot], { encoding: "utf8" });
if (verify.status !== 0) throw new Error(`extracted_bundle_verification_failed:${verify.stderr || verify.stdout}`);
const extractedSyntax = spawnSync(process.execPath, [path.join(extractedRoot, "scripts/check-source-syntax.mjs")], { cwd: extractedRoot, encoding: "utf8" });
if (extractedSyntax.status !== 0) throw new Error(`extracted_bundle_syntax_check_failed:${extractedSyntax.stderr || extractedSyntax.stdout}`);
const extractedEnvironment = spawnSync(process.execPath, [path.join(extractedRoot, "scripts/validate-environment-schema.mjs")], { cwd: extractedRoot, encoding: "utf8" });
if (extractedEnvironment.status !== 0) throw new Error(`extracted_bundle_environment_check_failed:${extractedEnvironment.stderr || extractedEnvironment.stdout}`);
const extractedContract = spawnSync(process.execPath, ["--test", path.join(extractedRoot, "tests/adapter-contract.test.mjs")], { cwd: extractedRoot, encoding: "utf8" });
if (extractedContract.status !== 0) throw new Error(`extracted_bundle_contract_test_failed:${extractedContract.stderr || extractedContract.stdout}`);
fs.rmSync(extractionParent, { recursive: true, force: false });
process.stdout.write(`${JSON.stringify({ bundle_directory: output, archive, archive_sha256: archiveSha256, release_id: releaseId, source_commit_sha: sourceCommitSha, source_tree_state: sourceTreeState, verification: verify.stdout.trim(), syntax_check: "PASS", environment_check: "PASS", contract_test: "PASS", extracted_verification: "PASS", extracted_syntax_check: "PASS", extracted_environment_check: "PASS", extracted_contract_test: "PASS" })}\n`);
