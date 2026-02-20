import type { ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Search, BarChart3, Shield, Sparkles } from 'lucide-react'
import type { AgentRole, AgentState } from '../types'

const ICONS: Record<AgentRole, ReactNode> = {
  researcher: <Search size={16} />,
  analyst: <BarChart3 size={16} />,
  critic: <Shield size={16} />,
  synthesizer: <Sparkles size={16} />,
}

function dotColor(status: string): string {
  if (status === 'complete') return '#00ff88'
  if (status === 'error') return '#ff3366'
  if (status === 'working' || status === 'thinking') return '#00d4ff'
  return '#64748b'
}

export function AgentNode({ data }: { data: AgentState }) {
  const isActive = data.status === 'working' || data.status === 'thinking'

  return (
    <div
      className={isActive ? 'glass-active agent-active' : 'glass'}
      style={{ width: 180, borderRadius: 16, padding: '14px 16px', position: 'relative' }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#00d4ff', border: 'none', width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#00d4ff', border: 'none', width: 8, height: 8 }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            padding: '6px',
            borderRadius: 8,
            color: isActive ? '#00d4ff' : '#64748b',
            background: isActive ? 'rgba(0,212,255,0.1)' : 'rgba(100,116,139,0.1)',
            display: 'flex',
          }}
        >
          {ICONS[data.id]}
        </div>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            marginLeft: 'auto',
            background: dotColor(data.status),
            boxShadow: isActive ? '0 0 8px #00d4ff' : undefined,
          }}
        />
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.3 }}>
        {data.name}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{data.description}</div>

      {data.status === 'complete' && data.tokens > 0 && (
        <div
          style={{
            marginTop: 8,
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 99,
            background: 'rgba(0,212,255,0.1)',
            color: '#00d4ff',
            fontSize: 10,
          }}
        >
          {data.tokens.toLocaleString()} tokens
        </div>
      )}

      {isActive && (
        <div
          style={{
            marginTop: 8,
            height: 2,
            background: 'rgba(255,255,255,0.08)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{ height: '100%', width: '60%', background: '#00d4ff', borderRadius: 2 }}
          />
        </div>
      )}
    </div>
  )
}
