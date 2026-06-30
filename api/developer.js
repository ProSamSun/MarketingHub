/**
 * /api/developer
 * Developer console — full audit trail of every message sent,
 * editable AI prompt templates, and inbound webhook events.
 *
 * GET  ?action=logs      — paginated message log
 * GET  ?action=templates — list templates for client (seeds defaults if empty)
 * POST ?action=save-template — upsert a template
 * GET  ?action=webhooks  — recent webhook events
 */

import { sql, migrate, activeClientId } from './_db.js'

function auth(req) {
  const pw = req.headers['x-dashboard-token']
  if (!pw || pw !== process.env.DASHBOARD_PASSWORD) return false
  return true
}

// ── Default AI prompt templates ───────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  {
    key: 'speed_to_lead_sms',
    label: 'Speed-to-Lead SMS',
    channel: 'sms',
    body: `Hey {{first_name}}! This is {{rep_name}} with {{business_name}} 🔥 I just saw you reached out — I want to make sure you get taken care of fast. What's the best time to connect today?`,
  },
  {
    key: 'follow_up_sms',
    label: 'Follow-Up SMS (Day 2)',
    channel: 'sms',
    body: `Hey {{first_name}}, just following up from yesterday! We have a great offer on {{offer}} and I'd hate for you to miss out. Reply here or call us anytime — {{rep_name}} @ {{business_name}}`,
  },
  {
    key: 'reactivation_sms',
    label: 'Reactivation SMS',
    channel: 'sms',
    body: `Hey {{first_name}}! It's {{rep_name}} from {{business_name}}. We haven't connected yet and I don't want you to miss out on {{offer}}. This offer won't last long — are you still interested? Reply YES and I'll get you details!`,
  },
  {
    key: 'welcome_email_subject',
    label: 'Welcome Email — Subject Line',
    channel: 'email_subject',
    body: `You're one step away from {{offer}} — let's talk, {{first_name}}`,
  },
  {
    key: 'welcome_email_body',
    label: 'Welcome Email — Body',
    channel: 'email',
    body: `<p>Hi {{first_name}},</p>
<p>Thanks for reaching out to <strong>{{business_name}}</strong>! We're excited to connect with you about <strong>{{offer}}</strong>.</p>
<p>Our team is ready to walk you through everything and answer any questions you have. Click below to book a quick call:</p>
<p style="text-align:center"><a href="{{booking_link}}" style="background:#cc0000;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Book My Call →</a></p>
<p>Talk soon,<br><strong>{{rep_name}}</strong><br>{{business_name}}</p>`,
  },
  {
    key: 'reactivation_email_subject',
    label: 'Reactivation Email — Subject Line',
    channel: 'email_subject',
    body: `{{first_name}}, we saved your spot — but not for long`,
  },
  {
    key: 'reactivation_email_body',
    label: 'Reactivation Email — Body',
    channel: 'email',
    body: `<p>Hey {{first_name}},</p>
<p>We noticed you reached out a while back about <strong>{{offer}}</strong> but we never got to connect. Life gets busy — we get it.</p>
<p>We wanted to reach out one more time because this offer is still available and we think it could genuinely help you. But spots are limited.</p>
<p style="text-align:center"><a href="{{booking_link}}" style="background:#cc0000;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Claim My Spot →</a></p>
<p>If now's not the right time, no worries — just reply and let us know.</p>
<p>— {{rep_name}} @ {{business_name}}</p>`,
  },
]

async function seedTemplates(db, clientId) {
  for (const t of DEFAULT_TEMPLATES) {
    await db`
      INSERT INTO templates (client_id, key, label, channel, body)
      VALUES (${clientId}, ${t.key}, ${t.label}, ${t.channel}, ${t.body})
      ON CONFLICT (client_id, key) DO NOTHING
    `
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'x-dashboard-token, x-client-id, content-type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  try {
    await migrate()
    const db  = sql()
    const cid = await activeClientId(req)

    const action = req.query.action || req.body?.action

    // ── Message log ───────────────────────────────────────────────────────────
    if (action === 'logs') {
      const limit  = Math.min(parseInt(req.query.limit  || '100'), 500)
      const offset = parseInt(req.query.offset || '0')
      const search = req.query.search || ''
      const chan   = req.query.channel || ''

      const rows = await db`
        SELECT
          m.id,
          m.type        AS channel,
          m.direction,
          m.subject,
          m.body,
          m.status,
          m.metadata,
          m.sent_at,
          c.first_name,
          c.last_name,
          c.phone,
          c.email,
          c.id AS contact_id
        FROM messages m
        LEFT JOIN contacts c ON c.id = m.contact_id
        WHERE m.client_id = ${cid}
          AND (${search} = '' OR c.first_name ILIKE ${'%' + search + '%'}
               OR c.last_name ILIKE ${'%' + search + '%'}
               OR c.phone ILIKE ${'%' + search + '%'}
               OR c.email ILIKE ${'%' + search + '%'}
               OR m.body ILIKE ${'%' + search + '%'})
          AND (${chan} = '' OR m.type = ${chan})
        ORDER BY m.sent_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `

      const [{ total }] = await db`
        SELECT COUNT(*) AS total FROM messages WHERE client_id = ${cid}
      `

      return res.status(200).json({ logs: rows, total: Number(total), limit, offset })
    }

    // ── Templates list ────────────────────────────────────────────────────────
    if (action === 'templates' && req.method === 'GET') {
      await seedTemplates(db, cid)
      const rows = await db`
        SELECT id, key, label, channel, body, updated_at
        FROM templates
        WHERE client_id = ${cid}
        ORDER BY channel, label
      `
      return res.status(200).json({ templates: rows })
    }

    // ── Save / update template ────────────────────────────────────────────────
    if (action === 'save-template') {
      let body
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body } catch { body = {} }
      const { key, label, channel, templateBody } = body

      if (!key || !templateBody) return res.status(400).json({ error: 'key and templateBody required' })

      await db`
        INSERT INTO templates (client_id, key, label, channel, body, updated_at)
        VALUES (${cid}, ${key}, ${label || key}, ${channel || 'sms'}, ${templateBody}, now())
        ON CONFLICT (client_id, key)
        DO UPDATE SET body = EXCLUDED.body, label = EXCLUDED.label, updated_at = now()
      `
      return res.status(200).json({ ok: true })
    }

    // ── Webhook events ────────────────────────────────────────────────────────
    if (action === 'webhooks') {
      const limit = Math.min(parseInt(req.query.limit || '50'), 200)
      const rows  = await db`
        SELECT id, source, event_type, payload, processed, received_at
        FROM webhook_events
        WHERE client_id = ${cid}
        ORDER BY received_at DESC
        LIMIT ${limit}
      `
      return res.status(200).json({ events: rows })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (err) {
    console.error('[developer]', err)
    return res.status(500).json({ error: err.message })
  }
}
