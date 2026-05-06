import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownRenderer } from '../components/markdown-renderer'

describe('MarkdownRenderer', () => {
  it('renders markdown task list items as disabled checkboxes instead of bullet-only items', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'- [ ] todo\n- [x] done'} />,
    )

    expect(html).toContain('type="checkbox"')
    expect(html).toContain('list-style-type:none')
    expect(html).toContain('todo')
    expect(html).toContain('done')
  })
})
