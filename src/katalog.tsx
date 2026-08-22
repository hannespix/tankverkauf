import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Card, EmptyState, Input, Textarea, cx } from './components/ui'
import { IconCheck, IconSearch, IconSun, IconMoon } from './components/icons'
import { eur, num } from './lib/format'
import type { Catalog, CatalogItem } from './types'
import './index.css'

/**
 * The buyer-facing page. Deliberately its own entry point: no token, no vault,
 * no dashboard code ships here — it only ever reads one published JSON file.
 */

const THEME_KEY = 'tankverkauf.theme'

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])
  return [dark, setDark] as const
}

/**
 * Where to look for the published list, in order:
 *  1. same origin — served from the build, once the deploy after a publish is through
 *  2. raw.githubusercontent — bridges the minute between publishing and that deploy
 *  3. the repo root, where the very first version of the publisher wrote to
 */
function sources(): string[] {
  const list = ['katalog/katalog.json']
  const host = location.hostname.match(/^([^.]+)\.github\.io$/)
  const repo = location.pathname.split('/').filter(Boolean)[0]
  if (host && repo) {
    const base = `https://raw.githubusercontent.com/${host[1]}/${repo}/main`
    list.push(`${base}/public/katalog/katalog.json`, `${base}/katalog/katalog.json`)
  }
  return list
}

