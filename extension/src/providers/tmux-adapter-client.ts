import { execFile } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

interface ExecFileResult {
  stdout: string
  stderr: string
}

export interface TmuxAdapterConfig {
  command: string
  stateRoot?: string
}

export interface EnsureTargetOptions extends TmuxAdapterConfig {
  spawnProfile: string
  cwd: string
}

export interface TmuxAdapterTarget {
  bindingId: string
  acquired: 'reused' | 'spawned'
  paneId?: string
  paneTarget?: string
  pid?: string
  targetScopeKey?: string
}

export interface SendMessageOptions extends TmuxAdapterConfig {
  bindingId: string
  message: string
}

interface EnsureTargetStdout {
  binding_id?: unknown
  acquired?: unknown
  target?: {
    status?: unknown
    pane_id?: unknown
    pane_target?: unknown
    pid?: unknown
    target_scope_key?: unknown
  }
}

interface SendStdout {
  sent?: unknown
}

function execFileAsync(command: string, args: string[], cwd?: string): Promise<ExecFileResult> {
  const commandSpec = parseCommandSpec(command)
  const resolvedArgs = [...commandSpec.args, ...args]
  return new Promise((resolve, reject) => {
    execFile(commandSpec.command, resolvedArgs, { cwd, timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error([
          `${commandSpec.command} ${resolvedArgs.join(' ')} failed`,
          `cwd=${cwd ?? process.cwd()}`,
          error.message,
          stderr ? `stderr=${stderr}` : '',
        ].filter(Boolean).join('\n')))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export function parseCommandSpec(commandSpec: string): { command: string; args: string[] } {
  const trimmed = commandSpec.trim()
  if (!trimmed) return { command: 'tmux-adapter', args: [] }

  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i]
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) parts.push(current)
  if (parts.length === 0) return { command: 'tmux-adapter', args: [] }
  const [command, ...args] = parts
  return { command, args }
}

export function buildTmuxAdapterArgs(stateRoot: string | undefined, subcommand: string, args: string[]): string[] {
  const result: string[] = []
  const trimmedStateRoot = stateRoot?.trim()
  if (trimmedStateRoot) {
    result.push('--state-root', trimmedStateRoot)
  }
  result.push(subcommand, ...args)
  return result
}

function parseJsonObject(stdout: string, commandLabel: string): Record<string, unknown> {
  const trimmed = stdout.trim()
  if (!trimmed) throw new Error(`${commandLabel} returned empty stdout`)
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('stdout is not an object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`${commandLabel} returned invalid JSON: ${String(error)}`)
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function normalizeEnsureTargetOutput(data: Record<string, unknown>): TmuxAdapterTarget {
  const output = data as EnsureTargetStdout
  if (typeof output.binding_id !== 'string' || output.binding_id.length === 0) {
    throw new Error('ensure-target response missing binding_id')
  }
  if (output.acquired !== 'reused' && output.acquired !== 'spawned') {
    throw new Error('ensure-target response has invalid acquired value')
  }
  if (!output.target || output.target.status !== 'active') {
    throw new Error('ensure-target response target is not active')
  }
  return {
    bindingId: output.binding_id,
    acquired: output.acquired,
    paneId: optionalString(output.target.pane_id),
    paneTarget: optionalString(output.target.pane_target),
    pid: optionalString(output.target.pid),
    targetScopeKey: optionalString(output.target.target_scope_key),
  }
}

export function normalizeSendOutput(data: Record<string, unknown>): true {
  const output = data as SendStdout
  if (output.sent !== true) {
    throw new Error('send response did not confirm sent: true')
  }
  return true
}

export async function ensureTarget(options: EnsureTargetOptions): Promise<TmuxAdapterTarget> {
  const args = buildTmuxAdapterArgs(options.stateRoot, 'ensure-target', [
    '--invoker-adapter-id',
    'code-viewer',
    '--spawn-profile',
    options.spawnProfile,
    '--cwd',
    options.cwd,
    '--spawn-timeout',
    '5',
    '--tags-json',
    JSON.stringify({ feature: 'annotation' }),
  ])
  const { stdout } = await execFileAsync(options.command, args, options.cwd)
  return normalizeEnsureTargetOutput(parseJsonObject(stdout, 'tmux-adapter ensure-target'))
}

export async function sendMessage(options: SendMessageOptions): Promise<true> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'code-viewer-annotation-'))
  const promptFile = path.join(tmpDir, 'prompt.txt')

  try {
    await fs.writeFile(promptFile, options.message, 'utf8')
    const args = buildTmuxAdapterArgs(options.stateRoot, 'send', [
      '--binding-id',
      options.bindingId,
      '--message-file',
      promptFile,
      '--submit-enters',
      '1',
      '--submit-delay',
      '0.05',
    ])
    const { stdout } = await execFileAsync(options.command, args)
    return normalizeSendOutput(parseJsonObject(stdout, 'tmux-adapter send'))
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Best effort cleanup for a generated prompt file.
    }
  }
}
