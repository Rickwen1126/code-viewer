import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock vscode before importing the module under test
vi.mock('vscode', () => ({
  extensions: { getExtension: vi.fn(() => null) },
  workspace: {
    asRelativePath: vi.fn((p: string) => p),
    workspaceFolders: [],
  },
  Uri: {
    joinPath: vi.fn((_base: unknown, p: string) => ({ fsPath: p })),
  },
}))

// Mock the ws/client module
vi.mock('../ws/client', () => ({
  createMessage: vi.fn((type: string, payload: unknown, replyTo?: string) => ({
    type,
    id: 'mock-id',
    replyTo,
    payload,
    timestamp: 0,
  })),
}))

// Import after mocks are set up
import { parseUnifiedDiff } from '../providers/git-provider'

describe('parseUnifiedDiff', () => {
  it('should return empty array for empty string', () => {
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('should return empty array for null/falsy input', () => {
    // The function checks `if (!diffText) return []`
    expect(parseUnifiedDiff('')).toEqual([])
  })

  it('should parse a single hunk with one added line', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
 existing
+added`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].oldLines).toBe(1)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].newLines).toBe(2)
    expect(hunks[0].changes).toHaveLength(2)
    expect(hunks[0].changes[0]).toEqual({ type: 'normal', content: 'existing', oldLineNumber: 1, newLineNumber: 1 })
    expect(hunks[0].changes[1]).toEqual({ type: 'add', content: 'added', newLineNumber: 2 })
  })

  it('should parse a single hunk with one deleted line', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,2 +1,1 @@
-removed
 kept`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].changes).toHaveLength(2)
    expect(hunks[0].changes[0]).toEqual({ type: 'delete', content: 'removed', oldLineNumber: 1 })
    expect(hunks[0].changes[1]).toEqual({ type: 'normal', content: 'kept', oldLineNumber: 2, newLineNumber: 1 })
  })

  it('should parse a single hunk with mixed add/delete/normal lines', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,5 @@
 line1
+added1
+added2
 line2
 line3`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].oldLines).toBe(3)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].newLines).toBe(5)
    expect(hunks[0].changes).toHaveLength(5)
    expect(hunks[0].changes[0]).toEqual({ type: 'normal', content: 'line1', oldLineNumber: 1, newLineNumber: 1 })
    expect(hunks[0].changes[1]).toEqual({ type: 'add', content: 'added1', newLineNumber: 2 })
    expect(hunks[0].changes[2]).toEqual({ type: 'add', content: 'added2', newLineNumber: 3 })
    expect(hunks[0].changes[3]).toEqual({ type: 'normal', content: 'line2', oldLineNumber: 2, newLineNumber: 4 })
    expect(hunks[0].changes[4]).toEqual({ type: 'normal', content: 'line3', oldLineNumber: 3, newLineNumber: 5 })
  })

  it('should parse multiple hunks', () => {
    const diff = `@@ -1,3 +1,3 @@
-old1
+new1
 same
 same
@@ -10,3 +10,4 @@
 context
+inserted
 more
 end`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(2)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].oldLines).toBe(3)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].newLines).toBe(3)
    expect(hunks[1].oldStart).toBe(10)
    expect(hunks[1].oldLines).toBe(3)
    expect(hunks[1].newStart).toBe(10)
    expect(hunks[1].newLines).toBe(4)
  })

  it('should handle hunk header with single-line counts (no comma)', () => {
    // @@ -1 +1,3 @@ — oldLines defaults to 1 when omitted
    const diff = `@@ -1 +1,3 @@
 unchanged
+newline1
+newline2`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].oldLines).toBe(1)  // defaulted from missing count
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].newLines).toBe(3)
  })

  it('should handle hunk header where both counts are omitted', () => {
    // @@ -5 +5 @@ — both default to 1
    const diff = `@@ -5 +5 @@
-old
+new`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(5)
    expect(hunks[0].oldLines).toBe(1)
    expect(hunks[0].newStart).toBe(5)
    expect(hunks[0].newLines).toBe(1)
  })

  it('should ignore lines not starting with +, -, or space', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
\\ No newline at end of file
 kept`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    // The backslash line is ignored; only the space-prefixed line is a change
    expect(hunks[0].changes).toHaveLength(1)
    expect(hunks[0].changes[0].type).toBe('normal')
    expect(hunks[0].changes[0].content).toBe('kept')
  })

  it('should track line numbers correctly through a hunk', () => {
    const diff = `@@ -10,5 +10,6 @@
 ctx1
-del1
 ctx2
+add1
+add2
 ctx3`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    const changes = hunks[0].changes

    // ctx1: old=10, new=10
    expect(changes[0]).toEqual({ type: 'normal', content: 'ctx1', oldLineNumber: 10, newLineNumber: 10 })
    // del1: old=11 (no newLineNumber)
    expect(changes[1]).toEqual({ type: 'delete', content: 'del1', oldLineNumber: 11 })
    // ctx2: old=12, new=11
    expect(changes[2]).toEqual({ type: 'normal', content: 'ctx2', oldLineNumber: 12, newLineNumber: 11 })
    // add1: new=12 (no oldLineNumber)
    expect(changes[3]).toEqual({ type: 'add', content: 'add1', newLineNumber: 12 })
    // add2: new=13 (no oldLineNumber)
    expect(changes[4]).toEqual({ type: 'add', content: 'add2', newLineNumber: 13 })
    // ctx3: old=13, new=14
    expect(changes[5]).toEqual({ type: 'normal', content: 'ctx3', oldLineNumber: 13, newLineNumber: 14 })
  })

  it('should handle lines before first hunk header gracefully', () => {
    // Lines before the first @@ should be ignored (no currentHunk)
    const diff = `diff --git a/file.ts b/file.ts
index abc123..def456 100644
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,1 @@
-old
+new`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].changes).toHaveLength(2)
    expect(hunks[0].changes[0].type).toBe('delete')
    expect(hunks[0].changes[1].type).toBe('add')
  })

  it('should handle a real-world TypeScript change diff', () => {
    const diff = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,7 +1,10 @@
 import { createServer } from 'http'
-import { old } from './old-module'
+import { newFeature } from './new-module'
+import { helper } from './utils'

 const PORT = process.env.PORT || 3000

+// Initialize new feature
+newFeature.init()
+
 createServer((req, res) => {`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[0].oldLines).toBe(7)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].newLines).toBe(10)

    const changes = hunks[0].changes
    // First line: normal
    expect(changes[0].type).toBe('normal')
    expect(changes[0].content).toBe("import { createServer } from 'http'")
    // Second line: delete
    expect(changes[1].type).toBe('delete')
    expect(changes[1].content).toBe("import { old } from './old-module'")
    // Third line: add
    expect(changes[2].type).toBe('add')
    expect(changes[2].content).toBe("import { newFeature } from './new-module'")
  })

  it('should handle consecutive delete then add with correct line numbers', () => {
    const diff = `@@ -5,4 +5,4 @@
 before
-removed_a
-removed_b
+added_a
+added_b
 after`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    const changes = hunks[0].changes
    expect(changes[0]).toEqual({ type: 'normal', content: 'before', oldLineNumber: 5, newLineNumber: 5 })
    expect(changes[1]).toEqual({ type: 'delete', content: 'removed_a', oldLineNumber: 6 })
    expect(changes[2]).toEqual({ type: 'delete', content: 'removed_b', oldLineNumber: 7 })
    expect(changes[3]).toEqual({ type: 'add', content: 'added_a', newLineNumber: 6 })
    expect(changes[4]).toEqual({ type: 'add', content: 'added_b', newLineNumber: 7 })
    expect(changes[5]).toEqual({ type: 'normal', content: 'after', oldLineNumber: 8, newLineNumber: 8 })
  })

  it('should handle diff with only added lines (new file)', () => {
    const diff = `@@ -0,0 +1,3 @@
+line1
+line2
+line3`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].oldStart).toBe(0)
    expect(hunks[0].oldLines).toBe(0)
    expect(hunks[0].newStart).toBe(1)
    expect(hunks[0].newLines).toBe(3)
    expect(hunks[0].changes).toHaveLength(3)
    for (const change of hunks[0].changes) {
      expect(change.type).toBe('add')
    }
  })

  it('should handle diff with only deleted lines (deleted file)', () => {
    const diff = `@@ -1,3 +0,0 @@
-line1
-line2
-line3`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].changes).toHaveLength(3)
    for (const change of hunks[0].changes) {
      expect(change.type).toBe('delete')
    }
    expect(hunks[0].changes[0].oldLineNumber).toBe(1)
    expect(hunks[0].changes[1].oldLineNumber).toBe(2)
    expect(hunks[0].changes[2].oldLineNumber).toBe(3)
  })

  it('should handle three or more hunks correctly', () => {
    const diff = `@@ -1,2 +1,2 @@
-a
+A
 b
@@ -10,2 +10,2 @@
-c
+C
 d
@@ -20,2 +20,2 @@
-e
+E
 f`
    const hunks = parseUnifiedDiff(diff)
    expect(hunks).toHaveLength(3)
    expect(hunks[0].oldStart).toBe(1)
    expect(hunks[1].oldStart).toBe(10)
    expect(hunks[2].oldStart).toBe(20)
    for (const hunk of hunks) {
      expect(hunk.changes).toHaveLength(3)
      expect(hunk.changes[0].type).toBe('delete')
      expect(hunk.changes[1].type).toBe('add')
      expect(hunk.changes[2].type).toBe('normal')
    }
  })
})
