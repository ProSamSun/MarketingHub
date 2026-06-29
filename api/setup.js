/**
 * POST /api/setup  — run database migrations (call once after deploy)
 */
import { migrate } from './_db.js'

export default async function handler(req, res) {
  const token = req.headers['x-dashboard-token']
  if (token !== process.env.DASHBOARD_PASSWORD) return res.status(401).end()

  try {
    await migrate()
    return res.status(200).json({ ok: true, message: 'Database ready.' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
