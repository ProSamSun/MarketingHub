/**
 * GET  /api/webhook-meta  — Meta verification challenge
 * POST /api/webhook-meta  — Incoming Meta Lead Ads submission
 *
 * Flow when someone submits your Meta lead form:
 *  1. Meta POSTs the lead here.
 *  2. We map it to a client business via the Facebook Page ID (entry.id) or the
 *     lead form id, falling back to the Default client.
 *  3. We create/update the contact in Neon (scoped to that client), tagged
 *     new-lead + campaign/ad.
 *  4. We enroll them in that client's "Speed-to-Lead Blitz" workflow, which fires
 *     the first SMS + email within seconds (speed-to-lead).
 *
 * Setup in Meta: Webhooks → leadgen, Callback URL /api/webhook-meta,
 * Verify Token = META_WEBHOOK_VERIFY_TOKEN. Put the Page ID (or form ids) on the
 * client during onboarding so leads route to the right business.
 */

import { sql, migrate, defaultClientId } from './_db.js'
import { enrollContact } from './_automation.js'
import { BLUEPRINTS } from './_blueprints.js'

export const config = { maxDuration: 60 }

const SPEED_TO_LEAD_NAME = BLUEPRINTS.find(b => b.isSpeedToLead)?.name || 'Speed-to-Lead Blitz'

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

async function clientIdForLead(db, pageId, formId) {
  if (pageId || formId) {
    const [c] = await db`
      SELECT id FROM clients
      WHERE (${pageId || ''} = ANY(meta_page_ids)) OR (${formId || ''} = ANY(meta_form_ids))
      LIMIT 1
    `
    if (c) return c.id
  }
  return defaultClientId()
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

      const leadData = change.value || {}
      const { field_data = [], ad_name, campaign_name, form_id } = leadData
      const fields = parseLeadFields(field_data)
      const { firstName = '', lastName = '', email = '', phone = '' } = fields

      if (!email && !phone) {
        console.warn('[webhook-meta] Lead has no email or phone, skipping')
        continue
      }

      try {
        const cid = await clientIdForLead(db, pageId, form_id)
        const [client] = await db`SELECT lead_tag FROM clients WHERE id = ${cid}`
        const tags = ['meta-lead', client?.lead_tag || 'new-lead', campaign_name, ad_name].filter(Boolean)
        const source = `Meta Ads — ${campaign_name ?? 'Unknown Campaign'}`

        const contactId = await upsertContact(db, cid, { firstName, lastName, email, phone, tags, source })

        // Enroll in the client's Speed-to-Lead workflow → first touch fires now
        const [wf] = await db`
          SELECT id FROM workflows
          WHERE client_id = ${cid} AND name = ${SPEED_TO_LEAD_NAME} AND active = true
          ORDER BY created_at ASC LIMIT 1
        `
        if (wf) await enrollContact(contactId, wf.id, cid)

        processed.push({ contactId, email, enrolled: !!wf, status: 'created' })
        console.log(`[webhook-meta] Lead ${firstName} ${lastName} → client ${cid} (enrolled: ${!!wf})`)
      } catch (err) {
        console.error('[webhook-meta] Error:', err.message)
        processed.push({ email, status: 'error', error: err.message })
      }
    }
  }

  return res.status(200).json({ received: true, processed })
}
