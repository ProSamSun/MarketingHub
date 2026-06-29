/**
 * POST /api/webhook-twilio  — incoming SMS replies from Twilio
 *
 * Maps the inbound message to a client via the destination number (To) against
 * clients.twilio_number, matches/creates the sender contact (scoped to that
 * client), stores the message as direction='inbound', and HALTS the contact's
 * active outbound sequences (stop-on-reply) so a human can take over.
 *
 * Setup in Twilio: Phone Numbers → your number → Messaging → "A message comes in"
 *   Webhook: https://your-app.vercel.app/api/webhook-twilio  (HTTP POST)
 */
import { sql, migrate, defaultClientId } from './_db.js'

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : '')
  const params = new URLSearchParams(raw)
  const out = {}
  for (const [k, v] of params) out[k] = v
  return out
}

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

    // Route to a client by the destination (our) number; fall back to Default
    let cid = null
    if (to) {
      const [c] = await db`
        SELECT id FROM clients
        WHERE twilio_number IS NOT NULL
          AND right(regexp_replace(twilio_number, '\D', '', 'g'), 10) = right(regexp_replace(${to}, '\D', '', 'g'), 10)
        LIMIT 1
      `
      cid = c?.id || null
    }
    if (!cid) cid = await defaultClientId()

    // Match the sender within this client by last 10 digits
    const matches = await db`
      SELECT id FROM contacts
      WHERE client_id = ${cid}
        AND phone IS NOT NULL
        AND right(regexp_replace(phone, '\D', '', 'g'), 10) = right(regexp_replace(${from}, '\D', '', 'g'), 10)
      ORDER BY created_at ASC
      LIMIT 1
    `

    let contactId = matches[0]?.id
    if (!contactId) {
      const [created] = await db`
        INSERT INTO contacts (client_id, first_name, last_name, phone, tags, source)
        VALUES (${cid}, '', '', ${from}, ARRAY['sms-inbound']::text[], 'SMS')
        RETURNING id
      `
      contactId = created.id
      console.log(`[webhook-twilio] Created contact for inbound ${from} (client ${cid})`)
    }

    await db`
      INSERT INTO messages (client_id, contact_id, type, direction, body, status, metadata)
      VALUES (${cid}, ${contactId}, 'sms', 'inbound', ${text}, 'received',
              ${JSON.stringify({ sid, from, to })})
    `

    // Stop-on-reply: halt active outbound sequences for this contact
    await db`
      UPDATE enrollments SET status = 'replied', completed_at = now()
      WHERE contact_id = ${contactId} AND status = 'active'
    `

    console.log(`[webhook-twilio] Inbound SMS from ${from} stored; sequences halted`)
    return twiml(res)
  } catch (err) {
    console.error('[webhook-twilio]', err)
    return twiml(res)
  }
}
