import { useMemo, useState } from 'react'
import { Button, Card, CopyButton, EmptyState, Field, Input, Modal, Pill, SectionTitle, Select, Textarea, cx, type Tone } from '../components/ui'
import { IconDownload, IconGrid, IconLink, IconMegaphone, IconPlus, IconRefresh, IconTrash, IconWarn } from '../components/icons'
import { bumpAd, createAdsForPortals, markAdPublished, patchAd, refreshAd, removeAd } from '../lib/actions'
import { SCOPE_LABEL, adDrift, generateAd, limitsOf, portalOf } from '../lib/ads'
import { collage, download, safeName, zip } from '../lib/bundle'
import { catalogPageUrl } from '../lib/catalog'
import { dateDE, eur, num, relativeDE } from '../lib/format'
import { store, useStore } from '../lib/store'
import { byMaker, isOpen } from '../lib/stats'
import type { Ad, AdScope, AdScopeKind, AdStatus, Maker, Portal, Tank } from '../types'

const STATUS_TONE: Record<AdStatus, Tone> = { entwurf: 'neutral', online: 'green', offline: 'amber' }
const STATUS_LABEL: Record<AdStatus, string> = { entwurf: 'Entwurf', online: 'Online', offline: 'Offline' }

export default function Ads() {
  const { db } = useStore()
  const [creating, setCreating] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const portals = db.settings.portals
  const stale = db.ads.filter((a) => a.status === 'online' && adDrift(db, a).stale)

  // One section per portal, plus a catch-all for ads whose portal was deleted.
  const groups = useMemo(() => {
    const known = portals.map((p) => ({ portal: p, ads: db.ads.filter((a) => a.portalId === p.id) }))
    const orphans = db.ads.filter((a) => !portals.some((p) => p.id === a.portalId))
    return orphans.length ? [...known, { portal: null, ads: orphans }] : known
  }, [db.ads, portals])

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle
          title="Anzeigen"
          hint="Der Text wird je Portal aus dem aktuellen Bestand erzeugt. Verkaufst du einen Tank, meldet sich jede betroffene Anzeige."
          action={<Button variant="primary" onClick={() => setCreating(true)}><IconPlus />Anzeige erstellen</Button>}
        />

        <div className="rounded-xl border border-line bg-surface-2 p-3.5 text-[13px] leading-relaxed text-muted">
          <strong className="text-ink">Warum kein Auto-Upload?</strong> Weder Kleinanzeigen noch Winzer-Service bieten
          privaten Verkäufern eine offizielle Schnittstelle an — Anzeigen lassen sich nur über die jeweilige Website
          einstellen. Deshalb macht dieses Tool den Weg so kurz wie möglich: Text erzeugen, drei Felder einzeln kopieren,
          im Formular einfügen.
        </div>

        {stale.length > 0 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber/50 bg-amber-soft/50 p-3 text-sm">
            <IconWarn className="mt-0.5 shrink-0 text-amber" />
            <span>
              <strong>{stale.length} Anzeige{stale.length > 1 ? 'n' : ''} nicht mehr aktuell.</strong> Der Bestand hat
              sich geändert, seit der Text zuletzt erzeugt wurde.
            </span>
          </div>
        )}

        {db.ads.length === 0 && (
          <EmptyState
            title="Noch keine Anzeige angelegt"
            hint="Erzeug denselben Bestand für mehrere Portale gleichzeitig — der Text passt sich dem jeweiligen Publikum an."
            action={<Button variant="primary" onClick={() => setCreating(true)}><IconMegaphone />Erste Anzeige</Button>}
          />
        )}
      </Card>

      <CatalogLink />

      {groups.map(({ portal, ads }) => (
        <section key={portal?.id ?? 'ohne-portal'} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              {portal?.name ?? 'Ohne Portal'}
              <Pill tone={ads.length ? 'sky' : 'neutral'}>{ads.length} Anzeige{ads.length === 1 ? '' : 'n'}</Pill>
            </h2>
            {portal && (
              <span className="text-[13px] text-muted">
                Titel max. {portal.titleLimit} · Text max. {num(portal.bodyLimit)} Zeichen
              </span>
            )}
          </div>

          {portal?.notes && <p className="px-1 text-[13px] text-faint">{portal.notes}</p>}

          {ads.length === 0 ? (
            <Card className="!py-6">
              <p className="text-center text-sm text-muted">
                Für {portal?.name} ist noch nichts angelegt.{' '}
                <button type="button" className="font-semibold text-primary underline" onClick={() => setCreating(true)}>
                  Anzeige erstellen
                </button>
              </p>
            </Card>
          ) : (
            ads.map((ad) => <AdCard key={ad.id} ad={ad} portal={portal} onOpen={() => setOpenId(ad.id)} />)
          )}
        </section>
      ))}

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={(ids) => { setCreating(false); setOpenId(ids[0] ?? null) }} />}
      {openId && <AdModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}

