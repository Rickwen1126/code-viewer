import { useMemo } from 'react'
import { marked, type Token, type Tokens } from 'marked'
import { CodeBlock } from './code-block'

interface MarkdownRendererProps {
  content: string
  codeFontSize?: number
  wordWrap?: boolean
}

export function MarkdownRenderer({ content, codeFontSize, wordWrap = false }: MarkdownRendererProps) {
  const tokens = useMemo(() => marked.lexer(content), [content])
  const markdownFontSize = codeFontSize ?? 14

  return (
    <div style={{ padding: '12px 16px', lineHeight: 1.6, fontSize: markdownFontSize, color: '#d4d4d4', ...(wordWrap ? { overflowWrap: 'break-word', wordBreak: 'break-word' } : undefined) }}>
      {tokens.map((token, i) => (
        <TokenRenderer key={i} token={token} fontSize={markdownFontSize} />
      ))}
    </div>
  )
}

function TokenRenderer({ token, fontSize }: { token: Token; fontSize: number }) {
  switch (token.type) {
    case 'heading':
      return <HeadingRenderer token={token as Tokens.Heading} fontSize={fontSize} />
    case 'paragraph':
      return (
        <p style={{ marginBottom: 12 }}>
          <InlineRenderer tokens={(token as Tokens.Paragraph).tokens} />
        </p>
      )
    case 'code':
      return <CodeBlockRenderer token={token as Tokens.Code} fontSize={fontSize} />
    case 'blockquote':
      return (
        <blockquote
          style={{
            borderLeft: '3px solid #569cd6',
            paddingLeft: 12,
            color: '#888',
            marginBottom: 12,
          }}
        >
          {(token as Tokens.Blockquote).tokens.map((t, i) => (
            <TokenRenderer key={i} token={t} fontSize={fontSize} />
          ))}
        </blockquote>
      )
    case 'list':
      return <ListRenderer token={token as Tokens.List} fontSize={fontSize} />
    case 'checkbox':
      return <CheckboxRenderer token={token as { checked: boolean }} />
    case 'hr':
      return <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '16px 0' }} />
    case 'table':
      return <TableRenderer token={token as Tokens.Table} fontSize={fontSize} />
    case 'space':
      return null
    default:
      // Fallback: render raw text
      if ('text' in token) {
        return <p style={{ marginBottom: 12 }}>{(token as { text: string }).text}</p>
      }
      return null
  }
}

function CheckboxRenderer({ token }: { token: { checked: boolean } }) {
  return (
    <input
      type="checkbox"
      checked={token.checked}
      readOnly
      disabled
      style={{
        margin: '0.35em 0 0',
        accentColor: '#569cd6',
        flexShrink: 0,
      }}
    />
  )
}

function HeadingRenderer({ token, fontSize }: { token: Tokens.Heading; fontSize: number }) {
  const styles: Record<number, React.CSSProperties> = {
    1: { fontSize: fontSize + 10, color: '#569cd6', fontWeight: 'bold', marginBottom: 16 },
    2: { fontSize: fontSize + 6, color: '#569cd6', fontWeight: 'bold', marginBottom: 12 },
    3: { fontSize: fontSize + 2, color: '#d4d4d4', fontWeight: 'bold', marginBottom: 8 },
  }
  const style = styles[token.depth] ?? styles[3]
  const depth = Math.min(token.depth, 6)
  return (
    <div role="heading" aria-level={depth} style={style}>
      <InlineRenderer tokens={token.tokens} />
    </div>
  )
}

function CodeBlockRenderer({ token, fontSize }: { token: Tokens.Code; fontSize: number }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <CodeBlock
        code={token.text}
        language={token.lang || 'text'}
        showLineNumbers={false}
        fontSize={fontSize}
      />
    </div>
  )
}

