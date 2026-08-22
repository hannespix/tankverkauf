import type { Catalog, DB } from '../types'
import { isOpen } from './stats'

/**
 * The public catalogue is built by whitelist, never by deletion: only the fields
 * listed here can ever leave the private repo. Zielpreis, Untergrenze, Gebote,
 * Notizen und Interessenten bleiben damit auch dann drin, wenn das Datenmodell
 * später wächst.
 */
export function buildCatalog(db: DB): Catalog {
  const label = (id: string) => db.settings.categories.find((c) => c.id === id)?.label ?? id
  return {
    seller: db.settings.seller.name,
    location: [db.settings.seller.plz, db.settings.seller.location].filter(Boolean).join(' '),
    email: db.settings.seller.email,
    intro: db.settings.catalog.intro,
    pickupInfo: db.settings.seller.pickupInfo,
    vatRate: db.settings.vatRate,
    updatedAt: new Date().toISOString(),
    items: db.tanks.filter(isOpen).map((t) => ({
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
  }
}

/** Where the buyer page reads the published file from. */
export function catalogRawUrl(c: DB['settings']['catalog']): string {
  return `https://raw.githubusercontent.com/${c.owner}/${c.repo}/${c.branch}/${c.path}`
}

export function catalogPageUrl(c: DB['settings']['catalog']): string {
  return `https://${c.owner}.github.io/${c.repo}/katalog.html`
}
