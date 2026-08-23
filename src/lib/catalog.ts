import type { Catalog, CatalogBundle, DB } from '../types'
import { resolveBundle } from './bundles'
import { isOpen } from './stats'

/**
 * The public catalogue is built by whitelist, never by deletion: only the fields
 * listed here can ever leave the private repo. Zielpreis, Untergrenze, Gebote,
 * Notizen und Interessenten bleiben damit auch dann drin, wenn das Datenmodell
 * später wächst.
 */
export function buildCatalog(db: DB): Catalog {
  const label = (id: string) => db.settings.categories.find((c) => c.id === id)?.label ?? id
  const open = db.tanks.filter(isOpen)
  // Reservierte Positionen bleiben in der Liste — ein zweiter Interessent ist Gold
  // wert, wenn die Reservierung platzt. In einem Paket haben sie nichts verloren:
  // ein Paketpreis ist ein festes Angebot, und was schon jemandem zugesagt ist,
  // kann darin nicht mitverkauft werden.
  const stock = new Map(
    open.filter((t) => t.status !== 'reserviert').map((t) => [t.id, { id: t.id, category: t.category, vb: t.vb }]),
  )
  return {
    seller: db.settings.seller.name,
    location: [db.settings.seller.plz, db.settings.seller.location].filter(Boolean).join(' '),
    email: db.settings.seller.email,
    intro: db.settings.catalog.intro,
    pickupInfo: db.settings.seller.pickupInfo,
    imprintUrl: db.settings.catalog.imprintUrl ?? '',
    privacy: privacyText(db),
    vatRate: db.settings.vatRate,
    updatedAt: new Date().toISOString(),
    items: open.map((t) => ({
      id: t.id,
      category: t.category,
      categoryLabel: label(t.category),
      maker: t.maker,
      type: t.type,
      litres: t.litres,
      vb: t.vb,
      dims: t.dims,
      // A used stainless tank whose condition nobody can see is always guessed
      // worse than it is. The files themselves are copied by publishCatalog.
      photos: t.photos,
      // Was an der Ware dransteht, nicht was über sie besprochen wurde: `note`
      // bleibt in der privaten Datenbank, `tags` gehen hinaus.
      tags: t.tags,
      // Hiding this loses the second buyer entirely; showing it turns them into a backup.
      reserved: t.status === 'reserviert',
    })),
    // Nur Gruppen, in denen wirklich etwas steht — eine leere Überschrift mit
    // Werbetext darunter wäre ein Angebot für nichts.
    categories: db.settings.categories
      .filter((c) => open.some((t) => t.category === c.id))
      .map((c) => ({ id: c.id, label: c.label, note: c.note ?? '' })),
    // Von einem Paket geht die fertige Zusammenstellung und der fertige Preis raus,
    // nicht der eingestellte Nachlass — und schon gar nicht, gegen welche Untergrenze
    // er gerechnet wurde. Verkaufte Positionen fallen dabei still heraus.
    bundles: db.settings.bundles
      .map((b) => resolveBundle(b, stock))
      .filter((b): b is CatalogBundle => b !== null),
    // Die Staffel ist ein Angebot und darf gelesen werden. Stufen ohne Nachlass
    // wären nur eine Zeile, die nichts verspricht.
    tiers: db.settings.tiers.filter((t) => t.discount > 0),
  }
}

/**
 * Datenschutzhinweis für genau diese Seite.
 *
 * Die Erklärung der eigenen Firmenseite passt hier nicht: der Katalog liegt bei
 * einem anderen Anbieter (GitHub Pages), und was hier passiert, ist ein anderer
 * Vorgang. Der Text wird beim Veröffentlichen mitgeschrieben, damit er zu dem
 * Stand gehört, den der Käufer tatsächlich sieht.
 *
 * Was diese Seite wirklich tut, und nur das steht drin: sie wird von GitHub
 * ausgeliefert (dabei fällt die IP-Adresse an), lädt Schrift und Bilder aus dem
 * eigenen Bestand, setzt keine Cookies, misst nichts und bindet nichts Fremdes
 * ein. Die Anfrage entsteht als E-Mail im Programm des Besuchers — abgeschickt
 * wird sie von ihm, nicht von der Seite.
 */
function privacyText(db: DB): string {
  const s = db.settings.seller
  const who = [s.name, [s.plz, s.location].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [
    `Verantwortlich für diese Seite: ${who || 'siehe Impressum'}${s.email ? `, ${s.email}` : ''}. Vollständige Anschrift im Impressum.`,
    '',
    'Diese Seite wird von GitHub Inc. (GitHub Pages) ausgeliefert. Beim Aufruf überträgt Ihr Browser technisch bedingt Ihre IP-Adresse an GitHub; GitHub speichert sie in Server-Protokollen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO — ohne diese Übertragung lässt sich keine Seite ausliefern.',
    '',
    'Die Seite setzt keine Cookies, misst kein Nutzungsverhalten und bindet keine fremden Inhalte ein. Schrift und Bilder werden von derselben Adresse geladen wie die Seite selbst.',
    '',
    'Ihre Auswahl bleibt in Ihrem Browser und wird nirgends gespeichert. Klicken Sie auf „Anfrage senden“, öffnet sich Ihr eigenes E-Mail-Programm mit einem vorbereiteten Text. Abgeschickt wird die Nachricht erst von Ihnen. Was Sie uns dabei schreiben — Name, Adresse, Telefonnummer — verarbeiten wir ausschließlich, um Ihre Anfrage zu beantworten und ein Geschäft abzuwickeln (Art. 6 Abs. 1 lit. b DSGVO), und löschen es, sobald die gesetzlichen Aufbewahrungsfristen abgelaufen sind.',
    '',
    'Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie das Recht, sich bei einer Aufsichtsbehörde zu beschweren.',
  ].join('\n')
}

/** Where the buyer page reads the published file from. */
export function catalogRawUrl(c: DB['settings']['catalog']): string {
  return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${c.path}`
}

export function catalogPageUrl(c: DB['settings']['catalog']): string {
  return `https://${c.owner}.github.io/${c.repo}/katalog.html`
}

/**
 * Ein kurzer Fingerabdruck dessen, was den Käufer erreicht.
 *
 * Damit lässt sich beantworten, ob der veröffentlichte Stand noch dem entspricht,
 * was in der Datenbank steht — ohne die ganze Datei zu vergleichen und ohne sie in
 * der Datenbank abzulegen. FNV-1a genügt: es geht um "gleich oder nicht", nicht um
 * Fälschungssicherheit.
 */
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Fingerabdruck einer fertig gebauten Liste. */
export function stampOf(catalog: Catalog): string {
  // updatedAt wird bei jedem Bauen neu gesetzt und würde jeden Vergleich verderben.
  const { updatedAt: _ignored, ...rest } = catalog
  return hash(JSON.stringify(rest))
}

export function catalogStamp(db: DB): string {
  return stampOf(buildCatalog(db))
}

/** Nur die Bilder. Stimmen sie noch, muss beim Veröffentlichen keine Datei angefasst werden. */
export function photoStamp(db: DB): string {
  const all = db.tanks.filter(isOpen).flatMap((t) => t.photos)
  return hash([...new Set(all)].sort().join('|'))
}
