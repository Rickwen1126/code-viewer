#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdirSync, openSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

const SERVICES = {
  backend: {
    name: '@code-viewer/backend',
    port: 4800,
    logPath: '/private/tmp/claude-501/codeview-backend.log',
    pidPath: '/private/tmp/claude-501/codeview-backend.pid',
  },
  frontend: {
    name: '@code-viewer/frontend',
    port: 4801,
    logPath: '/private/tmp/claude-501/codeview-frontend.log',
    pidPath: '/private/tmp/claude-501/codeview-frontend.pid',
  },
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function isPortListening(port) {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: '127.0.0.1', port })

    socket.once('connect', () => {
      socket.destroy()
      resolvePromise(true)
    })

    socket.once('error', () => {
      socket.destroy()
      resolvePromise(false)
    })
  })
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  return new Promise((resolvePromise, rejectPromise) => {
    const tryConnect = () => {
      const socket = net.connect({ host: '127.0.0.1', port })

      socket.once('connect', () => {
        socket.destroy()
        resolvePromise()
      })

      socket.once('error', () => {
        socket.destroy()
        if (Date.now() >= deadline) {
          rejectPromise(new Error(`Timed out waiting for port ${port}`))
          return
        }
        setTimeout(tryConnect, 250)
      })
    }

    tryConnect()
  })
}

async function main() {
  const serviceKey = process.argv[2]
  const config = SERVICES[serviceKey]

  if (!config) {
    console.error('Usage: node scripts/start-dev-service.mjs <backend|frontend>')
    process.exit(1)
  }

  mkdirSync(dirname(config.logPath), { recursive: true })

  if (await isPortListening(config.port)) {
    console.log(`${serviceKey} already listening on port ${config.port}; skipping start.`)
    return
  }

  const outFd = openSync(config.logPath, 'a')
  let exitCode = null
  let exitSignal = null

  const child = spawn('pnpm', ['--filter', config.name, 'dev'], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
  })

  child.once('exit', (code, signal) => {
    exitCode = code
    exitSignal = signal
  })

  child.unref()
  writeFileSync(config.pidPath, `${child.pid}\n`, 'utf8')

  try {
    await waitForPort(config.port, 15000)
  } catch (error) {
    await sleep(250)
    if (exitCode !== null || exitSignal !== null) {
      const detail =
        exitSignal !== null
          ? `signal ${exitSignal}`
          : `exit code ${exitCode ?? 'unknown'}`
      console.error(
        `${serviceKey} failed before port ${config.port} became ready (${detail}). Log: ${config.logPath}`,
      )
    } else {
      console.error(
        `${serviceKey} did not become ready on port ${config.port}. Log: ${config.logPath}`,
      )
    }
    process.exit(1)
  }

  console.log(
    `${serviceKey} started on port ${config.port} (pid ${child.pid}). Log: ${config.logPath}`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
