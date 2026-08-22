import { useEffect, useRef, useState } from 'react'
import { Button, cx } from './ui'
import { IconCamera, IconPlus, IconTrash, IconWarn } from './icons'
import { prepareImage } from '../lib/photos'
import { store, useStore } from '../lib/store'
import type { Tank } from '../types'

/**
 * Photos are what actually sell a used tank. They live in the private data repo,
 * so every device that can open the dashboard has them at hand for a listing.
 */
export function PhotoStrip({ tank }: { tank: Tank }) {
  const { mode } = useStore()
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const offline = mode !== 'online'

  async function add(files: FileList | null) {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    try {
      for (const file of Array.from(files)) {
        const prepared = await prepareImage(file)
        await store.addPhoto(tank.id, prepared.base64)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Foto konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-muted">
          Fotos{tank.photos.length > 0 && ` (${tank.photos.length})`}
        </span>
        <span className="flex gap-1.5">
          {/* Two inputs on purpose: `capture` opens the camera directly, but the
              browser then ignores `multiple`. One button per intention beats one
              button that first asks which of the two you meant. */}
          <Button size="sm" disabled={busy || offline} onClick={() => camera.current?.click()}>
            <IconCamera />
            {busy ? 'Lädt hoch …' : 'Kamera'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy || offline} onClick={() => input.current?.click()}>
            <IconPlus />Auswählen
          </Button>
        </span>
      </div>

      {offline ? (
        <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
          Fotos brauchen die Verbindung zu GitHub — im Demo-Modus nicht verfügbar.
        </p>
      ) : tank.photos.length === 0 ? (
        <button
          type="button"
          onClick={() => camera.current?.click()}
          className="w-full rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-muted transition hover:border-primary hover:text-ink"
        >
          Foto aufnehmen oder auswählen — wird verkleinert und im Daten-Repository abgelegt.
        </button>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {tank.photos.map((path) => (
            <Thumb key={path} path={path} onRemove={() => void store.removePhoto(tank.id, path)} />
          ))}
        </div>
      )}

      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[13px] font-semibold text-rose">
          <IconWarn className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          void add(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void add(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function Thumb({ path, onRemove }: { path: string; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [full, setFull] = useState(false)

  useEffect(() => {
    let alive = true
    void store.photoUrl(path).then((u) => {
      if (alive) setUrl(u)
    })
    return () => {
      alive = false
    }
  }, [path])

  return (
    <>
      <div className="group relative shrink-0">
        <button
          type="button"
          onClick={() => url && setFull(true)}
          className={cx(
            'block h-24 w-24 overflow-hidden rounded-xl border border-line bg-surface-2',
            url && 'cursor-zoom-in',
          )}
        >
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <span className="flex h-full items-center justify-center text-[11px] text-faint">lädt …</span>
          )}
        </button>
        <button
          type="button"
          aria-label="Foto entfernen"
          onClick={() => {
            if (confirm('Foto löschen?')) onRemove()
          }}
          // Without hover there is no way to reveal this, but it stays hit-testable —
// tapping the corner of a photo would silently ask to delete it. Show it on touch.
          className="absolute top-1 right-1 flex h-9 w-9 items-center justify-center rounded-lg bg-black/70 text-white transition lg:h-7 lg:w-7 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
        >
          <IconTrash />
        </button>
      </div>

      {full && url && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setFull(false)}
          role="presentation"
        >
          <img src={url} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </>
  )
}
