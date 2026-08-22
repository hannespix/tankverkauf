/**
 * Photos live as ordinary files in the private data repo, next to db.json.
 * They are shrunk in the browser first — a phone photo is easily 4 MB, which
 * would make every save slow and blow past what the Contents API is happy with.
 */

const MAX_EDGE = 1600
const QUALITY = 0.82

export interface Prepared {
  base64: string
  bytes: number
  width: number
  height: number
}

export async function prepareImage(file: File): Promise<Prepared> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden.')
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('Bild konnte nicht umgewandelt werden.')

  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return { base64: btoa(bin), bytes: bytes.length, width, height }
}

/** Object URLs are expensive to recreate on every render, so keep them around. */
const urlCache = new Map<string, string>()

/**
 * Resolutions still in flight, one entry per path.
 *
 * One overview photo can hang on 31 positions, so 31 thumbnails ask for the same
 * file at the same moment. Without this they each fetched it and each called
 * rememberUrl — which revokes the previous object URL, the one the thumbnail
 * before it was already showing. All but the last picture went blank.
 */
const inFlight = new Map<string, Promise<string | null>>()

/** Everyone asking for the same path shares one fetch and one object URL. */
export function resolveOnce(path: string, load: () => Promise<string | null>): Promise<string | null> {
  const hit = urlCache.get(path)
  if (hit) return Promise.resolve(hit)
  const running = inFlight.get(path)
  if (running) return running
  const started = load().finally(() => inFlight.delete(path))
  inFlight.set(path, started)
  return started
}

export function cachedUrl(path: string): string | undefined {
  return urlCache.get(path)
}

export function rememberUrl(path: string, blob: Blob): string {
  const existing = urlCache.get(path)
  if (existing) URL.revokeObjectURL(existing)
  const url = URL.createObjectURL(blob)
  urlCache.set(path, url)
  return url
}

export function forgetUrl(path: string) {
  inFlight.delete(path)
  const url = urlCache.get(path)
  if (url) URL.revokeObjectURL(url)
  urlCache.delete(path)
}

export const photoPath = (tankId: string, stamp: string) => `fotos/${tankId}-${stamp}.jpg`

/** Re-encode a blob fetched from the private repo so it can be written to another one. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
