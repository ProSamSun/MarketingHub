/**
 * GET /api/auth-check
 * Returns 200 if the x-dashboard-token matches DASHBOARD_PASSWORD, 401 otherwise.
 * Used by the login screen — does NOT call GHL so it always works independently.
 */
export default function handler(req, res) {
  const token = req.headers['x-dashboard-token']

  if (!process.env.DASHBOARD_PASSWORD) {
    return res.status(500).json({ error: 'DASHBOARD_PASSWORD is not set in environment variables.' })
  }

  if (token === process.env.DASHBOARD_PASSWORD) {
    return res.status(200).json({ ok: true })
  }

  return res.status(401).json({ error: 'Incorrect password.' })
}
