/**
 * GET /api/cron  — process due workflow enrollments (drains each to its next wait)
 *
 * Triggered by: Vercel Cron (x-vercel-cron), the dashboard (DASHBOARD_PASSWORD),
 * or an external scheduler every ~2-3 min (CRON_SECRET) for real-time cadence.
 * Run an external pinger (e.g. cron-job.org) against this URL with header
 *   x-dashboard-token: <CRON_SECRET>
 * to make sub-day follow-ups (5-min / 30-min / hourly) fire on time.
 */
import { sql, migrate } from './_db.js'
import { processAllDueEnrollments } from './_automation.js'
import { syncDueClients } from './_meta.js'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  const token  = req.headers['x-dashboard-token'] || req.headers.authorization?.replace('Bearer ', '')
  const isCron = req.headers['x-vercel-cron'] === '1'
  const authorized =
    isCron ||
    token === process.env.DASHBOARD_PASSWORD ||
    (process.env.CRON_SECRET && token === process.env.CRON_SECRET)

  if (!authorized) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    await migrate()
    const result = await processAllDueEnrollments()
    // Pull new leads straight from Meta for any client due a sync (throttled ~10 min each)
    const metaSync = await syncDueClients(sql(), { minutes: 10, sinceDays: 3 })
    console.log(`[cron] Processed ${result.processed} enrollments; meta-sync:`, JSON.stringify(metaSync))
    return res.status(200).json({ ...result, metaSync })
  } catch (err) {
    console.error('[cron]', err)
    return res.status(500).json({ error: err.message })
  }
}
