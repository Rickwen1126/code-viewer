import { describe, expect, it } from 'vitest'
import {
  buildTmuxAdapterArgs,
  getFallbackTmuxAdapterCommandSpec,
  normalizeDeliveryAckOutput,
  normalizeDeliveriesOutput,
  normalizeEnsureTargetOutput,
  normalizeSendOutput,
  normalizeSubscribeOutput,
  parseCommandSpec,
  submitDelaySecondsFor,
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

  it('builds a uv fallback when bare tmux-adapter is unavailable', () => {
    expect(getFallbackTmuxAdapterCommandSpec(parseCommandSpec('tmux-adapter'))).toEqual({
      command: 'uv',
      args: ['--directory', '/Users/rickwen/code/tmux-adapter', 'run', 'tmux-adapter'],
    })
  })

  it('preserves explicit tmux-adapter args when building the uv fallback', () => {
    expect(getFallbackTmuxAdapterCommandSpec(parseCommandSpec('tmux-adapter --debug --json'))).toEqual({
      command: 'uv',
      args: ['--directory', '/Users/rickwen/code/tmux-adapter', 'run', 'tmux-adapter', '--debug', '--json'],
    })
  })

  it('does not rewrite already-custom commands', () => {
    expect(getFallbackTmuxAdapterCommandSpec(parseCommandSpec('uv --directory /tmp/tmux-adapter run tmux-adapter'))).toBeNull()
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

  it('builds destroy args with the global state-root before the subcommand', () => {
    expect(buildTmuxAdapterArgs('/tmp/state', 'destroy', [
      '--binding-id',
      'binding-1',
      '--admin-override',
    ])).toEqual([
      '--state-root',
      '/tmp/state',
      'destroy',
      '--binding-id',
      'binding-1',
      '--admin-override',
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

  it('normalizes subscribe output with a stable subscription id', () => {
    expect(normalizeSubscribeOutput({
      subscription: {
        subscription_id: 'code-viewer-annotation-stop',
      },
    })).toEqual({ subscriptionId: 'code-viewer-annotation-stop' })
  })

  it('normalizes deliveries output and preserves source binding metadata', () => {
    expect(normalizeDeliveriesOutput({
      deliveries: [
        {
          delivery_id: 'event-1:code-viewer-annotation-stop',
          event_id: 'event-1',
          adapter_id: 'code-viewer-annotation',
          subscription_id: 'code-viewer-annotation-stop',
          event: {
            event_type: 'agent.lifecycle.stop',
            created_at: '2026-06-06T01:23:45Z',
            source: {
              provider_id: 'codex',
              tool_name: 'codex',
              binding_id: 'binding-1',
            },
          },
        },
      ],
      cursor: 'event-1:code-viewer-annotation-stop',
      cursor_status: 'ok',
      recovery_cursor: '',
    })).toEqual({
      deliveries: [
        {
          deliveryId: 'event-1:code-viewer-annotation-stop',
          eventId: 'event-1',
          adapterId: 'code-viewer-annotation',
          subscriptionId: 'code-viewer-annotation-stop',
          eventType: 'agent.lifecycle.stop',
          createdAt: '2026-06-06T01:23:45Z',
          source: {
            provider_id: 'codex',
            tool_name: 'codex',
            binding_id: 'binding-1',
          },
          event: {
            event_type: 'agent.lifecycle.stop',
            created_at: '2026-06-06T01:23:45Z',
            source: {
              provider_id: 'codex',
              tool_name: 'codex',
              binding_id: 'binding-1',
            },
          },
        },
      ],
      cursor: 'event-1:code-viewer-annotation-stop',
      cursorStatus: 'ok',
      recoveryCursor: undefined,
    })
  })

  it('normalizes delivery ack output', () => {
    expect(normalizeDeliveryAckOutput({
      delivery: {
        delivery_id: 'event-1:code-viewer-annotation-stop',
        status: 'delivered',
      },
    })).toEqual({
      deliveryId: 'event-1:code-viewer-annotation-stop',
      status: 'delivered',
    })
  })

  it('uses a longer submit delay for large pasted prompts', () => {
    expect(submitDelaySecondsFor(10_000)).toBe('0.05')
    expect(submitDelaySecondsFor(20_001)).toBe('0.25')
    expect(submitDelaySecondsFor(50_001)).toBe('0.5')
  })
})
