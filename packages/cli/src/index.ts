#!/usr/bin/env node

import { resolve, dirname, relative, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import { existsSync } from 'fs'
import { networkInterfaces } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '../..')
const defaultBackendBase = 'http://127.0.0.1:4800'

interface WorkspaceStatusEntry {
  extensionId: string
  workspaceKey: string
  displayName: string
  rootPath: string
  gitBranch: string | null
  extensionVersion: string
  status: 'connected' | 'stale'
}

interface AdminWorkspacesResponse {
  status: 'ok'
  workspaces: WorkspaceStatusEntry[]
}

interface ResolverLinkResponse {
  status: 'ok'
  generatedAt: number
  workspace: Pick<WorkspaceStatusEntry, 'workspaceKey' | 'displayName' | 'gitBranch' | 'extensionVersion' | 'status'>
  resolverPath: string
  localUrl: string
  lanUrl: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────

function getLanIp(): string | null {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

function isDockerRunning(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function printBanner(workspacePath: string, lanIp: string | null) {
  console.log('')
  console.log('  ╔══════════════════════════════════════╗')
  console.log('  ║         Code Viewer Started          ║')
  console.log('  ╚══════════════════════════════════════╝')
  console.log('')
  console.log(`  Backend:   ws://localhost:4800`)
  console.log(`  Frontend:  http://localhost:4801`)
  console.log(`  Workspace: ${workspacePath}`)
  if (lanIp) {
    console.log('')
    console.log(`  📱 Mobile: http://${lanIp}:4801`)
  }
  console.log('')
}

function normalizeBackendBase(raw?: string): string {
  if (!raw) return defaultBackendBase
  return raw.replace(/\/+$/, '').replace(/^ws:/, 'http:').replace(/^wss:/, 'https:')
}

async function fetchJson<T>(url: URL): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const payload = await res.json() as { error?: string }
      if (payload.error) message = payload.error
    } catch { /* ignore json parse failure */ }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized >= 1 ? normalized : undefined
}

function parseLinkTarget(raw: string): { filePath: string; line?: number; endLine?: number } {
  const match = raw.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/)
  if (!match) {
    return { filePath: raw }
  }

  const [, filePath, lineRaw, endLineRaw] = match
  const line = parsePositiveInt(lineRaw)
  const endLine = parsePositiveInt(endLineRaw)

  if (line == null) {
    return { filePath: raw }
  }

  if (endLine != null && endLine >= line) {
    return { filePath, line, endLine }
  }

  return { filePath, line }
}

function normalizeRepoRelativePath(raw: string): string {
  return raw.replaceAll('\\', '/').replace(/^\.\//, '')
}

function isFileInsideWorkspace(absFilePath: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, absFilePath)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function findBestWorkspaceForFile(
  absFilePath: string,
  workspaces: WorkspaceStatusEntry[],
): WorkspaceStatusEntry | null {
  const connected = workspaces
    .filter((workspace) => workspace.status === 'connected')
    .filter((workspace) => isFileInsideWorkspace(absFilePath, workspace.rootPath))
    .sort((a, b) => b.rootPath.length - a.rootPath.length)
  return connected[0] ?? null
}

async function listWorkspaces(backendBase: string, secret: string | undefined): Promise<WorkspaceStatusEntry[]> {
  const url = new URL('/admin/workspaces', backendBase)
  if (secret) url.searchParams.set('secret', secret)
  const response = await fetchJson<AdminWorkspacesResponse>(url)
  return response.workspaces
}

interface LinkFileOptions {
  workspace?: string
  json?: boolean
  backend?: string
}

interface LinkDiffOptions extends LinkFileOptions {
  commit?: string
  status?: 'added' | 'modified' | 'deleted' | 'renamed'
}

interface LinkTourStepOptions extends LinkFileOptions {
  step?: number
}

async function linkFile(targetArg: string, options: LinkFileOptions) {
  const backendBase = normalizeBackendBase(options.backend ?? process.env.CODE_VIEWER_BACKEND_URL)
  const secret = process.env.CODE_VIEWER_SECRET
  const target = parseLinkTarget(targetArg)
  const absFilePath = resolve(target.filePath)
  const workspaces = await listWorkspaces(backendBase, secret)

  let matchedWorkspace: WorkspaceStatusEntry | null = null
  if (options.workspace) {
    const workspaceArg = options.workspace.trim()
    const resolvedWorkspaceRoot = workspaceArg.startsWith('ws_') ? null : resolve(workspaceArg)
    matchedWorkspace = workspaces.find((workspace) =>
      workspace.workspaceKey === workspaceArg ||
      (resolvedWorkspaceRoot != null && workspace.rootPath === resolvedWorkspaceRoot),
    ) ?? null
    if (!matchedWorkspace) {
      throw new Error(`No connected workspace matches ${options.workspace}.`)
    }
  } else {
    matchedWorkspace = findBestWorkspaceForFile(absFilePath, workspaces)
    if (!matchedWorkspace) {
      throw new Error(`No connected workspace matches ${absFilePath}. Use --workspace <rootPath>.`)
    }
  }

  const workspaceRoot = matchedWorkspace.rootPath
  const relativePath = normalizeRepoRelativePath(relative(workspaceRoot, absFilePath))
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`File is outside workspace: ${absFilePath}`)
  }

  const url = new URL('/api/links/file', backendBase)
  url.searchParams.set('workspace', matchedWorkspace.workspaceKey)
  url.searchParams.set('path', relativePath)
  if (target.line != null) url.searchParams.set('line', String(target.line))
  if (target.endLine != null) url.searchParams.set('endLine', String(target.endLine))
  if (secret) url.searchParams.set('secret', secret)

  const response = await fetchJson<ResolverLinkResponse>(url)

  if (options.json) {
    console.log(JSON.stringify(response, null, 2))
    return
  }

  console.log('')
  console.log('File link ready')
  console.log(`  Workspace: ${response.workspace.displayName}`)
  console.log(`  Key:       ${response.workspace.workspaceKey}`)
  console.log(`  Root:      ${workspaceRoot}`)
  console.log(`  Path:      ${relativePath}`)
  console.log(`  Local:     ${response.localUrl}`)
  if (response.lanUrl) {
    console.log(`  Mobile:    ${response.lanUrl}`)
  }
  console.log('')
}

