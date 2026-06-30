/**
 * /api/clients
 * GET    — list clients
 * POST   — create a client (manual)
 * PUT    — update a client (body: { id, ...fields })
 * DELETE — delete a client (body: { id })
 *
 * POST /api/clients?action=onboard — one-click: create the client, its pipeline,
 * and a full AI-tailored lead-gen automation suite (the blueprints), optionally
 * enrolling existing leads into the nurture.
 *
 * Copy is generated with claude-sonnet-4-6 (fast + reliable so the onboard call
 * doesn't time out across ~6 parallel generations); each step has a strong
 * fallback so a workflow is never empty even if generation fails.
 */
import { sql, migrate } from './_db.js'
import { enrollContact } from './_automation.js'
import { BLUEPRINTS, messageSteps, assembleSteps } from './_blueprints.js'
import Anthropic from '@anthropic-ai/sdk'

export const config = { maxDuration: 60 }

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function auth(req) {
  const t = req.headers['x-dashboard-token'] || req.body?.token
  return t === process.env.DASHBOARD_PASSWORD
}

const PIPELINE_STAGES = [
  ['New Lead',        '#6366f1'],
  ['Contacted',       '#8b5cf6'],
  ['Appointment Set', '#a855f7'],
  ['Showed',          '#0ea5e9'],
  ['Proposal/Quote',  '#ec4899'],
  ['Won',             '#22c55e'],
  ['Lost',            '#ef4444'],
]

const COPY_TOOL = {
  name: 'write_sequence_copy',
  description: 'Return the written copy for each requested message in the automation.',
  input_schema: {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index:   { type: 'integer', description: 'The message index you are writing for.' },
            channel: { type: 'string', enum: ['sms', 'email'] },
            text:    { type: 'string', description: 'SMS body (for sms messages only).' },
            subject: { type: 'string', description: 'Email subject line (for email messages only).' },
            html:    { type: 'string', description: 'Email HTML body (for email messages only).' },
          },
          required: ['index', 'channel'],
        },
      },
    },
    required: ['messages'],
  },
}

async function generateCopyForBlueprint(client, bp) {
  const msgs = messageSteps(bp)
  if (msgs.length === 0) return {}

  const lines = msgs
    .map(m => `- index ${m.index} [${m.type === 'send_sms' ? 'sms' : 'email'}]: ${m.brief}`)
    .join('\n')

  const system = `You are an elite direct-response copywriter for a marketing agency.
Write copy for the automation "${bp.name}" for this client:
- Business: ${client.name}
- Industry: ${client.industry || 'general'}
- Offer / lead magnet: ${client.offer || 'their service'}
- Desired outcome for the lead: ${client.outcome || 'book an appointment'}
- Tone: ${client.tone || 'friendly'}
- Rep name: ${client.rep_name || 'the team'}

Rules:
- Use merge tags naturally: {{firstName}}, {{business}}, {{repName}}, {{bookingLink}}, {{offer}}.
- SMS: UNDER 160 characters, conversational, one clear CTA, minimal/no emoji.
- Email: a punchy subject + a SHORT HTML body (UNDER 90 words) using simple inline-styled <p> tags,
  ending in a clear CTA; for booking CTAs use an <a href="{{bookingLink}}">…</a> link.
- Be specific to the offer and tone. Never output bracket placeholders like [name].
Return copy for EVERY requested index using the tool.`

  const msg = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system,
    tools: [COPY_TOOL],
    tool_choice: { type: 'tool', name: 'write_sequence_copy' },
    messages: [{ role: 'user', content: `Write copy for these messages:\n${lines}` }],
  })

  const tu = msg.content.find(b => b.type === 'tool_use')
  const out = {}
  for (const m of (tu?.input?.messages || [])) {
    if (m.channel === 'email' || (m.html || m.subject)) out[m.index] = { subject: m.subject, html: m.html }
    else out[m.index] = { text: m.text }
  }
  return out
}

