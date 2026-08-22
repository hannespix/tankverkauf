import type { DB } from '../types'

/**
 * ACHTUNG: Diese Datei liegt im ÖFFENTLICHEN Repository und landet im ausgelieferten
 * Bundle. Hier stehen deshalb NUR Verhandlungsbasispreise, die ohnehin in jeder Anzeige
 * öffentlich sind. Zielpreise und Untergrenzen sind hier bewusst nach der neutralen Regel
 * (86 % bzw. 72 % der VB) gesetzt und NICHT die tatsächlichen Verhandlungsgrenzen — die
 * gehören ausschließlich in die private db.json.
 *
 * Holzfässer. Preise nach Marktrecherche im August 2026: gebrauchte 225-l-Barriques
 * werden im Einzelverkauf bei Händlern und auf Kleinanzeigen für rund 170–190 €
 * angeboten, 300-l-Fässer entsprechend höher. Die Untergrenze liegt deutlich
 * darunter, weil 29 Stück eine Partie sind und Wiederverkäufer nur Partiepreise
 * zahlen.
 */
const FAESSER: DB['tanks'] = [
  { id: 'F-01', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-02', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-03', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-04', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-05', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-06', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-07', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-08', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-09', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-10', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-11', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-12', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-13', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-14', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-15', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-16', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-17', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-18', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-19', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-20', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-21', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-22', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-23', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-24', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-25', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-26', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-27', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-28', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-29', category: 'fass', maker: 'Sonstige', type: 'Barriquefass', litres: 225, dims: null, vb: 175, target: 150, floor: 126, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-30', category: 'fass', maker: 'Sonstige', type: 'Tonneau', litres: 300, dims: null, vb: 250, target: 215, floor: 180, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'F-31', category: 'fass', maker: 'Sonstige', type: 'Tonneau', litres: 300, dims: null, vb: 250, target: 215, floor: 180, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Eiche', 'gebraucht'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
]

/**
 * Ausgangsbestand aus "Edelstahltanks_Preisliste_Weingut_Pix_aktualisiert.xlsx".
 * 24 Tanks · 37.745 l · 25.100 € Summe Einzel-VB (brutto, inkl. 19 % MwSt.).
 * T-01, T-02 und T-06 sind bereits als Paket (D-01) für 1.000 € verkauft.
 */
const TANKS: DB['tanks'] = [
  { id: 'T-01', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 310, dims: { dia: 85, h: 95 }, vb: 300, target: 258, floor: 216, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-02', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 310, dims: { dia: 85, h: 95 }, vb: 300, target: 258, floor: 216, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-03', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 525, dims: { dia: 85, h: 138 }, vb: 650, target: 559, floor: 468, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-04', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 625, dims: { dia: 85, h: 158 }, vb: 700, target: 602, floor: 504, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-05', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 625, dims: { dia: 85, h: 158 }, vb: 700, target: 602, floor: 504, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-06', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 750, dims: null, vb: 750, target: 645, floor: 540, status: 'verkauft', leadId: null, dealId: 'D-01', offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-07', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 1250, dims: { dia: 135, h: 120 }, vb: 900, target: 774, floor: 648, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['stapelbar — zwei übereinander nur 218 cm hoch'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-08', category: 'tank', maker: 'Speidel', type: 'Edelstahltank', litres: 1250, dims: { dia: 135, h: 120 }, vb: 900, target: 774, floor: 648, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['stapelbar — zwei übereinander nur 218 cm hoch'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-09', category: 'tank', maker: 'Sonstige', type: 'Transporttank', litres: 1000, dims: { w: 102, d: 102, h: 132 }, vb: 700, target: 602, floor: 504, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-10', category: 'tank', maker: 'Sonstige', type: 'Transporttank', litres: 1000, dims: { w: 102, d: 102, h: 132 }, vb: 700, target: 602, floor: 504, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-11', category: 'tank', maker: 'Sonstige', type: 'Immervolltank', litres: 1800, dims: null, vb: 1300, target: 1118, floor: 936, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: [], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-12', category: 'tank', maker: 'Clemens', type: 'Edelstahltank', litres: 2000, dims: { w: 119, d: 125, h: 192 }, vb: 1250, target: 1075, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['fassen praktisch ca. 2.100 l'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-13', category: 'tank', maker: 'Clemens', type: 'Edelstahltank', litres: 2000, dims: { w: 119, d: 125, h: 192 }, vb: 1250, target: 1075, floor: 900, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['fassen praktisch ca. 2.100 l'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-14', category: 'tank', maker: 'Sonstige', type: 'Raumspar-Koffertank', litres: 800, dims: { w: 95,  d: 132, h: 85 }, vb: 650, target: 559, floor: 468, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-15', category: 'tank', maker: 'Sonstige', type: 'Raumspar-Koffertank', litres: 1000, dims: { w: 97,  d: 132, h: 100 }, vb: 750, target: 645, floor: 540, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-16', category: 'tank', maker: 'Sonstige', type: 'Raumspar-Koffertank', litres: 1250, dims: { w: 97,  d: 132, h: 115 }, vb: 850, target: 731, floor: 612, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-17', category: 'tank', maker: 'Sonstige', type: 'Raumspar-Koffertank', litres: 1650, dims: { w: 106, d: 132, h: 147 }, vb: 1050, target: 903, floor: 756, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-18', category: 'tank', maker: 'Sonstige', type: 'Raumspar-Koffertank', litres: 1650, dims: { w: 106, d: 132, h: 147 }, vb: 1050, target: 903, floor: 756, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-19', category: 'tank', maker: 'Sonstige', type: 'Raumspar-Koffertank', litres: 1650, dims: { w: 106, d: 132, h: 147 }, vb: 1050, target: 903, floor: 756, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-20', category: 'tank', maker: 'Sonstige', type: 'Rundtank', litres: 2800, dims: { dia: 136, h: 248 }, vb: 1650, target: 1419, floor: 1188, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-21', category: 'tank', maker: 'Sonstige', type: 'Rundtank', litres: 2800, dims: { dia: 136, h: 248 }, vb: 1650, target: 1419, floor: 1188, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-22', category: 'tank', maker: 'Sonstige', type: 'Rundtank', litres: 3100, dims: { dia: 140, h: 251 }, vb: 1800, target: 1548, floor: 1296, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-23', category: 'tank', maker: 'Sonstige', type: 'Rundtank', litres: 3700, dims: { dia: 151, h: 253 }, vb: 2100, target: 1806, floor: 1512, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
  { id: 'T-24', category: 'tank', maker: 'Sonstige', type: 'Rundtank', litres: 3700, dims: { dia: 151, h: 253 }, vb: 2100, target: 1806, floor: 1512, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['hochwertige Ausführung'], photos: [], updatedAt: '2026-01-15T09:00:00.000Z' },
]

/**
 * Kellereimaschinen. Wie überall in dieser Datei sind Zielpreis und Untergrenze
 * die neutralen 86 % / 72 % — die tatsächlich recherchierten Grenzen und die
 * Verhandlungshinweise gehören in die private db.json, nicht in ein Bundle,
 * das jeder Käufer herunterladen kann.
 */
const MASCHINEN: DB['tanks'] = [
  { id: 'M-01', category: 'maschine', maker: 'Schneider', type: 'Exzenterschneckenpumpe SP3 Evario', litres: 0, dims: null, vb: 2950, target: 2537, floor: 2124, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Baujahr 2011', 'stufenlos regelbar', 'Frequenzumrichter', 'Funkfernbedienung', 'Trockenlaufschutz', 'Druckwächter'], photos: [], updatedAt: '2026-08-22T16:00:00.000Z' },
  { id: 'M-02', category: 'maschine', maker: 'Schneider', type: 'Impellerpumpe Phönix 12000', litres: 0, dims: null, vb: 590, target: 507, floor: 425, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Baujahr 2018', '12.000 l/h', 'Links- und Rechtslauf', 'fahrbar'], photos: [], updatedAt: '2026-08-22T16:00:00.000Z' },
  { id: 'M-03', category: 'maschine', maker: 'Kiesel', type: 'Schichtenfilter 40 × 40 cm', litres: 0, dims: null, vb: 390, target: 335, floor: 281, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['19 Schichten', 'ca. 3 m² Filterfläche', 'ca. 2.000 l/h'], photos: [], updatedAt: '2026-08-22T16:00:00.000Z' },
  { id: 'M-04', category: 'maschine', maker: 'Kiesel', type: 'Barriquefass-Reiniger', litres: 0, dims: null, vb: 690, target: 593, floor: 497, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Rotationsdüse', 'für Barriquefässer'], photos: [], updatedAt: '2026-08-22T16:00:00.000Z' },
  { id: 'M-05', category: 'maschine', maker: 'Jakobs', type: 'Heizstab für Zapflochklappe', litres: 0, dims: null, vb: 130, target: 112, floor: 94, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Edelstahl', '230 V'], photos: [], updatedAt: '2026-08-22T16:00:00.000Z' },
  { id: 'M-06', category: 'maschine', maker: 'Jakobs', type: 'Heizstab für Zapflochklappe', litres: 0, dims: null, vb: 130, target: 112, floor: 94, status: 'verfuegbar', leadId: null, dealId: null, offer: null, pickup: null, note: '', tags: ['Edelstahl', '230 V'], photos: [], updatedAt: '2026-08-22T16:00:00.000Z' },
]

export const SEED: DB = {
  schema: 1,
  updatedAt: '2026-01-15T09:00:00.000Z',
  tanks: [...TANKS, ...FAESSER, ...MASCHINEN],
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
    packageTarget: 15200,
    packageFloor: 12800,
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
      path: 'public/katalog/katalog.json',
      intro: 'Wegen Betriebsaufgabe geben wir unsere komplette Kellerausstattung ab. Markieren Sie, was für Sie infrage kommt, und schicken Sie uns Ihr Angebot.',
    },
    ad: {
      signature: 'Betriebsauflösung Weingut Pix – weitere Tanks auf Anfrage.',
      bumpAfterDays: 7,
    },
  },
  activity: [],
}
