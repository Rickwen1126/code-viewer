import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFile } from 'child_process'

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('../utils/debug', () => ({
  debugLog: vi.fn(),
}))

import { waitForSpawnReady, paneTail } from '../providers/spawn-readiness'

const mockExecFile = vi.mocked(execFile)

const MOCK_TARGET = {
  bindingId: 'codex:codex:test-123',
  acquired: 'spawned' as const,
  paneId: '%42',
  paneTarget: 'codeview:1.0',
}

const CODEX_PANE = `╭───────────────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.139.0)                            │
│ model:     gpt-5.3-codex-spark low                    │
│ directory: ~/code/copilot-sdk                         │
╰───────────────────────────────────────────────────────╯
› Find and fix a bug
  gpt-5.3-codex-spark low · main · Context 0% used`

const CLAUDE_PANE = `
╭────────────────────────────────────────╮
│ ✻ Welcome to Claude Code              │
╰────────────────────────────────────────╯
> What would you like to do?
`

const LOADING_PANE = `Starting codex...
Loading model...
Connecting to API...`

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

describe('paneTail', () => {
  it('should return last N non-empty lines', () => {
    const content = 'line1\nline2\n\nline3\n\nline4\nline5\n\n'
    expect(paneTail(content, 3)).toBe('line3\nline4\nline5')
  })

  it('should return all lines when fewer than N', () => {
    expect(paneTail('a\nb', 5)).toBe('a\nb')
  })

  it('should handle empty content', () => {
    expect(paneTail('', 5)).toBe('')
    expect(paneTail('\n\n\n', 5)).toBe('')
  })
})

describe('waitForSpawnReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should detect Codex › prompt', async () => {
    simulateCapture(CODEX_PANE)

    const result = await waitForSpawnReady({
      target: MOCK_TARGET,
      timeoutMs: 5000,
      feature: 'fileChat',
    })

    expect(result.ready).toBe(true)
    expect(result.method).toBe('pane-probe')
  })

  it('should detect Claude > prompt', async () => {
    simulateCapture(CLAUDE_PANE)

    const result = await waitForSpawnReady({
      target: MOCK_TARGET,
      timeoutMs: 5000,
      feature: 'fileChat',
    })

    expect(result.ready).toBe(true)
  })

  it('should not match > inside code/output (only checks tail)', async () => {
    const paneWithCodeOutput = `some output line
const x = arr.filter(a > b)
more output
Loading...
Still loading...`
    simulateCapture(paneWithCodeOutput)

    const result = await waitForSpawnReady({
      target: MOCK_TARGET,
      timeoutMs: 1500,
      feature: 'fileChat',
    })

    expect(result.ready).toBe(false)
  })

  it('should poll until prompt appears', async () => {
    simulateCaptureSequence([LOADING_PANE, LOADING_PANE, CODEX_PANE])

    const result = await waitForSpawnReady({
      target: MOCK_TARGET,
      timeoutMs: 10000,
      feature: 'annotation',
    })

    expect(result.ready).toBe(true)
    expect(mockExecFile).toHaveBeenCalledTimes(3)
  })

  it('should timeout when prompt never appears', async () => {
    simulateCapture(LOADING_PANE)

    const result = await waitForSpawnReady({
      target: MOCK_TARGET,
      timeoutMs: 2000,
      feature: 'fileChat',
    })

    expect(result.ready).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.error).toContain('did not show its prompt')
  })

  it('should accept custom prompt pattern', async () => {
    const customPane = `My Custom Tool v1.0\n$$$ ready\n`
    simulateCapture(customPane)

    const result = await waitForSpawnReady({
      target: MOCK_TARGET,
      timeoutMs: 5000,
      feature: 'fileChat',
      promptPattern: /\$\$\$\s/,
    })

    expect(result.ready).toBe(true)
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

  it('should handle tmux errors gracefully and keep probing', async () => {
    mockExecFile
      .mockImplementationOnce((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(new Error('pane not found'), '', '')
        }
        return {} as ReturnType<typeof execFile>
      })
      .mockImplementation((_cmd, _args, _opts, callback) => {
        if (typeof callback === 'function') {
          callback(null, CODEX_PANE, '')
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
    simulateCapture(CODEX_PANE)

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
