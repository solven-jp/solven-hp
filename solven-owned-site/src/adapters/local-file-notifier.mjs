import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

export class LocalFileNotificationAdapter {
  name = "local-file";

  constructor({ runtimeDir }) {
    if (!path.isAbsolute(runtimeDir)) throw new Error("runtime_dir_must_be_absolute");
    this.runtimeDir = runtimeDir;
  }

  async notify(summary) {
    const receipt = {
      notification_id: `LOCAL-${crypto.randomUUID()}`,
      lead_id: summary.lead_id,
      received_at: summary.received_at,
      service: summary.service,
      status: "LOCAL_RECORDED",
      destination: "local-review-queue",
      contains_pii: false
    };
    atomicWrite(path.join(this.runtimeDir, "notifications", `${summary.lead_id}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    return receipt;
  }
}
