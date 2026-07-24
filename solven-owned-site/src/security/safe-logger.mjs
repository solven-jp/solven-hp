import crypto from "node:crypto";

const allowedFields = new Set(["at", "event", "correlation_id", "lead_id", "adapter", "status", "reason_code", "attempts"]);

export function correlationId(candidate) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(String(candidate || "")) ? String(candidate) : crypto.randomUUID();
}

export function redactLogEvent(event) {
  const result = {};
  for (const [key, value] of Object.entries(event || {})) {
    if (!allowedFields.has(key)) continue;
    if (["event", "adapter", "status", "reason_code"].includes(key) && !/^[A-Za-z0-9_:-]{1,80}$/.test(String(value))) continue;
    if (key === "at" && (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value)) continue;
    if (key === "attempts" && (!Number.isInteger(value) || value < 0 || value > 1000)) continue;
    if (key === "lead_id" && !/^LEAD-\d{4}-\d{4,}$/.test(String(value))) continue;
    if (key === "correlation_id" && !/^[A-Za-z0-9_-]{8,80}$/.test(String(value))) continue;
    result[key] = value;
  }
  return result;
}

export function createSafeLogger(write = () => {}) {
  return {
    event(details) {
      write(redactLogEvent({ at: new Date().toISOString(), ...details }));
    }
  };
}
