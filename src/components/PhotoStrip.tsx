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
  const { mode, photosPending } = useStore()
  const input = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Taking a picture works without a connection now — it is queued. Only the demo
  // has nowhere to put it.
  const demo = mode === 'demo'
  const offline = demo

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

      {photosPending > 0 && (
        <p className="mb-1.5 rounded-xl bg-amber-soft px-3 py-2 text-[13px] font-semibold text-amber">
          {photosPending === 1 ? 'Ein Foto wartet' : `${photosPending} Fotos warten`} auf die Übertragung. Sie bleiben auf
          diesem Gerät gespeichert und gehen von selbst raus, sobald wieder Empfang da ist.
        </p>
      )}

      {offline ? (
        <p className="rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
          Fotos brauchen ein eingerichtetes Daten-Repository — im Demo-Modus nicht verfügbar.
        </p>
      ) : tank.photos.length === 0 ? (
        <button
          type="button"
          onClick={() => camera.current?.click()}
          className="w-full rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-muted transition hover:border-primary hover:text-ink"
        >
          Foto aufnehmen oder auswählen — wird verkleinert und abgelegt, auch ohne Empfang.
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

/**
 * A photo in a list row. Same resolver as the big thumbnail — it answers from the
 * local queue while an upload is still pending, so a picture taken in the cellar
 * shows up straight away.
 */
export function MiniPhoto({ path, className }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void store.photoUrl(path).then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [path])
  return (
    <span className={cx('block overflow-hidden rounded-md bg-surface-2 ring-1 ring-line', className)}>
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />}
    </span>
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
