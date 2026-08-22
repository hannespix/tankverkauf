import { STORE_PHOTOS, done, openIdb, request } from './idb'

/**
 * Photos used to go straight onto the network: shoot, upload, and if there is no
 * signal the picture is simply gone. That is exactly the situation this is for —
 * a cellar with thick walls and one bar of reception.
 *
 * So a photo is written here first and uploaded afterwards. The position already
 * carries the path, the thumbnail is served from these bytes until the upload is
 * through, and a failed attempt stays queued instead of disappearing.
 */

export interface Pending {
  /** Same path the position stores, so it doubles as the key. */
  path: string
  tankId: string
  base64: string
  addedAt: number
  /** Failed attempts so far — a picture that never goes through has to be visible. */
  tries: number
  lastError: string | null
}

export async function enqueue(entry: Omit<Pending, 'tries' | 'lastError'>): Promise<void> {
  const db = await openIdb()
  try {
    const tx = db.transaction(STORE_PHOTOS, 'readwrite')
    tx.objectStore(STORE_PHOTOS).put({ ...entry, tries: 0, lastError: null }, entry.path)
    await done(tx)
  } finally {
    db.close()
  }
}

export async function pendingPaths(): Promise<string[]> {
  const db = await openIdb()
  try {
    return (await request(db.transaction(STORE_PHOTOS, 'readonly').objectStore(STORE_PHOTOS).getAllKeys())) as string[]
  } finally {
    db.close()
  }
}

export async function allPending(): Promise<Pending[]> {
  const db = await openIdb()
  try {
    return (await request(db.transaction(STORE_PHOTOS, 'readonly').objectStore(STORE_PHOTOS).getAll())) as Pending[]
  } finally {
    db.close()
  }
}

export async function get(path: string): Promise<Pending | undefined> {
  const db = await openIdb()
  try {
    return (await request(db.transaction(STORE_PHOTOS, 'readonly').objectStore(STORE_PHOTOS).get(path))) as Pending | undefined
  } finally {
    db.close()
  }
}

export async function remove(path: string): Promise<void> {
  const db = await openIdb()
  try {
    const tx = db.transaction(STORE_PHOTOS, 'readwrite')
    tx.objectStore(STORE_PHOTOS).delete(path)
    await done(tx)
  } finally {
    db.close()
  }
}

/**
 * Record a failed attempt without losing the bytes. Read and write are separate
 * transactions on purpose: an IndexedDB transaction commits as soon as the
 * microtask queue drains with nothing outstanding, so holding one open across an
 * await is a race. A miscounted retry is harmless; a dropped photo is not.
 */
export async function markFailed(path: string, message: string): Promise<void> {
  const db = await openIdb()
  try {
    const entry = (await request(
      db.transaction(STORE_PHOTOS, 'readonly').objectStore(STORE_PHOTOS).get(path),
    )) as Pending | undefined
    if (!entry) return
    const tx = db.transaction(STORE_PHOTOS, 'readwrite')
    tx.objectStore(STORE_PHOTOS).put({ ...entry, tries: entry.tries + 1, lastError: message }, path)
    await done(tx)
  } finally {
    db.close()
  }
}

/** Turn stored base64 back into something an <img> can show without a round trip. */
export function dataUrl(base64: string): string {
  return `data:image/jpeg;base64,${base64}`
}
