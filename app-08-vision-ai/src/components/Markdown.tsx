import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  // Wide tables scroll inside their own box instead of widening the page.
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  ),
}

interface MarkdownProps {
  content: string
  /** Shows a caret after the last block while the answer is still streaming. */
  streaming?: boolean
}

export default function Markdown({ content, streaming = false }: MarkdownProps) {
  return (
    <div className={streaming ? 'result-text is-streaming' : 'result-text'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
