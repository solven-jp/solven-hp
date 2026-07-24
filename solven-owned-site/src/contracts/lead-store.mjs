export const LEAD_STORE_OPERATIONS = Object.freeze([
  "create",
  "findByIdempotencyKey",
  "findByLeadId",
  "reserveReceiptId",
  "updateNotificationState",
  "markRetry",
  "moveToDeadLetter",
  "listRetentionCandidates",
  "deleteOrAnonymize"
]);

export function assertLeadStore(adapter) {
  if (!adapter || typeof adapter !== "object") throw new TypeError("lead_store_required");
  for (const operation of LEAD_STORE_OPERATIONS) {
    if (typeof adapter[operation] !== "function") throw new TypeError(`lead_store_operation_missing:${operation}`);
  }
  return adapter;
}

export function publicLeadReceipt(record) {
  if (!record || typeof record.receipt_id !== "string") throw new TypeError("receipt_id_required");
  return {
    receipt_id: record.receipt_id,
    status: record.status,
    notification_status: record.notification_status
  };
}
