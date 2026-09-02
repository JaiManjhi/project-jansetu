/**
 * Offline submission queue — PRD §6.
 *
 * Acceptance: a submission made with no connection is queued, a visible
 * "queued, will send" state is shown, and it retries automatically on
 * reconnect. This is the storage and flush half; the visible state lives in
 * the submission page.
 *
 * IndexedDB rather than localStorage: submissions can carry media URLs and
 * arbitrary text, localStorage is synchronous and size-capped, and PRD §6
 * names IndexedDB explicitly.
 *
 * Written against the raw IDB API with small promise wrappers rather than
 * adding a dependency — the surface used here is four operations wide.
 */

const DB_NAME = "jansetu";
const DB_VERSION = 1;
const STORE = "queued-submissions";

/** Payload shape is whatever POST /api/problems accepts. */
export interface QueuedSubmission {
  id?: number;
  body: Record<string, unknown>;
  queuedAt: number;
  /** Bumped on each failed flush, so a permanently bad row cannot spin. */
  attempts: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
  });
}

export function isSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function enqueue(body: Record<string, unknown>): Promise<void> {
  const db = await openDb();
  await tx(db, "readwrite", (store) =>
    store.add({ body, queuedAt: Date.now(), attempts: 0 } satisfies Omit<QueuedSubmission, "id">),
  );
  db.close();
}

export async function listQueued(): Promise<QueuedSubmission[]> {
  const db = await openDb();
  const rows = await tx<QueuedSubmission[]>(db, "readonly", (store) => store.getAll());
  db.close();
  return rows;
}

export async function countQueued(): Promise<number> {
  const db = await openDb();
  const n = await tx<number>(db, "readonly", (store) => store.count());
  db.close();
  return n;
}

async function remove(id: number): Promise<void> {
  const db = await openDb();
  await tx(db, "readwrite", (store) => store.delete(id));
  db.close();
}

async function bumpAttempts(row: QueuedSubmission): Promise<void> {
  const db = await openDb();
  await tx(db, "readwrite", (store) => store.put({ ...row, attempts: row.attempts + 1 }));
  db.close();
}

/**
 * A row rejected with a 4xx this many times is dropped.
 *
 * Only 4xx counts. That distinction matters more than it looks: a 4xx means
 * this particular submission is malformed and will never become a 200, so
 * retrying forever would block everything queued behind it. A 5xx means the
 * server is having a bad day — during the Atlas outage this queue was built
 * under, every flush returned 503 — and counting those would quietly delete a
 * citizen's report for the crime of being submitted at the wrong moment.
 * Transient failures therefore leave `attempts` untouched and simply wait.
 */
const MAX_ATTEMPTS = 5;

export interface FlushResult {
  sent: number;
  remaining: number;
  dropped: number;
}

/**
 * Attempts to send everything queued, oldest first.
 *
 * Stops at the first network failure rather than burning through the whole
 * queue while offline — the connection is either there or it is not.
 */
export async function flushQueue(): Promise<FlushResult> {
  if (!isSupported()) return { sent: 0, remaining: 0, dropped: 0 };

  const rows = (await listQueued()).sort((a, b) => a.queuedAt - b.queuedAt);
  let sent = 0;
  let dropped = 0;

  for (const row of rows) {
    if (row.id === undefined) continue;

    let response: Response;
    try {
      response = await fetch("/api/problems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(row.body),
      });
    } catch {
      // Still offline. Leave this row and everything after it untouched.
      break;
    }

    if (response.ok) {
      await remove(row.id);
      sent++;
      continue;
    }

    // Server trouble, not a bad submission. Stop and try the whole queue
    // again later — do not count it against the row, and do not burn through
    // the rest of the queue against a server that is already failing.
    if (response.status >= 500) break;

    // A 4xx will not become a 200 on its own.
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await remove(row.id);
      dropped++;
    } else {
      await bumpAttempts(row);
    }
  }

  return { sent, remaining: await countQueued(), dropped };
}
