/**
 * Tiny fetch wrapper. Every request carries the dashboard token header.
 * Usage:
 *   const api = makeApi(token)
 *   await api.get('/api/contacts', { search: 'jane' })
 *   await api.post('/api/workflows', { name, steps })
 *   await api.put('/api/pipeline', { id, stageId })
 *   await api.del('/api/contacts', { id })
 */
export function makeApi(token, clientId) {
  async function request(path, { method = 'GET', body, query } = {}) {
    let url = path
    if (query) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, v)
      }
      const s = qs.toString()
      if (s) url += (url.includes('?') ? '&' : '?') + s
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-dashboard-token': token,
    }
    if (clientId) headers['x-client-id'] = clientId

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    let data
    try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }

    if (!res.ok) {
      throw new Error(data?.error || `Request failed (${res.status})`)
    }
    return data
  }

  return {
    get:  (path, query) => request(path, { query }),
    post: (path, body)  => request(path, { method: 'POST', body }),
    put:  (path, body)  => request(path, { method: 'PUT', body }),
    del:  (path, body)  => request(path, { method: 'DELETE', body }),
  }
}
