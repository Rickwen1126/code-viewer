import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'packages/shared',
  'backend',
  'frontend',
  'extension',
])
