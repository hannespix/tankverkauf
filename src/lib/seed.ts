import type { DB } from '../types'

/**
 * Ausgangsbestand aus "Edelstahltanks_Preisliste_Weingut_Pix_aktualisiert.xlsx".
 * 24 Tanks · 37.745 l · 25.100 € Summe Einzel-VB (brutto, inkl. 19 % MwSt.).
 * T-01, T-02 und T-06 sind bereits als Paket (D-01) für 1.000 € verkauft.
 */
const TANKS: DB['tanks'] = [
  { id: 'T-01', maker: 'Speidel', type: 'Edelstahltank', litres: 310, vb: 300, target: 275, floor: 225, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-02', maker: 'Speidel', type: 'Edelstahltank', litres: 310, vb: 300, target: 275, floor: 225, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-03', maker: 'Speidel', type: 'Edelstahltank', litres: 525, vb: 650, target: 550, floor: 450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-04', maker: 'Speidel', type: 'Edelstahltank', litres: 625, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-05', maker: 'Speidel', type: 'Edelstahltank', litres: 625, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-06', maker: 'Speidel', type: 'Edelstahltank', litres: 750, vb: 750, target: 650, floor: 550, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-07', maker: 'Speidel', type: 'Edelstahltank', litres: 1250, vb: 900, target: 800, floor: 650, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-08', maker: 'Speidel', type: 'Edelstahltank', litres: 1250, vb: 900, target: 800, floor: 650, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-09', maker: 'Sonstige', type: 'Transporttank', litres: 1000, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-10', maker: 'Sonstige', type: 'Transporttank', litres: 1000, vb: 700, target: 600, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-11', maker: 'Sonstige', type: 'Immervolltank', litres: 1800, vb: 1300, target: 1100, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-12', maker: 'Clemens', type: 'Edelstahltank', litres: 2100, vb: 1250, target: 1100, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-13', maker: 'Clemens', type: 'Edelstahltank', litres: 2100, vb: 1250, target: 1100, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-14', maker: 'Möschle', type: 'Edelstahltank', litres: 800, vb: 650, target: 550, floor: 450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-15', maker: 'Möschle', type: 'Edelstahltank', litres: 1000, vb: 750, target: 650, floor: 500, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-16', maker: 'Möschle', type: 'Edelstahltank', litres: 1250, vb: 850, target: 750, floor: 600, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-17', maker: 'Möschle', type: 'Edelstahltank', litres: 1650, vb: 1050, target: 900, floor: 750, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-18', maker: 'Möschle', type: 'Edelstahltank', litres: 1650, vb: 1050, target: 900, floor: 750, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-19', maker: 'Möschle', type: 'Edelstahltank', litres: 1650, vb: 1050, target: 900, floor: 750, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-20', maker: 'Möschle', type: 'Edelstahltank', litres: 2800, vb: 1650, target: 1400, floor: 1150, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-21', maker: 'Möschle', type: 'Edelstahltank', litres: 2800, vb: 1650, target: 1400, floor: 1150, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-22', maker: 'Möschle', type: 'Edelstahltank', litres: 3100, vb: 1800, target: 1500, floor: 1250, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-23', maker: 'Möschle', type: 'Edelstahltank', litres: 3700, vb: 2100, target: 1750, floor: 1450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-24', maker: 'Möschle', type: 'Edelstahltank', litres: 3700, vb: 2100, target: 1750, floor: 1450, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], updatedAt: '2026-01-15T09:00:00.000Z' },
]

export const SEED: DB = {
  schema: 1,
  updatedAt: '2026-01-15T09:00:00.000Z',
  tanks: TANKS,
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
      pickupInfo: 'Besichtigung und Abholung nach Absprache. Selbstabholung, Verladung mit Stapler möglich.',
    },
    ad: {
      signature: 'Betriebsauflösung Weingut Pix – weitere Tanks auf Anfrage.',
      bumpAfterDays: 7,
    },
  },
  activity: [],
}
