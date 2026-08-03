export default function Header() {
  return (
    <>
      <header className="w-full flex items-center justify-between px-8 py-5 border-b border-zinc-800/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
              <rect x="12" y="3" width="8" height="16" rx="4" fill="#8b5cf6" opacity="0.3" stroke="#8b5cf6" strokeWidth="1.5"/>
              <path d="M8 14v2a8 8 0 0016 0v-2" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round"/>
              <line x1="16" y1="24" x2="16" y2="29" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round"/>
              <path d="M4 16c0 0 3-4 6-2s4 6 6 4 4-6 6-4 6 2 6 2" stroke="#c4b5fd" strokeWidth="1.5" opacity="0.4" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white" style={{ margin: 0 }}>VoxAI</h1>
        </div>
        <span className="text-xs text-zinc-500 font-mono">Voice AI Assistant</span>
      </header>
      <div className="w-full px-8 py-3 border-b border-zinc-800/30" style={{ background: 'rgba(139,92,246,0.03)' }}>
        <p className="text-xs text-zinc-400 leading-relaxed max-w-2xl mx-auto text-center" style={{ margin: 0 }}>
          Hit the mic button and just talk. Your voice gets transcribed on the fly, the AI thinks through a response, and reads it back to you out loud. No microphone? The text box works just as well.
        </p>
      </div>
    </>
  )
}
