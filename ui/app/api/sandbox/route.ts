import { Sandbox } from '@e2b/code-interpreter'

import { fragmentSchema, FragmentSchema } from '@/lib/schema'
import {
  ApiError,
  apiErrorResponse,
  enforceApiQuota,
  optionalClientApiKey,
  readJsonBody,
  requestPrincipal,
  requireObject,
  requireServerCredential,
} from '@/lib/security/api'
import templates from '@/lib/templates'
import { ExecutionResultInterpreter, ExecutionResultWeb } from '@/lib/types'

const sandboxTimeout = 10 * 60 * 1000

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const body = requireObject(await readJsonBody<unknown>(req))
    const parsedFragment = fragmentSchema.safeParse(body.fragment)
    if (!parsedFragment.success) {
      throw new ApiError(400, 'invalid_fragment', 'Fragment is invalid.')
    }

    const fragment: FragmentSchema = parsedFragment.data
    if (!Object.prototype.hasOwnProperty.call(templates, fragment.template)) {
      throw new ApiError(400, 'template_not_allowed', 'Sandbox template is not allowed.')
    }

    const clientApiKey = optionalClientApiKey(body.apiKey)
    const principal = await requestPrincipal(req, clientApiKey)
    await enforceApiQuota(principal)
    const apiKey =
      clientApiKey ?? requireServerCredential(process.env.E2B_API_KEY)

    // Select exactly one funding source. Untrusted metadata and credentials from
    // the request are never mixed with the server-funded path.
    const sbx = await Sandbox.create(fragment.template, {
      metadata: {
        template: fragment.template,
        principal: principal.slice(0, 64),
      },
      timeoutMs: sandboxTimeout,
      apiKey,
    })

    if (fragment.has_additional_dependencies) {
      await sbx.commands.run(fragment.install_dependencies_command)
    }

    for (const file of fragment.code) {
      await sbx.files.write(file.file_path, file.file_content)
    }

    if (fragment.template === 'code-interpreter-v1') {
      const codeContent = fragment.code
        .map((file) => file.file_content)
        .join('\n\n')
      const { logs, error, results } = await sbx.runCode(codeContent)

      return Response.json({
        sbxId: sbx.sandboxId,
        template: fragment.template,
        stdout: logs.stdout,
        stderr: logs.stderr,
        runtimeError: error,
        cellResults: results,
      } as ExecutionResultInterpreter)
    }

    return Response.json({
      sbxId: sbx.sandboxId,
      template: fragment.template,
      url: `https://${sbx.getHost(fragment.port || 80)}`,
    } as ExecutionResultWeb)
  } catch (error) {
    return apiErrorResponse(error)
  }
}
