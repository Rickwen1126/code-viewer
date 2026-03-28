import { useMemo } from 'react'
import { marked, type Token, type Tokens } from 'marked'
import { CodeBlock } from './code-block'

interface MarkdownRendererProps {
  content: string
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const tokens = useMemo(() => marked.lexer(content), [content])

  return (
    <div style={{ padding: '12px 16px', lineHeight: 1.6, fontSize: 14, color: '#d4d4d4' }}>
      {tokens.map((token, i) => (
        <TokenRenderer key={i} token={token} />
      ))}
    </div>
  )
}

function TokenRenderer({ token }: { token: Token }) {
  switch (token.type) {
    case 'heading':
      return <HeadingRenderer token={token as Tokens.Heading} />
    case 'paragraph':
      return (
        <p style={{ marginBottom: 12 }}>
          <InlineRenderer tokens={(token as Tokens.Paragraph).tokens} />
        </p>
      )
    case 'code':
      return <CodeBlockRenderer token={token as Tokens.Code} />
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
            <TokenRenderer key={i} token={t} />
          ))}
        </blockquote>
      )
    case 'list':
      return <ListRenderer token={token as Tokens.List} />
    case 'hr':
      return <hr style={{ border: 'none', borderTop: '1px solid #333', margin: '16px 0' }} />
    case 'table':
      return <TableRenderer token={token as Tokens.Table} />
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

function HeadingRenderer({ token }: { token: Tokens.Heading }) {
  const styles: Record<number, React.CSSProperties> = {
    1: { fontSize: 24, color: '#569cd6', fontWeight: 'bold', marginBottom: 16 },
    2: { fontSize: 20, color: '#569cd6', fontWeight: 'bold', marginBottom: 12 },
    3: { fontSize: 16, color: '#d4d4d4', fontWeight: 'bold', marginBottom: 8 },
  }
  const style = styles[token.depth] ?? styles[3]
  const depth = Math.min(token.depth, 6)
  return (
    <div role="heading" aria-level={depth} style={style}>
      <InlineRenderer tokens={token.tokens} />
    </div>
  )
}

function CodeBlockRenderer({ token }: { token: Tokens.Code }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <CodeBlock code={token.text} language={token.lang || 'text'} showLineNumbers={false} />
    </div>
  )
}

function ListRenderer({ token }: { token: Tokens.List }) {
  const Tag = token.ordered ? 'ol' : 'ul'
  return (
    <Tag
      style={{
        paddingLeft: 24,
        marginBottom: 12,
        listStyleType: token.ordered ? 'decimal' : 'disc',
      }}
    >
      {token.items.map((item, i) => (
        <li key={i} style={{ marginBottom: 4 }}>
          {item.tokens.map((t, j) => {
            if (t.type === 'text' && 'tokens' in t && t.tokens) {
              return <InlineRenderer key={j} tokens={t.tokens as Token[]} />
            }
            return <TokenRenderer key={j} token={t} />
          })}
        </li>
      ))}
    </Tag>
  )
}

function TableRenderer({ token }: { token: Tokens.Table }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 12 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
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
