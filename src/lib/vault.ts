/**
 * The GitHub token never sits in localStorage as plain text. It is sealed with a
 * PIN the user chooses, using PBKDF2 + AES-GCM via WebCrypto. Losing the phone
 * therefore does not hand anyone write access to the data repo.
 */

const ITERATIONS = 250_000
const KEY_STORAGE = 'tankverkauf.vault.v1'

export interface SealedVault {
  salt: string
  iv: string
  data: string
}

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function seal(secret: string, pin: string): Promise<SealedVault> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(pin, salt)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret))
  return { salt: b64(salt), iv: b64(iv), data: b64(data) }
}

/** Returns null when the PIN is wrong — AES-GCM authentication fails loudly. */
export async function unseal(vault: SealedVault, pin: string): Promise<string | null> {
  try {
    const key = await deriveKey(pin, unb64(vault.salt))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) as BufferSource }, key, unb64(vault.data) as BufferSource)
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

export function saveVault(vault: SealedVault) {
  localStorage.setItem(KEY_STORAGE, JSON.stringify(vault))
}

export function loadVault(): SealedVault | null {
  const raw = localStorage.getItem(KEY_STORAGE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SealedVault
    return parsed.salt && parsed.iv && parsed.data ? parsed : null
  } catch {
    return null
  }
}

export function clearVault() {
  localStorage.removeItem(KEY_STORAGE)
}

export const hasVault = () => loadVault() !== null

// ---------------------------------------------------------------- remember me

/**
 * "Angemeldet bleiben" without a PIN prompt on every visit.
 *
 * The token is encrypted with an AES-GCM key that is generated as
 * NON-EXTRACTABLE and kept as a live CryptoKey inside IndexedDB. The page can
 * ask the browser to decrypt with it, but neither our code nor anything that
 * reads storage can ever get the raw key bytes out — so a copied profile,
 * a synced backup or a glance at localStorage yields ciphertext, not a token.
 *
 * This is convenience-grade, not PIN-grade: anything running as this origin can
 * still ask the key to decrypt. Hence the expiry and the explicit opt-in.
 */

const IDB_NAME = 'tankverkauf'
const IDB_STORE = 'keys'
const DEVICE_KEY_ID = 'device'
const REMEMBER_STORAGE = 'tankverkauf.remember.v1'

export const DEFAULT_REMEMBER_DAYS = 30

interface Remembered {
  iv: string
  data: string
  expires: number
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function deviceKey(createIfMissing: boolean): Promise<CryptoKey | null> {
  const db = await openIdb()
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(DEVICE_KEY_ID)
      req.onsuccess = () => resolve(req.result as CryptoKey | undefined)
      req.onerror = () => reject(req.error)
    })
    if (existing) return existing
    if (!createIfMissing) return null

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(key, DEVICE_KEY_ID)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return key
  } finally {
    db.close()
  }
}

export async function rememberOnDevice(token: string, days = DEFAULT_REMEMBER_DAYS): Promise<boolean> {
  try {
    const key = await deviceKey(true)
    if (!key) return false
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token))
    const entry: Remembered = { iv: b64(iv), data: b64(data), expires: Date.now() + days * 86_400_000 }
    localStorage.setItem(REMEMBER_STORAGE, JSON.stringify(entry))
    return true
  } catch {
    // Private windows and locked-down browsers may refuse IndexedDB — fall back to the PIN.
    return false
  }
}

export async function recallFromDevice(): Promise<string | null> {
  const raw = localStorage.getItem(REMEMBER_STORAGE)
  if (!raw) return null
  try {
    const entry = JSON.parse(raw) as Remembered
    if (!entry.expires || Date.now() > entry.expires) {
      forgetDevice()
      return null
    }
    const key = await deviceKey(false)
    if (!key) return null
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(entry.iv) as BufferSource }, key, unb64(entry.data) as BufferSource)
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

export function forgetDevice() {
  localStorage.removeItem(REMEMBER_STORAGE)
}

export function rememberedUntil(): Date | null {
  const raw = localStorage.getItem(REMEMBER_STORAGE)
  if (!raw) return null
  try {
    const entry = JSON.parse(raw) as Remembered
    return entry.expires && Date.now() <= entry.expires ? new Date(entry.expires) : null
  } catch {
    return null
  }
}
