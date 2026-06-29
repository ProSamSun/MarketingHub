/**
 * GET /api/inbox  — conversation history (scoped to the active client via x-client-id)
 */
import { sql, migrate, activeClientId } from './_db.js'

function auth(req) {
  return req.headers['x-dashboard-token'] === process.env.DASHBOARD_PASSWORD
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'GET') return res.status(405).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  await migrate()
  const db = sql()
  const cid = await activeClientId(req)

  const { contactId, limit = '50' } = req.query

  try {
    let messages
    if (contactId) {
      messages = await db`
        SELECT m.*, c.first_name, c.last_name
        FROM messages m
        JOIN contacts c ON c.id = m.contact_id
        WHERE m.client_id = ${cid} AND m.contact_id = ${contactId}
        ORDER BY m.sent_at DESC
        LIMIT ${parseInt(limit)}
      `
    } else {
      messages = await db`
        SELECT m.*, c.first_name, c.last_name
        FROM messages m
        JOIN contacts c ON c.id = m.contact_id
        WHERE m.client_id = ${cid}
        ORDER BY m.sent_at DESC
        LIMIT ${parseInt(limit)}
      `
    }
    return res.status(200).json({ messages })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
