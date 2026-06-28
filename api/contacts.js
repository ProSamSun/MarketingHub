/**
 * GET /api/contacts — fetch recent leads from GHL for the dashboard
 */

import { getContacts } from './_ghl.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'GET') return res.status(405).end()

  const token = req.headers['x-dashboard-token']
  if (token !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const data = await getContacts({ limit: 100 })
    return res.status(200).json({ contacts: data?.contacts ?? [] })
  } catch (err) {
    console.error('[api/contacts]', err)
    return res.status(500).json({ error: err.message })
  }
}
