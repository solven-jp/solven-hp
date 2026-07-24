import assert from "node:assert/strict";
import test from "node:test";
import {
  FirestoreStagingRateLimiter,
  FirestoreStagingSessionStore,
  createStagingFirestore,
  createFirestoreStagingAdapters
} from "../src/adapters/firestore-staging.mjs";
import { verifyProviderContracts } from "./contracts/provider-contract.mjs";

const copy = (value) => value === undefined ? undefined : structuredClone(value);

class Snapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.exists = value !== undefined;
    this.value = copy(value);
  }

  data() {
    return copy(this.value);
  }
}

class Reference {
  constructor(store, collection, id) {
    this.store = store;
    this.collectionName = collection;
    this.id = id;
  }

  key() {
    return `${this.collectionName}/${this.id}`;
  }

  async get() {
    return new Snapshot(this, this.store.rows.get(this.key()));
  }

  async set(value) {
    this.store.rows.set(this.key(), copy(value));
  }

  async delete() {
    this.store.rows.delete(this.key());
  }
}

class Query {
  constructor(store, collection, predicates = [], maximum = Infinity) {
    this.store = store;
    this.collectionName = collection;
    this.predicates = predicates;
    this.maximum = maximum;
  }

  where(field, operator, value) {
    return new Query(this.store, this.collectionName, [...this.predicates, { field, operator, value }], this.maximum);
  }

  limit(maximum) {
    return new Query(this.store, this.collectionName, this.predicates, maximum);
  }

  async get() {
    const prefix = `${this.collectionName}/`;
    const matches = [...this.store.rows.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => new Snapshot(new Reference(this.store, this.collectionName, key.slice(prefix.length)), value))
      .filter((snapshot) => this.predicates.every(({ field, operator, value }) => {
        const actual = snapshot.data()[field];
        if (operator === "==") return actual === value;
        if (operator === "<") return actual < value;
        if (operator === "<=") return actual <= value;
        throw new Error(`unsupported_fake_query:${operator}`);
      }));
    return { docs: matches.slice(0, this.maximum) };
  }
}

class Collection extends Query {
  constructor(store, collection) {
    super(store, collection);
  }

  doc(id) {
    return new Reference(this.store, this.collectionName, String(id));
  }
}

class Transaction {
  constructor(store) {
    this.store = store;
  }

  async get(reference) {
    return reference.get();
  }

  set(reference, value) {
    this.store.rows.set(reference.key(), copy(value));
  }

  create(reference, value) {
    if (this.store.rows.has(reference.key())) throw Object.assign(new Error("already_exists"), { code: "already_exists" });
    this.store.rows.set(reference.key(), copy(value));
  }

  delete(reference) {
    this.store.rows.delete(reference.key());
  }
}

class FakeFirestore {
  rows = new Map();

  collection(name) {
    return new Collection(this, name);
  }

  async runTransaction(callback) {
    return callback(new Transaction(this));
  }
}

test("Firestore staging adapters pass the provider contract without local filesystem state", async () => {
  const adapters = createFirestoreStagingAdapters({ firestore: new FakeFirestore() });
  await verifyProviderContracts(adapters);
  assert.equal(adapters.leadStore.name, "firestore-staging");
  assert.equal(adapters.outbox.name, "firestore-staging");
});

test("Firestore staging rejects a non-staging project before creating a client", () => {
  assert.throws(() => createStagingFirestore({ projectId: "production-project" }), /staging_firestore_project_id_required/);
});

test("Firestore staging session and rate-limit stores are shared across adapter instances", async () => {
  const firestore = new FakeFirestore();
  const sessionA = new FirestoreStagingSessionStore({ firestore });
  const sessionB = new FirestoreStagingSessionStore({ firestore });
  await sessionA.create("5d37d89a-3b9e-4ae6-a926-0dc9b42c3c92", { csrf: "csrf", expires: Date.now() + 60_000 });
  assert.deepEqual(await sessionB.get("5d37d89a-3b9e-4ae6-a926-0dc9b42c3c92"), { csrf: "csrf", expires: (await sessionA.get("5d37d89a-3b9e-4ae6-a926-0dc9b42c3c92")).expires });

  const limiterA = new FirestoreStagingRateLimiter({ firestore, limit: 1, networkLimit: 1 });
  const limiterB = new FirestoreStagingRateLimiter({ firestore, limit: 1, networkLimit: 1 });
  const input = { key: "a".repeat(64), dimensions: { session: "b".repeat(64), network: "c".repeat(64) } };
  assert.equal((await limiterA.consume(input)).allowed, true);
  assert.equal((await limiterB.consume(input)).allowed, false);
  const sessionRecord = firestore.rows.get("solven_owned_site_staging_sessions/5d37d89a-3b9e-4ae6-a926-0dc9b42c3c92");
  const rateRecord = firestore.rows.get(`solven_owned_site_staging_rate_limits/session-${"b".repeat(64)}`);
  assert.equal(sessionRecord.purge_at instanceof Date, true);
  assert.equal(rateRecord.purge_at instanceof Date, true);
});
