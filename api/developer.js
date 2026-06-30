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

// ── Default templates ─────────────────────────────────────────────────────────
// World-class direct-response sequence used by top-tier marketing agencies.
// Variables: {{first_name}} {{last_name}} {{business_name}} {{rep_name}}
//            {{offer}} {{booking_link}}
const DEFAULT_TEMPLATES = [

  // ── SMS Sequence ─────────────────────────────────────────────────────────────

  {
    key:     'speed_to_lead_sms',
    label:   '1. Speed-to-Lead SMS — Immediate',
    channel: 'sms',
    body:
`Hi {{first_name}}, this is {{rep_name}} from {{business_name}}. I just received your request about {{offer}} and wanted to reach out personally. Do you have 15 minutes to connect today?`,
  },

  {
    key:     'follow_up_sms_4hr',
    label:   '2. Follow-Up SMS — 4 Hours',
    channel: 'sms',
    body:
`{{first_name}}, {{rep_name}} again from {{business_name}}. Wanted to make sure my earlier message didn't get lost! Any questions about {{offer}}? I'm here whenever you're ready.`,
  },

  {
    key:     'follow_up_sms_day2',
    label:   '3. Follow-Up SMS — Day 2',
    channel: 'sms',
    body:
`Hey {{first_name}}, {{rep_name}} from {{business_name}} here. I still have a spot set aside for you this week for {{offer}}. Would tomorrow or the day after work for a quick call?`,
  },

  {
    key:     'final_attempt_sms',
    label:   '4. Final Attempt SMS — Day 4',
    channel: 'sms',
    body:
`{{first_name}}, last check-in from {{rep_name}} at {{business_name}}. Is {{offer}} still something you want to explore? If the timing's off, just say so — no hard feelings either way.`,
  },

  {
    key:     'reactivation_sms',
    label:   '5. Reactivation SMS — Day 21+',
    channel: 'sms',
    body:
`{{first_name}}, {{rep_name}} from {{business_name}} here. You reached out about {{offer}} a while back — still on your radar? Reply YES and I'll get you taken care of right away.`,
  },

  // ── Email Sequence ────────────────────────────────────────────────────────────

  {
    key:     'welcome_email_subject',
    label:   '6. Welcome Email — Subject Line',
    channel: 'email_subject',
    body:    `{{first_name}}, we received your request — here's what happens next`,
  },

  {
    key:     'welcome_email_body',
    label:   '7. Welcome Email — Body (Immediate)',
    channel: 'email',
    body:
`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;background:#f3f4f6">
  <tr><td align="center">
    <table width="100%" style="max-width:560px">
      <tr><td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07)">

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:#cc0000;padding:12px 40px">
            <p style="margin:0;color:rgba(255,255,255,0.95);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">{{business_name}}</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:40px">

            <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#cc0000;letter-spacing:1px;text-transform:uppercase">Request Received</p>
            <h1 style="margin:0 0 24px;font-size:26px;font-weight:800;color:#111827;line-height:1.3;letter-spacing:-0.5px">Hi {{first_name}}, we got your request — and we take it seriously.</h1>

            <p style="margin:0 0 16px;font-size:16px;line-height:1.75;color:#374151">Thank you for reaching out about <strong style="color:#111827">{{offer}}</strong>. Every inquiry we receive gets personal attention — that's not a marketing line, it's how we operate.</p>

            <p style="margin:0 0 28px;font-size:16px;line-height:1.75;color:#374151"><strong style="color:#111827">{{rep_name}}</strong> from our team will be in touch within the next few hours. You can also book a time that works for you right now:</p>

            <table cellpadding="0" cellspacing="0">
              <tr><td style="background:#cc0000;border-radius:8px">
                <a href="{{booking_link}}" style="display:inline-block;padding:15px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px">Schedule My Call &rarr;</a>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:36px 0;border-radius:10px;border:1px solid #f0f0f0;background:#fafafa">
              <tr><td style="padding:24px 28px">
                <p style="margin:0 0 14px;font-size:12px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:0.8px">What Happens Next</p>
                <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#374151"><span style="color:#cc0000;font-weight:700">&#10003;</span>&nbsp; <strong>Within minutes</strong> &mdash; You'll receive a text from {{rep_name}} to confirm your inquiry</p>
                <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#374151"><span style="color:#cc0000;font-weight:700">&#10003;</span>&nbsp; <strong>Within 24 hours</strong> &mdash; A short call to understand your exact situation</p>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#374151"><span style="color:#cc0000;font-weight:700">&#10003;</span>&nbsp; <strong>Same week</strong> &mdash; A clear, honest path forward — no fluff, no pressure</p>
              </td></tr>
            </table>

            <table cellpadding="0" cellspacing="0" style="padding-top:24px;border-top:1px solid #f0f0f0;width:100%">
              <tr><td>
                <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#111827">{{rep_name}}</p>
                <p style="margin:0;font-size:13px;color:#6b7280">{{business_name}}</p>
              </td></tr>
            </table>

          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 0;text-align:center">
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6">You received this because you submitted a form requesting information about {{offer}}.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  },

  {
    key:     'follow_up_email_subject',
    label:   '8. Follow-Up Email — Subject Line (Day 2)',
    channel: 'email_subject',
    body:    `Still thinking it over, {{first_name}}? Here's something worth reading.`,
  },

  {
    key:     'follow_up_email_body',
    label:   '9. Follow-Up Email — Body (Day 2)',
    channel: 'email',
    body:
`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;background:#f3f4f6">
  <tr><td align="center">
    <table width="100%" style="max-width:560px">
      <tr><td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07)">

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:#111827;padding:12px 40px">
            <p style="margin:0;color:rgba(255,255,255,0.6);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">{{business_name}}</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:40px">

            <h1 style="margin:0 0 24px;font-size:24px;font-weight:800;color:#111827;line-height:1.35;letter-spacing:-0.3px">{{first_name}}, a quick follow-up.</h1>

            <p style="margin:0 0 16px;font-size:16px;line-height:1.75;color:#374151">I reached out yesterday about <strong style="color:#111827">{{offer}}</strong> and didn't want to leave you hanging. I'm following up — not to pressure you, but because I genuinely believe this could be the right fit.</p>

            <p style="margin:0 0 24px;font-size:16px;line-height:1.75;color:#374151">Most people have the same two questions before they get on a call with us:</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border-radius:10px;border-left:4px solid #cc0000;background:#fafafa">
              <tr><td style="padding:20px 24px">
                <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111827">"Is this actually going to be worth my time?"</p>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#374151">That's exactly why we keep the first call to 15 minutes. No long pitches. We learn about your situation, and if we can help, we tell you how. If we can't, we'll tell you that too.</p>
              </td></tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;border-radius:10px;border-left:4px solid #cc0000;background:#fafafa">
              <tr><td style="padding:20px 24px">
                <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#111827">"I'm not sure I'm ready to commit to anything."</p>
                <p style="margin:0;font-size:14px;line-height:1.7;color:#374151">A conversation isn't a commitment. It's just a conversation. We've never pushed anyone into a decision they weren't ready to make — and we don't plan to start.</p>
              </td></tr>
            </table>

            <p style="margin:0 0 28px;font-size:16px;line-height:1.75;color:#374151">If any part of you is still curious, I'd love 15 minutes. Book below — no strings attached.</p>

            <table cellpadding="0" cellspacing="0">
              <tr><td style="background:#cc0000;border-radius:8px">
                <a href="{{booking_link}}" style="display:inline-block;padding:15px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px">Let's Talk &mdash; 15 Min &rarr;</a>
              </td></tr>
            </table>

            <table cellpadding="0" cellspacing="0" style="margin-top:36px;padding-top:24px;border-top:1px solid #f0f0f0;width:100%">
              <tr><td>
                <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#111827">{{rep_name}}</p>
                <p style="margin:0;font-size:13px;color:#6b7280">{{business_name}}</p>
              </td></tr>
            </table>

          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 0;text-align:center">
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6">You received this because you submitted a form requesting information about {{offer}}.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  },

  {
    key:     'reactivation_email_subject',
    label:   '10. Reactivation Email — Subject Line (Day 21+)',
    channel: 'email_subject',
    body:    `{{first_name}}, we haven't forgotten about you.`,
  },

  {
    key:     'reactivation_email_body',
    label:   '11. Reactivation Email — Body (Day 21+)',
    channel: 'email',
    body:
`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;background:#f3f4f6">
  <tr><td align="center">
    <table width="100%" style="max-width:560px">
      <tr><td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07)">

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:#cc0000;padding:12px 40px">
            <p style="margin:0;color:rgba(255,255,255,0.95);font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">{{business_name}}</p>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:40px">

            <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#cc0000;letter-spacing:1px;text-transform:uppercase">One Last Reach Out</p>
            <h1 style="margin:0 0 24px;font-size:26px;font-weight:800;color:#111827;line-height:1.3;letter-spacing:-0.5px">Life got busy. We completely understand, {{first_name}}.</h1>

            <p style="margin:0 0 16px;font-size:16px;line-height:1.75;color:#374151">It's been a while since you first reached out about <strong style="color:#111827">{{offer}}</strong>. We haven't forgotten about you, and we wanted to check in one final time before closing out your file.</p>

            <p style="margin:0 0 24px;font-size:16px;line-height:1.75;color:#374151">We're not going to send you ten more emails. This is it. But we'd feel like we let you down if we didn't give you one more chance to connect.</p>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px;border-radius:12px;background:#111827">
              <tr><td style="padding:28px 32px">
                <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#cc0000;letter-spacing:1px;text-transform:uppercase">Why People Come Back</p>
                <p style="margin:0 0 10px;font-size:15px;line-height:1.7;color:#d1d5db">&#8220;I kept putting it off and finally booked the call. I wish I had done it months ago.&#8221;</p>
                <p style="margin:0;font-size:13px;color:#6b7280;font-style:italic">— A client who waited too long</p>
              </td></tr>
            </table>

            <p style="margin:0 0 12px;font-size:16px;line-height:1.75;color:#374151">If <strong style="color:#111827">{{offer}}</strong> is still something you're working toward — even in the back of your mind — let's talk. 15 minutes. No commitment. Just a real conversation.</p>

            <p style="margin:0 0 28px;font-size:16px;line-height:1.75;color:#374151">And if the timing truly isn't right, just reply to this email and let us know. We'll take care of it.</p>

            <table cellpadding="0" cellspacing="0" style="margin:0 0 8px">
              <tr><td style="background:#cc0000;border-radius:8px">
                <a href="{{booking_link}}" style="display:inline-block;padding:15px 36px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.3px">I'm Still Interested &rarr;</a>
              </td></tr>
            </table>
            <p style="margin:0 0 36px;font-size:13px;color:#9ca3af">or simply reply to this email</p>

            <table cellpadding="0" cellspacing="0" style="padding-top:24px;border-top:1px solid #f0f0f0;width:100%">
              <tr><td>
                <p style="margin:0 0 2px;font-size:15px;font-weight:700;color:#111827">{{rep_name}}</p>
                <p style="margin:0;font-size:13px;color:#6b7280">{{business_name}}</p>
              </td></tr>
            </table>

          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:20px 0;text-align:center">
        <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6">You received this because you submitted a form requesting information about {{offer}}.</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  },
]

async function seedTemplates(db, clientId) {
  for (const t of DEFAULT_TEMPLATES) {
    await db`
      INSERT INTO templates (client_id, key, label, channel, body, updated_at)
      VALUES (${clientId}, ${t.key}, ${t.label}, ${t.channel}, ${t.body}, now())
      ON CONFLICT (client_id, key)
      DO UPDATE SET
        label      = EXCLUDED.label,
        channel    = EXCLUDED.channel,
        body       = EXCLUDED.body,
        updated_at = now()
      WHERE templates.body != EXCLUDED.body
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
