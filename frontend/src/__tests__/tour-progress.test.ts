import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLegacyTourProgressKey,
  getResumeTourStep,
  getTourProgressKey,
  loadTourProgress,
  saveTourProgress,
} from '../pages/tours/tour-progress'
import type { Workspace } from '@code-viewer/shared'

const storage = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value)
  },
  removeItem: (key: string) => {
    storage.delete(key)
  },
})

describe('tour-progress', () => {
  const workspace: Workspace = {
    extensionId: 'ext-1',
    workspaceKey: 'ws_1',
    name: 'code-viewer',
    rootPath: '/repo/code-viewer',
    gitBranch: 'main',
    vscodeVersion: '1.115.0',
    extensionVersion: '0.0.5',
  }
  const tourId = 'tour-1'

  beforeEach(() => {
    storage.clear()
  })

  it('loads zero progress when nothing is stored', () => {
    expect(loadTourProgress(workspace, tourId)).toBe(0)
    expect(getResumeTourStep(workspace, tourId, 5)).toBe(1)
  })

  it('writes and reads the stable workspace key', () => {
    saveTourProgress(workspace, tourId, 3)

    expect(storage.get(getTourProgressKey(workspace, tourId)!)).toBe(JSON.stringify({ currentStep: 3 }))
    expect(storage.has(getLegacyTourProgressKey(workspace, tourId)!)).toBe(false)
    expect(loadTourProgress(workspace, tourId)).toBe(3)
  })

  it('clamps resume step into the current step count', () => {
    saveTourProgress(workspace, tourId, 99)
    expect(getResumeTourStep(workspace, tourId, 4)).toBe(4)
  })

  it('normalizes invalid stored data back to the first step', () => {
    storage.set(getTourProgressKey(workspace, tourId)!, JSON.stringify({ currentStep: 'oops' }))
    expect(loadTourProgress(workspace, tourId)).toBe(0)
    expect(getResumeTourStep(workspace, tourId, 3)).toBe(1)
  })

  it('falls back to the legacy extension key during migration', () => {
    storage.set(getLegacyTourProgressKey(workspace, tourId)!, JSON.stringify({ currentStep: 2 }))

    expect(loadTourProgress(workspace, tourId)).toBe(2)
    expect(getResumeTourStep(workspace, tourId, 4)).toBe(3)
  })

  it('returns first step when the tour is empty or single-step', () => {
    saveTourProgress(workspace, tourId, 7)
    expect(getResumeTourStep(workspace, tourId, 0)).toBe(1)
    expect(getResumeTourStep(workspace, tourId, 1)).toBe(1)
  })
})