function slugify(name) {
  return String(name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'client'
}

async function uniqueSlug(db, base) {
  const existing = await db`SELECT 1 FROM clients WHERE slug = ${base} LIMIT 1`
  if (existing.length === 0) return base
  return `${base}-${Date.now().toString(36).slice(-4)}`
}

async function onboard(db, body) {
  const {
    name, industry = '', offer = '', outcome = '', tone = 'friendly',
    repName = '', fromName = '', fromEmail = '', twilioNumber = '',
    bookingLink = '', leadTag = 'new-lead',
    metaPageIds = [], metaFormIds = [], metaPageToken = '', enrollExisting = false,
  } = body
  if (!name) throw new Error('Business name is required')

  const slug = await uniqueSlug(db, slugify(name))

  const [client] = await db`
    INSERT INTO clients (name, slug, industry, offer, outcome, tone, rep_name, from_name, from_email,
                         twilio_number, booking_link, lead_tag, meta_page_ids, meta_form_ids, meta_page_token)
    VALUES (${name}, ${slug}, ${industry}, ${offer}, ${outcome}, ${tone}, ${repName},
            ${fromName || repName}, ${fromEmail || null}, ${twilioNumber || null},
            ${bookingLink || null}, ${leadTag || 'new-lead'},
            ${metaPageIds}::text[], ${metaFormIds}::text[], ${metaPageToken || null})
    RETURNING *
  `

  // Pipeline stages for this client
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    const [pname, color] = PIPELINE_STAGES[i]
    await db`
      INSERT INTO pipeline_stages (client_id, name, color, position)
      VALUES (${client.id}, ${pname}, ${color}, ${i})
    `
  }

  // Generate copy for all blueprints in parallel, then insert each workflow
  const copyResults = await Promise.all(
    BLUEPRINTS.map(bp => generateCopyForBlueprint(client, bp).catch(() => ({})))
  )

  const workflows = []
  let nurtureId = null
  for (let i = 0; i < BLUEPRINTS.length; i++) {
    const bp = BLUEPRINTS[i]
    const steps = assembleSteps(bp, copyResults[i])
    const [wf] = await db`
      INSERT INTO workflows (client_id, name, description, trigger, steps, active)
      VALUES (${client.id}, ${bp.name}, ${bp.description}, 'manual', ${JSON.stringify(steps)}, true)
      RETURNING id, name
    `
    workflows.push({ id: wf.id, name: wf.name, key: bp.key, steps: steps.length })
    if (bp.key === 'nurture') nurtureId = wf.id
  }

  // Optionally enroll existing leads (tagged lead_tag) into the nurture sequence
  let enrolled = 0
  if (enrollExisting && nurtureId) {
    const leads = await db`
      SELECT id FROM contacts
      WHERE client_id = ${client.id} AND ${leadTag} = ANY(tags) AND NOT ('unsubscribed' = ANY(tags))
      LIMIT 500
    `
    for (const l of leads) {
      try { await enrollContact(l.id, nurtureId, client.id); enrolled++ } catch {}
    }
  }

  return { client, workflows, stages: PIPELINE_STAGES.length, enrolled }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token, x-client-id')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  await migrate()
  const db = sql()

  let body = {}
  if (req.method !== 'GET') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  }

  try {
    if (req.query.action === 'onboard') {
      const result = await onboard(db, body)
      return res.status(201).json(result)
    }

    // ── Register the app-level webhook (callback URL + leadgen) via Graph API ──
    if (req.query.action === 'meta-app-subscribe') {
      const APP_ID = process.env.META_APP_ID
      const APP_SECRET = process.env.META_APP_SECRET
      const VERIFY = process.env.META_WEBHOOK_VERIFY_TOKEN
      if (!APP_ID || !APP_SECRET) return res.status(400).json({ error: 'META_APP_ID / META_APP_SECRET not set' })
      if (!VERIFY) return res.status(400).json({ error: 'META_WEBHOOK_VERIFY_TOKEN not set' })
      const base = (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`).replace(/\/$/, '')
      const callback = `${base}/api/webhook-meta`
      const V = 'v21.0'
      const appToken = `${APP_ID}|${APP_SECRET}`
      const g = async (u, m) => { const r = await fetch(u, m ? { method: m } : undefined); let d; try { d = await r.json() } catch { d = {} } return d }
      const subscribe = await g(
        `https://graph.facebook.com/${V}/${APP_ID}/subscriptions?object=page&callback_url=${encodeURIComponent(callback)}&fields=leadgen&include_values=true&verify_token=${encodeURIComponent(VERIFY)}&access_token=${encodeURIComponent(appToken)}`,
        'POST',
      )
      const current = await g(`https://graph.facebook.com/${V}/${APP_ID}/subscriptions?access_token=${encodeURIComponent(appToken)}`)
      return res.status(200).json({ callback, subscribe, current: current.data || current })
    }

    // ── Meta connection diagnosis / fix (uses the stored Page token server-side) ──
    if (req.query.action === 'meta-check' || req.query.action === 'meta-subscribe') {
      const clientId = body.clientId || req.query.clientId
      if (!clientId) return res.status(400).json({ error: 'clientId required' })
      const [c] = await db`SELECT id, name, meta_page_ids, meta_page_token FROM clients WHERE id = ${clientId}`
      if (!c) return res.status(404).json({ error: 'Client not found' })
      const tok = c.meta_page_token
      const pageId = (c.meta_page_ids || [])[0]
      if (!tok) return res.status(200).json({ ok: false, reason: 'No Page Access Token configured', client: c.name, pageId })
      if (!pageId) return res.status(200).json({ ok: false, reason: 'No Page ID configured', client: c.name })

      const V = 'v21.0'
      const enc = encodeURIComponent(tok)
      const g = async (u, m) => { const r = await fetch(u, m ? { method: m } : undefined); let d; try { d = await r.json() } catch { d = {} } return d }

      if (req.query.action === 'meta-subscribe') {
        const result = await g(`https://graph.facebook.com/${V}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${enc}`, 'POST')
        return res.status(200).json({ action: 'subscribe', pageId, result })
      }

      // read-only diagnosis
      const me = await g(`https://graph.facebook.com/${V}/me?fields=id,name,category&access_token=${enc}`)
      const accounts = await g(`https://graph.facebook.com/${V}/me/accounts?fields=id,name&access_token=${enc}`)
      const subs = await g(`https://graph.facebook.com/${V}/${pageId}/subscribed_apps?access_token=${enc}`)
      const accountIds = (accounts?.data || []).map(a => String(a.id))
      return res.status(200).json({
        client: c.name,
        pageId,
        tokenValid: !me?.error,
        identity: me?.error ? { error: me.error?.message } : me,
        pageInManageableList: accountIds.includes(String(pageId)),
        manageablePages: (accounts?.data || []).map(a => ({ id: a.id, name: a.name })),
        accountsError: accounts?.error?.message || null,
        leadgenSubscribed: !!(subs?.data || []).some(a => (a.subscribed_fields || []).includes('leadgen')),
        subscribedApps: subs?.data || subs,
        subscribedAppsError: subs?.error?.message || null,
      })
    }

    if (req.method === 'GET') {
      const rows = await db`SELECT * FROM clients ORDER BY created_at ASC`
      // Never expose the Page token to the browser; just whether one is configured.
      const clients = rows.map(c => ({ ...c, meta_page_token: undefined, meta_page_token_set: !!c.meta_page_token }))
      return res.status(200).json({ clients })
    }

    if (req.method === 'POST') {
      const { name } = body
      if (!name) return res.status(400).json({ error: 'name required' })
      const slug = await uniqueSlug(db, slugify(name))
      const [client] = await db`
        INSERT INTO clients (name, slug, industry, offer, outcome, tone, rep_name, from_name, from_email, twilio_number, booking_link, lead_tag)
        VALUES (${name}, ${slug}, ${body.industry || ''}, ${body.offer || ''}, ${body.outcome || ''},
                ${body.tone || 'friendly'}, ${body.repName || ''}, ${body.fromName || ''}, ${body.fromEmail || null},
                ${body.twilioNumber || null}, ${body.bookingLink || null}, ${body.leadTag || 'new-lead'})
        RETURNING *
      `
      return res.status(201).json({ client })
    }

    if (req.method === 'PUT') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      const b = body
      await db`
        UPDATE clients SET
          name          = COALESCE(${b.name          ?? null}, name),
          industry      = COALESCE(${b.industry      ?? null}, industry),
          offer         = COALESCE(${b.offer         ?? null}, offer),
          outcome       = COALESCE(${b.outcome       ?? null}, outcome),
          tone          = COALESCE(${b.tone          ?? null}, tone),
          rep_name      = COALESCE(${b.repName       ?? null}, rep_name),
          from_name     = COALESCE(${b.fromName      ?? null}, from_name),
          from_email    = COALESCE(${b.fromEmail     ?? null}, from_email),
          twilio_number = COALESCE(${b.twilioNumber  ?? null}, twilio_number),
          booking_link  = COALESCE(${b.bookingLink   ?? null}, booking_link),
          lead_tag      = COALESCE(${b.leadTag       ?? null}, lead_tag),
          meta_page_ids = COALESCE(${b.metaPageIds   ?? null}::text[], meta_page_ids),
          meta_form_ids = COALESCE(${b.metaFormIds   ?? null}::text[], meta_form_ids),
          meta_page_token = COALESCE(NULLIF(${b.metaPageToken ?? ''}, ''), meta_page_token),
          active        = COALESCE(${b.active         ?? null}, active)
        WHERE id = ${id}
      `
      const [row] = await db`SELECT * FROM clients WHERE id = ${id}`
      const client = row ? { ...row, meta_page_token: undefined, meta_page_token_set: !!row.meta_page_token } : null
      return res.status(200).json({ client })
    }

    if (req.method === 'DELETE') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      const [def] = await db`SELECT id FROM clients WHERE slug = 'default'`
      if (def && String(def.id) === String(id)) return res.status(400).json({ error: 'Cannot delete the Default client' })
      await db`DELETE FROM clients WHERE id = ${id}`
      return res.status(200).json({ deleted: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[api/clients]', err)
    return res.status(500).json({ error: err.message })
  }
}
