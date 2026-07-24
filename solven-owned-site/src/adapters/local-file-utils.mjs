import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const waitCell = new Int32Array(new SharedArrayBuffer(4));

export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, value, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

export function safeJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function withRuntimeLock(runtimeDir, scope, operation, { timeoutMs = 5_000 } = {}) {
  const locks = path.join(runtimeDir, ".locks");
  fs.mkdirSync(locks, { recursive: true, mode: 0o700 });
  const lockFile = path.join(locks, `${scope}.lock`);
  const deadline = Date.now() + timeoutMs;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    } catch (error) {
      if (error.code !== "EEXIST" || Date.now() >= deadline) throw new Error("local_store_lock_unavailable");
      Atomics.wait(waitCell, 0, 0, 10);
    }
  }
  try {
    return operation();
  } finally {
    fs.closeSync(descriptor);
    try { fs.unlinkSync(lockFile); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function safeCode(value, fallback = "adapter_error") {
  const candidate = String(value || "");
  return /^[a-z0-9_:-]{1,80}$/i.test(candidate) ? candidate : fallback;
}
