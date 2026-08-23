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
  /**
   * Ein Satz über die ganze Gruppe, der auf der Käuferliste unter der Überschrift
   * steht. Dafür da, eine Verwendung auszusprechen, die man der einzelnen Position
   * nicht ansieht — gebrauchte Barriques verkaufen sich als Dekofässer an einen
   * viel größeren Kreis als an Winzer.
   */
  note?: string
}
/** Free text — a pump maker is as valid here as a tank maker. */
export type Maker = string

/**
 * Outer dimensions in centimetres — what a buyer needs to know before renting a
 * trailer or measuring the cellar door. Rectangular tanks give width (at the
 * widest point), depth and height; cylindrical ones give a diameter instead of
 * width and depth.
 */
export interface Dims {
  w?: number
  d?: number
  h?: number
  dia?: number
}

export interface Tank {
  id: string
  category: Category
  maker: Maker
  /** Edelstahltank, Transporttank, Immervolltank … */
  type: string
  litres: number
  /** Outer size in cm. null while it has not been measured. */
  dims: Dims | null
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
  /**
   * Eingegangene Nachrichten samt dem, was daraus übernommen wurde. Sie hängen am
   * Interessenten und nicht an einem eigenen Wurzelschlüssel: migrate() baut sein
   * Rückgabeobjekt aus einer festen Liste und würde alles Neue beim Laden
   * verwerfen — ein Feld an Lead reist unverändert mit, auch durch replaceAll().
   */
  messages?: LeadMessage[]
  createdAt: string
  updatedAt: string
}

export interface LeadMessage {
  at: string
  /** Der Wortlaut, gekappt. Bei einem Bild das, was die KI abgelesen hat. */
  text: string
  /**
   * Eingegangen oder von uns geschrieben.
   *
   * Fehlt bei allen Nachrichten, die vor der Antwortfunktion abgelegt wurden —
   * die waren ausnahmslos eingehend, deshalb ist „ein" der stille Standard.
   */
  dir?: 'ein' | 'aus'
  /** Bei einer Antwort: die Betreffzeile, damit man sie wiederfindet. */
  subject?: string
  /** Bei einer Antwort: das Angebot, aus dem sie entstanden ist. */
  quoteId?: string
  /** War es ein Bild? Dann ist text ein Transkript und kein Original. */
  fromImage?: boolean
  /** Was daraus übernommen wurde, im Klartext. */
  applied: string[]
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
  /**
   * Negotiated price per position, brutto — sparse.
   *
   * Only positions whose price was actually touched appear here; everything
   * else falls back to the tank's own VB. Sparse on purpose: an untouched line
   * follows the stock price when that changes, which is what you want for a
   * position nobody has negotiated yet.
   *
   * `migrate()` passes quotes through untouched (store.ts), so old quotes
   * arrive without this field — every read must go through `linePrice()`.
   */
  prices?: Record<string, number>
  /** What the buyer put on the table, brutto. */
  buyerOffer: number | null
  status: QuoteStatus
  validUntil: string | null
  note: string
  createdAt: string
  updatedAt: string
}

export type AdScopeKind = 'gesamt' | 'paket' | 'kategorie' | 'maker' | 'tank' | 'restposten' | 'custom'

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
  /**
   * Höchstzahl an WÖRTERN im Anzeigentext. Manche Portale zählen Wörter statt
   * Zeichen — bei 58 Positionen ist das die Schranke, die zuerst greift.
   * 0 oder fehlend heißt: keine Wortgrenze.
   */
  bodyWords?: number
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
  /**
   * Am Text wurde von Hand gearbeitet.
   *
   * Der Stempel läuft über den ERZEUGTEN Text; eine Handänderung war damit für
   * das Werkzeug unsichtbar und wurde beim nächsten „Text neu erzeugen"
   * kommentarlos überschrieben — ohne Rückfrage und ohne Weg zurück.
   */
  edited?: boolean
  note: string
  createdAt: string
  updatedAt: string
}

/**
 * Ein geschnürtes Paketangebot. Gespeichert wird die Zusammenstellung und der
 * Nachlass, nicht der fertige Preis: verkauft sich eine Position daraus, fällt sie
 * heraus und der Preis rechnet sich neu, statt dass das Angebot falsch wird.
 */
export interface Bundle {
  id: string
  label: string
  /** Ein, zwei Sätze für den Käufer. */
  blurb: string
  /** Alle Positionen des Angebots. */
  ids: string[]
  /** Teilmenge von ids, die ohne Aufpreis mitgeht ("gratis dazu"). */
  giftIds: string[]
  /** Nachlass auf die bezahlten Positionen, 0,12 = 12 %. */
  discount: number
  /** Unter so vielen verbliebenen Positionen wird das Angebot zurückgezogen. */
  minItems: number
  active: boolean
}

/** Mengenstaffel: ab so vielen Positionen einer Kategorie so viel Nachlass. */
export interface PriceTier {
  category: string
  minCount: number
  discount: number
}

