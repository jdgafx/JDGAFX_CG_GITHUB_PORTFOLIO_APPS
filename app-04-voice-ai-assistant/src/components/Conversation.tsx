import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Trash2 } from 'lucide-react'
import type { ChatMessage } from '../lib/api'

interface ConversationProps {
  messages: ChatMessage[]
  onClear: () => void
}

export default function Conversation({ messages, onClear }: ConversationProps) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) return null

  return (
    <section className="w-full space-y-3" aria-label="Conversation">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-zinc-500 font-medium uppercase tracking-wider">
          <MessageCircle size={12} aria-hidden="true" />
          Conversation
        </div>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the conversation"
          title="Clear the conversation and start over"
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-zinc-400 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          style={{ background: '#18181b', border: '1px solid #27272a' }}
        >
          <Trash2 size={12} aria-hidden="true" />
          Clear
        </button>
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin', scrollbarColor: '#3f3f46 transparent' }}>
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className="max-w-xs px-4 py-2.5 rounded-2xl text-sm leading-relaxed"
                title={msg.role === 'user' ? 'You said' : 'VoxAI replied'}
                style={msg.role === 'user' ? {
                  background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                  color: 'white',
                  borderBottomRightRadius: 4,
                } : {
                  background: '#18181b',
                  color: '#d4d4d8',
                  border: '1px solid #27272a',
                  borderBottomLeftRadius: 4,
                }}
              >
                {msg.content}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={endRef} />
      </div>
    </section>
  )
}
