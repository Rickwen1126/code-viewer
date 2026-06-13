import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../providers/tmux-adapter-client', () => ({
  subscribeToEvents: vi.fn().mockResolvedValue({ subscriptionId: 'code-viewer-codex-start' }),
  pollDeliveries: vi.fn().mockResolvedValue({ deliveries: [], cursor: '', cursorStatus: 'ok' }),
  ackDelivery: vi.fn().mockResolvedValue({ deliveryId: 'ack', status: 'delivered' }),
}))

vi.mock('../utils/debug', () => ({
  debugLog: vi.fn(),
}))

import { waitForSpawnReady, ensureStartSubscription } from '../providers/spawn-readiness'
import { subscribeToEvents, pollDeliveries, ackDelivery } from '../providers/tmux-adapter-client'

const mockSubscribe = vi.mocked(subscribeToEvents)
const mockPoll = vi.mocked(pollDeliveries)
const mockAck = vi.mocked(ackDelivery)

const BASE_CONFIG = {
  command: 'tmux-adapter',
  stateRoot: '/tmp/test-state',
}

const MOCK_TARGET = {
  bindingId: 'codex:codex:test-123',
  acquired: 'spawned' as const,
  paneId: '%42',
  paneTarget: 'codeview:1.0',
}

function makeDelivery(overrides: Record<string, unknown> = {}) {
  return {
    deliveryId: 'evt-1:code-viewer-codex-start',
    eventId: 'evt-1',
    adapterId: 'code-viewer',
    subscriptionId: 'code-viewer-codex-start',
    eventType: 'agent.lifecycle.start',
    createdAt: new Date().toISOString(),
    source: {
      binding_id: MOCK_TARGET.bindingId,
      tmux_pane: MOCK_TARGET.paneId,
      provider_id: 'codex',
      tool_name: 'codex',
    },
    event: { event_type: 'agent.lifecycle.start' },
    ...overrides,
  }
}

describe('spawn-readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribe.mockResolvedValue({ subscriptionId: 'code-viewer-codex-start' })
    mockPoll.mockResolvedValue({ deliveries: [], cursor: '', cursorStatus: 'ok' })
    mockAck.mockResolvedValue({ deliveryId: 'ack', status: 'delivered' })
  })

  describe('ensureStartSubscription', () => {
    it('should call subscribeToEvents with correct params', async () => {
      await ensureStartSubscription(BASE_CONFIG)
      expect(mockSubscribe).toHaveBeenCalledWith({
        command: 'tmux-adapter',
        stateRoot: '/tmp/test-state',
        adapterId: 'code-viewer',
        subscriptionId: 'code-viewer-codex-start',
        scope: 'tool:codex',
        eventTypes: ['agent.lifecycle.start'],
      })
    })
  })

  describe('waitForSpawnReady', () => {
    it('should return ready when matching delivery arrives on first poll', async () => {
      const delivery = makeDelivery()
      mockPoll.mockResolvedValueOnce({
        deliveries: [delivery],
        cursor: delivery.deliveryId,
        cursorStatus: 'ok',
      })

      const result = await waitForSpawnReady({
        ...BASE_CONFIG,
        target: MOCK_TARGET,
        spawnedAt: Date.now(),
        timeoutMs: 5000,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(true)
      expect(result.timedOut).toBe(false)
      expect(result.delivery?.deliveryId).toBe(delivery.deliveryId)
      expect(mockAck).toHaveBeenCalledWith({
        command: 'tmux-adapter',
        stateRoot: '/tmp/test-state',
        deliveryId: delivery.deliveryId,
      })
    })

    it('should match by paneId when binding_id differs', async () => {
      const delivery = makeDelivery({
        source: {
          binding_id: 'different-binding',
          tmux_pane: MOCK_TARGET.paneId,
          provider_id: 'codex',
          tool_name: 'codex',
        },
      })
      mockPoll.mockResolvedValueOnce({
        deliveries: [delivery],
        cursor: delivery.deliveryId,
        cursorStatus: 'ok',
      })

      const result = await waitForSpawnReady({
        ...BASE_CONFIG,
        target: MOCK_TARGET,
        spawnedAt: Date.now(),
        timeoutMs: 5000,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(true)
    })

    it('should skip deliveries that predate the spawn', async () => {
      const oldDelivery = makeDelivery({
        source: { provider_id: 'codex', tool_name: 'codex' },
        createdAt: new Date(Date.now() - 60000).toISOString(),
      })
      mockPoll
        .mockResolvedValueOnce({
          deliveries: [oldDelivery],
          cursor: oldDelivery.deliveryId,
          cursorStatus: 'ok',
        })
        .mockResolvedValue({ deliveries: [], cursor: oldDelivery.deliveryId, cursorStatus: 'ok' })

      const result = await waitForSpawnReady({
        ...BASE_CONFIG,
        target: MOCK_TARGET,
        spawnedAt: Date.now(),
        timeoutMs: 1500,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(false)
      expect(result.timedOut).toBe(true)
    })

    it('should timeout and return error message', async () => {
      mockPoll.mockResolvedValue({ deliveries: [], cursor: '', cursorStatus: 'ok' })

      const result = await waitForSpawnReady({
        ...BASE_CONFIG,
        target: MOCK_TARGET,
        spawnedAt: Date.now(),
        timeoutMs: 1500,
        feature: 'annotation',
      })

      expect(result.ready).toBe(false)
      expect(result.timedOut).toBe(true)
      expect(result.error).toContain('did not become ready')
    })

    it('should recover from cursor status errors', async () => {
      const delivery = makeDelivery()
      mockPoll
        .mockResolvedValueOnce({
          deliveries: [],
          cursor: '',
          cursorStatus: 'missing',
          recoveryCursor: 'recovered-cursor',
        })
        .mockResolvedValueOnce({
          deliveries: [delivery],
          cursor: delivery.deliveryId,
          cursorStatus: 'ok',
        })

      const result = await waitForSpawnReady({
        ...BASE_CONFIG,
        target: MOCK_TARGET,
        spawnedAt: Date.now(),
        timeoutMs: 5000,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(true)
    })

    it('should handle poll errors gracefully and keep trying', async () => {
      const delivery = makeDelivery()
      mockPoll
        .mockRejectedValueOnce(new Error('connection refused'))
        .mockResolvedValueOnce({
          deliveries: [delivery],
          cursor: delivery.deliveryId,
          cursorStatus: 'ok',
        })

      const result = await waitForSpawnReady({
        ...BASE_CONFIG,
        target: MOCK_TARGET,
        spawnedAt: Date.now(),
        timeoutMs: 5000,
        feature: 'fileChat',
      })

      expect(result.ready).toBe(true)
    })
  })
})
