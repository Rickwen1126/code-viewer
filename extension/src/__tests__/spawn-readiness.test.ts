import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFile } from 'child_process'

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('../utils/debug', () => ({
  debugLog: vi.fn(),
}))

import { waitForSpawnReady } from '../providers/spawn-readiness'

const mockExecFile = vi.mocked(execFile)

const MOCK_TARGET = {
  bindingId: 'codex:codex:test-123',
  acquired: 'spawned' as const,
  paneId: '%42',
  paneTarget: 'codeview:1.0',
}

const CODEX_PROMPT_OUTPUT = `╭───────────────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.139.0)                            │
│ model:     gpt-5.3-codex-spark low                    │
│ directory: ~/code/copilot-sdk                         │
╰───────────────────────────────────────────────────────╯
› Find and fix a bug in @filename
  gpt-5.3-codex-spark low · main · Context 0% used`

const LOADING_OUTPUT = `Starting codex...
Loading model...`

function simulateCapture(output: string): void {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    if (typeof callback === 'function') {
      callback(null, output, '')
    }
    return {} as ReturnType<typeof execFile>
  })
}

function simulateCaptureSequence(outputs: string[]): void {
  let callIndex = 0
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const output = callIndex < outputs.length ? outputs[callIndex] : outputs[outputs.length - 1]
    callIndex++
    if (typeof callback === 'function') {
      callback(null, output, '')
    }
    return {} as ReturnType<typeof execFile>
  })
}

describe('spawn-readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('waitForSpawnReady', () => {
    it('should return ready when Codex prompt is detected on first probe', async () => {
      simulateCapture(CODEX_PROMPT_OUTPUT)

      const result = await waitForSpawnReady({
        target: MOCK_TARGET,
        timeoutMs: 5000,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(true)
      expect(result.timedOut).toBe(false)
      expect(result.method).toBe('pane-probe')
      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['capture-pane', '-t', '%42', '-p'],
        expect.objectContaining({ timeout: 5000 }),
        expect.any(Function),
      )
    })

    it('should poll until prompt appears', async () => {
      simulateCaptureSequence([LOADING_OUTPUT, LOADING_OUTPUT, CODEX_PROMPT_OUTPUT])

      const result = await waitForSpawnReady({
        target: MOCK_TARGET,
        timeoutMs: 10000,
        feature: 'annotation',
      })

      expect(result.ready).toBe(true)
      expect(mockExecFile).toHaveBeenCalledTimes(3)
    })

    it('should timeout when prompt never appears', async () => {
      simulateCapture(LOADING_OUTPUT)

      const result = await waitForSpawnReady({
        target: MOCK_TARGET,
        timeoutMs: 2000,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(false)
      expect(result.timedOut).toBe(true)
      expect(result.error).toContain('did not show its prompt')
    })

    it('should fail immediately when no pane ID is available', async () => {
      const result = await waitForSpawnReady({
        target: { ...MOCK_TARGET, paneId: undefined, paneTarget: undefined },
        timeoutMs: 5000,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(false)
      expect(result.error).toContain('No pane ID')
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('should handle tmux capture-pane errors gracefully', async () => {
      simulateCaptureSequence([]) // no outputs set
      mockExecFile
        .mockImplementationOnce((_cmd, _args, _opts, callback) => {
          if (typeof callback === 'function') {
            callback(new Error('pane not found'), '', '')
          }
          return {} as ReturnType<typeof execFile>
        })
        .mockImplementation((_cmd, _args, _opts, callback) => {
          if (typeof callback === 'function') {
            callback(null, CODEX_PROMPT_OUTPUT, '')
          }
          return {} as ReturnType<typeof execFile>
        })

      const result = await waitForSpawnReady({
        target: MOCK_TARGET,
        timeoutMs: 5000,
        feature: 'annotation',
      })

      expect(result.ready).toBe(true)
    })

    it('should use paneTarget when paneId is not available', async () => {
      simulateCapture(CODEX_PROMPT_OUTPUT)

      await waitForSpawnReady({
        target: { ...MOCK_TARGET, paneId: undefined },
        timeoutMs: 5000,
        feature: 'fileChat',
      })

      expect(mockExecFile).toHaveBeenCalledWith(
        'tmux',
        ['capture-pane', '-t', 'codeview:1.0', '-p'],
        expect.any(Object),
        expect.any(Function),
      )
    })
  })
})
