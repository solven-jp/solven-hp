import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const contractDocuments = [
  "docs/PRODUCTION_ADAPTER_SPEC.md",
  "docs/ARCHITECTURE.md",
  "docs/API_AND_DATA_CONTRACT.md",
  "docs/BROWSER_SECURITY_RELEASE_QA.md",
  "docs/OPERATIONS_INCIDENT_ROLLBACK.md",
  "docs/SECURITY_DEPLOYMENT_CONTRACT.md",
  "docs/MIGRATION_GUIDE.md",
  "../../reports/solven_canonical_integration/VERIFICATION_REPORT.md",
  "../../reports/solven_canonical_integration/CURRENT_SITE_RUNTIME_GAP.md"
];

test("code and handoff documents share the receipt-only public contract", () => {
  const documents = contractDocuments.map((relative) => fs.readFileSync(path.resolve(appRoot, relative), "utf8")).join("\n");
  assert.match(documents, /内部`?lead_id`?/);
  assert.match(documents, /公開`?receipt_id`?/);
  assert.match(documents, /同じidempotency key[^\n]*同じ`receipt_id`/);
  assert.match(documents, /公開照会(?:API|route)/);
  assert.doesNotMatch(documents, /Lead ID表示/);
  assert.doesNotMatch(documents, /lead_idを顧客画面へ表示/);
  assert.doesNotMatch(documents, /API(?:成功)?レスポンスにlead_idを含める/);
  assert.doesNotMatch(documents, /連番を受付番号として使う/);
});

test("the HTTP success projection has exactly the public receipt fields", async () => {
  const { publicLeadReceipt } = await import("../src/contracts/lead-store.mjs");
  const response = publicLeadReceipt({
    lead_id: "LEAD-2026-0001",
    receipt_id: "SV-7K4M-9Q2R-ABCDE",
    status: "NEW",
    notification_status: "PENDING",
    email: "fixture@example.invalid"
  });
  assert.deepEqual(Object.keys(response), ["receipt_id", "status", "notification_status"]);
  assert.doesNotMatch(JSON.stringify(response), /lead_id|LEAD-|fixture@example\.invalid/);
});
