import { useSearchParams } from 'react-router'
import { buildGitDiffUrl } from '../../services/semantic-navigation'
import { WorkspaceScopedResolverPage } from './workspace-resolver'

export function OpenGitDiffResolverPage() {
  const [searchParams] = useSearchParams()

  const workspaceRef = searchParams.get('workspace')
  const path = searchParams.get('path')
  const commit = searchParams.get('commit') ?? undefined
  const status = searchParams.get('status') ?? undefined
  const targetUrl = path ? buildGitDiffUrl(path, { commit, status }) : null

  return (
    <WorkspaceScopedResolverPage
      title="Open Git Diff Link"
      workspaceRef={workspaceRef}
      targetUrl={path && targetUrl ? targetUrl : null}
      invalidMessage="Invalid link: workspace and path are required."
      waitingMessage="Looking for matching workspace..."
      selectingLabel="workspace"
      details={[
        { label: 'path', value: path },
        { label: 'commit', value: commit ?? null },
        { label: 'status', value: status ?? null },
      ]}
    />
  )
}
