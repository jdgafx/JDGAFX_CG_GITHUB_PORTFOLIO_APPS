import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-base font-semibold text-white mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold text-white mt-4 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-rose-300/90 mt-3 mb-1.5 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-xs font-semibold text-rose-300/80 mt-3 mb-1.5 first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 pl-4 list-disc marker:text-rose-500/60">{children}</ul>,
  ol: ({ children }) => (
    <ol className="my-2 pl-4 list-decimal marker:text-rose-500/60">{children}</ol>
  ),
  li: ({ children }) => <li className="my-1 pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-gray-200">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-rose-400 underline underline-offset-2 hover:text-rose-300"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-rose-500/40 pl-3 text-gray-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-white/[0.08]" />,
  code: ({ children }) => (
    <code className="rounded bg-white/[0.07] px-1 py-0.5 text-[0.95em] text-rose-200">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/40 p-3 text-xs [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-gray-300">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-white/[0.08]">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-white/[0.08] px-2.5 py-1.5 font-semibold text-gray-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-white/[0.04] px-2.5 py-1.5 align-top text-gray-400">
      {children}
    </td>
  ),
}

interface MarkdownProps {
  content: string
  /** Renders a blinking caret after the final block while tokens stream in. */
  streaming?: boolean
}

export default function Markdown({ content, streaming = false }: MarkdownProps) {
  return (
    <div className={`md-body${streaming ? ' md-streaming' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
