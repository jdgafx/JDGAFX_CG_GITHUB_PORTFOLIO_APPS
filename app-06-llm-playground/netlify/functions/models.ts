import { catalogueView } from '../shared/catalogue'
import { gate, json, SERVER_ERROR } from '../shared/guard'
import { errorName } from '../shared/parse'

export const config = { path: '/api/models' }

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'GET')
  if (!guard.ok) return guard.response
  try {
    return json(await catalogueView(), 200, guard.headers)
  } catch (err) {
    console.error(`Models failed: ${errorName(err)}`)
    return json({ error: SERVER_ERROR }, 500, guard.headers)
  }
}
