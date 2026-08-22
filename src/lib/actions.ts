import type { Ad, AdScope, DB, Lead, Tank, TankStatus } from '../types'
import { STATUS_LABEL } from '../types'
import { generateAd, portalOf } from './ads'
import { newId, store } from './store'

const now = () => new Date().toISOString()
const tankName = (t: Tank) => `${t.maker === 'Sonstige' ? t.type : t.maker} ${t.litres} l`

// -------------------------------------------------------------------- tanks

export function patchTank(id: string, patch: Partial<Tank>, label?: string) {
  store.mutate(
    (db) => {
      const t = db.tanks.find((x) => x.id === id)
      if (!t) return
      Object.assign(t, patch, { updatedAt: now() })
    },
    label ? { kind: 'tank', text: label } : undefined,
  )
}

export function setTankStatus(tank: Tank, status: TankStatus) {
  patchTank(tank.id, { status }, `${tankName(tank)} → ${STATUS_LABEL[status]}`)
}

export function setTankOffer(tank: Tank, offer: number | null) {
  patchTank(tank.id, { offer }, offer ? `Gebot ${offer} € für ${tankName(tank)}` : `Gebot entfernt: ${tankName(tank)}`)
}

export function addTank(partial: Partial<Tank>) {
  store.mutate(
    (db) => {
      const maxN = db.tanks.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, '')) || 0), 0)
      const vb = partial.vb ?? 0
      db.tanks.push({
        id: `T-${String(maxN + 1).padStart(2, '0')}`,
        maker: partial.maker ?? 'Sonstige',
        type: partial.type ?? 'Edelstahltank',
        litres: partial.litres ?? 0,
        vb,
        target: partial.target ?? Math.round(vb * 0.86),
        floor: partial.floor ?? Math.round(vb * 0.72),
        status: 'verfuegbar',
        leadId: null,
        dealId: null,
        offer: null,
        pickup: null,
        note: partial.note ?? '',
        tags: [],
        updatedAt: now(),
      })
    },
    { kind: 'tank', text: `Tank angelegt: ${partial.maker ?? ''} ${partial.litres ?? 0} l` },
  )
}

export function removeTank(tank: Tank) {
  store.mutate(
    (db) => {
      db.tanks = db.tanks.filter((t) => t.id !== tank.id)
      db.deals.forEach((d) => {
        d.tankIds = d.tankIds.filter((id) => id !== tank.id)
      })
      db.leads.forEach((l) => {
        l.tankIds = l.tankIds.filter((id) => id !== tank.id)
      })
    },
    { kind: 'tank', text: `Tank gelöscht: ${tankName(tank)}` },
  )
}

// -------------------------------------------------------------------- leads

export function addLead(partial: Partial<Lead>): string {
  const id = newId('L')
  store.mutate(
    (db) => {
      db.leads.unshift({
        id,
        name: partial.name?.trim() || 'Unbenannt',
        phone: partial.phone ?? '',
        email: partial.email ?? '',
        location: partial.location ?? '',
        source: partial.source ?? 'kleinanzeigen',
        stage: partial.stage ?? 'neu',
        tankIds: partial.tankIds ?? [],
        budget: partial.budget ?? null,
        lastContact: partial.lastContact ?? new Date().toISOString().slice(0, 10),
        nextFollowUp: partial.nextFollowUp ?? null,
        note: partial.note ?? '',
        createdAt: now(),
        updatedAt: now(),
      })
      // Any tank this lead asked about moves out of "nobody has called".
      for (const tid of partial.tankIds ?? []) {
        const t = db.tanks.find((x) => x.id === tid)
        if (t && t.status === 'verfuegbar') {
          t.status = 'kontakt'
          t.leadId = id
          t.updatedAt = now()
        }
      }
    },
    { kind: 'lead', text: `Interessent angelegt: ${partial.name ?? 'Unbenannt'}` },
  )
  return id
}

export function patchLead(id: string, patch: Partial<Lead>, label?: string) {
  store.mutate(
    (db) => {
      const l = db.leads.find((x) => x.id === id)
      if (!l) return
      Object.assign(l, patch, { updatedAt: now() })
    },
    label ? { kind: 'lead', text: label } : undefined,
  )
}

export function removeLead(lead: Lead) {
  store.mutate(
    (db) => {
      db.leads = db.leads.filter((l) => l.id !== lead.id)
      db.tanks.forEach((t) => {
        if (t.leadId === lead.id) {
          t.leadId = null
          if (t.status === 'kontakt' || t.status === 'reserviert') t.status = 'verfuegbar'
        }
      })
    },
    { kind: 'lead', text: `Interessent gelöscht: ${lead.name}` },
  )
}

// -------------------------------------------------------------------- deals

/** Close a sale: bundle the tanks, book the price once, mark everything sold. */
export function createDeal(input: { label: string; tankIds: string[]; price: number; leadId: string | null; date: string; note: string }): string {
  const id = newId('D')
  store.mutate(
    (db) => {
      db.deals.unshift({
        id,
        label: input.label || 'Verkauf',
        leadId: input.leadId,
        tankIds: input.tankIds,
        price: input.price,
        date: input.date,
        paid: false,
        pickedUp: false,
        note: input.note,
      })
      for (const tid of input.tankIds) {
        const t = db.tanks.find((x) => x.id === tid)
        if (!t) continue
        t.status = 'verkauft'
        t.dealId = id
        t.leadId = input.leadId ?? t.leadId
        t.updatedAt = now()
      }
      if (input.leadId) {
        const l = db.leads.find((x) => x.id === input.leadId)
        if (l) l.stage = 'gewonnen'
      }
    },
    { kind: 'deal', text: `Verkauf gebucht: ${input.label} für ${input.price} €` },
  )
  return id
}

