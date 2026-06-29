/**
 * GET /api/cron  — process due workflow enrollments
 * Called by Vercel Cron every hour.
 * Also callable manually from the dashboard.
 */
import { processAllDueEnrollments } from './_automation.js'

export default async function handler(req, res) {
  // Allow Vercel cron (no auth header) OR authenticated dashboard calls
  const token = req.headers['x-dashboard-token'] || req.headers.authorization?.replace('Bearer ', '')
  const isCron = req.headers['x-vercel-cron'] === '1'

  if (!isCron && token !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const result = await processAllDueEnrollments()
    console.log(`[cron] Processed ${result.processed} enrollments`)
    return res.status(200).json(result)
  } catch (err) {
    console.error('[cron]', err)
    return res.status(500).json({ error: err.message })
  }
}
