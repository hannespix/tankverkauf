import { useState } from 'react'
import { PriceLadder } from '../components/charts'
import { LeadPicker } from '../components/LeadPicker'
import { Button, Card, EmptyState, Field, Input, Pill, SectionTitle, Select, Stat, Textarea, cx, type Tone } from '../components/ui'
import { IconHandshake, IconLock, IconPlus, IconTrash } from '../components/icons'
import { patchQuote, quoteToDeal, removeQuote, setQuoteLinePrice, setQuoteReserved, setQuoteTanks } from '../lib/actions'
import { itemLabel, centsPerLitre, dateDE, eur, num, todayISO } from '../lib/format'
import { collapseIds, publicEffect } from '../lib/inbox'
import { Verlauf } from '../components/Verlauf'
import { useStore } from '../lib/store'
import { VERDICT_LABEL, linePrice, quoteMetrics } from '../lib/stats'
import { QUOTE_STATUS_LABEL, type Quote, type QuoteStatus, type Tank } from '../types'

const STATUSES: QuoteStatus[] = ['entwurf', 'gesendet', 'verhandlung', 'angenommen', 'abgelehnt']
const STATUS_TONE: Record<QuoteStatus, Tone> = {
  entwurf: 'neutral', gesendet: 'sky', verhandlung: 'amber', angenommen: 'green', abgelehnt: 'neutral',
}

export default function Quotes() {
  const { db } = useStore()
  const [filter, setFilter] = useState<QuoteStatus | ''>('')
  const [leadSel, setLeadSel] = useState('')
  const [portalSel, setPortalSel] = useState('')

  const openQuotes = db.quotes.filter((q) => q.status !== 'angenommen' && q.status !== 'abgelehnt')
  const shown = db.quotes.filter((q) => {
    if (filter && q.status !== filter) return false
    if (leadSel === '__none' ? q.leadId : leadSel && q.leadId !== leadSel) return false
    if (portalSel && q.portalId !== portalSel) return false
    return true
  })

  const openValue = openQuotes.reduce((a, q) => a + (q.buyerOffer ?? q.askPrice), 0)
  const openLitres = openQuotes.reduce(
    (a, q) => a + q.tankIds.reduce((x, id) => x + (db.tanks.find((t) => t.id === id)?.litres ?? 0), 0), 0)
  const belowFloor = openQuotes.filter((q) => quoteMetrics(db, q.tankIds, q.askPrice, q.buyerOffer, q.prices).verdict === 'unter-limit')

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Offene Angebote" value={openQuotes.length} sub={`${db.quotes.length} insgesamt`} />
        <Stat label="Im Angebot" value={`${num(openLitres)} l`} sub={`${openQuotes.reduce((a, q) => a + q.tankIds.length, 0)} ${openQuotes.reduce((a, q) => a + q.tankIds.length, 0) === 1 ? 'Position' : 'Positionen'} gebunden`} />
        <Stat label="Angebotswert" value={eur(openValue)} sub="offene Angebote, brutto" tone="green" />
        <Stat label="Unter Untergrenze" value={belowFloor.length} sub="genauer ansehen" tone={belowFloor.length ? 'rose' : undefined} />
      </section>

      <Card pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <SectionTitle title="Angebote" hint="Was wem zu welchem Preis angeboten wurde — und wie viel Luft noch bleibt." />
          <div className="flex flex-wrap gap-2">
            <Select value={filter} onChange={(e) => setFilter(e.target.value as QuoteStatus | '')} className="w-auto min-w-[150px]">
              <option value="">Alle Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
            </Select>
            <Select value={leadSel} onChange={(e) => setLeadSel(e.target.value)} className="w-auto min-w-[170px]">
              <option value="">Alle Interessenten</option>
              <option value="__none">ohne Interessent</option>
              {db.leads.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select value={portalSel} onChange={(e) => setPortalSel(e.target.value)} className="w-auto min-w-[150px]">
              <option value="">Alle Portale</option>
              {db.settings.portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </div>
        </div>
      </Card>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            title={db.quotes.length === 0 ? 'Noch kein Angebot erstellt' : 'Keine Angebote mit diesem Status'}
            hint="In der Tankliste filtern (z. B. Hersteller Speidel), alle auswählen und „Angebot erstellen“ wählen. Summen, Zielpreis und Untergrenze siehst du dabei live."
          />
        </Card>
      ) : (
        <div className="space-y-3">{shown.map((q) => <QuoteCard key={q.id} quote={q} />)}</div>
      )}
    </div>
  )
}

