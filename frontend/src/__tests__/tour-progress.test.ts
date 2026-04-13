import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getResumeTourStep, getTourProgressKey, loadTourProgress, saveTourProgress } from '../pages/tours/tour-progress'

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
  const extensionId = 'ext-1'
  const tourId = 'tour-1'

  beforeEach(() => {
    storage.clear()
  })

  it('loads zero progress when nothing is stored', () => {
    expect(loadTourProgress(extensionId, tourId)).toBe(0)
    expect(getResumeTourStep(extensionId, tourId, 5)).toBe(1)
  })

  it('round-trips saved progress as zero-based index', () => {
    saveTourProgress(extensionId, tourId, 3)
    expect(loadTourProgress(extensionId, tourId)).toBe(3)
  })

  it('clamps resume step into the current step count', () => {
    saveTourProgress(extensionId, tourId, 99)
    expect(getResumeTourStep(extensionId, tourId, 4)).toBe(4)
  })

  it('normalizes invalid stored data back to the first step', () => {
    storage.set(getTourProgressKey(extensionId, tourId), JSON.stringify({ currentStep: 'oops' }))
    expect(loadTourProgress(extensionId, tourId)).toBe(0)
    expect(getResumeTourStep(extensionId, tourId, 3)).toBe(1)
  })

  it('returns first step when the tour is empty or single-step', () => {
    saveTourProgress(extensionId, tourId, 7)
    expect(getResumeTourStep(extensionId, tourId, 0)).toBe(1)
    expect(getResumeTourStep(extensionId, tourId, 1)).toBe(1)
  })
})