function ListRenderer({ token, fontSize }: { token: Tokens.List; fontSize: number }) {
  const Tag = token.ordered ? 'ol' : 'ul'
  const isTaskList = !token.ordered && token.items.some((item) => item.task)
  return (
    <Tag
      style={{
        paddingLeft: 24,
        marginBottom: 12,
        listStyleType: token.ordered ? 'decimal' : isTaskList ? 'none' : 'disc',
      }}
    >
      {token.items.map((item, i) => {
        if (item.task) {
          const inlineTokens = item.tokens.filter((t) => t.type !== 'list')
          const nestedLists = item.tokens.filter((t) => t.type === 'list')
          return (
            <li key={i} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {inlineTokens.map((t, j) => {
                  if (t.type === 'text' && 'tokens' in t && t.tokens) {
                    return <InlineRenderer key={j} tokens={t.tokens as Token[]} />
                  }
                  return <TokenRenderer key={j} token={t} fontSize={fontSize} />
                })}
              </div>
              {nestedLists.map((t, j) => (
                <TokenRenderer key={`nested-${j}`} token={t} fontSize={fontSize} />
              ))}
            </li>
          )
        }
        return (
          <li key={i} style={{ marginBottom: 4 }}>
            {item.tokens.map((t, j) => {
              if (t.type === 'text' && 'tokens' in t && t.tokens) {
                return <InlineRenderer key={j} tokens={t.tokens as Token[]} />
              }
              return <TokenRenderer key={j} token={t} fontSize={fontSize} />
            })}
          </li>
        )
      })}
    </Tag>
  )
}

function TableRenderer({ token, fontSize }: { token: Tokens.Table; fontSize: number }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 12 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: Math.max(fontSize - 1, 8) }}>
        <thead>
          <tr>
            {token.header.map((cell, i) => (
              <th
                key={i}
                style={{
                  border: '1px solid #444',
                  padding: '6px 10px',
                  textAlign: (token.align[i] as React.CSSProperties['textAlign']) ?? 'left',
                  background: '#252526',
                  fontWeight: 'bold',
                }}
              >
                <InlineRenderer tokens={cell.tokens} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {token.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  style={{
                    border: '1px solid #444',
                    padding: '6px 10px',
                    textAlign: (token.align[j] as React.CSSProperties['textAlign']) ?? 'left',
                  }}
                >
                  <InlineRenderer tokens={cell.tokens} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Render inline tokens (text, code, strong, em, link, etc.) */
function InlineRenderer({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'text':
            // Text tokens may have nested tokens (e.g., bold inside text)
            if ('tokens' in token && token.tokens) {
              return <InlineRenderer key={i} tokens={token.tokens as Token[]} />
            }
            return <span key={i}>{(token as Tokens.Text).text}</span>
          case 'checkbox':
            return <CheckboxRenderer key={i} token={token as { checked: boolean }} />
          case 'strong':
            return (
              <strong key={i} style={{ fontWeight: 'bold', color: '#d4d4d4' }}>
                <InlineRenderer tokens={(token as Tokens.Strong).tokens} />
              </strong>
            )
          case 'em':
            return (
              <em key={i} style={{ fontStyle: 'italic' }}>
                <InlineRenderer tokens={(token as Tokens.Em).tokens} />
              </em>
            )
          case 'codespan':
            return (
              <code
                key={i}
                style={{
                  color: '#4ec9b0',
                  background: '#252526',
                  padding: '2px 6px',
                  borderRadius: 3,
                  fontSize: '0.9em',
                }}
              >
                {(token as Tokens.Codespan).text}
              </code>
            )
          case 'link':
            return (
              <a
                key={i}
                href={(token as Tokens.Link).href}
                style={{ color: '#569cd6', textDecoration: 'underline' }}
                target="_blank"
                rel="noopener noreferrer"
              >
                <InlineRenderer tokens={(token as Tokens.Link).tokens} />
              </a>
            )
          case 'image':
            return (
              <img
                key={i}
                src={(token as Tokens.Image).href}
                alt={(token as Tokens.Image).text}
                style={{ maxWidth: '100%', borderRadius: 4 }}
              />
            )
          case 'br':
            return <br key={i} />
          case 'del':
            return (
              <del key={i} style={{ color: '#888' }}>
                <InlineRenderer tokens={(token as Tokens.Del).tokens} />
              </del>
            )
          default:
            if ('text' in token) return <span key={i}>{(token as { text: string }).text}</span>
            return null
        }
      })}
    </>
  )
}