function QuoteCard({ quote }: { quote: Quote }) {
  const { db } = useStore()
  const m = quoteMetrics(db, quote.tankIds, quote.askPrice, quote.buyerOffer, quote.prices)
  const lead = db.leads.find((l) => l.id === quote.leadId)
  const portal = db.settings.portals.find((p) => p.id === quote.portalId)
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState('')
  // Nur freie Positionen, und nur solche, die nicht schon drin sind.
  const matching = db.tanks
    .filter((t) => t.status === 'verfuegbar' && !quote.tankIds.includes(t.id))
    .filter((t) => {
      const q = pick.trim().toLowerCase()
      return !q || [t.id, t.maker, t.type, String(t.litres)].some((v) => v.toLowerCase().includes(q))
    })
  // Gekappt wird weiter, aber nicht mehr stumm: bei 29 gleich aussehenden
  // Dekofässern konnte niemand wissen, dass es F-21 bis F-29 überhaupt gibt.
  const addable = matching.slice(0, 20)
  const closed = quote.status === 'angenommen' || quote.status === 'abgelehnt'

  /*
   * Wer im Angebot steht, in welchem Zustand.
   *
   * `fremd` sind Positionen, die inzwischen jemand anderem zugesagt wurden —
   * sie verschwanden bisher beim nächsten Positionswechsel stillschweigend aus
   * dem Angebot. Jetzt stehen sie benannt da, statt zu verschwinden.
   */
  const positionen = quote.tankIds.map((id) => db.tanks.find((t) => t.id === id)).filter((t): t is Tank => !!t)
  const fremd = positionen.filter((t) => t.status === 'reserviert' && t.leadId && t.leadId !== quote.leadId)
  const offene = positionen.filter((t) => t.status !== 'verkauft' && !fremd.includes(t))
  const reserviert = offene.filter((t) => t.status === 'reserviert').map((t) => t.id)
  const reservierbar = offene.filter((t) => t.status !== 'reserviert').map((t) => t.id)

  /**
   * Reservieren wirkt nach außen, deshalb wird gefragt — und die Frage nennt,
   * was der Käufer danach sieht. Bei 31 baugleichen Dekofässern ist die Anzahl
   * allein keine Auskunft; `publicEffect` rechnet aus, welches Paket dadurch
   * kleiner wird oder ganz von der Käuferseite verschwindet.
   */
  function reservieren(ids: string[], on: boolean) {
    const betroffen = positionen.filter((t) => ids.includes(t.id))
    const wer = lead ? ` für ${lead.name}` : ''
    const frage = on
      ? `${ids.length} ${ids.length === 1 ? 'Position' : 'Positionen'} (${collapseIds(ids)})${wer} reservieren?\n\n${publicEffect(db, betroffen)}`
      : `Reservierung für ${collapseIds(ids)} lösen? Die ${ids.length === 1 ? 'Position steht' : 'Positionen stehen'} danach wieder frei im Katalog.`
    if (confirm(frage)) setQuoteReserved(quote.id, ids, on)
  }

  return (
    <Card className={cx(closed && 'opacity-70')}>
      <SectionTitle
        title={quote.label}
        hint={[
          lead ? lead.name : 'kein Interessent',
          portal?.name,
          `${m.count} Position${m.count === 1 ? '' : 'en'}${m.litres > 0 ? ` · ${num(m.litres)} l` : ''}`,
          quote.validUntil ? `gültig bis ${dateDE(quote.validUntil)}` : null,
        ].filter(Boolean).join(' · ')}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Zwei verschiedene Zustände, zwei verschiedene Sätze.
              Die Gesamtwarnung misst die eine Zahl gegen die Summe der
              Untergrenzen — ein Angebot kann darüber liegen und trotzdem eine
              einzelne Position verschenken. Beide gleich zu benennen wäre die
              Warnung, die niemand mehr liest.
            */}
            {m.underFloor.length > 0 && (
              <Pill tone="rose">
                {m.underFloor.length === 1
                  ? `${m.underFloor[0]} unter seiner Untergrenze`
                  : `${m.underFloor.length} Positionen unter ihrer Untergrenze`}
              </Pill>
            )}
            {m.verdict && (
              <Pill tone={m.verdict === 'unter-limit' ? 'rose' : m.verdict === 'ok' ? 'amber' : 'green'}>
                {VERDICT_LABEL[m.verdict]}
              </Pill>
            )}
            <Pill tone={STATUS_TONE[quote.status]}>{QUOTE_STATUS_LABEL[quote.status]}</Pill>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Summe Einzel-VB" value={eur(m.vb)} sub={m.litres > 0 ? `${num(m.litres)} l` : ''} />
        <Figure label="Zielpreis gesamt" value={eur(m.target)} sub="angestrebt" />
        <Figure label="Untergrenze gesamt" value={eur(m.floor)} sub="nicht darunter" tone="rose" />
        <Figure
          label={quote.buyerOffer != null ? 'Käufergebot' : 'Unser Angebot'}
          value={eur(m.decisive)}
          sub={m.litres ? centsPerLitre(m.decisive, m.litres) : '–'}
          tone={m.verdict === 'unter-limit' ? 'rose' : 'green'}
        />
      </div>

      <div className="mt-4">
        {/*
          Stand hier vorher "800 € unter Einzel-VB", während die Leiter darunter
          bei gesetztem Käufergebot dessen Zahl zeichnete: zwei Werte
          nebeneinander, die Verschiedenes maßen. Jetzt steht ausdrücklich da,
          welche Zahl welche ist.
        */}
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[13px]">
          <span className="font-semibold text-muted">Wo liegt der Preis?</span>
          <span className="tnum text-muted">
            Einzelpreise {eur(m.lines)} · gefordert {eur(m.askPrice)}
            {m.bundleOff > 0 && ` · ${eur(m.bundleOff)} Paketnachlass`}
            {m.bundleOff < 0 && ` · ${eur(-m.bundleOff)} darüber`}
          </span>
        </div>
        {m.lines !== m.vb && (
          <p className="mb-1 text-xs text-muted">
            Ohne verhandelte Zeilen stünden hier {eur(m.vb)} — die Summe der Bestands-VB.
          </p>
        )}
        <PriceLadder floor={m.floor} target={m.target} vb={m.vb} offer={m.decisive} format={eur} />
      </div>

      {/*
        Gelesen wird kompakt, bearbeitet wird in Zeilen.
        Im aufgeklappten Zustand übernimmt die Preisliste weiter unten dieselben
        Positionen samt Nummer, Preisfeld und Entfernen-Knopf — beides zugleich
        zu zeigen hieße, dieselbe Position zweimal mit zwei Bedienungen
        anzubieten. Der ausgehandelte Preis steht auch in der Marke, sonst müsste
        man zum Nachsehen erst aufklappen.
      */}
      {!(open && !closed) && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {quote.tankIds.map((id) => {
            const t = db.tanks.find((x) => x.id === id)
            if (!t) return null
            const preis = linePrice(quote, t)
            return (
              <li key={id}>
                <Pill tone={t.status === 'verkauft' ? 'neutral' : t.status === 'reserviert' ? 'amber' : preis < t.floor ? 'rose' : 'sky'}>
                  <span className="tnum">{t.id}</span> {itemLabel(t)}
                  {preis !== t.vb && <span className="tnum ml-1 opacity-80">· {eur(preis)}</span>}
                  {/* Reserviert war in dieser Liste bisher nicht zu sehen — die
                      Marke hatte denselben Ton wie eine freie Position. */}
                  {t.status === 'reserviert' && <span className="ml-1 opacity-80">· reserviert</span>}
                </Pill>
              </li>
            )
          })}
          {quote.tankIds.length === 0 && <li className="text-[13px] text-amber">Keine Position im Angebot.</li>}
        </ul>
      )}

      {/*
        Angeboten, abgelehnt — und die Ware hängt weiter fest.
        Aufgelöst wird das NICHT von selbst: eine falsch zugeordnete Absage gäbe
        sonst reservierte Ware wieder öffentlich frei. Angeboten wird es, damit
        es niemandem entgeht.
      */}
      {quote.status === 'abgelehnt' && reserviert.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-soft px-3 py-2 text-[13px] text-amber">
          Das Angebot ist abgelehnt, {collapseIds(reserviert)} {reserviert.length === 1 ? 'steht' : 'stehen'} aber
          weiter reserviert — für Käufer sichtbar vergeben. Unten lösen.
        </p>
      )}

      {/*
        Der Schriftwechsel gehört auch hierher.
        Aus dem Angebot heraus wird geantwortet — mit einem Knopf, der die
        fertige Angebots-E-Mail einsetzt. Gespeichert wird sie beim
        Interessenten, nicht am Angebot: sonst hätte, wer zwei Angebote hat,
        zwei halbe Verläufe. Ohne zugeordneten Interessenten gibt es nichts zu
        zeigen — dann steht das da, statt dass der Bereich leer bleibt.
      */}
      {!open && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-1.5 text-[11px] font-bold text-muted uppercase">Schriftwechsel</p>
          {lead
            ? <Verlauf lead={lead} quote={quote} readOnly={false} />
            : <p className="text-[13px] text-muted">Erst einen Interessenten zuordnen — an ihm hängt der Verlauf.</p>}
        </div>
      )}

      {!open ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {/*
            Der Griff steht hier und nicht im Bearbeiten-Block: gebraucht wird
            er, wenn am Telefon zugesagt wurde — dann darf man nicht erst
            aufklappen müssen. Ohne Interessenten bleibt er gesperrt, sonst wäre
            die Ware öffentlich weg und intern niemandem zugeordnet.
          */}
          {reservierbar.length > 0 && !closed && (
            <Button
              disabled={!quote.leadId}
              title={quote.leadId ? undefined : 'Erst einen Interessenten zuordnen'}
              onClick={() => reservieren(reservierbar, true)}
            >
              <IconLock />{reservierbar.length === offene.length ? 'Reservieren' : `${reservierbar.length} noch reservieren`}
            </Button>
          )}
          {reserviert.length > 0 && (
            <Button variant="ghost" onClick={() => reservieren(reserviert, false)}>
              Reservierung lösen{reservierbar.length > 0 ? ` (${reserviert.length})` : ''}
            </Button>
          )}
          <Button onClick={() => setOpen(true)}>Bearbeiten</Button>
          {!closed && (
            <Button variant="primary" onClick={() => { if (confirm(`„${quote.label}“ zu ${eur(m.decisive)} als Verkauf buchen?`)) quoteToDeal(quote.id) }}>
              <IconHandshake />Als Verkauf buchen
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          {/*
            Die Positionen eines Angebots ließen sich bisher überhaupt nicht
            ändern — kein einziger Schreibweg fasste `tankIds` an. Wer eine
            Position herausnehmen wollte, musste sie aus dem Bestand löschen.
          */}
          {!closed && (
            <Field as="div" label="Positionen und Einzelpreise">
              <div className="space-y-2">
                {/*
                  Eine Zeile je Position, nie zusammengefasst.
                  T-17, T-18 und T-19 sind bis aufs letzte Feld baugleich — die
                  Nummer ist das einzige, was sie unterscheidet. Deshalb steht
                  sie vorn, ungedimmt, und in jedem aria-label: sonst kündigt
                  eine Vorlesehilfe drei identische "Preis"-Felder an. Und
                  sobald sich zwei Preise unterscheiden, könnte eine gruppierte
                  Zeile sie ohnehin nicht mehr zeigen.
                */}
                <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface-2 p-2">
                  {quote.tankIds.map((id) => {
                    const t = db.tanks.find((x) => x.id === id)
                    if (!t) return null
                    const preis = linePrice(quote, t)
                    const drunter = preis < t.floor
                    return (
                      <li key={id} className="flex items-center gap-2 text-[13px]">
                        {/*
                          Einzeln umschalten, ohne Rückfrage: eine Position ist
                          eine überschaubare Folge, und der Zustand steht in
                          derselben Zeile. Gefragt wird beim Knopf in der
                          Fußzeile — der trifft im Zweifel 31 Fässer auf einmal.
                        */}
                        <input
                          type="checkbox"
                          aria-label={`${t.id}, ${itemLabel(t)} reservieren`}
                          checked={t.status === 'reserviert'}
                          disabled={t.status === 'verkauft' || !quote.leadId || fremd.includes(t)}
                          title={
                            t.status === 'verkauft' ? 'Verkauft'
                              : fremd.includes(t) ? 'Für jemand anderen reserviert — erst dort lösen'
                                : quote.leadId ? 'Für diesen Interessenten reservieren'
                                  : 'Erst einen Interessenten zuordnen'
                          }
                          onChange={(e) => setQuoteReserved(quote.id, [t.id], e.target.checked)}
                          className="h-4 w-4 shrink-0 accent-[var(--amber)] disabled:opacity-30"
                        />
                        <span className="tnum w-12 shrink-0 font-semibold">{t.id}</span>
                        <span className="truncate">{itemLabel(t)}</span>
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          <input
                            type="number"
                            inputMode="numeric"
                            aria-label={`Preis für ${t.id}, ${itemLabel(t)}`}
                            // Ungesetzt bleibt das Feld LEER und zeigt die VB nur
                            // blass als Platzhalter. Stünde die Zahl darin, sähe
                            // niemand mehr, welche Zeile er wirklich bewegt hat.
                            value={quote.prices?.[t.id] ?? ''}
                            placeholder={String(t.vb)}
                            onChange={(e) => setQuoteLinePrice(quote.id, t.id, e.target.value === '' ? null : Number(e.target.value))}
                            className={cx(
                              'tnum w-24 rounded-lg border bg-surface px-2 py-1 text-right',
                              drunter ? 'border-rose text-rose' : 'border-line',
                            )}
                          />
                          <span className="w-3 text-faint">€</span>
                          {quote.tankIds.length > 1 && (
                            <button
                              type="button"
                              aria-label={`${t.id} ${itemLabel(t)} aus dem Angebot nehmen`}
                              onClick={() => setQuoteTanks(quote.id, quote.tankIds.filter((x) => x !== id))}
                              className="flex h-6 w-6 items-center justify-center rounded leading-none text-faint hover:bg-surface-3 hover:text-rose"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="tnum text-muted">
                    Summe der Einzelpreise <strong>{eur(m.lines)}</strong>
                    {m.bundleOff !== 0 && ` · gefordert ${eur(m.askPrice)}`}
                  </span>
                  {/* Kurz beschriftet: die lange Fassung lief aus der Karte
                      heraus und landete unter dem schwebenden Posteingang. */}
                  {m.bundleOff !== 0 && (
                    <Button size="sm" onClick={() => patchQuote(quote.id, { askPrice: m.lines })}>
                      Summe übernehmen
                    </Button>
                  )}
                </div>
                {/* Der Hinweis gehört hierher, nicht ans Ende des Blocks: als
                    Field-hint stand er unter dem Suchfeld und damit zwei
                    Bildschirmdrittel von der Zahl entfernt, die er erklärt. */}
                <p className="text-xs text-muted">
                  Leer heißt: Preis aus dem Bestand. Der geforderte Gesamtpreis rechnet mit,
                  solange er nicht von Hand gesetzt wurde.
                </p>
                {m.underFloor.length > 0 && (
                  <p className="text-[13px] text-rose">
                    Unter der eigenen Untergrenze: {m.underFloor.join(', ')}.
                  </p>
                )}
                {/* Bisher verschwanden diese Positionen beim nächsten
                    Positionswechsel stillschweigend aus dem Angebot. */}
                {fremd.length > 0 && (
                  <p className="text-[13px] text-amber">
                    Inzwischen anderweitig reserviert: {collapseIds(fremd.map((t) => t.id))} — erst dort lösen.
                  </p>
                )}
                {quote.tankIds.length === 1 && (
                  <p className="text-[13px] text-muted">
                    Die letzte Position bleibt — ein Angebot über nichts stünde mit 0 € da. Erst eine weitere hinzufügen, dann diese entfernen.
                  </p>
                )}
                <Input value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Position suchen und hinzufügen …" />
                {pick.trim() && (
                  <div className="relative z-40 max-h-40 overflow-y-auto rounded-xl border border-line bg-surface-2 p-2">
                    {addable.length === 0 && <p className="px-2 py-1 text-[13px] text-muted">Nichts Freies gefunden.</p>}
                    {matching.length > addable.length && (
                      <p className="px-2 py-1 text-[13px] text-muted">
                        {addable.length} von {matching.length} — genauer suchen zeigt die übrigen.
                      </p>
                    )}
                    {addable.map((t) => (
                      <button key={t.id} type="button"
                        onClick={() => { setQuoteTanks(quote.id, [...quote.tankIds, t.id]); setPick('') }}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-surface-3">
                        <IconPlus className="h-4 w-4 shrink-0" />
                        <span className="tnum shrink-0 text-faint">{t.id}</span>
                        <span className="truncate">{itemLabel(t)}</span>
                        <span className="tnum ml-auto shrink-0 text-muted">{eur(t.vb)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Unser Angebotspreis (€)">
              <Input type="number" className="tnum" value={quote.askPrice}
                onChange={(e) => patchQuote(quote.id, { askPrice: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Käufergebot (€)" hint="Was der Interessent geboten hat.">
              <Input type="number" className="tnum" value={quote.buyerOffer ?? ''} placeholder="–"
                onChange={(e) => patchQuote(quote.id, { buyerOffer: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Status">
              <Select value={quote.status}
                onChange={(e) => patchQuote(quote.id, { status: e.target.value as QuoteStatus }, `Angebot ${quote.label}: ${QUOTE_STATUS_LABEL[e.target.value as QuoteStatus]}`)}>
                {STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
              </Select>
            </Field>
            <Field label="Gültig bis">
              <Input type="date" value={quote.validUntil ?? ''} min={todayISO()}
                onChange={(e) => patchQuote(quote.id, { validUntil: e.target.value || null })} />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interessent">
              <LeadPicker value={quote.leadId ?? ''} stage="angebot" onChange={(id) => patchQuote(quote.id, { leadId: id || null })} />
            </Field>
            <Field label="Anfrage über">
              <Select value={quote.portalId ?? ''} onChange={(e) => patchQuote(quote.id, { portalId: e.target.value || null })}>
                <option value="">– unbekannt –</option>
                {db.settings.portals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          </div>

          <Field label="Notiz">
            <Textarea rows={2} value={quote.note} onChange={(e) => patchQuote(quote.id, { note: e.target.value })}
              placeholder="Gesprächsverlauf, Bedingungen, Abholung …" />
          </Field>

          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="danger" onClick={() => { if (confirm(`Angebot „${quote.label}“ löschen?`)) removeQuote(quote.id) }}>
              <IconTrash />Löschen
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>Fertig</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'green' | 'rose' }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <div className="text-[11px] font-bold text-muted uppercase">{label}</div>
      <div className={cx('tnum mt-0.5 text-xl font-extrabold', tone === 'green' && 'text-primary', tone === 'rose' && 'text-rose')}>{value}</div>
      <div className="text-[13px] text-muted">{sub}</div>
    </div>
  )
}
