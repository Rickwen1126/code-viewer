import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HtmlRenderer } from '../components/html-renderer'

describe('HtmlRenderer', () => {
  it('renders HTML content inside a sandboxed iframe', () => {
    const html = renderToStaticMarkup(
      <HtmlRenderer content={'<main><h1>Hello</h1><script>window.bad = true</script></main>'} />,
    )

    expect(html).toContain('title="Rendered HTML preview"')
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).toContain('&lt;main&gt;&lt;h1&gt;Hello&lt;/h1&gt;')
  })
})
