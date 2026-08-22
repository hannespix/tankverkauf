import type { DB } from '../types'

/**
 * Holzfässer. Preise nach Marktrecherche im August 2026: gebrauchte 225-l-Barriques
 * werden im Einzelverkauf bei Händlern und auf Kleinanzeigen für rund 170–190 €
 * angeboten, 300-l-Fässer entsprechend höher. Die Untergrenze liegt deutlich
 * darunter, weil 29 Stück eine Partie sind und Wiederverkäufer nur Partiepreise
 * zahlen.
 */
const FAESSER: DB['tanks'] = [
  { id: 'F-01', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-02', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-03', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-04', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-05', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-06', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-07', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-08', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-09', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-10', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-11', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-12', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-13', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-14', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-15', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-16', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-17', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-18', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-19', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-20', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-21', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-22', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-23', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-24', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-25', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-26', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-27', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-28', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-29', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, vb: 175, target: 145, floor: 95, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-30', category: 'fass', maker: 'Sonstige', type: 'Tonneau', litres: 300, vb: 250, target: 215, floor: 150, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-31', category: 'fass', maker: 'Sonstige', type: 'Tonneau', litres: 300, vb: 250, target: 215, floor: 150, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
]

/**
 * Ausgangsbestand aus "Edelstahltanks_Preisliste_Weingut_Pix_aktualisiert.xlsx".
 * 24 Tanks · 37.745 l · 25.100 € Summe Einzel-VB (brutto, inkl. 19 % MwSt.).
 * T-01, T-02 und T-06 sind bereits als Paket (D-01) für 1.000 € verkauft.
 */
const TANKS: DB['tanks'] = [
  { id: 'T-01', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 310, vb: 300, target: 275, floor: 225, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-02', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 310, vb: 300, target: 275, floor: 225, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-03', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 525, vb: 650, target: 550, floor: 450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-04', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 625, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-05', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 625, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-06', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 750, vb: 750, target: 650, floor: 550, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-07', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 1250, vb: 900, target: 800, floor: 650, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-08', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 1250, vb: 900, target: 800, floor: 650, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-09', category: 'tank', maker: 'Sonstige', type: 'Transporttank', litres: 1000, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-10', category: 'tank', maker: 'Sonstige', type: 'Transporttank', litres: 1000, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-11', category: 'tank', maker: 'Sonstige', type: 'Immervolltank', litres: 1800, vb: 1300, target: 1100, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-12', category: 'tank', maker: 'Clemens', type: 'Edelstahltank', litres: 2100, vb: 1250, target: 1100, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-13', category: 'tank', maker: 'Clemens', type: 'Edelstahltank', litres: 2100, vb: 1250, target: 1100, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-14', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 800, vb: 650, target: 550, floor: 450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-15', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 1000, vb: 750, target: 650, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-16', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 1250, vb: 850, target: 750, floor: 600, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-17', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 1650, vb: 1050, target: 900, floor: 750, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-18', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 1650, vb: 1050, target: 900, floor: 750, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-19', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 1650, vb: 1050, target: 900, floor: 750, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-20', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 2800, vb: 1650, target: 1400, floor: 1150, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-21', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 2800, vb: 1650, target: 1400, floor: 1150, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-22', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 3100, vb: 1800, target: 1500, floor: 1250, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-23', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 3700, vb: 2100, target: 1750, floor: 1450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-24', category: 'tank', maker: 'Möschle', type: 'Edelstahltank', litres: 3700, vb: 2100, target: 1750, floor: 1450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
]

export const SEED: DB = {
  schema: 1,
  updatedAt: '2026-01-15T09:00:00.000Z',
  tanks: [...TANKS, ...FAESSER],
  leads: [],
  quotes: [],
  deals: [
    {
      id: 'D-01',
      label: 'Speidel-Paket (2× 310 l + 750 l)',
      leadId: null,
      tankIds: ['T-01', 'T-02', 'T-06'],
      price: 1000,
      date: '2026-01-15',
      paid: true,
      pickedUp: true,
      note: 'Paketpreis für alle drei verkauften Speidel-Tanks: 1.000 € brutto.',
    },
  ],
  ads: [],
  settings: {
    vatRate: 0.19,
    categories: [
      { id: 'tank', label: 'Edelstahltanks', one: 'Edelstahltank', hasVolume: true, inPackage: true },
      { id: 'fass', label: 'Holzfässer', one: 'Holzfass', hasVolume: true, inPackage: false },
      { id: 'gitterbox', label: 'Gitterboxen', one: 'Gitterbox', hasVolume: false, inPackage: false },
      { id: 'maschine', label: 'Maschinen', one: 'Maschine', hasVolume: false, inPackage: false },
      { id: 'armatur', label: 'Armaturen & Schläuche', one: 'Armatur', hasVolume: false, inPackage: false },
      { id: 'sonstiges', label: 'Sonstiges', one: 'Position', hasVolume: false, inPackage: false },
    ],
    portals: [
      {
        id: 'kleinanzeigen',
        name: 'Kleinanzeigen.de',
        postUrl: 'https://www.kleinanzeigen.de/p-anzeige-aufgeben.html',
        titleLimit: 65,
        bodyLimit: 4000,
        style: 'privat',
        notes: 'Kostenlos. Kategorie: Business & Gewerbe \u203a Gastronomie & Ladeneinrichtung.',
        active: true,
      },
      {
        id: 'winzer-service',
        name: 'Winzer-Service.de',
        postUrl: 'https://www.winzer-service.de/anzeige-aufgeben-auswahl',
        titleLimit: 100,
        bodyLimit: 3000,
        style: 'fach',
        notes: 'Kostenpflichtig: Einzelanzeige ab 21 \u20ac, Flatrate 39,98 \u20ac ab zwei Anzeigen. Kategorie: Gebrauchtmaschinenb\u00f6rse \u203a Kellereimaschinen.',
        active: true,
      },
    ],
    packagePrice: 17900,
    packageTarget: 16800,
    packageFloor: 16000,
    seller: {
      name: 'Weingut Pix',
      location: '',
      plz: '',
      contact: '',
      email: '',
      pickupInfo: 'Besichtigung und Abholung nach Absprache. Selbstabholung, Verladung mit Stapler möglich.',
    },
    catalog: {
      owner: '',
      repo: 'tankverkauf',
      branch: 'main',
      path: 'katalog/katalog.json',
      intro: 'Wegen Betriebsaufgabe geben wir unsere komplette Kellerausstattung ab. Markieren Sie, was für Sie infrage kommt, und schicken Sie uns Ihr Angebot.',
    },
    ad: {
      signature: 'Betriebsauflösung Weingut Pix – weitere Tanks auf Anfrage.',
      bumpAfterDays: 7,
    },
  },
  activity: [],
}
