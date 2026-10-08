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

/** The dot carries the state beside the word. Colour alone never does. */
const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'ds-dot',
  working: 'ds-dot ds-dot--running',
  complete: 'ds-dot ds-dot--ok',
  error: 'ds-dot ds-dot--failed',
  skipped: 'ds-dot ds-dot--skipped',
  stopped: 'ds-dot app-dot--warning',
}

/** Handles sit on all four sides. The graph picks which pair each edge uses. */
export function AgentNode({ data }: { data: AgentState }) {
  const cut = data.status === 'complete' && wasTruncated(data)
  const word = cut ? 'Cut off' : STATUS_WORD[data.status]
  const dot = cut ? 'ds-dot app-dot--warning' : STATUS_DOT[data.status]
  return (
    <div className="agent-node" data-status={data.status} data-cut={cut ? 'true' : undefined}>
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
      <div className="agent-node__name">{data.name}</div>
      {/* A non-breaking space holds the line until the stage reports its time, so the node does not shift. */}
      <div className="agent-node__ms ds-num">{data.ms !== undefined ? `${data.ms.toLocaleString('en-US')} ms` : ' '}</div>
      <div className="agent-node__desc">{data.description}</div>
      <div className="agent-node__status">
        <span className={dot} aria-hidden="true" />
        {word}
      </div>
    </div>
  )
}
