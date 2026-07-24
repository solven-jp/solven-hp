#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeConfiguration } from "../src/config/environment.mjs";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = JSON.parse(fs.readFileSync(path.join(appRoot, "config/environment.schema.json"), "utf8"));
assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(schema.type, "object");
assert.equal(schema.additionalProperties, false);

function resolvedRule(rule) {
  if (!rule?.$ref) return rule || {};
  const name = rule.$ref.split("/").at(-1);
  return schema.$defs[name];
}

function validateProperties(values, properties = {}) {
  for (const [key, value] of Object.entries(values)) {
    const rule = resolvedRule(properties[key] || schema.properties[key]);
    assert.ok(rule, `unknown_schema_property:${key}`);
    if (rule.type) assert.equal(typeof value, rule.type, `schema_type:${key}`);
    if (rule.const !== undefined) assert.equal(value, rule.const, `schema_const:${key}`);
    if (rule.enum) assert.equal(rule.enum.includes(value), true, `schema_enum:${key}`);
    if (rule.pattern) assert.match(value, new RegExp(rule.pattern), `schema_pattern:${key}`);
    if (rule.minLength !== undefined) assert.equal(value.length >= rule.minLength, true, `schema_min_length:${key}`);
    if (rule.format === "uri") assert.doesNotThrow(() => new URL(value), `schema_uri:${key}`);
  }
}

function validateSchemaObject(values) {
  for (const key of Object.keys(values)) assert.ok(schema.properties[key], `unknown_env_key:${key}`);
  for (const key of schema.required) assert.ok(Object.hasOwn(values, key), `schema_required:${key}`);
  validateProperties(values);
  for (const conditional of schema.allOf || []) {
    const conditions = conditional.if?.properties || {};
    const matches = Object.entries(conditions).every(([key, rule]) => values[key] === rule.const);
    if (!matches) continue;
    for (const key of conditional.then?.required || []) assert.ok(Object.hasOwn(values, key), `schema_conditional_required:${key}`);
    validateProperties(Object.fromEntries(Object.keys(conditional.then?.properties || {}).filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]])), conditional.then?.properties);
  }
}

const example = {};
for (const line of fs.readFileSync(path.join(appRoot, ".env.example"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  assert.ok(separator > 0, `invalid_env_example_line:${line}`);
  const key = line.slice(0, separator);
  assert.equal(Object.hasOwn(example, key), false, `duplicate_env_key:${key}`);
  assert.ok(schema.properties[key], `unknown_env_key:${key}`);
  example[key] = line.slice(separator + 1);
}
for (const key of schema.required) assert.ok(Object.hasOwn(example, key), `missing_required_example_key:${key}`);
assert.doesNotMatch(JSON.stringify(example), /(BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN|password\s*=)/i);
validateSchemaObject(example);
assert.throws(
  () => loadRuntimeConfiguration(example),
  (error) => error.codes.includes("staging_release_id_placeholder_forbidden") && error.codes.includes("staging_source_sha_placeholder_forbidden"),
  ".env.example must fail closed until release metadata placeholders are replaced"
);
loadRuntimeConfiguration({
  ...example,
  SOLVEN_RELEASE_ID: "staging-release-fixture",
  SOLVEN_SOURCE_COMMIT_SHA: "b".repeat(40)
});

const production = {
  SOLVEN_RUNTIME_ENVIRONMENT: "production",
  SOLVEN_PUBLIC_ORIGIN: "https://www.example.invalid",
  SOLVEN_ALLOWED_HOSTS: "www.example.invalid",
  SOLVEN_TRUSTED_PROXY_MODE: "edge",
  SOLVEN_REQUIRE_HTTPS: "true",
  SOLVEN_SECURE_COOKIES: "true",
  SOLVEN_COOKIE_SAME_SITE: "Strict",
  SOLVEN_SESSION_COOKIE_NAME: "solven_session",
  SOLVEN_SESSION_TRANSPORT: "cookie",
  SOLVEN_SESSION_TTL_SECONDS: "1800",
  SOLVEN_CSRF_ENABLED: "true",
  SOLVEN_MAX_BODY_BYTES: "32768",
  SOLVEN_CORS_MODE: "same-origin",
  SOLVEN_HSTS_MAX_AGE: "31536000",
  SOLVEN_LOG_PII: "false",
  SOLVEN_INCIDENT_CORRELATION_HEADER: "x-request-id",
  SOLVEN_LEAD_STORE_ADAPTER: "production-approved",
  SOLVEN_OUTBOX_ADAPTER: "production-approved",
  SOLVEN_NOTIFICATION_ADAPTER: "production-approved",
  SOLVEN_SESSION_ADAPTER: "distributed-approved",
  SOLVEN_RATE_LIMITER_ADAPTER: "distributed-approved",
  SOLVEN_SECRET_MANAGER_REF: "production/secret-manager-reference",
  SOLVEN_SECRET_NAMESPACE: "production/solven-owned-site",
  SOLVEN_LEAD_STORE_SECRET_REF: "production/lead-store-reference",
  SOLVEN_NOTIFICATION_SECRET_REF: "production/notification-reference",
  SOLVEN_NOTIFICATION_DESTINATION_REF: "production/notification-destination-reference",
  SOLVEN_GA4_ENABLED: "false",
  SOLVEN_RETENTION_DAYS: "730",
  SOLVEN_BACKUP_TARGET_REF: "production/backup-reference",
  SOLVEN_STAGING: "false",
  SOLVEN_NOINDEX: "false",
  SOLVEN_RELEASE_ID: "release-fixture",
  SOLVEN_SOURCE_COMMIT_SHA: "a".repeat(40)
};
validateSchemaObject(production);
loadRuntimeConfiguration(production);
assert.throws(() => loadRuntimeConfiguration({ SOLVEN_RUNTIME_ENVIRONMENT: "production" }), /unsafe_runtime_configuration/);
assert.throws(() => loadRuntimeConfiguration({ SOLVEN_CSRF_ENABLED: "yes" }), /invalid_boolean_environment_value/);
process.stdout.write("environment-schema: PASS\n");
