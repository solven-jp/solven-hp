import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contract = JSON.parse(fs.readFileSync(path.join(appRoot, "deploy/staging-release-contract.json"), "utf8"));

test("staging release contract blocks current revision reuse and requires immutable provenance", () => {
  assert.equal(contract.status, "LOCAL_CONTRACT_ONLY");
  assert.equal(contract.source_provenance.current_revision_reuse, "forbidden");
  assert.equal(contract.source_provenance.required_source_tree_state, "clean");
  assert.deepEqual(contract.source_provenance.required_release_metadata.sort(), ["cloud_run_image_digest", "cloud_run_revision", "hosting_release_id", "source_commit_sha"]);
});

test("staging release contract pins the audited target and same-origin API rewrite", () => {
  assert.deepEqual(contract.target, {
    project_id: "solven-owned-site-stg-d3e6",
    hosting_site: "solven-owned-site-stg-d3e6",
    cloud_run_service: "solven-owned-site-stg",
    cloud_run_region: "asia-northeast1"
  });
  assert.deepEqual(contract.hosting_plan.rewrites, [{
    source: "/api/**",
    run: { service_id: "solven-owned-site-stg", region: "asia-northeast1" }
  }]);
  assert.match(contract.external_actions, /authorizes no Cloud, IAM, Secret Manager, Firestore, Hosting, or deploy action/);
});

test("staging release contract permits only reference names for required secrets", () => {
  assert.deepEqual(contract.environment_contract.secret_manager_references_only, [
    "SOLVEN_SECRET_MANAGER_REF",
    "SOLVEN_SECRET_NAMESPACE",
    "SOLVEN_LEAD_STORE_SECRET_REF",
    "SOLVEN_BACKUP_TARGET_REF"
  ]);
  assert.equal(contract.environment_contract.prohibited.includes("secret_values_in_source_or_build"), true);
  assert.equal(contract.environment_contract.prohibited.includes("production_data_connection"), true);
});

test("staging environment values fail closed to the approved adapter and safety policy", () => {
  assert.deepEqual(contract.environment_contract.required_values, {
    SOLVEN_RUNTIME_ENVIRONMENT: "staging",
    SOLVEN_STAGING: "true",
    SOLVEN_NOINDEX: "true",
    SOLVEN_GA4_ENABLED: "false",
    SOLVEN_LEAD_STORE_ADAPTER: "staging-approved",
    SOLVEN_OUTBOX_ADAPTER: "staging-approved",
    SOLVEN_NOTIFICATION_ADAPTER: "disabled",
    SOLVEN_SESSION_ADAPTER: "distributed-approved",
    SOLVEN_RATE_LIMITER_ADAPTER: "distributed-approved-or-edge-approved",
    SOLVEN_FIRESTORE_PROJECT_ID: "solven-owned-site-stg-d3e6"
  });
});

test("staging defaults disable the public contact submission path", () => {
  const defaults = JSON.parse(fs.readFileSync(path.join(appRoot, "deploy/staging.defaults.json"), "utf8"));
  const checklist = JSON.parse(fs.readFileSync(path.join(appRoot, "deploy/staging.checklist.json"), "utf8"));
  const source = fs.readFileSync(path.join(appRoot, "public/index.html"), "utf8");
  assert.equal(defaults.requirements.contact_submission, "disabled");
  assert.equal(checklist.gates.some((gate) => gate.id === "staging_contact_submission_disabled" && gate.required), true);
  for (const id of ["contact-company", "contact-name", "contact-email", "contact-phone", "contact-service", "contact-timing", "contact-message", "contact-privacy-consent"]) {
    assert.match(source, new RegExp(`id="${id}"[^>]*\\bdisabled`));
  }
});

test("staging retention requires TTL on every data-bearing collection group", () => {
  assert.deepEqual(contract.firestore_ttl_policy.collection_groups, [
    "solven_owned_site_staging_leads",
    "solven_owned_site_staging_idempotency",
    "solven_owned_site_staging_receipts",
    "solven_owned_site_staging_outbox",
    "solven_owned_site_staging_sessions",
    "solven_owned_site_staging_rate_limits"
  ]);
  assert.equal(contract.firestore_ttl_policy.field, "purge_at");
  assert.equal(contract.firestore_ttl_policy.required_before_synthetic_data, true);
  assert.match(contract.firestore_ttl_policy.verification, /asynchronous/);
});

test("Hosting rewrite and security headers stay pinned", () => {
  assert.deepEqual(contract.hosting_plan, {
    public_directory: "dist",
    noindex: true,
    rewrites: [{ source: "/api/**", run: { service_id: "solven-owned-site-stg", region: "asia-northeast1" } }],
    required_headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    },
    apply_preconditions: contract.hosting_plan.apply_preconditions
  });
  assert.equal(contract.hosting_plan.apply_preconditions.length, 3);
  assert.match(contract.hosting_plan.apply_preconditions[0], /Owner approves/);
});

test("rollback keeps the exact Hosting release and Cloud Run revision/digest evidence", () => {
  assert.deepEqual(contract.rollback_plan.required_recorded_identifiers, ["hosting_release_id", "cloud_run_revision", "cloud_run_image_digest"]);
  assert.match(contract.rollback_plan.before_apply, /current Hosting release ID and Cloud Run revision/);
  assert.match(contract.rollback_plan.rollback, /recorded Hosting release.*recorded Cloud Run revision/);
  assert.deepEqual(contract.rollback_plan.verification, ["Hosting-origin /api/health", "noindex response", "synthetic lead E2E", "three-browser smoke test"]);
});

test("Secret Manager references require numeric immutable versions and reject latest", () => {
  const policy = contract.environment_contract.secret_reference_policy;
  const referenceName = new RegExp(policy.reference_name_pattern);
  const resolvedVersion = new RegExp(policy.resolved_secret_version_pattern);
  assert.equal(referenceName.test("staging/solven-owned-site/lead-store"), true);
  assert.equal(resolvedVersion.test("projects/solven-owned-site-stg-d3e6/secrets/lead-store/versions/7"), true);
  assert.equal(resolvedVersion.test("projects/solven-owned-site-stg-d3e6/secrets/lead-store/versions/latest"), false);
  assert.equal(resolvedVersion.test("projects/solven-owned-site-stg-d3e6/secrets/lead-store"), false);
  assert.equal(policy.required_version_selector, "numeric-version");
  assert.deepEqual(policy.forbidden_version_aliases, ["latest"]);
  assert.equal(policy.resolved_secret_values_in_release_artifacts, "forbidden");
});
