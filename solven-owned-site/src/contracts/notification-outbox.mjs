export const NOTIFICATION_OUTBOX_OPERATIONS = Object.freeze([
  "enqueue",
  "claim",
  "recordSendResult",
  "scheduleRetry",
  "moveToDeadLetter",
  "manualRetry",
  "getStatus",
  "listPending"
]);

const outboxIdPattern = /^NOTIFY-LEAD-\d{4}-\d{4,}$/;

export function notificationOutboxId(leadId) {
  const outboxId = `NOTIFY-${leadId}`;
  if (!outboxIdPattern.test(outboxId)) throw new TypeError("invalid_outbox_id");
  return outboxId;
}

export function assertNotificationOutbox(adapter) {
  if (!adapter || typeof adapter !== "object") throw new TypeError("notification_outbox_required");
  for (const operation of NOTIFICATION_OUTBOX_OPERATIONS) {
    if (typeof adapter[operation] !== "function") throw new TypeError(`notification_outbox_operation_missing:${operation}`);
  }
  return adapter;
}
