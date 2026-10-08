import { Handle, Position } from '@xyflow/react'
import { wasTruncated } from '../lib/agents'
import type { AgentState, AgentStatus } from '../types'

const STATUS_WORD: Record<AgentStatus, string> = {
  idle: 'Waiting',
  working: 'Working',
  complete: 'Finished',
  error: 'Failed',
  skipped: 'Not run',
  stopped: 'Stopped',
}

/** Handles sit on all four sides. The graph picks which pair each edge uses. */
export function AgentNode({ data }: { data: AgentState }) {
  const word = data.status === 'complete' && wasTruncated(data) ? 'Cut off' : STATUS_WORD[data.status]
  return (
    <div className="agent-node" data-status={data.status} title={data.description}>
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
      <div className="agent-node__name">{data.name}</div>
      <div className="agent-node__state">{word}</div>
      {data.status === 'complete' && data.ms !== undefined && (
        <div className="agent-node__state">{data.ms.toLocaleString('en-US')} ms</div>
      )}
    </div>
  )
}
