import { execFile } from 'child_process'
import { existsSync } from 'fs'
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
  feature?: 'annotation' | 'fileChat'
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

export interface SubscribeToEventsOptions extends TmuxAdapterConfig {
  adapterId: string
  subscriptionId: string
  scope: string
  eventTypes: string[]
}

export interface PollDeliveriesOptions extends TmuxAdapterConfig {
  adapterId: string
  subscriptionId?: string
  eventTypes?: string[]
  afterDeliveryId?: string
  limit?: number
}

export interface AckDeliveryOptions extends TmuxAdapterConfig {
  deliveryId: string
}

export interface DestroyTargetOptions extends TmuxAdapterConfig {
  bindingId: string
  cwd?: string
  adminOverride?: boolean
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

interface SubscribeStdout {
  subscription?: {
    subscription_id?: unknown
  }
}

interface DeliveriesStdout {
  deliveries?: unknown
  cursor?: unknown
  cursor_status?: unknown
  recovery_cursor?: unknown
}

interface DeliveryAckStdout {
  delivery?: {
    delivery_id?: unknown
    status?: unknown
  }
}

export interface TmuxAdapterEventDelivery {
  deliveryId: string
  eventId: string
  adapterId: string
  subscriptionId: string
  eventType: string
  createdAt?: string
  source: Record<string, string>
  event: Record<string, unknown>
}

export interface PollDeliveriesResult {
  deliveries: TmuxAdapterEventDelivery[]
  cursor: string
  cursorStatus?: string
  recoveryCursor?: string
}

export interface AckDeliveryResult {
  deliveryId: string
  status?: string
}

const DEFAULT_TMUX_ADAPTER_REPO = path.join(os.homedir(), 'code', 'tmux-adapter')

interface ParsedCommandSpec {
  command: string
  args: string[]
}

function formatCommandFailure(
  commandSpec: ParsedCommandSpec,
  resolvedArgs: string[],
  cwd: string | undefined,
  error: Error,
  stderr: string,
): Error {
  return new Error([
    `${commandSpec.command} ${resolvedArgs.join(' ')} failed`,
    `cwd=${cwd ?? process.cwd()}`,
    error.message,
    stderr ? `stderr=${stderr}` : '',
  ].filter(Boolean).join('\n'))
}

function execFileAttempt(commandSpec: ParsedCommandSpec, args: string[], cwd?: string): Promise<ExecFileResult> {
  const resolvedArgs = [...commandSpec.args, ...args]
  return new Promise((resolve, reject) => {
    execFile(commandSpec.command, resolvedArgs, { cwd, timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        reject(formatCommandFailure(commandSpec, resolvedArgs, cwd, error, String(stderr)))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function errorLooksLikeMissingExecutable(error: unknown): boolean {
  return error instanceof Error && /spawn .* ENOENT/.test(error.message)
}

export function getFallbackTmuxAdapterCommandSpec(commandSpec: ParsedCommandSpec): ParsedCommandSpec | null {
  if (commandSpec.command !== 'tmux-adapter') return null
  if (!existsSync(path.join(DEFAULT_TMUX_ADAPTER_REPO, 'pyproject.toml'))) return null
  return {
    command: 'uv',
    args: ['--directory', DEFAULT_TMUX_ADAPTER_REPO, 'run', 'tmux-adapter', ...commandSpec.args],
  }
}

function execFileAsync(command: string, args: string[], cwd?: string): Promise<ExecFileResult> {
  const commandSpec = parseCommandSpec(command)
  return execFileAttempt(commandSpec, args, cwd).catch(async (error) => {
    const fallback = getFallbackTmuxAdapterCommandSpec(commandSpec)
    if (!fallback || !errorLooksLikeMissingExecutable(error)) {
      throw error
    }
    return execFileAttempt(fallback, args, cwd)
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

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`)
  }
  return value as Record<string, unknown>
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, recordValue]) => typeof recordValue === 'string')
      .map(([key, recordValue]) => [key, String(recordValue)]),
  )
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

export function normalizeSubscribeOutput(data: Record<string, unknown>): { subscriptionId: string } {
  const output = data as SubscribeStdout
  const subscriptionId = output.subscription?.subscription_id
  if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
    throw new Error('subscribe response missing subscription.subscription_id')
  }
  return { subscriptionId }
}

export function normalizeDeliveriesOutput(data: Record<string, unknown>): PollDeliveriesResult {
  const output = data as DeliveriesStdout
  if (!Array.isArray(output.deliveries)) {
    throw new Error('deliveries response missing deliveries array')
  }
  const deliveries = output.deliveries.map((item, index) => {
    const delivery = asObject(item, `deliveries[${index}]`)
    const deliveryId = optionalString(delivery.delivery_id)
    const eventId = optionalString(delivery.event_id)
    const adapterId = optionalString(delivery.adapter_id)
    const subscriptionId = optionalString(delivery.subscription_id)
    if (!deliveryId || !eventId || !adapterId || !subscriptionId) {
      throw new Error(`deliveries[${index}] is missing delivery identity fields`)
    }
    const event = asObject(delivery.event, `deliveries[${index}].event`)
    const eventType = optionalString(event.event_type)
    if (!eventType) {
      throw new Error(`deliveries[${index}].event is missing event_type`)
    }
    return {
      deliveryId,
      eventId,
      adapterId,
      subscriptionId,
      eventType,
      createdAt: optionalString(event.created_at),
      source: asStringRecord(event.source),
      event,
    }
  })
  return {
    deliveries,
    cursor: optionalString(output.cursor) ?? '',
    cursorStatus: optionalString(output.cursor_status),
    recoveryCursor: optionalString(output.recovery_cursor),
  }
}

export function normalizeDeliveryAckOutput(data: Record<string, unknown>): AckDeliveryResult {
  const output = data as DeliveryAckStdout
  const delivery = asObject(output.delivery, 'delivery_ack response delivery')
  const deliveryId = optionalString(delivery.delivery_id)
  if (!deliveryId) {
    throw new Error('delivery_ack response missing delivery.delivery_id')
  }
  return {
    deliveryId,
    status: optionalString(delivery.status),
  }
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
    JSON.stringify({ feature: options.feature ?? 'annotation' }),
  ])
  const { stdout } = await execFileAsync(options.command, args, options.cwd)
  return normalizeEnsureTargetOutput(parseJsonObject(stdout, 'tmux-adapter ensure-target'))
}

export function submitDelaySecondsFor(messageLength: number): string {
  if (messageLength > 50_000) return '0.5'
  if (messageLength > 20_000) return '0.25'
  return '0.05'
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
      submitDelaySecondsFor(options.message.length),
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

export async function subscribeToEvents(options: SubscribeToEventsOptions): Promise<{ subscriptionId: string }> {
  const args = buildTmuxAdapterArgs(options.stateRoot, 'subscribe', [
    '--adapter-id',
    options.adapterId,
    '--subscription-id',
    options.subscriptionId,
    '--scope',
    options.scope,
    ...options.eventTypes.flatMap((eventType) => ['--event-type', eventType]),
  ])
  const { stdout } = await execFileAsync(options.command, args)
  return normalizeSubscribeOutput(parseJsonObject(stdout, 'tmux-adapter subscribe'))
}

export async function pollDeliveries(options: PollDeliveriesOptions): Promise<PollDeliveriesResult> {
  const args = buildTmuxAdapterArgs(options.stateRoot, 'deliveries', [
    '--adapter-id',
    options.adapterId,
    ...(options.subscriptionId ? ['--subscription-id', options.subscriptionId] : []),
    ...((options.eventTypes ?? []).flatMap((eventType) => ['--event-type', eventType])),
    ...(options.afterDeliveryId ? ['--after-delivery-id', options.afterDeliveryId] : []),
    '--limit',
    String(options.limit ?? 100),
  ])
  const { stdout } = await execFileAsync(options.command, args)
  return normalizeDeliveriesOutput(parseJsonObject(stdout, 'tmux-adapter deliveries'))
}

export async function ackDelivery(options: AckDeliveryOptions): Promise<AckDeliveryResult> {
  const args = buildTmuxAdapterArgs(options.stateRoot, 'delivery-ack', [
    '--delivery-id',
    options.deliveryId,
  ])
  const { stdout } = await execFileAsync(options.command, args)
  return normalizeDeliveryAckOutput(parseJsonObject(stdout, 'tmux-adapter delivery-ack'))
}

export async function destroyTarget(options: DestroyTargetOptions): Promise<boolean> {
  const args = buildTmuxAdapterArgs(options.stateRoot, 'destroy', [
    '--binding-id',
    options.bindingId,
    ...(options.adminOverride ? ['--admin-override'] : []),
  ])
  const { stdout } = await execFileAsync(options.command, args, options.cwd)
  const parsed = parseJsonObject(stdout, 'tmux-adapter destroy')
  return parsed.destroyed === true
}