/**
 * The public list is the thing to send someone after first contact, so it needs
 * to be one tap away from where the ads are written — not buried in settings.
 */
function CatalogLink() {
  const { db } = useStore()
  const cfg = db.settings.catalog
  const open = db.tanks.filter(isOpen).length
  if (!cfg.owner) return null
  const url = catalogPageUrl(cfg)

  const share = async () => {
    const text = `Unsere verfügbaren Positionen aus der Betriebsauflösung: ${url}`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Verfügbare Positionen', text, url })
        return
      } catch {
        /* cancelled — fall through to the clipboard */
      }
    }
    await navigator.clipboard.writeText(url).catch(() => undefined)
  }

  return (
    <Card>
      <SectionTitle
        title="Käuferliste zum Weitergeben"
        hint={`Zeigt die ${open} noch verfügbaren Positionen. Interessenten kreuzen an und schicken daraus eine Anfrage.`}
        action={
          <div className="flex flex-wrap gap-2">
            <CopyButton text={url} label="Link kopieren" />
            <Button onClick={() => void share()}><IconLink />Teilen</Button>
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <a href={url} target="_blank" rel="noreferrer noopener"
          className="min-w-0 flex-1 truncate rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-[13px] text-primary underline">
          {url}
        </a>
      </div>
      <p className="mt-2 text-xs text-faint">
        Nicht aus einer Kleinanzeige heraus verlinken — dort sind Links auf eigene Angebotsseiten heikel.
        Nach dem Erstkontakt per Mail oder Messenger verschicken ist unproblematisch.
        Der Stand kommt aus dem zuletzt veröffentlichten Katalog (Einstellungen).
      </p>
    </Card>
  )
}