function App() {
  const [dark, setDark] = useTheme()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [message, setMessage] = useState('')
  const [offer, setOffer] = useState('')

  useEffect(() => {
    let alive = true
    void (async () => {
      // No override parameter: it let anyone point this page at their own file and
      // present foreign prices and a foreign contact address under this very address.
      for (const url of sources()) {
        try {
          const res = await fetch(url, { cache: 'no-store' })
          if (!res.ok) continue
          const data = (await res.json()) as Catalog
          if (alive) setCatalog(data)
          return
        } catch {
          /* try the next candidate */
        }
      }
      if (alive) setError('Die Liste konnte nicht geladen werden. Bitte später noch einmal versuchen.')
    })()
    return () => { alive = false }
  }, [])

  const groups = useMemo(() => {
    if (!catalog) return []
    const needle = q.trim().toLowerCase()
    const items = catalog.items.filter((i) => {
      if (cat && i.category !== cat) return false
      if (!needle) return true
      return [i.maker, i.type, String(i.litres)].some((v) => v.toLowerCase().includes(needle))
    })

    const byCat = new Map<string, { label: string; lots: Lot[] }>()
    for (const i of items) {
      const g = byCat.get(i.category) ?? { label: i.categoryLabel, lots: [] }
      // 29 identical barrels are one lot with a quantity, not 29 checkboxes.
      const key = `${i.maker}|${i.type}|${i.litres}|${i.vb}`
      const lot = g.lots.find((l) => l.key === key)
      if (lot) lot.ids.push(i.id)
      else g.lots.push({ key, maker: i.maker, type: i.type, litres: i.litres, vb: i.vb, ids: [i.id] })
      byCat.set(i.category, g)
    }
    return [...byCat.entries()].map(([id, g]) => ({ id, ...g }))
  }, [catalog, q, cat])

  const chosen = catalog?.items.filter((i) => picked.has(i.id)) ?? []
  const sum = chosen.reduce((a, i) => a + i.vb, 0)
  const litres = chosen.reduce((a, i) => a + i.litres, 0)

  /** Selecting n of a lot simply picks its first n ids. */
  function setLotCount(lot: Lot, n: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      lot.ids.forEach((id, idx) => (idx < n ? next.add(id) : next.delete(id)))
      return next
    })
  }

  const categories = useMemo(() => {
    if (!catalog) return []
    const seen = new Map<string, string>()
    catalog.items.forEach((i) => seen.set(i.category, i.categoryLabel))
    return [...seen.entries()]
  }, [catalog])

  function mailto(): string {
    if (!catalog) return '#'
    const lines = summarise(chosen).map(
      (r) => `- ${r.count}× ${r.name}${r.litres ? ` (${num(r.litres)} l)` : ''} – je ${eur(r.vb)}${r.count > 1 ? `, zusammen ${eur(r.total)}` : ''}`)
    // null marks "leave this out"; '' is a deliberate blank line and must survive.
    const body = [
      'Guten Tag,',
      '',
      'ich interessiere mich für folgende Positionen aus Ihrer Betriebsauflösung:',
      '',
      ...lines,
      '',
      `Summe der genannten Preise: ${eur(sum)}${litres ? ` · ${num(litres)} l` : ''}`,
      offer.trim() ? '' : null,
      offer.trim() ? `Mein Angebot: ${offer.trim()} €` : null,
      message.trim() ? '' : null,
      message.trim() ? message.trim() : null,
      '',
      'Mit freundlichen Grüßen',
      '',
      // Read verbatim by the seller's tool, so nothing has to be guessed from the prose.
      '— — —',
      `Positionen: ${chosen.map((i) => i.id).join(', ')}`,
      offer.trim() ? `Angebot: ${offer.trim()}` : null,
      '(Diese drei Zeilen bitte stehen lassen, sie beschleunigen die Bearbeitung.)',
    ]
      .filter((l): l is string => l !== null)
      .join('\n')
    const subject = `Anfrage: ${chosen.length} Position${chosen.length === 1 ? '' : 'en'} aus der Betriebsauflösung`
    return `mailto:${encodeURIComponent(catalog.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  if (error) {
    return <Shell dark={dark} setDark={setDark} title="Kellertechnik"><Card><EmptyState title="Liste nicht verfügbar" hint={error} /></Card></Shell>
  }
  if (!catalog) {
    return <Shell dark={dark} setDark={setDark} title="Kellertechnik"><p className="p-8 text-center text-sm text-muted">Liste wird geladen …</p></Shell>
  }

  return (
    <Shell dark={dark} setDark={setDark} title={catalog.seller || 'Betriebsauflösung'}>
      <Card>
        <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Kellertechnik aus Betriebsauflösung</h1>
        {catalog.intro && <p className="mt-2 text-sm leading-relaxed text-muted">{catalog.intro}</p>}
        <p className="tnum mt-3 text-[13px] text-muted">
          {catalog.items.length} Positionen verfügbar
          {catalog.location && ` · Standort ${catalog.location}`}
          {' · '}Preise brutto inkl. {Math.round(catalog.vatRate * 100)} % MwSt.
        </p>
      </Card>

      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-[180px] flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Chip active={cat === ''} onClick={() => setCat('')}>Alle</Chip>
            {categories.map(([id, label]) => (
              <Chip key={id} active={cat === id} onClick={() => setCat(id)}>{label}</Chip>
            ))}
          </div>
        </div>
      </Card>

      {groups.map((g) => (
        <Card key={g.id} pad={false}>
          <h2 className="border-b border-line px-4 py-3 font-bold">{g.label} <span className="text-muted">({g.lots.reduce((a, l) => a + l.ids.length, 0)})</span></h2>
          <ul className="divide-y divide-line">
            {g.lots.map((lot) => {
              const taken = lot.ids.filter((id) => picked.has(id)).length
              const many = lot.ids.length > 1
              return (
                <li key={lot.key} className={cx('flex items-center gap-3 px-4 py-3 transition', taken > 0 && 'bg-primary-soft/40')}>
                  {!many && (
                    <input
                      type="checkbox"
                      checked={taken > 0}
                      onChange={(e) => setLotCount(lot, e.target.checked ? 1 : 0)}
                      aria-label={`${lot.type} auswählen`}
                      className="h-5 w-5 shrink-0 accent-[var(--primary)]"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{lot.maker === 'Sonstige' ? lot.type : `${lot.maker} ${lot.type}`}</span>
                    <span className="tnum block text-[13px] text-muted">
                      {lot.litres > 0 && `${num(lot.litres)} Liter · `}
                      {many ? `${lot.ids.length} Stück verfügbar` : 'Einzelstück'}
                    </span>
                  </span>
                  {many && (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <Step label="weniger" disabled={taken === 0} onClick={() => setLotCount(lot, taken - 1)}>−</Step>
                      <span className="tnum w-8 text-center font-bold">{taken}</span>
                      <Step label="mehr" disabled={taken === lot.ids.length} onClick={() => setLotCount(lot, taken + 1)}>+</Step>
                    </span>
                  )}
                  <span className="tnum w-24 shrink-0 text-right font-bold">
                    {eur(lot.vb)}
                    {many && <span className="block text-[11px] font-medium text-muted">je Stück</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}

      {groups.length === 0 && <Card><EmptyState title="Nichts gefunden" hint="Suche oder Kategorie anpassen." /></Card>}

      <Card>
        <h2 className="font-bold">Ihre Auswahl</h2>
        {chosen.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Kreuzen Sie oben an, was für Sie infrage kommt.</p>
        ) : (
          <>
            <ul className="mt-3 space-y-1 text-sm">
              {summarise(chosen).map((r) => (
                <li key={r.key} className="flex justify-between gap-3">
                  <span>{r.count > 1 && <strong>{r.count}× </strong>}{r.name}{r.litres > 0 && ` · ${num(r.litres)} l`}</span>
                  <span className="tnum shrink-0 text-muted">{eur(r.total)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-3">
              <span className="font-bold">{chosen.length} Positionen{litres > 0 && ` · ${num(litres)} l`}</span>
              <span className="tnum text-xl font-extrabold">{eur(sum)}</span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[10rem_1fr]">
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-muted">Ihr Angebot (€)</span>
                <Input type="number" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="optional" className="tnum" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-semibold text-muted">Nachricht</span>
                <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Wann könnten Sie abholen? Fragen zum Zustand?" />
              </label>
            </div>

            {catalog.email ? (
              <a
                href={mailto()}
                className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary bg-primary px-4 font-bold text-primary-text transition hover:brightness-110"
              >
                <IconCheck />Anfrage per E-Mail senden
              </a>
            ) : (
              <p className="mt-4 text-sm text-rose">Für Anfragen ist noch keine E-Mail-Adresse hinterlegt.</p>
            )}
            <p className="mt-2 text-xs text-faint">
              Öffnet Ihr E-Mail-Programm mit der Auswahl. Unverbindlich — es wird nichts abgeschickt, bevor Sie es selbst tun.
            </p>
          </>
        )}
      </Card>

      {catalog.pickupInfo && (
        <Card>
          <h2 className="font-bold">Besichtigung & Abholung</h2>
          <p className="mt-1.5 text-sm text-muted">{catalog.pickupInfo}</p>
        </Card>
      )}

      <p className="pb-8 text-center text-xs text-faint">
        Stand: {new Date(catalog.updatedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })} ·
        {' '}Zwischenverkauf vorbehalten
      </p>
    </Shell>
  )
}

interface Lot {
  key: string
  maker: string
  type: string
  litres: number
  vb: number
  ids: string[]
}

interface Summary {
  key: string
  name: string
  litres: number
  vb: number
  count: number
  total: number
}

/** Collapse a selection back into "6× Barriquefass" lines. */
function summarise(items: CatalogItem[]): Summary[] {
  const map = new Map<string, Summary>()
  for (const i of items) {
    const key = `${i.maker}|${i.type}|${i.litres}|${i.vb}`
    const hit = map.get(key)
    if (hit) {
      hit.count += 1
      hit.total += i.vb
    } else {
      map.set(key, {
        key,
        name: i.maker === 'Sonstige' ? i.type : `${i.maker} ${i.type}`,
        litres: i.litres,
        vb: i.vb,
        count: 1,
        total: i.vb,
      })
    }
  }
  return [...map.values()]
}

function Step({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-lg font-bold transition hover:border-line-strong disabled:opacity-35"
    >
      {children}
    </button>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'min-h-9 rounded-full border px-3 text-[13px] font-semibold transition',
        active ? 'border-primary bg-primary text-primary-text' : 'border-line bg-surface hover:border-line-strong',
      )}
    >
      {children}
    </button>
  )
}

function Shell({ dark, setDark, title, children }: { dark: boolean; setDark: (v: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur">
        <span className="font-extrabold tracking-tight">{title}</span>
        <button
          type="button"
          onClick={() => setDark(!dark)}
          aria-label="Design wechseln"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-3 hover:text-ink"
        >
          {dark ? <IconSun /> : <IconMoon />}
        </button>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-4 p-3 sm:p-4">{children}</main>
    </div>
  )
}

const saved = localStorage.getItem(THEME_KEY)
document.documentElement.classList.toggle(
  'dark',
  saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches,
)

createRoot(document.getElementById('katalog')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
