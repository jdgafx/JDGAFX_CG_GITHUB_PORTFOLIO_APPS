import { catalogueView } from '../shared/catalogue'
import { gate, json } from '../shared/guard'

export const config = { path: '/api/models' }

export default async (req: Request): Promise<Response> => {
  const guard = gate(req, 'GET')
  if (!guard.ok) return guard.response
  return json(await catalogueView(), 200, guard.headers)
}
