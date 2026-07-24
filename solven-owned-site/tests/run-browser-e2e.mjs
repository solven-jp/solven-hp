#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrowserE2ETarget } from "./browser-e2e-target-policy.mjs";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const suppliedBaseUrl = process.env.SOLVEN_E2E_BASE_URL;
const baseUrl = suppliedBaseUrl || "http://127.0.0.1:4178";
validateBrowserE2ETarget(baseUrl, process.env);
let server = null;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The server may still be binding its local socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`local_e2e_server_not_ready:${baseUrl}`);
}

try {
  if (!suppliedBaseUrl) {
    const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "solven-owned-site-e2e-"));
    server = spawn(process.execPath, ["server.mjs"], {
      cwd: appRoot,
      env: { ...process.env, HOST: "127.0.0.1", PORT: "4178", SOLVEN_SITE_RUNTIME_DIR: runtimeDirectory },
      stdio: ["ignore", "inherit", "inherit"]
    });
    server.once("exit", (code) => {
      if (code !== null && code !== 0) process.stderr.write(`local_e2e_server_exit:${code}\n`);
    });
    await waitForHealth();
  }

  const result = await run(process.execPath, ["tests/browser-e2e.mjs"], {
    cwd: appRoot,
    env: { ...process.env, SOLVEN_E2E_BASE_URL: baseUrl },
    stdio: "inherit"
  });
  if (result.code !== 0) process.exitCode = result.code ?? 1;
} finally {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
