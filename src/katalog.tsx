import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Card, EmptyState, Input, Textarea, cx } from './components/ui'
import { IconCheck, IconSearch, IconSun, IconMoon } from './components/icons'
import { dims as fmtDims, eur, num } from './lib/format'
import { OFFER_MARK, PACKAGE_MARK, REQUEST_MARK } from './lib/ads'
import { priceSelection, type Priced } from './lib/bundles'
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

/**
 * Wie gleiche Positionen zu einem Los zusammengefasst werden. Liste, Auswahl-
 * zusammenfassung und Paketübernahme müssen dieselbe Bündelung sehen, sonst
 * normalisiert der Stückzahlregler eine Paketauswahl auseinander.
 */
const lotKey = (i: CatalogItem) => `${i.maker}|${i.type}|${i.litres}|${i.vb}|${i.reserved ? 'r' : 'f'}`

function App() {
  const [dark, setDark] = useTheme()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  // Photos are published next to the JSON, so they resolve against whichever
  // of the candidate sources actually answered.
  const [base, setBase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [message, setMessage] = useState('')
  const [offer, setOffer] = useState('')
  const [allBundles, setAllBundles] = useState(false)
  const auswahl = useRef<HTMLDivElement>(null)

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
          if (alive) {
            setBase(new URL(url, location.href).href.replace(/\/[^/]*$/, '/'))
            setCatalog(data)
          }
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
      const key = lotKey(i)
      const lot = g.lots.find((l) => l.key === key)
      if (lot) lot.ids.push(i.id)
      // photos fehlt in der allerersten veröffentlichten Datei ganz — ohne ?? []
      // wirft i.photos[0] mitten im Render und die Seite bleibt weiß.
      else g.lots.push({ key, maker: i.maker, type: i.type, litres: i.litres, vb: i.vb, dims: i.dims, photo: (i.photos ?? [])[0] ?? null, reserved: i.reserved, ids: [i.id] })
      byCat.set(i.category, g)
    }
    return [...byCat.entries()].map(([id, g]) => ({ id, ...g }))
  }, [catalog, q, cat])

  const chosen = useMemo(() => catalog?.items.filter((i) => picked.has(i.id)) ?? [], [catalog, picked])
  const sum = chosen.reduce((a, i) => a + i.vb, 0)
  const litres = chosen.reduce((a, i) => a + i.litres, 0)

  // ?? [] überall: eine ältere veröffentlichte Datei kennt diese Felder nicht, und
  // in der Minute zwischen Veröffentlichen und Deploy liefert dieselbe Adresse noch
  // genau so eine Datei aus.
  const bundles = useMemo(() => catalog?.bundles ?? [], [catalog])
  const tiers = useMemo(() => catalog?.tiers ?? [], [catalog])

  const stock = useMemo(
    () => new Map<string, Priced>((catalog?.items ?? []).map((i) => [i.id, { id: i.id, category: i.category, vb: i.vb }])),
    [catalog],
  )
  const catLabel = useMemo(() => {
    const m = new Map((catalog?.items ?? []).map((i) => [i.category, i.categoryLabel]))
    return (id: string) => m.get(id) ?? id
  }, [catalog])

  const pricing = useMemo(
    () => priceSelection(chosen, bundles, tiers, catLabel, stock),
    [chosen, bundles, tiers, catLabel, stock],
  )

  /**
   * Die Reihenfolge innerhalb eines Loses, über den ganzen Bestand — ungefiltert.
   * Der Stückzahlregler normalisiert eine Auswahl immer auf die ERSTEN n eines
   * Loses. Ein Paket, das die hinteren Exemplare nennt, verlöre deshalb beim
   * nächsten Druck auf "+" seine eigene Zusammenstellung und damit den Paketpreis.
   */
  const lotOrder = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const i of catalog?.items ?? []) m.set(lotKey(i), [...(m.get(lotKey(i)) ?? []), i.id])
    return m
  }, [catalog])

  /** Eine Auswahl auf genau die Form bringen, die der Stückzahlregler erzeugt. */
  const normalise = useMemo(() => {
    const byId = new Map((catalog?.items ?? []).map((i) => [i.id, i]))
    return (ids: Iterable<string>) => {
      const count = new Map<string, number>()
      for (const id of ids) {
        const item = byId.get(id)
        if (item) count.set(lotKey(item), (count.get(lotKey(item)) ?? 0) + 1)
      }
      return new Set([...count].flatMap(([k, n]) => (lotOrder.get(k) ?? []).slice(0, n)))
    }
  }, [catalog, lotOrder])

  /** Selecting n of a lot simply picks its first n ids. */
  function setLotCount(lot: Lot, n: number) {
    setPicked((prev) => {
      const next = new Set(prev)
      lot.ids.forEach((id, idx) => (idx < n ? next.add(id) : next.delete(id)))
      return next
    })
  }

  function toggleBundle(ids: string[], take: boolean) {
    setPicked((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => (take ? next.add(id) : next.delete(id)))
      return normalise(next)
    })
  }

  const categories = useMemo(() => {
    if (!catalog) return []
    const seen = new Map<string, string>()
    catalog.items.forEach((i) => seen.set(i.category, i.categoryLabel))
    return [...seen.entries()]
  }, [catalog])

