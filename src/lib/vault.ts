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
