/**
 * Cross-component "reveal file in tree" signal.
 * Desktop: CodeViewerPage header dispatches, FileBrowserSidebar listens and
 * expands/scrolls to the node. Mobile uses router state instead (the tree is
 * a separate route, so the event would fire before the page mounts).
 */
export const REVEAL_FILE_EVENT = 'code-viewer:reveal-file'

export function requestRevealFileInTree(path: string): void {
  window.dispatchEvent(new CustomEvent(REVEAL_FILE_EVENT, { detail: { path } }))
}

export function revealEventPath(event: Event): string | null {
  const detail = (event as CustomEvent<{ path?: string }>).detail
  return typeof detail?.path === 'string' && detail.path ? detail.path : null
}

/** All ancestor directory paths of a file path, shallowest first. */
export function ancestorDirs(path: string): string[] {
  const parts = path.split('/')
  const dirs: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    dirs.push(parts.slice(0, i + 1).join('/'))
  }
  return dirs
}

/** CSS selector matching a tree node button rendered with data-tree-path. */
export function treeNodeSelector(path: string): string {
  return `[data-tree-path="${CSS.escape(path)}"]`
}