function resolveWorkspaceByOption(
  workspaceArg: string | undefined,
  workspaces: WorkspaceStatusEntry[],
): WorkspaceStatusEntry | null {
  if (!workspaceArg) return null
  const trimmed = workspaceArg.trim()
  const resolvedWorkspaceRoot = trimmed.startsWith('ws_') ? null : resolve(trimmed)
  return workspaces.find((workspace) =>
    workspace.workspaceKey === trimmed ||
    (resolvedWorkspaceRoot != null && workspace.rootPath === resolvedWorkspaceRoot),
  ) ?? null
}

function printResolverLink(
  label: string,
  workspaceRoot: string,
  response: ResolverLinkResponse,
  extraLines: Array<[string, string]>,
) {
  console.log('')
  console.log(`${label} ready`)
  console.log(`  Workspace: ${response.workspace.displayName}`)
  console.log(`  Key:       ${response.workspace.workspaceKey}`)
  console.log(`  Root:      ${workspaceRoot}`)
  for (const [key, value] of extraLines) {
    console.log(`  ${key.padEnd(10)}${value}`)
  }
  console.log(`  Local:     ${response.localUrl}`)
  if (response.lanUrl) {
    console.log(`  Mobile:    ${response.lanUrl}`)
  }
  console.log('')
}

async function linkDiff(targetArg: string, options: LinkDiffOptions) {
  const backendBase = normalizeBackendBase(options.backend ?? process.env.CODE_VIEWER_BACKEND_URL)
  const secret = process.env.CODE_VIEWER_SECRET
  const absFilePath = resolve(targetArg)
  const workspaces = await listWorkspaces(backendBase, secret)

  let matchedWorkspace: WorkspaceStatusEntry | null = null
  if (options.workspace) {
    matchedWorkspace = resolveWorkspaceByOption(options.workspace, workspaces)
    if (!matchedWorkspace) {
      throw new Error(`No connected workspace matches ${options.workspace}.`)
    }
  } else {
    matchedWorkspace = findBestWorkspaceForFile(absFilePath, workspaces)
    if (!matchedWorkspace) {
      throw new Error(`No connected workspace matches ${absFilePath}. Use --workspace <rootPath>.`)
    }
  }

  const workspaceRoot = matchedWorkspace.rootPath
  const relativePath = normalizeRepoRelativePath(relative(workspaceRoot, absFilePath))
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`File is outside workspace: ${absFilePath}`)
  }

  const url = new URL('/api/links/diff', backendBase)
  url.searchParams.set('workspace', matchedWorkspace.workspaceKey)
  url.searchParams.set('path', relativePath)
  if (options.commit) url.searchParams.set('commit', options.commit)
  if (options.status) url.searchParams.set('status', options.status)
  if (secret) url.searchParams.set('secret', secret)

  const response = await fetchJson<ResolverLinkResponse>(url)

  if (options.json) {
    console.log(JSON.stringify(response, null, 2))
    return
  }

  printResolverLink('Diff link', workspaceRoot, response, [
    ['Path:', relativePath],
    ['Commit:', options.commit ?? '(workspace diff)'],
    ['Status:', options.status ?? '(auto)'],
  ])
}

