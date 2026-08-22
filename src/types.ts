/** Domain model for the Tankverkauf dashboard. Everything is stored brutto (incl. VAT). */

export type TankStatus = 'verfuegbar' | 'kontakt' | 'reserviert' | 'verkauft'

/** Category id. The list itself is configurable, see Settings.categories. */
export type Category = string

export interface CategoryDef {
  id: string
  label: string
  /** Singular, for a single item in the list. */
  one: string
  /** Volume only makes sense for vessels; a pump has none. */
  hasVolume: boolean
  /** Included in the package price calculation. */
  inPackage: boolean
}
/** Free text — a pump maker is as valid here as a tank maker. */
export type Maker = string

export interface Tank {
  id: string
  category: Category
  maker: Maker
  /** Edelstahltank, Transporttank, Immervolltank … */
  type: string
  litres: number
  /** Verhandlungsbasis brutto — the public asking price. */
  vb: number
  /** Zielpreis brutto — what we realistically want. */
  target: number
  /** Untergrenze brutto — never go below without a deliberate decision. */
  floor: number
  status: TankStatus
  leadId: string | null
  dealId: string | null
  /** Current offer on the table, brutto. */
  offer: number | null
  pickup: string | null
  note: string
  tags: string[]
  /** Paths inside the data repo, e.g. fotos/T-12-a1b2.jpg */
  photos: string[]
  updatedAt: string
}

export type LeadStage = 'neu' | 'kontakt' | 'angebot' | 'reserviert' | 'gewonnen' | 'verloren'
export type LeadSource = 'kleinanzeigen' | 'telefon' | 'email' | 'empfehlung' | 'vorort' | 'sonstige'

export interface Lead {
  id: string
  name: string
  phone: string
  email: string
  location: string
  source: LeadSource
  stage: LeadStage
  /** Tanks this lead is interested in. */
  tankIds: string[]
  budget: number | null
  lastContact: string | null
  nextFollowUp: string | null
  note: string
  createdAt: string
  updatedAt: string
}

export interface Deal {
  id: string
  label: string
  leadId: string | null
  tankIds: string[]
  /** Total brutto for the whole bundle. */
  price: number
  date: string
  paid: boolean
  pickedUp: boolean
  note: string
}

/** A bundle offered to one interested party, before it becomes a sale. */
export type QuoteStatus = 'entwurf' | 'gesendet' | 'verhandlung' | 'angenommen' | 'abgelehnt'

export interface Quote {
  id: string
  label: string
  leadId: string | null
  /** Where the enquiry came from. */
  portalId: string | null
  tankIds: string[]
  /** What we are asking for the bundle, brutto. */
  askPrice: number
  /** What the buyer put on the table, brutto. */
  buyerOffer: number | null
  status: QuoteStatus
  validUntil: string | null
  note: string
  createdAt: string
  updatedAt: string
}

export type AdScopeKind = 'paket' | 'kategorie' | 'maker' | 'tank' | 'restposten' | 'custom'

export interface AdScope {
  kind: AdScopeKind
  maker?: Maker
  tankId?: string
  category?: Category
}

export type AdStatus = 'entwurf' | 'online' | 'offline'

/** Wording register: a consumer marketplace reads differently than a trade portal. */
export type PortalStyle = 'privat' | 'fach'

export interface Portal {
  id: string
  name: string
  /** Where a new ad is posted. */
  postUrl: string
  titleLimit: number
  bodyLimit: number
  style: PortalStyle
  /** Free note, e.g. costs or the right category to pick. */
  notes: string
  active: boolean
}

export interface Ad {
  id: string
  /** Which portal this ad is written for. */
  portalId: string
  title: string
  body: string
  price: number
  priceType: 'VB' | 'Festpreis'
  url: string
  scope: AdScope
  /** Tanks covered by the ad at the time it was last published. */
  tankIds: string[]
  status: AdStatus
  publishedAt: string | null
  bumpedAt: string | null
  views: number | null
  /** Fingerprint of the inventory the published text was generated from. */
  stamp: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface Settings {
  vatRate: number
  categories: CategoryDef[]
  portals: Portal[]
  packagePrice: number
  packageTarget: number
  packageFloor: number
  seller: {
    name: string
    location: string
    plz: string
    contact: string
    /** Where buyer requests from the public catalogue are sent. */
    email: string
    pickupInfo: string
  }
  /** Where the public catalogue is published. Empty owner disables it. */
  catalog: {
    owner: string
    repo: string
    branch: string
    path: string
    /** Free line shown at the top of the catalogue. */
    intro: string
  }
  ad: {
    signature: string
    /** Remind me to bump an ad after this many days online. */
    bumpAfterDays: number
  }
}

export type ActivityKind = 'tank' | 'lead' | 'deal' | 'ad' | 'sync' | 'settings'

export interface Activity {
  id: string
  at: string
  kind: ActivityKind
  text: string
}

/** The deliberately reduced view of an item that buyers get to see. */
export interface CatalogItem {
  id: string
  category: string
  categoryLabel: string
  maker: string
  type: string
  litres: number
  vb: number
}

export interface Catalog {
  seller: string
  location: string
  email: string
  intro: string
  pickupInfo: string
  vatRate: number
  updatedAt: string
  items: CatalogItem[]
}

export interface DB {
  schema: number
  updatedAt: string
  tanks: Tank[]
  leads: Lead[]
  quotes: Quote[]
  deals: Deal[]
  ads: Ad[]
  settings: Settings
  activity: Activity[]
}

export const STATUS_LABEL: Record<TankStatus, string> = {
  verfuegbar: 'Verfügbar',
  kontakt: 'Im Kontakt',
  reserviert: 'Reserviert',
  verkauft: 'Verkauft',
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  entwurf: 'Entwurf',
  gesendet: 'Gesendet',
  verhandlung: 'In Verhandlung',
  angenommen: 'Angenommen',
  abgelehnt: 'Abgelehnt',
}

export const STAGE_LABEL: Record<LeadStage, string> = {
  neu: 'Neu',
  kontakt: 'Kontakt',
  angebot: 'Angebot',
  reserviert: 'Reserviert',
  gewonnen: 'Gewonnen',
  verloren: 'Verloren',
}

export const STYLE_LABEL: Record<PortalStyle, string> = {
  privat: 'Privatmarkt (allgemein verständlich)',
  fach: 'Fachportal (Branchensprache, MwSt.-Hinweis)',
}

export const SOURCE_LABEL: Record<LeadSource, string> = {
  kleinanzeigen: 'Kleinanzeigen',
  telefon: 'Telefon',
  email: 'E-Mail',
  empfehlung: 'Empfehlung',
  vorort: 'Vor Ort',
  sonstige: 'Sonstige',
}
