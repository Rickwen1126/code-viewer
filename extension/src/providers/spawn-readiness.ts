import {
  ackDelivery,
  pollDeliveries,
  subscribeToEvents,
  type TmuxAdapterConfig,
  type TmuxAdapterEventDelivery,
  type TmuxAdapterTarget,
} from './tmux-adapter-client'
import { debugLog } from '../utils/debug'

const START_ADAPTER_ID = 'code-viewer'
const START_SUBSCRIPTION_ID = 'code-viewer-codex-start'
const START_SCOPE = 'tool:codex'
const START_EVENT_TYPE = 'agent.lifecycle.start'
const POLL_INTERVAL_MS = 800
const DELIVERY_PAGE_LIMIT = 25

export interface WaitForSpawnReadyOptions extends TmuxAdapterConfig {
  target: TmuxAdapterTarget
  spawnedAt: number
  timeoutMs?: number
  feature: string
}

export interface SpawnReadyResult {
  ready: boolean
  delivery?: TmuxAdapterEventDelivery
  elapsedMs: number
  timedOut: boolean
  error?: string
}

function spawnDebug(stage: string, data: Record<string, unknown>): void {
  debugLog('spawnReady', stage, data)
}

function deliveryMatchesTarget(
  delivery: TmuxAdapterEventDelivery,
  target: TmuxAdapterTarget,
  spawnedAt: number,
): { matches: boolean; reason?: string } {
  if (target.bindingId && delivery.source.binding_id === target.bindingId) {
    return { matches: true }
  }
  const deliveryPane = delivery.source.tmux_pane || ''
  if (target.paneId && deliveryPane === target.paneId) {
    return { matches: true }
  }
  if (delivery.createdAt) {
    const deliveryTime = new Date(delivery.createdAt).getTime()
    if (deliveryTime < spawnedAt - 5000) {
      return { matches: false, reason: 'delivery predates spawn' }
    }
  }
  return { matches: false, reason: 'no binding_id or pane match' }
}

export async function ensureStartSubscription(config: TmuxAdapterConfig): Promise<void> {
  await subscribeToEvents({
    command: config.command,
    stateRoot: config.stateRoot ?? '',
    adapterId: START_ADAPTER_ID,
    subscriptionId: START_SUBSCRIPTION_ID,
    scope: START_SCOPE,
    eventTypes: [START_EVENT_TYPE],
  })
}

export async function waitForSpawnReady(options: WaitForSpawnReadyOptions): Promise<SpawnReadyResult> {
  const { target, spawnedAt, feature } = options
  const timeoutMs = options.timeoutMs ?? 15000
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  let cursor: string | undefined

  spawnDebug('wait.start', {
    feature,
    bindingId: target.bindingId,
    paneId: target.paneId,
    timeoutMs,
  })

  await ensureStartSubscription(options)

  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    if (Date.now() >= deadline) break

    try {
      const page = await pollDeliveries({
        command: options.command,
        stateRoot: options.stateRoot ?? '',
        adapterId: START_ADAPTER_ID,
        subscriptionId: START_SUBSCRIPTION_ID,
        eventTypes: [START_EVENT_TYPE],
        afterDeliveryId: cursor,
        limit: DELIVERY_PAGE_LIMIT,
      })

      if (page.cursorStatus && page.cursorStatus !== 'ok' && page.recoveryCursor) {
        spawnDebug('cursor.recovered', {
          feature,
          bindingId: target.bindingId,
          cursorStatus: page.cursorStatus,
          recoveryCursor: page.recoveryCursor,
        })
        cursor = page.recoveryCursor
      }

      for (const delivery of page.deliveries) {
        const match = deliveryMatchesTarget(delivery, target, spawnedAt)
        spawnDebug('delivery.check', {
          feature,
          deliveryId: delivery.deliveryId,
          bindingId: delivery.source.binding_id ?? null,
          pane: delivery.source.tmux_pane ?? null,
          targetBindingId: target.bindingId,
          targetPaneId: target.paneId ?? null,
          matches: match.matches,
          reason: match.reason ?? null,
          attempt,
        })

        cursor = delivery.deliveryId

        if (match.matches) {
          await ackDelivery({
            command: options.command,
            stateRoot: options.stateRoot ?? '',
            deliveryId: delivery.deliveryId,
          }).catch((error) => {
            spawnDebug('ack.failed', {
              feature,
              deliveryId: delivery.deliveryId,
              message: error instanceof Error ? error.message : String(error),
            })
          })

          const result: SpawnReadyResult = {
            ready: true,
            delivery,
            elapsedMs: Date.now() - startedAt,
            timedOut: false,
          }
          spawnDebug('wait.ready', {
            feature,
            bindingId: target.bindingId,
            deliveryId: delivery.deliveryId,
            elapsedMs: result.elapsedMs,
            attempt,
          })
          return result
        }

        await ackDelivery({
          command: options.command,
          stateRoot: options.stateRoot ?? '',
          deliveryId: delivery.deliveryId,
        }).catch(() => {})
      }
    } catch (error) {
      spawnDebug('poll.error', {
        feature,
        bindingId: target.bindingId,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const result: SpawnReadyResult = {
    ready: false,
    elapsedMs: Date.now() - startedAt,
    timedOut: true,
    error: `Codex did not become ready within ${Math.round(timeoutMs / 1000)}s — the session may have failed to start. Try again or check the tmux pane.`,
  }
  spawnDebug('wait.timeout', {
    feature,
    bindingId: target.bindingId,
    elapsedMs: result.elapsedMs,
  })
  return result
}