async function linkTourStep(tourId: string, options: LinkTourStepOptions) {
  const backendBase = normalizeBackendBase(options.backend ?? process.env.CODE_VIEWER_BACKEND_URL)
  const secret = process.env.CODE_VIEWER_SECRET
  const workspaces = await listWorkspaces(backendBase, secret).then((items) =>
    items.filter((workspace) => workspace.status === 'connected'),
  )

  let matchedWorkspace = resolveWorkspaceByOption(options.workspace, workspaces)
  if (!matchedWorkspace) {
    if (options.workspace) {
      throw new Error(`No connected workspace matches ${options.workspace}.`)
    }
    if (workspaces.length === 1) {
      matchedWorkspace = workspaces[0]
    } else {
      throw new Error('Tour step links require --workspace <rootPath> when multiple workspaces are connected.')
    }
  }

  const url = new URL('/api/links/tour-step', backendBase)
  url.searchParams.set('workspace', matchedWorkspace.workspaceKey)
  url.searchParams.set('tourId', tourId)
  if (options.step != null) url.searchParams.set('step', String(options.step))
  if (secret) url.searchParams.set('secret', secret)

  const response = await fetchJson<ResolverLinkResponse>(url)

  if (options.json) {
    console.log(JSON.stringify(response, null, 2))
    return
  }

  printResolverLink('Tour step link', matchedWorkspace.rootPath, response, [
    ['Tour:', tourId],
    ['Step:', options.step != null ? String(options.step) : '(saved progress)'],
  ])
}

// ── Commands ────────────────────────────────────────────────────────

async function start(workspacePath: string) {
  const absPath = resolve(workspacePath)
  if (!existsSync(absPath)) {
    console.error(`Error: Path does not exist: ${absPath}`)
    process.exit(1)
  }

  // 1. Check Docker
  if (!isDockerRunning()) {
    console.error('Error: Docker is not running. Please start Docker Desktop.')
    process.exit(1)
  }

  // 2. Start backend + frontend via docker compose
  console.log('Starting backend + frontend...')
  try {
    execSync('docker compose up -d --build', {
      cwd: projectRoot,
      stdio: 'inherit',
    })
  } catch {
    console.error('Failed to start Docker containers.')
    process.exit(1)
  }

  // 3. Build extension if needed
  const extensionDist = resolve(projectRoot, 'extension/dist/extension.js')
  if (!existsSync(extensionDist)) {
    console.log('Building extension...')
    execSync('pnpm --filter code-viewer-extension build', {
      cwd: projectRoot,
      stdio: 'inherit',
    })
  }

  // 4. Write workspace setting to enable extension connection
  const vscodeDir = resolve(absPath, '.vscode')
  const settingsPath = resolve(vscodeDir, 'settings.json')

  if (!existsSync(vscodeDir)) {
    const { mkdirSync } = await import('fs')
    mkdirSync(vscodeDir, { recursive: true })
  }

  // Read existing settings, merge codeViewer config
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      const { readFileSync } = await import('fs')
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch { /* start fresh */ }
  }

  settings['codeViewer.enabled'] = true
  settings['codeViewer.backendUrl'] = 'ws://localhost:4800'

  const { writeFileSync } = await import('fs')
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
  console.log(`  ✅ Wrote .vscode/settings.json (codeViewer.enabled: true)`)

  // 5. Open VS Code (normal mode, extension installed via VSIX)
  const lanIp = getLanIp()
  printBanner(absPath, lanIp)

  const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code'
  try {
    spawn(codeCmd, [absPath], {
      stdio: 'ignore',
      detached: true,
    }).unref()

    console.log('  VS Code opened. Extension reads workspace setting → auto-connects.')
    console.log('')
  } catch (err) {
    console.error('Failed to launch VS Code:', err)
    console.error('Make sure `code` CLI is in your PATH.')
    process.exit(1)
  }
}

function stop() {
  console.log('Stopping Code Viewer...')
  try {
    execSync('docker compose down', {
      cwd: projectRoot,
      stdio: 'inherit',
    })
    console.log('Stopped.')
  } catch {
    console.error('Failed to stop containers.')
  }
}

function status() {
  try {
    execSync('docker compose ps', {
      cwd: projectRoot,
      stdio: 'inherit',
    })
  } catch {
    console.log('No containers running.')
  }
}

