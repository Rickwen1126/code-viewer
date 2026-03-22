#!/usr/bin/env node

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn, execSync } from 'child_process'
import { existsSync } from 'fs'
import { networkInterfaces } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '../..')

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

  // 4. Launch VS Code with extension via `code` CLI
  console.log('Launching VS Code with extension...')
  const extensionPath = resolve(projectRoot, 'extension')

  const lanIp = getLanIp()
  printBanner(absPath, lanIp)

  // Use `code` CLI — supports multiple instances (unlike test-electron)
  const codeCmd = process.platform === 'win32' ? 'code.cmd' : 'code'
  try {
    spawn(codeCmd, [
      `--extensionDevelopmentPath=${extensionPath}`,
      absPath,
    ], {
      stdio: 'ignore',
      detached: true,
      env: {
        ...process.env,
        CODE_VIEWER_AUTOCONNECT: '1',
        CODE_VIEWER_BACKEND_URL: `ws://localhost:4800`,
      },
    }).unref()

    console.log('  VS Code window opened. Extension will auto-connect.')
    console.log('  Close the VS Code window to disconnect this workspace.')
    console.log('')
  } catch (err) {
    console.error('Failed to launch VS Code:', err)
    console.error('Make sure `code` CLI is in your PATH.')
    console.error('VS Code → Cmd+Shift+P → "Shell Command: Install \'code\' command in PATH"')
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

Examples:
  code-viewer start ~/code/my-project
  code-viewer stop
  code-viewer status
`)
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
  default:
    printHelp()
}
