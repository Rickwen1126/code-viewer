import { execFile } from 'child_process'
import type { TmuxAdapterTarget } from './tmux-adapter-client'
import { debugLog } from '../utils/debug'

const POLL_INTERVAL_MS = 800
const CODEX_PROMPT_PATTERN = /›/

export interface WaitForSpawnReadyOptions {
  target: TmuxAdapterTarget
  timeoutMs?: number
  feature: string
}

export interface SpawnReadyResult {
  ready: boolean
  elapsedMs: number
  timedOut: boolean
  error?: string
  method?: 'pane-probe'
}

function spawnDebug(stage: string, data: Record<string, unknown>): void {
  debugLog('spawnReady', stage, data)
}

function capturePaneContent(paneId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('tmux', ['capture-pane', '-t', paneId, '-p'], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        reject(new Error(`tmux capture-pane failed: ${error.message}`))
        return
      }
      resolve(String(stdout))
    })
  })
}

export async function waitForSpawnReady(options: WaitForSpawnReadyOptions): Promise<SpawnReadyResult> {
  const { target, feature } = options
  const timeoutMs = options.timeoutMs ?? 30000
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  const paneId = target.paneId || target.paneTarget || ''

  if (!paneId) {
    return {
      ready: false,
      elapsedMs: 0,
      timedOut: false,
      error: 'No pane ID available to probe readiness',
    }
  }

  spawnDebug('wait.start', {
    feature,
    bindingId: target.bindingId,
    paneId,
    timeoutMs,
  })

  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
    if (Date.now() >= deadline) break

    try {
      const content = await capturePaneContent(paneId)
      const hasPrompt = CODEX_PROMPT_PATTERN.test(content)

      if (hasPrompt) {
        const result: SpawnReadyResult = {
          ready: true,
          elapsedMs: Date.now() - startedAt,
          timedOut: false,
          method: 'pane-probe',
        }
        spawnDebug('wait.ready', {
          feature,
          bindingId: target.bindingId,
          paneId,
          elapsedMs: result.elapsedMs,
          attempt,
        })
        return result
      }

      spawnDebug('probe.pending', {
        feature,
        paneId,
        attempt,
      })
    } catch (error) {
      spawnDebug('probe.error', {
        feature,
        bindingId: target.bindingId,
        paneId,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const result: SpawnReadyResult = {
    ready: false,
    elapsedMs: Date.now() - startedAt,
    timedOut: true,
    error: `Codex did not show its prompt within ${Math.round(timeoutMs / 1000)}s — the session may have failed to start. Try again or check the tmux pane.`,
  }
  spawnDebug('wait.timeout', {
    feature,
    bindingId: target.bindingId,
    paneId,
    elapsedMs: result.elapsedMs,
  })
  return result
}
