import { LocalFileLeadStore } from "../../src/adapters/local-file-lead-store.mjs";
import { contractLead } from "../contracts/provider-contract.mjs";

const [runtimeDir, idempotencyKey] = process.argv.slice(2);
const store = new LocalFileLeadStore({ runtimeDir });
const result = store.create({ lead: contractLead, receivedAt: new Date("2026-07-18T00:00:00.000Z"), idempotencyKey });
process.stdout.write(`${JSON.stringify({ lead_id: result.record.lead_id, receipt_id: result.record.receipt_id, created: result.created })}\n`);
