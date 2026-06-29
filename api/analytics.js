/**
 * GET /api/analytics  — dashboard stats (scoped to the active client via x-client-id)
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

  try {
    const [[contacts], [deals], [messages], [workflows], leadsPerDay, topSources, pipeline] = await Promise.all([
      db`SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS new_7d,
              COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new_30d
         FROM contacts WHERE client_id = ${cid}`,

      db`SELECT COUNT(*)::int AS total,
              COALESCE(SUM(value),0)::float AS total_value,
              COUNT(*) FILTER (WHERE s.name = 'Closed Won' OR s.name = 'Won')::int AS won
         FROM deals d LEFT JOIN pipeline_stages s ON s.id = d.stage_id
         WHERE d.client_id = ${cid}`,

      db`SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE type = 'sms')::int   AS sms,
              COUNT(*) FILTER (WHERE type = 'email')::int AS email,
              COUNT(*) FILTER (WHERE sent_at > now() - interval '7 days')::int AS sent_7d
         FROM messages WHERE direction = 'outbound' AND client_id = ${cid}`,

      db`SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE active = true)::int AS active
         FROM workflows WHERE client_id = ${cid}`,

      db`SELECT DATE(created_at) AS day, COUNT(*)::int AS count
         FROM contacts WHERE client_id = ${cid} AND created_at > now() - interval '30 days'
         GROUP BY 1 ORDER BY 1`,

      db`SELECT source, COUNT(*)::int AS count
         FROM contacts WHERE client_id = ${cid} AND source IS NOT NULL AND source != ''
         GROUP BY source ORDER BY count DESC LIMIT 10`,

      db`SELECT s.name, s.color, COUNT(d.id)::int AS deals, COALESCE(SUM(d.value),0)::float AS value
         FROM pipeline_stages s LEFT JOIN deals d ON d.stage_id = s.id
         WHERE s.client_id = ${cid}
         GROUP BY s.id, s.name, s.color, s.position ORDER BY s.position`,
    ])

    return res.status(200).json({
      contacts,
      deals,
      messages,
      workflows,
      leadsPerDay,
      topSources,
      pipeline,
    })
  } catch (err) {
    console.error('[api/analytics]', err)
    return res.status(500).json({ error: err.message })
  }
}
