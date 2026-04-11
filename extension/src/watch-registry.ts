import * as vscode from 'vscode'
import type { WatchDescriptor, WsMessage } from '@code-viewer/shared'
import { startFileContentDocumentWatch, startFileContentWatch } from './providers/file-provider'
import { startGitStatusWatch } from './providers/git-provider'

function getWatchDescriptorKey(descriptor: WatchDescriptor): string {
  switch (descriptor.topic) {
    case 'file.content':
      return `file.content:${descriptor.path}`
    case 'git.status':
      return 'git.status:workspace'
  }
}

function disposeAll(disposables: Iterable<vscode.Disposable>): void {
  for (const disposable of disposables) {
    disposable.dispose()
  }
}

export class WatchRegistry {
  private fileContentPaths = new Set<string>()
  private fileContentWatches = new Map<string, vscode.Disposable[]>()
  private fileContentDocumentWatch: vscode.Disposable | undefined
  private gitStatusWatch: vscode.Disposable[] | undefined

  constructor(
    private readonly sendEvent: (msg: WsMessage) => void,
    private readonly log: (...args: unknown[]) => void = () => {},
  ) {}

  apply(watches: WatchDescriptor[]): void {
    this.log('watchRegistry.apply', watches)
    const nextByKey = new Map<string, WatchDescriptor>()
    for (const watch of watches) {
      nextByKey.set(getWatchDescriptorKey(watch), watch)
    }

    const nextFilePaths = new Set<string>()
    let needsGitStatusWatch = false

    for (const watch of nextByKey.values()) {
      if (watch.topic === 'file.content') {
        nextFilePaths.add(watch.path)
      } else if (watch.topic === 'git.status') {
        needsGitStatusWatch = true
      }
    }

    this.reconcileFileContent(nextFilePaths)
    this.reconcileGitStatus(needsGitStatusWatch)
  }

  clear(): void {
    this.log('watchRegistry.clear', {
      fileContentPaths: [...this.fileContentPaths],
      hasGitStatusWatch: Boolean(this.gitStatusWatch),
    })
    for (const disposables of this.fileContentWatches.values()) {
      disposeAll(disposables)
    }
    this.fileContentWatches.clear()
    this.fileContentPaths.clear()

    if (this.fileContentDocumentWatch) {
      this.fileContentDocumentWatch.dispose()
      this.fileContentDocumentWatch = undefined
    }

    if (this.gitStatusWatch) {
      disposeAll(this.gitStatusWatch)
      this.gitStatusWatch = undefined
    }
  }

  private reconcileFileContent(nextFilePaths: Set<string>): void {
    for (const [path, disposables] of this.fileContentWatches.entries()) {
      if (nextFilePaths.has(path)) continue
      this.log('watchRegistry.disposeFileContentWatch', path)
      disposeAll(disposables)
      this.fileContentWatches.delete(path)
      this.fileContentPaths.delete(path)
    }

    for (const path of nextFilePaths) {
      if (this.fileContentWatches.has(path)) continue
      this.log('watchRegistry.startFileContentWatch', path)
      const disposables = startFileContentWatch(path, this.sendEvent)
      this.fileContentWatches.set(path, disposables)
      this.fileContentPaths.add(path)
    }

    if (this.fileContentPaths.size > 0 && !this.fileContentDocumentWatch) {
      this.log('watchRegistry.startFileContentDocumentWatch', [...this.fileContentPaths])
      this.fileContentDocumentWatch = startFileContentDocumentWatch(
        () => this.fileContentPaths,
        this.sendEvent,
      )
    }

    if (this.fileContentPaths.size === 0 && this.fileContentDocumentWatch) {
      this.log('watchRegistry.disposeFileContentDocumentWatch')
      this.fileContentDocumentWatch.dispose()
      this.fileContentDocumentWatch = undefined
    }
  }

  private reconcileGitStatus(needsGitStatusWatch: boolean): void {
    if (needsGitStatusWatch && !this.gitStatusWatch) {
      this.log('watchRegistry.startGitStatusWatch')
      this.gitStatusWatch = startGitStatusWatch(this.sendEvent)
      return
    }

    if (!needsGitStatusWatch && this.gitStatusWatch) {
      this.log('watchRegistry.disposeGitStatusWatch')
      disposeAll(this.gitStatusWatch)
      this.gitStatusWatch = undefined
    }
  }
}
