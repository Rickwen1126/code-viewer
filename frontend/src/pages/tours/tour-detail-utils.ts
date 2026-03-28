import type { TourAddStepPayload, TourGetStepsResultPayload } from '@code-viewer/shared'

type TourStep = TourGetStepsResultPayload['steps'][number]

export function buildEditedStepAddPayload(
  tourId: string,
  step: TourStep,
  description: string,
  index: number,
): TourAddStepPayload {
  const payload: TourAddStepPayload = {
    tourId,
    description,
    index,
  }

  if (step.file) {
    payload.file = step.file
    payload.line = step.line
  }

  if (step.endLine != null) payload.endLine = step.endLine
  if (step.selection) payload.selection = step.selection
  if (step.title !== undefined) payload.title = step.title

  return payload
}
