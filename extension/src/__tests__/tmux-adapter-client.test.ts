import { describe, expect, it } from 'vitest'
import {
  buildTmuxAdapterArgs,
  normalizeEnsureTargetOutput,
  normalizeSendOutput,
  parseCommandSpec,
} from '../providers/tmux-adapter-client'

describe('tmux-adapter client helpers', () => {
  it('parses command specs without shell execution', () => {
    expect(parseCommandSpec('uv --directory /Users/rickwen/code/tmux-adapter run tmux-adapter')).toEqual({
      command: 'uv',
      args: ['--directory', '/Users/rickwen/code/tmux-adapter', 'run', 'tmux-adapter'],
    })
  })

  it('preserves quoted command arguments', () => {
    expect(parseCommandSpec('tool --path "/tmp/with space" run')).toEqual({
      command: 'tool',
      args: ['--path', '/tmp/with space', 'run'],
    })
  })

  it('places global state-root before the subcommand', () => {
    expect(buildTmuxAdapterArgs('/tmp/state', 'ensure-target', ['--cwd', '/repo'])).toEqual([
      '--state-root',
      '/tmp/state',
      'ensure-target',
      '--cwd',
      '/repo',
    ])
  })

  it('omits empty state-root', () => {
    expect(buildTmuxAdapterArgs('', 'send', ['--binding-id', 'b1'])).toEqual([
      'send',
      '--binding-id',
      'b1',
    ])
  })

  it('normalizes active ensure-target output', () => {
    expect(normalizeEnsureTargetOutput({
      binding_id: 'binding-1',
      acquired: 'spawned',
      target: {
        status: 'active',
        pane_id: '%1',
        pane_target: 'session:0.1',
        pid: '123',
        target_scope_key: 'scope',
      },
    })).toEqual({
      bindingId: 'binding-1',
      acquired: 'spawned',
      paneId: '%1',
      paneTarget: 'session:0.1',
      pid: '123',
      targetScopeKey: 'scope',
    })
  })

  it('rejects inactive ensure-target output', () => {
    expect(() => normalizeEnsureTargetOutput({
      binding_id: 'binding-1',
      acquired: 'reused',
      target: { status: 'stale' },
    })).toThrow(/not active/)
  })

  it('requires send confirmation', () => {
    expect(normalizeSendOutput({ sent: true })).toBe(true)
    expect(() => normalizeSendOutput({ sent: false })).toThrow(/sent: true/)
  })
})
