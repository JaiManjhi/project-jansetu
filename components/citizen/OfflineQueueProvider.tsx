"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { countQueued, flushQueue, isSupported } from "@/lib/offline-queue";

/**
 * Registers the service worker and drains the offline queue.
 *
 * Flushes on mount and on every `online` event — PRD §6 requires automatic
 * retry on reconnect, not a manual "try again".
 */

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Live online/offline state. Server snapshot is `true`: assuming offline
 *  during SSR would flash a false warning on every first paint. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function useOfflineQueue() {
  const online = useOnlineStatus();
  const [queued, setQueued] = useState(0);
  const [flushing, setFlushing] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupported()) return;
    try {
      setQueued(await countQueued());
    } catch {
      // A blocked or unavailable IndexedDB must not break the form.
    }
  }, []);

  const flush = useCallback(async () => {
    if (!isSupported() || !navigator.onLine) return;
    setFlushing(true);
    try {
      const result = await flushQueue();
      if (result.sent > 0 || result.dropped > 0) {
        console.info(
          `[offline-queue] sent ${result.sent}, dropped ${result.dropped}, ${result.remaining} remaining`,
        );
      }
      setQueued(result.remaining);
    } catch (error: unknown) {
      console.error("[offline-queue] flush failed:", error);
    } finally {
      setFlushing(false);
    }
  }, []);

  /**
   * Drain on reconnect, and take a count on mount.
   *
   * The async work is inlined rather than calling refresh()/flush() directly,
   * for two reasons: every setState here lands after an await (so it cannot
   * cascade a render, which is what the lint rule guards against), and the
   * cancelled flag stops a slow IndexedDB read from setting state on an
   * unmounted component — a real hazard on a page a citizen may leave quickly.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!isSupported()) return;

      try {
        const initial = await countQueued();
        if (!cancelled) setQueued(initial);
      } catch {
        // A blocked or unavailable IndexedDB must not break the form.
        return;
      }

      if (!online || !navigator.onLine) return;

      if (!cancelled) setFlushing(true);
      try {
        const result = await flushQueue();
        if (result.sent > 0 || result.dropped > 0) {
          console.info(
            `[offline-queue] sent ${result.sent}, dropped ${result.dropped}, ${result.remaining} remaining`,
          );
        }
        if (!cancelled) setQueued(result.remaining);
      } catch (error: unknown) {
        console.error("[offline-queue] flush failed:", error);
      } finally {
        if (!cancelled) setFlushing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [online]);

  return { online, queued, flushing, refresh, flush };
}

/**
 * Registers the service worker. Mounted once in the citizen layout.
 *
 * Dev is deliberately excluded: a worker caching Turbopack's dev chunks serves
 * stale modules after an edit, which looks like a broken hot reload and wastes
 * an afternoon. It is only useful in a production build anyway.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("[sw] registration failed:", error);
    });
  }, []);
  return null;
}
