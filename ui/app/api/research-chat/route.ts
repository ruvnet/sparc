import { apiErrorResponse, readJsonBody, requireObject } from '@/lib/security/api'

export async function POST(req: Request) {
  try {
    requireObject(await readJsonBody<unknown>(req))
    return Response.json({ success: true })
  } catch (error) {
    return apiErrorResponse(error)
  }
}
