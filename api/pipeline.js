/**
 * /api/pipeline
 * GET  — stages + deals
 * POST — create deal
 * PUT  — move deal to stage or update fields
 */
import { sql, migrate } from './_db.js'

function auth(req) {
  const t = req.headers['x-dashboard-token'] || req.body?.token
  return t === process.env.DASHBOARD_PASSWORD
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  await migrate()
  const db = sql()

  let body = {}
  if (req.method !== 'GET') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  }

  try {
    if (req.method === 'GET') {
      const stages = await db`SELECT * FROM pipeline_stages ORDER BY position`
      const deals  = await db`
        SELECT d.*, c.first_name, c.last_name, c.email, c.phone
        FROM deals d
        LEFT JOIN contacts c ON c.id = d.contact_id
        ORDER BY d.created_at DESC
      `
      return res.status(200).json({ stages, deals })
    }

    if (req.method === 'POST') {
      const { contactId, stageId, title, value = 0, notes = '' } = body
      if (!title) return res.status(400).json({ error: 'title required' })

      // Default to first stage
      let sid = stageId
      if (!sid) {
        const [first] = await db`SELECT id FROM pipeline_stages ORDER BY position LIMIT 1`
        sid = first?.id
      }

      const [deal] = await db`
        INSERT INTO deals (contact_id, stage_id, title, value, notes)
        VALUES (${contactId || null}, ${sid}, ${title}, ${value}, ${notes})
        RETURNING *
      `
      return res.status(201).json({ deal })
    }

    if (req.method === 'PUT') {
      const { id, stageId, title, value, notes } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      await db`
        UPDATE deals SET
          stage_id = COALESCE(${stageId ?? null}::uuid, stage_id),
          title    = COALESCE(${title   ?? null}, title),
          value    = COALESCE(${value   ?? null}, value),
          notes    = COALESCE(${notes   ?? null}, notes),
          updated_at = now()
        WHERE id = ${id}
      `
      const [deal] = await db`SELECT * FROM deals WHERE id = ${id}`
      return res.status(200).json({ deal })
    }

    if (req.method === 'DELETE') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      await db`DELETE FROM deals WHERE id = ${id}`
      return res.status(200).json({ deleted: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[api/pipeline]', err)
    return res.status(500).json({ error: err.message })
  }
}
