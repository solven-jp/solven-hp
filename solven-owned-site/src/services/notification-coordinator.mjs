import crypto from "node:crypto";
import { assertLeadStore } from "../contracts/lead-store.mjs";
import { assertNotificationOutbox, notificationOutboxId } from "../contracts/notification-outbox.mjs";

export const NOTIFICATION_RETRY_DELAYS_MS = Object.freeze([60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000]);

function failureCode(error) {
  return /^[a-z0-9_:-]{1,80}$/i.test(String(error?.code || "")) ? String(error.code) : "adapter_delivery_failed";
}

function summary(record, deliveryKey) {
  return {
    lead_id: record.lead_id,
    received_at: record.received_at,
    service: record.service,
    status: record.status,
    delivery_key: deliveryKey
  };
}

function adapterName(notifier) {
  return /^[a-z0-9_-]{1,40}$/.test(String(notifier?.name || "")) ? notifier.name : "unknown";
}

function deliveryStatus(receipt) {
  if (!/^[A-Z0-9_]{1,40}$/.test(String(receipt?.status || ""))) {
    const error = new Error("invalid_adapter_result");
    error.code = "invalid_adapter_result";
    throw error;
  }
  return receipt.status;
}

export class NotificationCoordinator {
  constructor({ leadStore, outbox, notifier, now = () => new Date(), workerId = `worker-${crypto.randomUUID()}`, eventSink }) {
    this.leadStore = assertLeadStore(leadStore);
    this.outbox = assertNotificationOutbox(outbox);
    this.notifier = notifier;
    this.now = now;
    this.workerId = workerId;
    this.eventSink = eventSink || ((event) => this.leadStore.recordEvent?.(event));
  }

  async recordEvent(event) {
    try { await this.eventSink(event); } catch { /* Observability failure must not trigger duplicate provider delivery. */ }
  }

  async notificationStatus(record) {
    const state = await this.outbox.getStatus(notificationOutboxId(record.lead_id));
    if (state?.status !== "delivered" || !/^[A-Z0-9_]{1,40}$/.test(String(state.delivery_status || ""))) {
      return record.notification_status || "PENDING";
    }
    if (record.notification_status !== state.delivery_status) {
      try { await this.leadStore.updateNotificationState(record.lead_id, state.delivery_status); }
      catch {
        await this.recordEvent({
          event: "notification_projection_failed",
          lead_id: record.lead_id,
          at: this.now().toISOString(),
          status: "reconciliation_required"
        });
      }
    }
    return state.delivery_status;
  }

  async deliver(record, { force = false } = {}) {
    const outboxId = notificationOutboxId(record.lead_id);
    const item = await this.outbox.claim(outboxId, { workerId: this.workerId, now: this.now(), force });
    if (!item) return { status: await this.notificationStatus(await this.leadStore.findByLeadId(record.lead_id) || record) };
    const attempt = item.attempts + 1;
    let status;
    try {
      const receipt = await this.notifier.notify(summary(record, item.delivery_key));
      status = deliveryStatus(receipt);
      await this.outbox.recordSendResult(outboxId, { attempts: attempt, status, at: this.now() });
    } catch (error) {
      const at = this.now();
      const reasonCode = failureCode(error);
      const terminal = attempt > NOTIFICATION_RETRY_DELAYS_MS.length;
      if (terminal) {
        await this.outbox.moveToDeadLetter(outboxId, { attempts: attempt, reasonCode, at });
        await this.leadStore.moveToDeadLetter(record.lead_id, { attempts: attempt, reasonCode });
      } else {
        const nextAttemptAt = new Date(at.getTime() + NOTIFICATION_RETRY_DELAYS_MS[attempt - 1]).toISOString();
        await this.outbox.scheduleRetry(outboxId, { attempts: attempt, reasonCode, nextAttemptAt });
        await this.leadStore.markRetry(record.lead_id, { attempts: attempt, reasonCode, nextAttemptAt });
      }
      await this.recordEvent({
        event: "notification_failed",
        lead_id: record.lead_id,
        at: at.toISOString(),
        adapter: adapterName(this.notifier),
        reason_code: reasonCode,
        attempts: attempt
      });
      return { status: terminal ? "DEAD_LETTER" : "RETRY_PENDING" };
    }
    try {
      await this.leadStore.updateNotificationState(record.lead_id, status);
    } catch {
      await this.recordEvent({
        event: "notification_projection_failed",
        lead_id: record.lead_id,
        at: this.now().toISOString(),
        adapter: adapterName(this.notifier),
        status: "reconciliation_required"
      });
    }
    await this.recordEvent({
      event: "notification_recorded",
      lead_id: record.lead_id,
      at: this.now().toISOString(),
      adapter: adapterName(this.notifier),
      status
    });
    return { status };
  }

  async retryPending({ force = false } = {}) {
    const results = [];
    for (const item of await this.outbox.listPending({ now: this.now(), includeFuture: force })) {
      const record = await this.leadStore.findByLeadId(item.lead_id);
      if (!record) continue;
      results.push({ lead_id: item.lead_id, ...(await this.deliver(record, { force })) });
    }
    return results;
  }
}
