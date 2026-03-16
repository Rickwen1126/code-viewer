import ShikiHighlighter from 'react-shiki'

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <div style={{ fontSize: 13, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5 }}>
      <ShikiHighlighter language={language} theme="dark-plus">
        {code}
      </ShikiHighlighter>
    </div>
  )
}
