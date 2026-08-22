/**
 * Photos for a listing, ready to upload.
 *
 * The pictures live in the private data repo, so a buyer can never reach them by
 * link — they have to be uploaded to the portal itself, where they are free and
 * where buyers actually look. This packs the ones belonging to a listing into a
 * single file, named in the order the ad text mentions them.
 *
 * The archive is written here rather than with a library: JPEGs are already
 * compressed, so a stored (uncompressed) zip is exactly as small and needs no
 * dependency at all.
 */

export interface BundleFile {
  name: string
  blob: Blob
}

/** CRC-32, the one checksum a zip entry needs. */
const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Zip stores names as bytes; umlauts need the UTF-8 flag or they arrive mangled. */
const utf8 = (s: string) => new TextEncoder().encode(s)

export async function zip(files: BundleFile[]): Promise<Blob> {
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = utf8(file.name)
    const data = new Uint8Array(await file.blob.arrayBuffer())
    const sum = crc32(data)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    // Bit 11 says the name is UTF-8.
    local.setUint16(6, 0x0800, true)
    local.setUint16(8, 0, true) // stored, no compression
    local.setUint16(10, 0, true)
    local.setUint16(12, 0, true)
    local.setUint32(14, sum, true)
    local.setUint32(18, data.length, true)
    local.setUint32(22, data.length, true)
    local.setUint16(26, name.length, true)
    local.setUint16(28, 0, true)
    parts.push(local.buffer, name, data)

    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true)
    dir.setUint16(4, 20, true)
    dir.setUint16(6, 20, true)
    dir.setUint16(8, 0x0800, true)
    dir.setUint16(10, 0, true)
    dir.setUint16(12, 0, true)
    dir.setUint16(14, 0, true)
    dir.setUint32(16, sum, true)
    dir.setUint32(20, data.length, true)
    dir.setUint32(24, data.length, true)
    dir.setUint16(28, name.length, true)
    dir.setUint16(30, 0, true)
    dir.setUint16(32, 0, true)
    dir.setUint16(34, 0, true)
    dir.setUint16(36, 0, true)
    dir.setUint32(38, 0, true)
    dir.setUint32(42, offset, true)
    const entry = new Uint8Array(46 + name.length)
    entry.set(new Uint8Array(dir.buffer), 0)
    entry.set(name, 46)
    central.push(entry)

    offset += 30 + name.length + data.length
  }

  const dirBytes = central.reduce((a, e) => a + e.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, dirBytes, true)
  end.setUint32(16, offset, true)
  parts.push(...central, end.buffer)

  return new Blob(parts, { type: 'application/zip' })
}

/** Safe for every file system, and still readable in the upload dialog. */
export function safeName(s: string): string {
  return s
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/[^\w.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

export interface CollageEntry {
  url: string
  caption: string
}

/**
 * One image showing everything at once — the first picture of a listing, the one
 * that has to make somebody stop scrolling. It is not a replacement for the
 * single shots; the portals allow a couple of dozen pictures and every one of
 * them sells better than a link.
 */
export async function collage(entries: CollageEntry[], width = 1600): Promise<Blob> {
  const shown = entries.slice(0, 12)
  if (shown.length === 0) throw new Error('Keine Bilder ausgewählt.')

  // Four pictures want 2x2, not 3+1 with a hole in it.
  const n = shown.length
  const cols = n <= 3 ? n : n === 4 ? 2 : n <= 9 ? 3 : 4
  const rows = Math.ceil(n / cols)
  const gap = 8
  const cell = Math.floor((width - gap * (cols + 1)) / cols)
  const label = 34
  const height = gap + rows * (cell + label + gap)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Bild konnte nicht erzeugt werden.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const images = await Promise.all(
    shown.map(
      (e) =>
        new Promise<HTMLImageElement | null>((resolve) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => resolve(null)
          img.src = e.url
        }),
    ),
  )

  images.forEach((img, i) => {
    const row = Math.floor(i / cols)
    const inRow = Math.min(cols, n - row * cols)
    // An incomplete last row sits centred instead of clinging to the left edge.
    const rowWidth = inRow * cell + (inRow - 1) * gap
    const x = Math.round((width - rowWidth) / 2) + (i % cols) * (cell + gap)
    const y = gap + row * (cell + label + gap)
    ctx.fillStyle = '#f1f3f2'
    ctx.fillRect(x, y, cell, cell)
    if (img) {
      // Fill the square without distorting: crop the long edge.
      const scale = Math.max(cell / img.width, cell / img.height)
      const w = img.width * scale
      const h = img.height * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cell, cell)
      ctx.clip()
      ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h)
      ctx.restore()
    }
    ctx.fillStyle = '#1a1d1c'
    ctx.font = '600 20px system-ui, sans-serif'
    ctx.textBaseline = 'top'
    const text = shown[i].caption
    const max = cell
    let out = text
    while (ctx.measureText(out).width > max && out.length > 4) out = `${out.slice(0, -2)}…`
    ctx.fillText(out, x, y + cell + 8)
  })

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden.'))), 'image/jpeg', 0.85)
  })
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
