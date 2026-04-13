export function getTourProgressKey(extensionId: string, tourId: string): string {
  return `tour-progress:${extensionId}:${tourId}`
}

export function loadTourProgress(extensionId: string, tourId: string): number {
  try {
    const raw = localStorage.getItem(getTourProgressKey(extensionId, tourId))
    if (!raw) return 0
    const data = JSON.parse(raw) as { currentStep?: number }
    return typeof data.currentStep === 'number' && Number.isFinite(data.currentStep)
      ? Math.max(0, Math.trunc(data.currentStep))
      : 0
  } catch {
    return 0
  }
}

export function saveTourProgress(extensionId: string, tourId: string, currentStep: number): void {
  try {
    localStorage.setItem(
      getTourProgressKey(extensionId, tourId),
      JSON.stringify({ currentStep: Math.max(0, Math.trunc(currentStep)) }),
    )
  } catch {
    // ignore
  }
}

export function getResumeTourStep(
  extensionId: string,
  tourId: string,
  stepCount: number,
): number {
  const clampedStepCount = Math.max(0, Math.trunc(stepCount))
  if (clampedStepCount <= 1) return 1

  const savedIndex = loadTourProgress(extensionId, tourId)
  const clampedIndex = Math.max(0, Math.min(savedIndex, clampedStepCount - 1))
  return clampedIndex + 1
}
