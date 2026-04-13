import { useSearchParams } from 'react-router'
import { buildTourStepUrl, parsePositiveIntQuery } from '../../services/semantic-navigation'
import { WorkspaceScopedResolverPage } from './workspace-resolver'

export function OpenTourResolverPage() {
  const [searchParams] = useSearchParams()

  const workspaceRef = searchParams.get('workspace')
  const tourId = searchParams.get('tourId')
  const step = parsePositiveIntQuery(searchParams, 'step')
  const targetUrl = tourId ? buildTourStepUrl(tourId, step ?? 0) : null

  return (
    <WorkspaceScopedResolverPage
      title="Open Tour Link"
      workspaceRef={workspaceRef}
      targetUrl={tourId && targetUrl ? targetUrl : null}
      invalidMessage="Invalid link: workspace and tourId are required."
      waitingMessage="Looking for matching workspace..."
      selectingLabel="workspace"
      details={[
        { label: 'tourId', value: tourId },
        { label: 'step', value: step != null ? String(step) : null },
      ]}
    />
  )
}
