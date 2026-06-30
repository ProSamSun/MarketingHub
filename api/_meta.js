/**
 * Meta lead sync — pull leads straight from the ad account via the Graph API and
 * import them, instead of depending on webhook delivery. Each client maps to an
 * ad account (meta_ad_account_id) + an ads-capable token (meta_ads_token).
 *
 * Used by:
 *   - /api/clients?action=meta-sync  (manual / one-off, incl. full backfill)
 *   - /api/cron                      (throttled to ~every 10 min per client)
 */
import { sql } from './_db.js'
import { enrollContact } from './_automation.js'
import { BLUEPRINTS } from './_blueprints.js'

const V = 'v21.0'
const SPEED = BLUEPRINTS.find(b => b.isSpeedToLead)?.name || 'Speed-to-Lead Blitz'
const STD = new Set(['email', 'phone', 'phone_number', 'full_name', 'first_name', 'last_name'])

const g = async (u) => { const r = await fetch(u); let d; try { d = await r.json() } catch { d = {} } return d }

function parseLead(field_data) {
  const f = Object.fromEntries((field_data || []).map(x => [x.name, (x.values || [])[0]]))
  let first = f.first_name || '', last = f.last_name || ''
  if (!first && f.full_name) { const p = f.full_name.trim().split(' '); first = p[0] || ''; last = p.slice(1).join(' ') }
  const notes = Object.entries(f)
    .filter(([k]) => !STD.has(k))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v).replace(/_/g, ' ')}`)
    .join('\n')
  return { first, last, email: f.email || null, phone: f.phone || f.phone_number || null, notes }
}

// Pull leads from every ad in an ad account (optionally only those newer than `sinceUnix`).
export async function pullAdAccountLeads(token, adAccount, { sinceUnix = null, activeOnly = false } = {}) {
  const E = encodeURIComponent
  let ads = []
  let url = `https://graph.facebook.com/${V}/${adAccount}/ads?fields=id,effective_status&limit=100&access_token=${E(token)}`
  while (url) { const d = await g(url); ads.push(...(d.data || [])); url = d.paging?.next || null }
  if (activeOnly) ads = ads.filter(a => a.effective_status === 'ACTIVE')

  const filt = sinceUnix
    ? `&filtering=${E(JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix }]))}`
    : ''
  const leads = new Map()
  for (const ad of ads) {
    let u = `https://graph.facebook.com/${V}/${ad.id}/leads?fields=id,created_time,field_data&limit=100${filt}&access_token=${E(token)}`
    while (u) { const d = await g(u); for (const l of (d.data || [])) leads.set(l.id, l); u = d.paging?.next || null }
  }
  return [...leads.values()]
}

/**
 * Sync a client's ad-account leads into its hub.
 *   sinceDays: only pull leads newer than N days (null = full backfill)
 *   autoEnroll: enroll brand-new contacts into Speed-to-Lead (only if the client
 *               has that workflow AND a sender identity configured)
 */
export async function syncClientLeads(client, { sinceDays = null, autoEnroll = true, activeOnly = false } = {}) {
  const db = sql()
  const token = client.meta_ads_token
  const act = client.meta_ad_account_id
  if (!token || !act) return { skipped: true, reason: 'no ad account / token' }

  const sinceUnix = sinceDays ? Math.floor(Date.now() / 1000) - sinceDays * 86400 : null
  const leads = await pullAdAccountLeads(token, act, { sinceUnix, activeOnly })

  const canSend = !!(client.from_email || client.twilio_number)
  const [wf] = await db`SELECT id FROM workflows WHERE client_id = ${client.id} AND name = ${SPEED} AND active = true ORDER BY created_at ASC LIMIT 1`

  let created = 0, enrolled = 0, skipped = 0
  for (const l of leads) {
    const [dup] = await db`SELECT id FROM contacts WHERE client_id = ${client.id} AND metadata->>'leadgen_id' = ${l.id} LIMIT 1`
    if (dup) { skipped++; continue }
    const { first, last, email, phone, notes } = parseLead(l.field_data)
    if (!email && !phone) { skipped++; continue }
    if (email) {
      const [e] = await db`SELECT id FROM contacts WHERE client_id = ${client.id} AND email = ${email} LIMIT 1`
      if (e) { skipped++; continue }
    }
    const [c] = await db`
      INSERT INTO contacts (client_id, first_name, last_name, email, phone, tags, source, notes, metadata)
      VALUES (${client.id}, ${first}, ${last}, ${email}, ${phone}, ARRAY['meta-lead']::text[], 'Meta Ads (sync)', ${notes},
              ${JSON.stringify({ leadgen_id: l.id, created_time: l.created_time })})
      RETURNING id
    `
    created++
    if (autoEnroll && wf && canSend) {
      try { await enrollContact(c.id, wf.id, client.id); enrolled++ } catch { /* logged in engine */ }
    }
  }

  await db`UPDATE clients SET meta_last_sync = now() WHERE id = ${client.id}`
  return { synced: leads.length, created, enrolled, skipped }
}

// Run sync for every client due for one (throttled by meta_last_sync). Called by cron.
export async function syncDueClients(db, { minutes = 10, sinceDays = 3 } = {}) {
  const clients = await db`
    SELECT * FROM clients
    WHERE meta_ad_account_id IS NOT NULL AND meta_ads_token IS NOT NULL AND active = true
      AND (meta_last_sync IS NULL OR meta_last_sync < now() - (${minutes} || ' minutes')::interval)
  `
  const results = []
  for (const c of clients) {
    try {
      const r = await syncClientLeads(c, { sinceDays, autoEnroll: true, activeOnly: true })
      if (r.created) console.log(`[meta-sync] ${c.name}:`, JSON.stringify(r))
      results.push({ client: c.name, ...r })
    } catch (e) {
      console.error(`[meta-sync] ${c.name} failed:`, e.message)
      results.push({ client: c.name, error: e.message })
    }
  }
  return results
}
