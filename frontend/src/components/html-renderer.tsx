interface HtmlRendererProps {
  content: string
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  return (
    <iframe
      title="Rendered HTML preview"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={content}
      style={{
        display: 'block',
        width: '100%',
        minHeight: '100%',
        height: '100%',
        border: 'none',
        background: '#fff',
      }}
    />
  )
}
