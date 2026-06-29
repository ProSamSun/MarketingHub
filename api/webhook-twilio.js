/**
 * POST /api/webhook-twilio  — incoming SMS replies from Twilio
 *
 * Twilio posts inbound messages as application/x-www-form-urlencoded with fields
 * like From, To, Body, MessageSid. We match the sender to a contact (by phone),
 * create one if none exists, and store the message as direction='inbound' so it
 * shows up in the dashboard inbox.
 *
 * Setup in Twilio:
 *   Phone Numbers → your number → Messaging → "A message comes in"
 *   Webhook: https://your-app.vercel.app/api/webhook-twilio  (HTTP POST)
 */
import { sql, migrate } from './_db.js'

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : '')
  const params = new URLSearchParams(raw)
  const out = {}
  for (const [k, v] of params) out[k] = v
  return out
}

// Empty TwiML so Twilio doesn't send an auto-reply
function twiml(res) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8')
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const body = parseBody(req)
  const from = body.From || body.from || ''
  const text = body.Body || body.body || ''
  const to   = body.To   || body.to   || ''
  const sid  = body.MessageSid || body.SmsSid || body.MessageSID || null

  if (!from) {
    console.warn('[webhook-twilio] No From field on inbound message')
    return twiml(res)
  }

  try {
    await migrate()
    const db = sql()

    // Match by last 10 digits so +1XXXXXXXXXX matches a stored XXXXXXXXXX
    const matches = await db`
      SELECT id FROM contacts
      WHERE phone IS NOT NULL
        AND right(regexp_replace(phone, '\D', '', 'g'), 10) = right(regexp_replace(${from}, '\D', '', 'g'), 10)
      ORDER BY created_at ASC
      LIMIT 1
    `

    let contactId = matches[0]?.id
    if (!contactId) {
      const [created] = await db`
        INSERT INTO contacts (first_name, last_name, phone, tags, source)
        VALUES ('', '', ${from}, ARRAY['sms-inbound']::text[], 'SMS')
        RETURNING id
      `
      contactId = created.id
      console.log(`[webhook-twilio] Created contact for inbound number ${from}`)
    }

    await db`
      INSERT INTO messages (contact_id, type, direction, body, status, metadata)
      VALUES (${contactId}, 'sms', 'inbound', ${text}, 'received',
              ${JSON.stringify({ sid, from, to })})
    `

    console.log(`[webhook-twilio] Stored inbound SMS from ${from}`)
    return twiml(res)
  } catch (err) {
    console.error('[webhook-twilio]', err)
    // Still return valid TwiML so Twilio doesn't retry-storm
    return twiml(res)
  }
}
