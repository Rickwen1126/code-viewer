import { describe, expect, it } from 'vitest'
import { buildEditedStepAddPayload } from '../pages/tours/tour-detail-utils'

describe('buildEditedStepAddPayload', () => {
  it('preserves title and selection when re-adding an edited step', () => {
    const payload = buildEditedStepAddPayload(
      'sky-eye',
      {
        file: 'src/app.ts',
        line: 12,
        endLine: 18,
        title: 'Original Step Title',
        description: 'Old description',
        selection: {
          start: { line: 12, character: 2 },
          end: { line: 18, character: 5 },
        },
      },
      'Updated description',
      3,
    )

    expect(payload).toEqual({
      tourId: 'sky-eye',
      file: 'src/app.ts',
      line: 12,
      endLine: 18,
      title: 'Original Step Title',
      description: 'Updated description',
      selection: {
        start: { line: 12, character: 2 },
        end: { line: 18, character: 5 },
      },
      index: 3,
    })
  })

  it('supports context-only steps without forcing file or line', () => {
    const payload = buildEditedStepAddPayload(
      'chatpilot-tour',
      {
        file: '',
        line: 1,
        title: 'Context',
        description: 'Old context',
      },
      'Updated context',
      0,
    )

    expect(payload).toEqual({
      tourId: 'chatpilot-tour',
      title: 'Context',
      description: 'Updated context',
      index: 0,
    })
  })
})
