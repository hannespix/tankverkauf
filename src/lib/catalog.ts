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
      // Hiding this loses the second buyer entirely; showing it turns them into a backup.
      reserved: t.status === 'reserviert',
    })),
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

/** Where the buyer page reads the published file from. */
export function catalogRawUrl(c: DB['settings']['catalog']): string {
  return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${c.path}`
}

export function catalogPageUrl(c: DB['settings']['catalog']): string {
  return `https://${c.owner}.github.io/${c.repo}/katalog.html`
}
