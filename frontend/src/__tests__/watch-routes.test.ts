import { describe, expect, it } from 'vitest'
import { getRouteWatches } from '../services/watch-routes'

describe('getRouteWatches', () => {
  it('watches open file content on file routes', () => {
    expect(getRouteWatches('/files/src/foo%20bar.ts')).toEqual([
      { topic: 'file.content', path: 'src/foo bar.ts' },
    ])
  })

  it('watches git status on the git root and diff detail routes', () => {
    expect(getRouteWatches('/git')).toEqual([
      { topic: 'git.status', scope: 'workspace' },
    ])
    expect(getRouteWatches('/git/diff/src/app.tsx')).toEqual([
      { topic: 'git.status', scope: 'workspace' },
    ])
  })

  it('does not watch unrelated routes', () => {
    expect(getRouteWatches('/tours')).toEqual([])
  })
})