export interface Settings {
  /** Name of the whole thing, shown in the header and the browser tab. */
  appName: string
  /**
   * Optional key for reading incoming messages. Deliberately stored with the
   * data, not in the per-device vault: every device that can unlock the tool
   * should be able to use it, which is what was asked for. It therefore lives
   * in the private repo in plain text — it can spend money, but it cannot touch
   * the data, and it is revoked in one click at the provider.
   */
  ai: { apiKey: string; model: string }
  vatRate: number
  categories: CategoryDef[]
  portals: Portal[]
  packagePrice: number
  packageTarget: number
  packageFloor: number
  /** Geschnürte Pakete für die Käuferseite. */
  bundles: Bundle[]
  /** Automatischer Mengenrabatt je Kategorie. */
  tiers: PriceTier[]
  /** Nach jeder gespeicherten Änderung von selbst veröffentlichen. */
  autoPublish: boolean
  /** Fingerabdruck des zuletzt veröffentlichten Katalogs — leer heißt "nie". */
  publishedStamp: string
  /** Fingerabdruck der zuletzt vollständig übertragenen Bilder. */
  publishedPhotos: string
  /** Wann zuletzt veröffentlicht wurde. */
  publishedAt: string
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
    /**
     * Adresse der eigenen Impressumsseite, z. B. https://weingut-pix.de/impressum.
     * Der Katalog ist ein geschäftsmäßiger Dienst (§ 5 DDG) — ein klar
     * beschrifteter Verweis auf das bestehende Impressum genügt, ein fehlendes
     * nicht. Leer heißt: die Fußzeile weist in den Einstellungen darauf hin.
     */
    imprintUrl?: string
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
  /** Outer size in cm — decides whether it fits through the buyer's door. */
  dims: Dims | null
  /** Paths relative to this file, published alongside it. Empty when none exist. */
  photos: string[]
  /**
   * Ausstattungsmerkmale — „Baujahr 2018", „12.000 l/h", „19 Schichten".
   *
   * Sie waren gepflegt, aber nur intern sichtbar: der Käufer sah von einer
   * Pumpe nur Name und Preis. Genau diese Zeilen beantworten seine Fragen,
   * bevor er sie stellt. Die Notiz bleibt draußen — dort steht, was am Telefon
   * besprochen wurde.
   */
  tags: string[]
  /** Already promised to someone. Buyers may still register a backup interest. */
  reserved: boolean
}

/**
 * Eine verkaufte Position, wie der Käufer sie sieht.
 *
 * Ein EIGENES Feld, keine Kennzeichnung innerhalb von `items` — und das ist
 * keine Geschmacksfrage. Die Käuferseite holt die Liste bei jeder Rückkehr in
 * den Tab neu, ihr eigenes Programm aber nie. Wer den Tab offen lässt oder die
 * Seite noch im Zwischenspeicher hat, liest die NEUE Datei mit dem ALTEN Code.
 * Ein Kennzeichen in `items` überliest der: er zählte Verkauftes als lieferbar,
 * böte es zum Ankreuzen an, rechnete es in den Paketpreis und schriebe es in
 * die Anfrage-Mail. Ein unbekanntes Feld überliest er dagegen folgenlos.
 *
 * Ohne Preis und ohne Foto, beides mit Absicht:
 *
 * Der Preis wäre die Verhandlungsbasis, nicht der erzielte — und er ankert nur
 * dort etwas, wo es noch Vergleichbares gibt; dessen Preis steht dann eine
 * Zeile darüber. Er ist also entweder überflüssig oder ankert ins Leere.
 *
 * Ohne Fotos bleibt die Bildmenge genau die der lieferbaren Ware. Sonst müsste
 * `photoStamp` dieselbe erweiterte Menge sehen wie `writeCatalog`, und liefen
 * die beiden auseinander, zeigte die Liste dauerhaft ein totes Bild, während
 * das Werkzeug „aktuell" meldet.
 */
export interface SoldItem {
  id: string
  category: string
  categoryLabel: string
  maker: string
  type: string
  litres: number
  dims: Dims | null
  tags: string[]
}

/**
 * Ein Paket, wie es der Käufer sieht: gegen den heutigen Bestand aufgelöst und
 * ausgerechnet. Der konfigurierte Nachlass bleibt in der privaten Datenbank —
 * veröffentlicht wird nur, was das Paket kostet, und das steht ohnehin dran.
 */
export interface CatalogBundle {
  id: string
  label: string
  blurb: string
  /** Bezahlte Positionen. */
  ids: string[]
  /** Positionen ohne Aufpreis. */
  giftIds: string[]
  /** Summe der Einzelpreise aller enthaltenen Positionen. */
  full: number
  /** Preis des Pakets. */
  price: number
  /**
   * Wie viele der ursprünglich geschnürten Positionen fehlen — verkauft oder
   * reserviert.
   *
   * Etikett und Fließtext eines Pakets sind von Hand geschrieben („Raumspar-
   * Keller, 8.000 l", „Sechs eckige Tanks …") und ziehen nicht nach, wenn
   * Positionen herausfallen. Ohne diese Zahl stand die alte Behauptung über
   * einem Paket, das nur noch vier Positionen und 4.700 l umfasste.
   */
  short?: number
}

export interface Catalog {
  seller: string
  location: string
  email: string
  intro: string
  pickupInfo: string
  /** Verweis auf das Impressum des Verkäufers. Fehlt in älteren Dateien. */
  imprintUrl?: string
  /** Datenschutzhinweis für genau diese Seite. Fehlt in älteren Dateien. */
  privacy?: string
  vatRate: number
  updatedAt: string
  items: CatalogItem[]
  /**
   * Was verkauft ist — sichtbar, aber nicht zu haben.
   *
   * Steht bewusst NEBEN `items`, nicht darin: siehe `SoldItem`. Fehlt in
   * älteren veröffentlichten Dateien, dann zeigt die Seite wie bisher nur den
   * offenen Bestand.
   */
  soldItems?: SoldItem[]
  /** Überschrift und Hinweis je Gruppe. Fehlt in älteren veröffentlichten Dateien. */
  categories: { id: string; label: string; note: string }[]
  /** Fertig geschnürte Angebote. Fehlt in älteren veröffentlichten Dateien. */
  bundles: CatalogBundle[]
  /** Mengenstaffel je Kategorie. Fehlt in älteren veröffentlichten Dateien. */
  tiers: PriceTier[]
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
