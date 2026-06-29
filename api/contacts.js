/**
 * /api/contacts  (scoped to the active client via x-client-id)
 * GET    — list contacts (search, tag filter, pagination)
 * POST   — create contact
 * PUT    — update contact  (body: { id, ...fields })
 * DELETE — delete contact  (body: { id })
 */
import { sql, migrate, activeClientId } from './_db.js'

function auth(req) {
  const t = req.headers['x-dashboard-token'] || req.body?.token
  return t === process.env.DASHBOARD_PASSWORD
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-token, x-client-id')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!auth(req)) return res.status(401).json({ error: 'Unauthorized' })

  await migrate()
  const db = sql()
  const cid = await activeClientId(req)

  let body = {}
  if (req.method !== 'GET') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}) } catch {}
  }

  try {
    if (req.method === 'GET') {
      const { search = '', tag = '', limit = '100', offset = '0' } = req.query
      let contacts

      if (search) {
        const q = `%${search}%`
        contacts = await db`
          SELECT * FROM contacts
          WHERE client_id = ${cid}
            AND (first_name ILIKE ${q} OR last_name ILIKE ${q} OR email ILIKE ${q} OR phone ILIKE ${q})
          ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `
      } else if (tag) {
        contacts = await db`
          SELECT * FROM contacts WHERE client_id = ${cid} AND ${tag} = ANY(tags)
          ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `
      } else {
        contacts = await db`
          SELECT * FROM contacts WHERE client_id = ${cid}
          ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}
        `
      }

      const [{ count }] = await db`SELECT COUNT(*)::int AS count FROM contacts WHERE client_id = ${cid}`
      return res.status(200).json({ contacts, total: count })
    }

    if (req.method === 'POST') {
      const { firstName, lastName, email, phone, tags = [], source = '', notes = '', metadata = {} } = body

      // Check for duplicate within this client
      if (email) {
        const existing = await db`SELECT id FROM contacts WHERE email = ${email} AND client_id = ${cid} LIMIT 1`
        if (existing.length > 0) {
          await db`
            UPDATE contacts SET
              first_name = COALESCE(NULLIF(${firstName || ''}, ''), first_name),
              last_name  = COALESCE(NULLIF(${lastName  || ''}, ''), last_name),
              phone      = COALESCE(NULLIF(${phone     || ''}, ''), phone),
              tags       = (SELECT ARRAY(SELECT DISTINCT unnest(tags || ${tags}::text[]))),
              updated_at = now()
            WHERE id = ${existing[0].id}
          `
          const [updated] = await db`SELECT * FROM contacts WHERE id = ${existing[0].id}`
          return res.status(200).json({ contact: updated, updated: true })
        }
      }

      const [contact] = await db`
        INSERT INTO contacts (client_id, first_name, last_name, email, phone, tags, source, notes, metadata)
        VALUES (${cid}, ${firstName || ''}, ${lastName || ''}, ${email || null}, ${phone || null},
                ${tags}, ${source}, ${notes}, ${JSON.stringify(metadata)})
        RETURNING *
      `
      return res.status(201).json({ contact, created: true })
    }

    if (req.method === 'PUT') {
      const { id, ...fields } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      const { firstName, lastName, email, phone, tags, source, notes, metadata } = fields
      await db`
        UPDATE contacts SET
          first_name = COALESCE(${firstName ?? null}, first_name),
          last_name  = COALESCE(${lastName  ?? null}, last_name),
          email      = COALESCE(${email     ?? null}, email),
          phone      = COALESCE(${phone     ?? null}, phone),
          tags       = COALESCE(${tags      ?? null}::text[], tags),
          source     = COALESCE(${source    ?? null}, source),
          notes      = COALESCE(${notes     ?? null}, notes),
          metadata   = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, metadata),
          updated_at = now()
        WHERE id = ${id} AND client_id = ${cid}
      `
      const [contact] = await db`SELECT * FROM contacts WHERE id = ${id} AND client_id = ${cid}`
      return res.status(200).json({ contact })
    }

    if (req.method === 'DELETE') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      await db`DELETE FROM contacts WHERE id = ${id} AND client_id = ${cid}`
      return res.status(200).json({ deleted: true })
    }

    return res.status(405).end()
  } catch (err) {
    console.error('[api/contacts]', err)
    return res.status(500).json({ error: err.message })
  }
}