function printHelp() {
  console.log(`
Usage: code-viewer <command> [options]

Commands:
  start <path>   Start Code Viewer for a workspace
  stop           Stop all services
  status         Show service status
  link file <target> [--workspace <path>] [--json]
                 Generate a deep link for a file or range
  link diff <target> [--workspace <path>] [--commit <hash>] [--status <status>] [--json]
                 Generate a deep link for a git diff
  link tour-step <tourId> [--workspace <path>] [--step <n>] [--json]
                 Generate a deep link for a tour step

Examples:
  code-viewer start ~/code/my-project
  code-viewer stop
  code-viewer status
  code-viewer link file frontend/src/app.tsx --workspace ~/code/code-viewer
  code-viewer link file ~/code/code-viewer/frontend/src/app.tsx:120:140 --json
  code-viewer link diff packages/cli/src/index.ts --workspace ~/code/code-viewer --commit abc123
  code-viewer link tour-step review-tour --workspace ~/code/code-viewer --step 3
`)
}

function parseLinkFileArgs(args: string[]): { target: string; options: LinkFileOptions } {
  const [target, ...rest] = args
  if (!target) {
    throw new Error('Usage: code-viewer link file <target> [--workspace <path>] [--json]')
  }

  const options: LinkFileOptions = {}
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    switch (arg) {
      case '--workspace':
        options.workspace = rest[index + 1]
        if (!options.workspace) {
          throw new Error('--workspace requires a path')
        }
        index += 1
        break
      case '--backend':
        options.backend = rest[index + 1]
        if (!options.backend) {
          throw new Error('--backend requires a URL')
        }
        index += 1
        break
      case '--json':
        options.json = true
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return { target, options }
}

function parseLinkDiffArgs(args: string[]): { target: string; options: LinkDiffOptions } {
  const [target, ...rest] = args
  if (!target) {
    throw new Error('Usage: code-viewer link diff <target> [--workspace <path>] [--commit <hash>] [--status <status>] [--json]')
  }

  const options: LinkDiffOptions = {}
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    switch (arg) {
      case '--workspace':
        options.workspace = rest[index + 1]
        if (!options.workspace) throw new Error('--workspace requires a path')
        index += 1
        break
      case '--backend':
        options.backend = rest[index + 1]
        if (!options.backend) throw new Error('--backend requires a URL')
        index += 1
        break
      case '--commit':
        options.commit = rest[index + 1]
        if (!options.commit) throw new Error('--commit requires a hash')
        index += 1
        break
      case '--status':
        {
          const status = rest[index + 1]
          if (status !== 'added' && status !== 'modified' && status !== 'deleted' && status !== 'renamed') {
            throw new Error('--status must be one of: added, modified, deleted, renamed')
          }
          options.status = status
          index += 1
        }
        break
      case '--json':
        options.json = true
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return { target, options }
}

function parseLinkTourStepArgs(args: string[]): { tourId: string; options: LinkTourStepOptions } {
  const [tourId, ...rest] = args
  if (!tourId) {
    throw new Error('Usage: code-viewer link tour-step <tourId> [--workspace <path>] [--step <n>] [--json]')
  }

  const options: LinkTourStepOptions = {}
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    switch (arg) {
      case '--workspace':
        options.workspace = rest[index + 1]
        if (!options.workspace) throw new Error('--workspace requires a path')
        index += 1
        break
      case '--backend':
        options.backend = rest[index + 1]
        if (!options.backend) throw new Error('--backend requires a URL')
        index += 1
        break
      case '--step':
        {
          const step = parsePositiveInt(rest[index + 1])
          if (step == null) throw new Error('--step requires a positive integer')
          options.step = step
          index += 1
        }
        break
      case '--json':
        options.json = true
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return { tourId, options }
}

// ── Main ────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2)

switch (command) {
  case 'start':
    if (!args[0]) {
      console.error('Error: Please provide a workspace path.')
      console.error('Usage: code-viewer start <path>')
      process.exit(1)
    }
    start(args[0])
    break
  case 'stop':
    stop()
    break
  case 'status':
    status()
    break
  case 'link':
    try {
      switch (args[0]) {
        case 'file': {
          const { target, options } = parseLinkFileArgs(args.slice(1))
          await linkFile(target, options)
          break
        }
        case 'diff': {
          const { target, options } = parseLinkDiffArgs(args.slice(1))
          await linkDiff(target, options)
          break
        }
        case 'tour-step': {
          const { tourId, options } = parseLinkTourStepArgs(args.slice(1))
          await linkTourStep(tourId, options)
          break
        }
        default:
          throw new Error(
            'Usage: code-viewer link <file|diff|tour-step> ...',
          )
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    break
  default:
    printHelp()
}
