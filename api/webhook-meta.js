/**
 * GET  /api/webhook-meta  — Meta verification challenge
 * POST /api/webhook-meta  — Incoming Meta Lead Ads submission
 *
 * IMPORTANT: Meta's leadgen webhook does NOT include the person's field data —
 * only a `leadgen_id`. We fetch the actual name/email/phone from the Graph API
 * using the matched client's Page Access Token (clients.meta_page_token).
 *
 * Flow:
 *  1. Map the lead to a client via Page ID (entry.id) or form id → Default fallback.
 *  2. Fetch field data from Graph (or use inline field_data if a test payload has it).
 *  3. Create/update the contact (scoped to the client), tagged new-lead.
 *  4. Enroll in the client's "Speed-to-Lead Blitz" → first SMS+email fire instantly.
 */

import { sql, migrate, defaultClientId } from './_db.js'
import { enrollContact } from './_automation.js'
import { BLUEPRINTS } from './_blueprints.js'

export const config = { maxDuration: 60 }

const SPEED_TO_LEAD_NAME = BLUEPRINTS.find(b => b.isSpeedToLead)?.name || 'Speed-to-Lead Blitz'
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0'

const FIELD_MAP = {
  email: 'email',
  phone_number: 'phone',
  full_name: 'fullName',
  first_name: 'firstName',
  last_name: 'lastName',
}

function parseLeadFields(fieldData = []) {
  const parsed = {}
  for (const { name, values } of fieldData) {
    const key = FIELD_MAP[name] || name
    parsed[key] = values?.[0] ?? ''
  }
  if (parsed.fullName && !parsed.firstName) {
    const parts = parsed.fullName.trim().split(' ')
    parsed.firstName = parts[0] ?? ''
    parsed.lastName = parts.slice(1).join(' ')
    delete parsed.fullName
  }
  return parsed
}

async function fetchLeadFields(leadgenId, token) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${leadgenId}?access_token=${encodeURIComponent(token)}`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `Graph API ${res.status}`)
  return parseLeadFields(data.field_data || [])
}

async function clientForLead(db, pageId, formId) {
  if (pageId || formId) {
    const [c] = await db`
      SELECT id, meta_page_token, lead_tag FROM clients
      WHERE (${pageId || ''} = ANY(meta_page_ids)) OR (${formId || ''} = ANY(meta_form_ids))
      LIMIT 1
    `
    if (c) return c
  }
  const did = await defaultClientId()
  const [d] = await db`SELECT id, meta_page_token, lead_tag FROM clients WHERE id = ${did}`
  return d || { id: did, meta_page_token: null, lead_tag: 'new-lead' }
}

async function upsertContact(db, cid, { firstName, lastName, email, phone, tags, source }) {
  if (email) {
    const ex = await db`SELECT id FROM contacts WHERE email = ${email} AND client_id = ${cid} LIMIT 1`
    if (ex.length > 0) {
      await db`
        UPDATE contacts SET
          first_name = COALESCE(NULLIF(${firstName || ''}, ''), first_name),
          last_name  = COALESCE(NULLIF(${lastName  || ''}, ''), last_name),
          phone      = COALESCE(NULLIF(${phone     || ''}, ''), phone),
          tags       = (SELECT ARRAY(SELECT DISTINCT unnest(tags || ${tags}::text[]))),
          updated_at = now()
        WHERE id = ${ex[0].id}
      `
      return ex[0].id
    }
  }
  const [c] = await db`
    INSERT INTO contacts (client_id, first_name, last_name, email, phone, tags, source)
    VALUES (${cid}, ${firstName || ''}, ${lastName || ''}, ${email || null}, ${phone || null}, ${tags}::text[], ${source})
    RETURNING id
  `
  return c.id
}

export default async function handler(req, res) {
  // ── Verification handshake ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode']
    const token     = req.query['hub.verify_token']
    const challenge = req.query['hub.challenge']
    if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(challenge)
    }
    return res.status(403).json({ error: 'Verification failed' })
  }

  if (req.method !== 'POST') return res.status(405).end()

  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch {
    return res.status(400).json({ error: 'Invalid JSON' })
  }

  await migrate()
  const db = sql()

  const entries = body?.entry ?? []
  const processed = []

  for (const entry of entries) {
    const pageId = entry.id
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue

      const v = change.value || {}
      const { leadgen_id, field_data = [], ad_name, campaign_name, form_id } = v

      try {
        const client = await clientForLead(db, pageId, form_id)

        // Get field data: inline (rare/test) or fetched from Graph (normal path)
        let fields
        if (field_data.length) {
          fields = parseLeadFields(field_data)
        } else if (leadgen_id && client.meta_page_token) {
          fields = await fetchLeadFields(leadgen_id, client.meta_page_token)
        } else {
          processed.push({ leadgen_id, status: 'skipped', reason: 'No Page Access Token set for this client — add it in Settings → Integrations.' })
          continue
        }

        const { firstName = '', lastName = '', email = '', phone = '' } = fields
        if (!email && !phone) {
          processed.push({ leadgen_id, status: 'skipped', reason: 'Lead has no email or phone' })
          continue
        }

        const tags = ['meta-lead', client.lead_tag || 'new-lead', campaign_name, ad_name].filter(Boolean)
        const source = `Meta Ads — ${campaign_name ?? 'Unknown Campaign'}`
        const contactId = await upsertContact(db, client.id, { firstName, lastName, email, phone, tags, source })

        const [wf] = await db`
          SELECT id FROM workflows
          WHERE client_id = ${client.id} AND name = ${SPEED_TO_LEAD_NAME} AND active = true
          ORDER BY created_at ASC LIMIT 1
        `
        if (wf) await enrollContact(contactId, wf.id, client.id)

        processed.push({ contactId, email, enrolled: !!wf, status: 'created' })
        console.log(`[webhook-meta] Lead ${firstName} ${lastName} → client ${client.id} (enrolled: ${!!wf})`)
      } catch (err) {
        console.error('[webhook-meta] Error:', err.message)
        processed.push({ leadgen_id, status: 'error', error: err.message })
      }
    }
  }

  return res.status(200).json({ received: true, processed })
}
