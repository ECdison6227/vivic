import { MODEL_IDS, abortError, checkAbort } from "./models";
import type { ModelId, SpeechModel } from "./types";

export interface CachedModel { id: ModelId; sha256: string; bytes: number; blob: Blob }
export interface ModelStorage {
  get(id: ModelId): Promise<CachedModel | undefined>;
  begin(id: ModelId): Promise<string>;
  put(record: CachedModel, lease: string, signal?: AbortSignal): Promise<void>;
  delete(id?: ModelId): Promise<void>;
}
const DB_NAME = "vivic-local-speech-v1";
const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error("模型缓存操作失败。"));
});

/** Leases prevent a cancelled/older download from repopulating a cleared cache, across tabs. */
export class IndexedDbModelStorage implements ModelStorage {
  private async transact<T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>, signal?: AbortSignal): Promise<T> {
    checkAbort(signal);
    if (typeof indexedDB === "undefined") throw new Error("此浏览器不支持模型缓存，请使用 PTT 或文字。");
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("models", { keyPath: "id" });
      open.result.createObjectStore("leases");
    };
    const db = await request(open);
    try {
      checkAbort(signal);
      const tx = db.transaction(["models", "leases"], mode);
      const cancel = () => { try { tx.abort(); } catch { /* Already committed. */ } };
      const done = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(signal?.aborted ? abortError() : tx.error ?? new Error("模型缓存事务取消。"));
        tx.onerror = () => { /* onabort owns the error. */ };
      });
      // Observe failures immediately, including when action is still awaiting an IDB request.
      void done.catch(() => {});
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        checkAbort(signal);
        const value = await action(tx);
        await done;
        checkAbort(signal);
        return value;
      } catch (error) {
        cancel();
        await done.catch(() => {});
        throw error;
      } finally { signal?.removeEventListener("abort", cancel); }
    } finally { db.close(); }
  }
  get(id: ModelId) {
    return this.transact("readonly", tx => request(tx.objectStore("models").get(id)) as Promise<CachedModel | undefined>);
  }
  begin(id: ModelId) {
    const lease = crypto.randomUUID();
    return this.transact("readwrite", async tx => {
      await request(tx.objectStore("leases").put(lease, id));
      return lease;
    });
  }
  put(record: CachedModel, lease: string, signal?: AbortSignal) {
    return this.transact("readwrite", async tx => {
      const current = await request(tx.objectStore("leases").get(record.id));
      checkAbort(signal);
      if (current !== lease) throw abortError();
      await request(tx.objectStore("models").put(record));
    }, signal);
  }
  delete(id?: ModelId) {
    return this.transact("readwrite", async tx => {
      const requests = (id ? [id] : MODEL_IDS).flatMap(key => [
        request(tx.objectStore("leases").put(crypto.randomUUID(), key)),
        request(tx.objectStore("models").delete(key)),
      ]);
      await Promise.all(requests);
    });
  }
}
export const matchesModel = (record: CachedModel | undefined, model: SpeechModel): record is CachedModel =>
  Boolean(record && record.sha256 === model.sha256 && record.bytes === model.bytes && record.blob.size === model.bytes);
