interface WorkspaceLike {
  workspaceKey?: string | null
  extensionId?: string | null
}

export function getTourProgressKey(workspace: WorkspaceLike | null | undefined, tourId: string): string | null {
  if (!workspace?.workspaceKey) return null
  return `tour-progress:${workspace.workspaceKey}:${tourId}`
}

export function getLegacyTourProgressKey(workspace: WorkspaceLike | null | undefined, tourId: string): string | null {
  if (!workspace?.extensionId) return null
  return `tour-progress:${workspace.extensionId}:${tourId}`
}

export function loadTourProgress(workspace: WorkspaceLike | null | undefined, tourId: string): number {
  try {
    const stableKey = getTourProgressKey(workspace, tourId)
    if (stableKey) {
      const stableRaw = localStorage.getItem(stableKey)
      if (stableRaw) {
        const data = JSON.parse(stableRaw) as { currentStep?: number }
        return typeof data.currentStep === 'number' && Number.isFinite(data.currentStep)
          ? Math.max(0, Math.trunc(data.currentStep))
          : 0
      }
    }

    const legacyKey = getLegacyTourProgressKey(workspace, tourId)
    if (legacyKey) {
      const legacyRaw = localStorage.getItem(legacyKey)
      if (legacyRaw) {
        const data = JSON.parse(legacyRaw) as { currentStep?: number }
        return typeof data.currentStep === 'number' && Number.isFinite(data.currentStep)
          ? Math.max(0, Math.trunc(data.currentStep))
          : 0
      }
    }

    return 0
  } catch {
    return 0
  }
}

export function saveTourProgress(
  workspace: WorkspaceLike | null | undefined,
  tourId: string,
  currentStep: number,
): void {
  try {
    const stableKey = getTourProgressKey(workspace, tourId)
    if (stableKey) {
      localStorage.setItem(
        stableKey,
        JSON.stringify({ currentStep: Math.max(0, Math.trunc(currentStep)) }),
      )
    }
  } catch {
    // ignore
  }
}

export function getResumeTourStep(
  workspace: WorkspaceLike | null | undefined,
  tourId: string,
  stepCount: number,
): number {
  const clampedStepCount = Math.max(0, Math.trunc(stepCount))
  if (clampedStepCount <= 1) return 1

  const savedIndex = loadTourProgress(workspace, tourId)
  const clampedIndex = Math.max(0, Math.min(savedIndex, clampedStepCount - 1))
  return clampedIndex + 1
}
