/**
 * One IndexedDB for the whole app. Two modules open it — the vault for its
 * device key, the photo queue for pending uploads — and two modules opening the
 * same database under different version numbers throws VersionError on whichever
 * one comes second. So the version and the store list live here, in one place.
 */

const NAME = 'tankverkauf'
const VERSION = 2

export const STORE_KEYS = 'keys'
export const STORE_PHOTOS = 'photoQueue'

export function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION)
    req.onupgradeneeded = () => {
      // Runs for a fresh database and for one still at version 1, so every store
      // is created on demand rather than assumed to exist.
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_KEYS)) db.createObjectStore(STORE_KEYS)
      if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Promise wrapper around a single request, so callers can just await. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
