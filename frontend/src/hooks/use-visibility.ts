import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void): () => void {
  document.addEventListener('visibilitychange', onStoreChange)
  return () => {
    document.removeEventListener('visibilitychange', onStoreChange)
  }
}

function getSnapshot(): DocumentVisibilityState {
  return document.visibilityState
}

export function useDocumentVisibility(): DocumentVisibilityState {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'visible')
}