/** "T-03, T-04, T-05" becomes "T-03–T-05" — 52 ids shrink from 340 to 35 characters. */
function idRanges(ids: string[]): string {
  const parts = ids
    .map((id) => [id.replace(/-\d+$/, ''), Number(id.match(/(\d+)$/)?.[1] ?? 0), id] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1])
  const out: string[] = []
  let runStart: (typeof parts)[number] | null = null
  let prev: (typeof parts)[number] | null = null
  const flush = () => {
    if (!runStart || !prev) return
    out.push(runStart[2] === prev[2] ? runStart[2] : `${runStart[2]}–${prev[2]}`)
  }
  for (const cur of parts) {
    if (prev && cur[0] === prev[0] && cur[1] === prev[1] + 1) { prev = cur; continue }
    flush()
    runStart = cur
    prev = cur
  }
  flush()
  return out.join(', ')
}

  function mailto(): string {
    if (!catalog) return '#'
    const lines = summarise(chosen).map(
      (r) => `- ${r.count}× ${r.name}${r.litres ? ` (${num(r.litres)} l)` : ''} – je ${eur(r.vb)}${r.count > 1 ? `, zusammen ${eur(r.total)}` : ''}${r.reserved ? ' [reserviert — Ersatzinteresse]' : ''}`)
    // The block goes FIRST. Selecting everything makes the mail 2.642 characters
    // long, and several mail clients cut a mailto link off at about 2.048 — at the
    // end, which is exactly where this block used to sit. Losing it turns an exact
    // enquiry back into guesswork on the very largest order.
    const mark = [
      `${REQUEST_MARK} ${idRanges(chosen.map((i) => i.id))}`,
      offer.trim() ? `${OFFER_MARK} ${offer.trim()}` : null,
      // UNSER Preis, nicht der des Käufers — deshalb eine eigene Marke. Stünde er
      // als Zahl in der Prosa, läse ihn die Auswertung als Gebot und der Käufer
      // erschiene als Preisdrücker gegenüber der Summe der Einzelpreise.
      pricing.saved > 0 ? `${PACKAGE_MARK} ${pricing.price}` : null,
      '(Bitte stehen lassen, beschleunigt die Bearbeitung.)',
      '— — —',
      '',
    ].filter((l): l is string => l !== null)

    // null marks "leave this out"; '' is a deliberate blank line and must survive.
    const body = [
      ...mark,
      'Guten Tag,',
      '',
      'ich interessiere mich für folgende Positionen aus Ihrer Betriebsauflösung:',
      '',
      ...lines,
      '',
      `Summe der genannten Preise: ${eur(sum)}${litres ? ` · ${num(litres)} l` : ''}`,
      ...(pricing.saved > 0
        ? [
            `Paketpreis laut Liste: ${eur(pricing.price)} (${eur(pricing.saved)} günstiger)`,
            ...pricing.parts.map((p) => `  · ${p.label}: ${eur(p.price)} statt ${eur(p.full)}`),
          ]
        : []),
      offer.trim() ? '' : null,
      offer.trim() ? `Mein Angebot: ${offer.trim()} €` : null,
      message.trim() ? '' : null,
      message.trim() ? message.trim() : null,
      '',
      'Mit freundlichen Grüßen',
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
      <Card className="rise-in">
        <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Kellertechnik aus Betriebsauflösung</h1>
        {catalog.intro && <p className="mt-2 text-sm leading-relaxed text-muted">{catalog.intro}</p>}
        <p className="tnum mt-3 text-[13px] text-muted">
          {catalog.items.length} Positionen verfügbar
          {catalog.location && ` · Standort ${catalog.location}`}
          {' · '}Preise brutto inkl. {Math.round(catalog.vatRate * 100)} % MwSt.
        </p>
      </Card>

      <Card pad={false} className="rise-in" style={{ '--d': '40ms' } as React.CSSProperties}>
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

      {bundles.length > 0 && (
        <Card pad={false} className="rise-in overflow-hidden" style={{ '--d': '80ms' } as React.CSSProperties}>
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-bold">Fertig geschnürte Pakete</h2>
            <p className="mt-1 text-[13px] text-muted">
              Zusammenstellungen, die im Keller zusammengehören — zum Paketpreis günstiger als die Summe der Einzelpreise.
              Eine Fuhre, ein Termin.
            </p>
          </div>
          <ul className="divide-y divide-line">
            {bundles.slice(0, allBundles ? bundles.length : 3).map((b) => {
              const all = [...b.ids, ...b.giftIds]
              const taken = all.every((id) => picked.has(id))
              const gifts = b.giftIds
                .map((id) => catalog.items.find((i) => i.id === id))
                .filter((i): i is CatalogItem => Boolean(i))
              return (
                <li
                  key={b.id}
                  className={cx('accent tx relative px-4 py-3', taken ? 'accent-on bg-primary-soft/40' : 'hover:bg-surface-2')}
                >
                  {/* min-w-0 statt flex-wrap: ein langer Name bricht in sich um und der
                      Preis bleibt rechts daneben, statt allein in die nächste Zeile zu
                      rutschen und dort linksbündig wie eine Überschrift zu wirken. */}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-semibold">{b.label}</span>
                    <span className="tnum shrink-0 text-lg font-extrabold">{eur(b.price)}</span>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{b.blurb}</p>
                  {gifts.length > 0 && (
                    <p className="mt-1.5 text-[13px] font-semibold text-primary">
                      Ohne Aufpreis dabei: {gifts.map((g) => (g.maker === 'Sonstige' ? g.type : `${g.maker} ${g.type}`)).join(', ')}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    {/* Einzelpreissumme und Ersparnis in Euro. Ein Prozentsatz wäre eine
                        veröffentlichte Rabatthöhe, an der sich danach jede Einzelverhandlung
                        misst — der Preis sagt dasselbe, ohne die Grenze zu verraten. */}
                    <span className="tnum text-[13px] text-muted">
                      {all.length} Positionen · statt {eur(b.full)} ·{' '}
                      <span className="font-bold text-primary">{eur(b.full - b.price)} günstiger</span>
                    </span>
                    <Button size="sm" className="press" variant={taken ? 'ghost' : 'primary'} onClick={() => toggleBundle(all, !taken)}>
                      {taken ? <>Aus der Auswahl nehmen</> : <><IconCheck />Übernehmen</>}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          {bundles.length > 3 && (
            <button
              type="button"
              onClick={() => setAllBundles(!allBundles)}
              className="min-h-11 w-full border-t border-line px-4 text-[13px] font-semibold text-muted transition hover:text-ink"
            >
              {allBundles ? 'Weniger zeigen' : `Alle ${bundles.length} Pakete zeigen`}
            </button>
          )}
          {tiers.length > 0 && (
            <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
              Auch für selbst zusammengestellte Mengen gibt es Staffelpreise. Sie stehen unten in Ihrer Auswahl,
              sobald mehrere Positionen einer Gruppe angekreuzt sind.
            </p>
          )}
        </Card>
      )}

      {groups.map((g, gi) => (
        <Card key={g.id} pad={false} className="rise-in" style={{ '--d': `${140 + gi * 70}ms` } as React.CSSProperties}>
          <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-bold">{g.label}</h2>
            <span className="tnum text-[13px] text-muted">{g.lots.reduce((a, l) => a + l.ids.length, 0)} Positionen</span>
          </div>
          <ul className="divide-y divide-line">
            {g.lots.map((lot) => {
              const taken = lot.ids.filter((id) => picked.has(id)).length
              const many = lot.ids.length > 1
              return (
                <li
                  key={lot.key}
                  className={cx(
                    // Ein Raster statt flex-wrap: Bild, Text, Bedienung und Preis
                    // beginnen in jeder Zeile an derselben Stelle — vorher rückte der
                    // Text ein, sobald ein Kästchen davorstand, und die Liste
                    // franste über 20 Zeilen sichtbar aus.
                    'accent tx relative grid grid-cols-[3.5rem_1fr] items-center gap-x-3 gap-y-2 px-4 py-3',
                    'sm:grid-cols-[4rem_1fr_7.5rem_6rem]',
                    taken > 0 ? 'accent-on bg-primary-soft/40' : 'hover:bg-surface-2',
                    lot.reserved && 'opacity-70',
                  )}
                >
                  {/* Immer ein Bildplatz, auch ohne Bild — sonst verschiebt sich alles
                      dahinter um 64 px, sobald ein Foto fehlt. */}
                  {lot.photo ? (
                    <a
                      href={base + lot.photo}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Foto vergrößern"
                      className="tx group block h-14 w-14 overflow-hidden rounded-xl ring-1 ring-line hover:ring-primary sm:h-16 sm:w-16"
                    >
                      <img
                        src={base + lot.photo}
                        alt=""
                        loading="lazy"
                        className="tx h-full w-full object-cover group-hover:scale-105"
                      />
                    </a>
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-surface-2 text-[11px] text-faint ring-1 ring-line sm:h-16 sm:w-16">
                      kein Bild
                    </span>
                  )}

                  <span className="min-w-0">
                    <span className="block font-semibold">{lot.maker === 'Sonstige' ? lot.type : `${lot.maker} ${lot.type}`}</span>
                    <span className="tnum block text-[13px] text-muted">
                      {lot.litres > 0 && `${num(lot.litres)} Liter · `}
                      {many ? `${lot.ids.length} Stück` : 'Einzelstück'}
                      {fmtDims(lot.dims) && ` · ${fmtDims(lot.dims)}`}
                    </span>
                    {lot.reserved && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-bold text-amber">
                        reserviert — Ersatzinteresse möglich
                      </span>
                    )}
                  </span>

                  {/* Bedienung und Preis rutschen am Handy in eine eigene Zeile unter
                      den Text, stehen ab sm aber in festen Spalten nebeneinander. */}
                  <span className="col-start-2 flex items-center justify-between gap-3 sm:col-start-3 sm:justify-center">
                    {many ? (
                      <span className="flex items-center gap-1.5">
                        <Step label="weniger" disabled={taken === 0} onClick={() => setLotCount(lot, taken - 1)}>−</Step>
                        <span className={cx('tnum w-8 text-center font-bold', taken > 0 && 'text-primary')} key={taken}>
                          {taken}
                        </span>
                        <Step label="mehr" disabled={taken === lot.ids.length} onClick={() => setLotCount(lot, taken + 1)}>+</Step>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setLotCount(lot, taken > 0 ? 0 : 1)}
                        aria-pressed={taken > 0}
                        className={cx(
                          'tx press inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold',
                          taken > 0
                            ? 'border-primary bg-primary text-primary-text'
                            : 'border-line-strong bg-surface hover:border-primary hover:text-primary',
                        )}
                      >
                        {taken > 0 ? <><IconCheck />Gewählt</> : 'Auswählen'}
                      </button>
                    )}
                    <span className="tnum text-right sm:hidden">
                      <span className="block font-bold">{eur(lot.vb)}</span>
                      {many && <span className="block text-[11px] font-medium text-muted">je Stück</span>}
                    </span>
                  </span>

                  <span className="tnum hidden text-right sm:block">
                    <span className="block font-bold">{eur(lot.vb)}</span>
                    {many && <span className="block text-[11px] font-medium text-muted">je Stück</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}

      {groups.length === 0 && <Card><EmptyState title="Nichts gefunden" hint="Suche oder Kategorie anpassen." /></Card>}

      <Card className="scroll-mt-20">
        <div ref={auswahl} />
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
              <span className={cx('tnum text-xl font-extrabold', pricing.saved > 0 && 'text-base font-semibold text-muted line-through')}>
                {eur(sum)}
              </span>
            </div>

            {pricing.saved > 0 && (
              <div className="mt-3 rounded-xl bg-primary-soft/50 p-3">
                <ul className="tnum space-y-1 text-[13px]">
                  {pricing.parts.map((p) => (
                    <li key={p.bundleId ?? p.label} className="flex justify-between gap-3">
                      <span className="min-w-0">{p.label}</span>
                      <span className="shrink-0 text-muted">
                        <s>{eur(p.full)}</s> {eur(p.price)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-2">
                  <span className="font-bold">Ihr Paketpreis</span>
                  <span key={pricing.price} className="tnum pop text-2xl font-extrabold">{eur(pricing.price)}</span>
                </div>
                <p className="tnum mt-0.5 text-right text-[13px] font-semibold text-primary">
                  {eur(pricing.saved)} günstiger
                </p>
              </div>
            )}

            {pricing.next && (
              // Genau ein Hinweis, als Preis und nicht als Countdown: "noch zwei bis
              // 15 %" liest sich als Aufforderung, ein Preis als Angebot.
              <p className="mt-3 text-[13px] text-muted">
                {pricing.next.kind === 'bundle' ? (
                  pricing.next.price === pricing.price ? (
                    <>
                      Mit {pricing.next.missing.length === 1 ? 'einer weiteren Position' : `${pricing.next.missing.length} weiteren Positionen`}
                      {' '}greift das Paket <span className="font-semibold text-ink">{pricing.next.label}</span> — zum selben Preis.
                    </>
                  ) : (
                    <>
                      Mit {pricing.next.missing.length === 1 ? 'einer weiteren Position' : `${pricing.next.missing.length} weiteren Positionen`}
                      {' '}greift das Paket <span className="font-semibold text-ink">{pricing.next.label}</span>:
                      {' '}<span className="tnum font-semibold text-ink">{eur(pricing.next.price)}</span> statt {eur(pricing.price)}.
                    </>
                  )
                ) : (
                  <>
                    Ab <span className="tnum font-semibold text-ink">{pricing.next.minCount}</span> {catLabel(pricing.next.category)}
                    {' '}gilt ein günstigerer Mengenpreis — {pricing.next.missing === 1 ? 'eine fehlt' : `${pricing.next.missing} fehlen`} noch.
                  </>
                )}
              </p>
            )}

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
                className="tx press mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-primary bg-primary px-4 font-bold text-primary-text hover:brightness-110"
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

      {chosen.length > 0 && (
        // Die Auswahlübersicht steht am Ende der Seite — am Handy zwanzig Zeilen
        // unter dem Sichtfeld. Diese Leiste zeigt dieselbe Zahl immer, ohne dass
        // jemand dafür scrollen muss.
        <div className="slide-up pointer-events-none fixed inset-x-0 bottom-0 z-30 p-3">
          <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-3 rounded-2xl border border-line-strong bg-surface p-3 shadow-[0_-2px_8px_rgb(0_0_0/0.08),0_16px_40px_-12px_rgb(0_0_0/0.35)]">
            <span className="min-w-0 flex-1">
              <span className="tnum block text-[13px] text-muted">
                {chosen.length} {chosen.length === 1 ? 'Position' : 'Positionen'}
                {litres > 0 && ` · ${num(litres)} l`}
              </span>
              <span className="tnum flex items-baseline gap-2">
                <span key={pricing.price} className="pop text-lg font-extrabold">{eur(pricing.price)}</span>
                {pricing.saved > 0 && <s className="text-[13px] text-muted">{eur(sum)}</s>}
              </span>
            </span>
            <Button
              variant="primary"
              className="press"
              onClick={() => auswahl.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Zur Anfrage
            </Button>
          </div>
        </div>
      )}

      <p className={cx('text-center text-xs text-faint', chosen.length > 0 ? 'pb-28' : 'pb-8')}>
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
  dims: CatalogItem['dims']
  photo: string | null
  reserved: boolean
  ids: string[]
}

interface Summary {
  key: string
  name: string
  litres: number
  vb: number
  count: number
  total: number
  reserved: boolean
}

/** Collapse a selection back into "6× Barriquefass" lines. */
function summarise(items: CatalogItem[]): Summary[] {
  const map = new Map<string, Summary>()
  for (const i of items) {
    const key = `${i.maker}|${i.type}|${i.litres}|${i.vb}|${i.reserved ? 'r' : 'f'}`
    const hit = map.get(key)
    if (hit) {
      hit.count += 1
      hit.total += i.vb
    } else {
      map.set(key, {
        key,
        reserved: i.reserved,
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
      className="tx press flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-lg font-bold hover:border-primary hover:text-primary disabled:opacity-35 disabled:hover:border-line disabled:hover:text-ink"
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
        'tx press min-h-9 rounded-full border px-3 text-[13px] font-semibold',
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
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur-md">
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
