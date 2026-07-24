#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalFileLeadStore } from "../src/adapters/local-file-lead-store.mjs";
import { LocalFileNotificationOutbox } from "../src/adapters/local-file-notification-outbox.mjs";
import { LocalFileNotificationAdapter } from "../src/adapters/local-file-notifier.mjs";
import { NotificationCoordinator } from "../src/services/notification-coordinator.mjs";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtimeDir = path.resolve(process.env.SOLVEN_SITE_RUNTIME_DIR || path.join(appRoot, "runtime"));
const leadStore = new LocalFileLeadStore({ runtimeDir });
const outbox = new LocalFileNotificationOutbox({ runtimeDir });
const notifier = new LocalFileNotificationAdapter({ runtimeDir });
const coordinator = new NotificationCoordinator({ leadStore, outbox, notifier });
const results = await coordinator.retryPending({ force: process.argv.includes("--force") });
process.stdout.write(`${JSON.stringify({ retried: results.length, results })}\n`);