export function patchDeal(id: string, patch: Partial<DB['deals'][number]>, label?: string) {
  store.mutate(
    (db) => {
      const d = db.deals.find((x) => x.id === id)
      if (!d) return
      Object.assign(d, patch)
    },
    label ? { kind: 'deal', text: label } : undefined,
  )
}

/**
 * Assign (or clear) the buyer on an already-booked sale. The tanks follow along,
 * the new lead counts as won, and a previous buyer left without any other sale
 * drops back to "Angebot" instead of staying falsely marked as won.
 */
export function assignDealLead(dealId: string, leadId: string | null) {
  store.mutate(
    (db) => {
      const deal = db.deals.find((d) => d.id === dealId)
      if (!deal) return
      const previousId = deal.leadId
      if (previousId === leadId) return

      deal.leadId = leadId
      for (const tid of deal.tankIds) {
        const t = db.tanks.find((x) => x.id === tid)
        if (t) {
          t.leadId = leadId
          t.updatedAt = now()
        }
      }

      if (leadId) {
        const lead = db.leads.find((l) => l.id === leadId)
        if (lead) {
          lead.stage = 'gewonnen'
          lead.updatedAt = now()
        }
      }

      if (previousId) {
        const stillBuying = db.deals.some((d) => d.id !== dealId && d.leadId === previousId)
        const previous = db.leads.find((l) => l.id === previousId)
        if (previous && !stillBuying) {
          previous.stage = 'angebot'
          previous.updatedAt = now()
        }
      }
    },
    { kind: 'deal', text: leadId ? 'Käufer zugeordnet' : 'Käufer entfernt' },
  )
}

/** Undo a sale — the tanks go back on the market. */
export function removeDeal(dealId: string) {
  store.mutate(
    (db) => {
      const deal = db.deals.find((d) => d.id === dealId)
      if (!deal) return
      for (const tid of deal.tankIds) {
        const t = db.tanks.find((x) => x.id === tid)
        if (t && t.dealId === dealId) {
          t.dealId = null
          t.status = 'verfuegbar'
          t.updatedAt = now()
        }
      }
      db.deals = db.deals.filter((d) => d.id !== dealId)
    },
    { kind: 'deal', text: 'Verkauf zurückgenommen' },
  )
}

// ---------------------------------------------------------------------- ads

/** One ad per portal — same inventory, wording tuned to each audience. */
export function createAdsForPortals(db: DB, scope: AdScope, portalIds: string[]): string[] {
  return portalIds.map((pid) => createAd(db, scope, pid))
}

export function createAd(db: DB, scope: AdScope, portalId: string): string {
  const id = newId('AD')
  const portal = portalOf(db, portalId)
  const gen = generateAd(db, scope, portal)
  store.mutate(
    (draft) => {
      draft.ads.unshift({
        id,
        portalId,
        title: gen.title,
        body: gen.body,
        price: gen.price,
        priceType: gen.priceType,
        url: '',
        scope,
        tankIds: gen.tankIds,
        status: 'entwurf',
        publishedAt: null,
        bumpedAt: null,
        views: null,
        stamp: gen.stamp,
        note: '',
        createdAt: now(),
        updatedAt: now(),
      })
    },
    { kind: 'ad', text: `Anzeige für ${portal?.name ?? portalId} erstellt` },
  )
  return id
}

export function patchAd(id: string, patch: Partial<Ad>, label?: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      Object.assign(a, patch, { updatedAt: now() })
    },
    label ? { kind: 'ad', text: label } : undefined,
  )
}

/** Pull the ad's text back in line with the current inventory. */
export function refreshAd(id: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      const gen = generateAd(db, a.scope, portalOf(db, a.portalId))
      a.title = gen.title
      a.body = gen.body
      a.price = gen.price
      a.tankIds = gen.tankIds
      a.stamp = gen.stamp
      a.updatedAt = now()
    },
    { kind: 'ad', text: 'Anzeigentext aktualisiert' },
  )
}

export function markAdPublished(id: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      a.status = 'online'
      a.publishedAt = now()
      a.bumpedAt = now()
      a.updatedAt = now()
    },
    { kind: 'ad', text: 'Anzeige als online markiert' },
  )
}

export function bumpAd(id: string) {
  store.mutate(
    (db) => {
      const a = db.ads.find((x) => x.id === id)
      if (!a) return
      a.bumpedAt = now()
      a.updatedAt = now()
    },
    { kind: 'ad', text: 'Anzeige hochgeholt' },
  )
}

export function removeAd(id: string) {
  store.mutate((db) => {
    db.ads = db.ads.filter((a) => a.id !== id)
  }, { kind: 'ad', text: 'Anzeige gelöscht' })
}

// ----------------------------------------------------------------- settings

export function upsertPortal(portal: DB['settings']['portals'][number]) {
  store.mutate(
    (db) => {
      const i = db.settings.portals.findIndex((p) => p.id === portal.id)
      if (i >= 0) db.settings.portals[i] = portal
      else db.settings.portals.push(portal)
    },
    { kind: 'settings', text: `Portal gespeichert: ${portal.name}` },
  )
}

/** Removing a portal leaves its ads intact — they simply fall back to default limits. */
export function removePortal(portalId: string) {
  store.mutate(
    (db) => {
      db.settings.portals = db.settings.portals.filter((p) => p.id !== portalId)
    },
    { kind: 'settings', text: 'Portal entfernt' },
  )
}

export function patchSettings(patch: Partial<DB['settings']>, label = 'Einstellungen geändert') {
  store.mutate((db) => {
    db.settings = { ...db.settings, ...patch }
  }, { kind: 'settings', text: label })
}
