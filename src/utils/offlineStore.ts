import type {
  AgentProfile,
  MemoryItem,
  OfflineQueuedAction,
  ProjectRecord,
  TelemetryHistoryPoint,
} from '../types/os';

const DB_NAME = 'vcalabs_os_offline_v1';
const DB_VERSION = 1;

interface StoreMap {
  kv: { key: string; value: unknown; updatedAt: number };
  queue: OfflineQueuedAction;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveSnapshot<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key, value, updatedAt: Date.now() } satisfies StoreMap['kv']);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Graceful fallback when IndexedDB is restricted
  }
}

export async function loadSnapshot<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    const res = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve((req.result?.value as T) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

export async function enqueueOfflineAction(action: OfflineQueuedAction): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').put(action);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore if IDB unavailable
  }
}

export async function listOfflineQueue(): Promise<OfflineQueuedAction[]> {
  try {
    const db = await openDb();
    const res = await new Promise<OfflineQueuedAction[]>((resolve, reject) => {
      const tx = db.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve((req.result as OfflineQueuedAction[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function removeOfflineAction(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('queue', 'readwrite');
      tx.objectStore('queue').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore
  }
}

export interface CachedOsState {
  agents: AgentProfile[];
  projects: ProjectRecord[];
  memories: MemoryItem[];
  telemetryHistory: TelemetryHistoryPoint[];
  terminalHistory: string[];
  theme: string;
}