function AdCard({ ad, portal, onOpen }: { ad: Ad; portal: Portal | null; onOpen: () => void }) {
  const { db } = useStore()
  const drift = adDrift(db, ad)
  const bumpDays = ad.bumpedAt ? Math.floor((Date.now() - new Date(ad.bumpedAt).getTime()) / 86_400_000) : null
  const needsBump = ad.status === 'online' && bumpDays !== null && bumpDays >= db.settings.ad.bumpAfterDays

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={STATUS_TONE[ad.status]}>{STATUS_LABEL[ad.status]}</Pill>
            <Pill tone="neutral">{SCOPE_LABEL[ad.scope.kind]}</Pill>
            {drift.stale && <Pill tone="amber"><IconWarn className="h-3 w-3" />Text veraltet</Pill>}
            {needsBump && <Pill tone="sky">seit {bumpDays} Tagen nicht hochgeholt</Pill>}
          </div>
          <h3 className="mt-2 font-bold">{ad.title || <span className="text-faint">ohne Titel</span>}</h3>
          <p className="tnum mt-0.5 text-[13px] text-muted">
            {eur(ad.price)} {ad.priceType} · {ad.tankIds.length} Tank{ad.tankIds.length === 1 ? '' : 's'}
            {ad.publishedAt && ` · online seit ${dateDE(ad.publishedAt)}`}
            {ad.bumpedAt && ` · hochgeholt ${relativeDE(ad.bumpedAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ad.url && (
            <a href={ad.url} target="_blank" rel="noreferrer noopener"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 text-sm font-semibold transition hover:bg-surface-3">
              <IconLink />Anzeige öffnen
            </a>
          )}
          <Button variant="primary" onClick={onOpen}>Text & Aktionen</Button>
        </div>
      </div>

      {drift.stale && (
        <div className="mt-3 rounded-xl border border-amber/40 bg-amber-soft/40 p-3 text-[13px]">
          <strong>Seit dem letzten Erzeugen geändert:</strong>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted">
            {drift.soldSince.length > 0 && (
              <li>{drift.soldSince.length} beworbene{drift.soldSince.length === 1 ? ' Position ist' : ' Positionen sind'} inzwischen verkauft
                {' '}({drift.soldSince.map((t) => (t.litres > 0 ? `${t.maker} ${num(t.litres)} l` : `${t.maker} ${t.type}`)).join(', ')})</li>
            )}
            {drift.countThen !== drift.countNow && <li>Anzahl im Angebot: {drift.countThen} → {drift.countNow}</li>}
            {drift.priceChanged && <li>Preis: {eur(drift.priceChanged.from)} → {eur(drift.priceChanged.to)}</li>}
          </ul>
          <Button size="sm" variant="primary" className="mt-2.5" onClick={() => refreshAd(ad.id)}>
            <IconRefresh />Text neu erzeugen{portal ? ` für ${portal.name}` : ''}
          </Button>
        </div>
      )}
    </Card>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (ids: string[]) => void }) {
  const { db } = useStore()
  const portals = db.settings.portals
  const [kind, setKind] = useState<AdScopeKind>('paket')
  const [maker, setMaker] = useState<Maker>(byMaker(db.tanks.filter(isOpen))[0]?.maker ?? 'Sonstige')
  const [tankId, setTankId] = useState(db.tanks.find(isOpen)?.id ?? '')
  const [category, setCategory] = useState(db.settings.categories[0]?.id ?? 'tank')
  const [picked, setPicked] = useState<string[]>(portals.filter((p) => p.active).map((p) => p.id))

  const scope: AdScope =
    kind === 'maker' ? { kind, maker }
    : kind === 'tank' ? { kind, tankId }
    : kind === 'kategorie' ? { kind, category }
    : { kind }
  const previews = useMemo(
    () => picked.map((pid) => ({ portal: portalOf(db, pid), gen: generateAd(db, scope, portalOf(db, pid)) })),
    [db, scope, picked],
  )

  return (
    <Modal open onClose={onClose} title="Anzeige erstellen" wide>
      <div className="space-y-4">
        <Field label="Was soll beworben werden?">
          <Select value={kind} onChange={(e) => setKind(e.target.value as AdScopeKind)}>
            <option value="paket">Komplettpaket — alles, was zum Paket gehört</option>
            <option value="kategorie">Ganze Kategorie</option>
            <option value="maker">Hersteller-Bundle — alles einer Marke</option>
            <option value="tank">Einzelner Tank</option>
            <option value="restposten">Restposten — Kurzfassung</option>
          </Select>
        </Field>

        {kind === 'kategorie' && (
          <Field label="Kategorie">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {db.settings.categories
                .filter((c) => db.tanks.some((t) => t.category === c.id && isOpen(t)))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} ({db.tanks.filter((t) => t.category === c.id && isOpen(t)).length})
                  </option>
                ))}
            </Select>
          </Field>
        )}

        {kind === 'maker' && (
          <Field label="Hersteller">
            <Select value={maker} onChange={(e) => setMaker(e.target.value as Maker)}>
              {byMaker(db.tanks.filter(isOpen)).map((g) => (
                <option key={g.maker} value={g.maker}>{g.maker} ({g.tanks.length} Positionen)</option>
              ))}
            </Select>
          </Field>
        )}

        {kind === 'tank' && (
          <Field label="Tank">
            <Select value={tankId} onChange={(e) => setTankId(e.target.value)}>
              {db.tanks.filter(isOpen).map((t) => (
                <option key={t.id} value={t.id}>{t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}{t.litres > 0 && ` · ${num(t.litres)} l`} · {eur(t.vb)}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Für welche Portale?" hint="Je Portal entsteht eine eigene Anzeige mit passender Formulierung.">
          <div className="space-y-1.5">
            {portals.map((p) => (
              <label key={p.id} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-surface-2 p-2.5 hover:border-line-strong">
                <input type="checkbox" checked={picked.includes(p.id)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                  onChange={() => setPicked((v) => (v.includes(p.id) ? v.filter((x) => x !== p.id) : [...v, p.id]))} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{p.name}</span>
                  <span className="block text-xs text-muted">
                    {p.style === 'fach' ? 'Fachportal · Branchensprache, MwSt. separat ausgewiesen' : 'Privatmarkt · allgemein verständlich'}
                    {' · '}Titel max. {p.titleLimit}
                  </span>
                </span>
              </label>
            ))}
            {portals.length === 0 && <p className="text-sm text-muted">Keine Portale angelegt — unter Einstellungen ergänzen.</p>}
          </div>
        </Field>

        {previews.map(({ portal, gen }) => (
          <div key={portal?.id} className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted uppercase">Vorschau · {portal?.name}</span>
              <Counter value={gen.title.length} limit={limitsOf(portal).title} />
            </div>
            <div className="mt-1 font-bold">{gen.title}</div>
            <pre className="mt-2 max-h-44 overflow-y-auto text-[13px] leading-relaxed whitespace-pre-wrap text-muted">{gen.body}</pre>
          </div>
        ))}

        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={picked.length === 0} onClick={() => onCreated(createAdsForPortals(db, scope, picked))}>
            {picked.length > 1 ? `${picked.length} Anzeigen anlegen` : 'Anzeige anlegen'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * Photos for one listing, ready to upload. The pictures sit in the private data
 * repo — a buyer can never reach them by link, so they have to go onto the portal
 * itself, where they cost nothing and where people actually look.
 */
function AdPhotos({ ad }: { ad: Ad }) {
  const { db } = useStore()
  const [busy, setBusy] = useState<'' | 'zip' | 'collage'>('')
  const [error, setError] = useState<string | null>(null)

  // Order follows the ad text, so the numbering matches what a reader sees.
  const items = ad.tankIds
    .map((id) => db.tanks.find((t) => t.id === id))
    .filter((t): t is Tank => !!t)
  const withPhoto = items.filter((t) => t.photos.length > 0)
  const missing = items.length - withPhoto.length
  const total = withPhoto.reduce((a, t) => a + t.photos.length, 0)

  const nameOf = (t: Tank) => safeName(t.maker === 'Sonstige' ? t.type : `${t.maker}_${t.type}`)

  async function run(kind: 'zip' | 'collage') {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'zip') {
        const files: { name: string; blob: Blob }[] = []
        let n = 0
        for (const t of withPhoto) {
          for (const [i, path] of t.photos.entries()) {
            const url = await store.photoUrl(path)
            if (!url) continue
            n += 1
            const blob = await (await fetch(url)).blob()
            files.push({ name: `${String(n).padStart(2, '0')}_${nameOf(t)}${t.photos.length > 1 ? `_${i + 1}` : ''}.jpg`, blob })
          }
        }
        if (files.length === 0) throw new Error('Keine Fotos zum Herunterladen.')
        download(await zip(files), `${safeName(ad.title).slice(0, 40)}_Fotos.zip`)
      } else {
        // One photo per position — a collage of the same barrel twelve times helps nobody.
        const entries = []
        for (const t of withPhoto) {
          const url = await store.photoUrl(t.photos[0])
          if (url) entries.push({ url, caption: `${t.maker === 'Sonstige' ? t.type : `${t.maker} ${t.type}`}${t.litres > 0 ? ` · ${num(t.litres)} l` : ''}` })
        }
        download(await collage(entries), `${safeName(ad.title).slice(0, 40)}_Uebersicht.jpg`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hat nicht geklappt.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-muted">
          Fotos · {total} {total === 1 ? 'Bild' : 'Bilder'} zu {withPhoto.length} von {items.length} Positionen
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" disabled={total === 0 || busy !== ''} onClick={() => void run('zip')}>
            <IconDownload />{busy === 'zip' ? 'Packt …' : 'Alle Fotos (ZIP)'}
          </Button>
          <Button size="sm" disabled={withPhoto.length < 2 || busy !== ''} onClick={() => void run('collage')}>
            <IconGrid />{busy === 'collage' ? 'Erzeugt …' : 'Übersichtsbild'}
          </Button>
        </span>
      </div>
      <p className="text-[13px] text-muted">
        Die Bilder direkt beim Portal hochladen — dort sind sie kostenlos und werden angesehen. Als Link in den
        Anzeigentext gehören sie nicht: Sie liegen im privaten Repository und wären für Käufer nicht erreichbar.
      </p>
      {missing > 0 && (
        <p className="mt-1.5 text-[13px] font-semibold text-amber">
          {missing} {missing === 1 ? 'Position hat' : 'Positionen haben'} noch kein Foto — im Bestand über „ohne Foto" zu finden.
        </p>
      )}
      {error && <p className="mt-1.5 text-[13px] font-semibold text-rose">{error}</p>}
    </div>
  )
}

function AdModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { db } = useStore()
  const ad = db.ads.find((a) => a.id === id)
  if (!ad) return null
  const portal = portalOf(db, ad.portalId)
  const lim = limitsOf(portal)
  const drift = adDrift(db, ad)

  return (
    <Modal open onClose={onClose} title={`Anzeigentext · ${portal?.name ?? 'Ohne Portal'}`} wide>
      <div className="space-y-4">
        {drift.stale && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber/50 bg-amber-soft/50 p-3 text-sm">
            <span><strong>Der Bestand hat sich geändert.</strong> Text neu erzeugen?</span>
            <Button size="sm" variant="primary" onClick={() => refreshAd(ad.id)}><IconRefresh />Aktualisieren</Button>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-end justify-between">
            <span className="text-[13px] font-semibold text-muted">Titel</span>
            <span className="flex items-center gap-2"><Counter value={ad.title.length} limit={lim.title} /><CopyButton text={ad.title} /></span>
          </div>
          <Input value={ad.title} onChange={(e) => patchAd(ad.id, { title: e.target.value })} className="font-semibold" />
        </div>

        <div>
          <div className="mb-1 flex items-end justify-between">
            <span className="text-[13px] font-semibold text-muted">Beschreibung</span>
            <span className="flex items-center gap-2"><Counter value={ad.body.length} limit={lim.body} /><CopyButton text={ad.body} /></span>
          </div>
          <Textarea rows={14} value={ad.body} onChange={(e) => patchAd(ad.id, { body: e.target.value })} className="font-mono text-[13px]" />
        </div>

        <AdPhotos ad={ad} />

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1 flex items-end justify-between">
              <span className="text-[13px] font-semibold text-muted">Preis</span>
              <CopyButton text={String(ad.price)} label="€" />
            </div>
            <Input type="number" className="tnum font-bold" value={ad.price} onChange={(e) => patchAd(ad.id, { price: Number(e.target.value) || 0 })} />
          </div>
          <Field label="Preistyp">
            <Select value={ad.priceType} onChange={(e) => patchAd(ad.id, { priceType: e.target.value as Ad['priceType'] })}>
              <option value="VB">VB (Verhandlungsbasis)</option>
              <option value="Festpreis">Festpreis</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={ad.status} onChange={(e) => patchAd(ad.id, { status: e.target.value as AdStatus }, `Anzeige: ${STATUS_LABEL[e.target.value as AdStatus]}`)}>
              {(['entwurf', 'online', 'offline'] as AdStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Portal wechseln" hint="Ändert Zeichengrenzen und Zielseite. Der Text wird dabei nicht neu erzeugt.">
          <Select value={ad.portalId} onChange={(e) => patchAd(ad.id, { portalId: e.target.value }, 'Anzeige einem anderen Portal zugeordnet')}>
            {db.settings.portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>

        <Field label="Link zur Anzeige" hint="Nach dem Einstellen die URL hier einfügen — dann kommst du mit einem Klick zum Bearbeiten.">
          <Input value={ad.url} onChange={(e) => patchAd(ad.id, { url: e.target.value })} placeholder="https://…" inputMode="url" />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="danger" onClick={() => { if (confirm('Anzeige löschen?')) { removeAd(ad.id); onClose() } }}><IconTrash />Löschen</Button>
          <div className="flex flex-wrap gap-2">
            {portal && (
              <a href={portal.postUrl} target="_blank" rel="noreferrer noopener"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 text-sm font-semibold transition hover:bg-surface-3">
                <IconLink />{portal.name} öffnen
              </a>
            )}
            {ad.status === 'online' ? (
              <Button onClick={() => bumpAd(ad.id)}><IconRefresh />Hochgeholt</Button>
            ) : (
              <Button variant="primary" onClick={() => markAdPublished(ad.id)}>Als online markieren</Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Counter({ value, limit }: { value: number; limit: number }) {
  const over = value > limit
  return (
    <span className={cx('tnum text-xs font-bold', over ? 'text-rose' : value > limit * 0.9 ? 'text-amber' : 'text-faint')}>
      {value}/{limit}
    </span>
  )
}
