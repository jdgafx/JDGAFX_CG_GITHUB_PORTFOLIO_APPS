import { Handle, Position } from '@xyflow/react'
import { foundNoSources, statusView, wasTruncated } from '../lib/agents'
import type { AgentState } from '../types'

/** Handles sit on all four sides. The graph picks which pair each edge uses. */
export function AgentNode({ data }: { data: AgentState }) {
  const warn = data.status === 'complete' && (wasTruncated(data) || foundNoSources(data))
  const view = statusView(data)
  return (
    <div className="agent-node" data-status={data.status} data-warn={warn ? 'true' : undefined}>
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="target-right" type="target" position={Position.Right} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
      <div className="agent-node__name">{data.name}</div>
      {/* A non-breaking space holds the line until the stage reports its time, so the node does not shift. */}
      <div className="agent-node__ms ds-num">{data.ms !== undefined ? `${data.ms.toLocaleString('en-US')} ms` : ' '}</div>
      <div className="agent-node__desc">{data.description}</div>
      <div className="agent-node__status">
        <span className={view.dot} aria-hidden="true" />
        {view.word}
      </div>
    </div>
  )
}
