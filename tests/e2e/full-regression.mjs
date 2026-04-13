import { spawn } from 'child_process'

const WORKSPACE_PATH = '/Users/rickwen/code/code-viewer'

const suite = [
  { id: 'watch-demand', cmd: ['node', 'tests/e2e/watch-demand.mjs'] },
  { id: 'edit-step-title', cmd: ['node', 'tests/e2e/edit-step-title.mjs'] },
  { id: 'semantic-navigation', cmd: ['node', 'tests/e2e/semantic-navigation.mjs'] },
  { id: 'media-preview', cmd: ['node', 'tests/e2e/media-preview.mjs', WORKSPACE_PATH] },
  { id: 'git-media-preview', cmd: ['node', 'tests/e2e/git-media-preview.mjs', WORKSPACE_PATH] },
]

function runOne({ id, cmd }) {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('close', (code) => {
      resolve({
        id,
        cmd: cmd.join(' '),
        code: code ?? 1,
        ok: code === 0,
        stdout,
        stderr,
      })
    })
  })
}

async function main() {
  const results = []
  for (const test of suite) {
    console.log(`\n=== ${test.id} ===`)
    results.push(await runOne(test))
  }

  const summary = results.map((result) => ({
    id: result.id,
    ok: result.ok,
    code: result.code,
  }))

  console.log('\n=== summary ===')
  console.log(JSON.stringify(summary, null, 2))

  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
