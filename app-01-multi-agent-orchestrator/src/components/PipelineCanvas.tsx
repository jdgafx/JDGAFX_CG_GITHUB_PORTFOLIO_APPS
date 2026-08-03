import { useEffect, useRef, type ReactNode } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react'
import { AgentNode } from './AgentNode'

const nodeTypes: NodeTypes = { agent: AgentNode as unknown as NodeTypes[string] }

interface PipelineCanvasProps {
  nodes: Node[]
  edges: Edge[]
  onNodesChange: OnNodesChange<Node>
  onEdgesChange: OnEdgesChange<Edge>
  /** Rendered below the graph so it reserves space instead of covering a node. */
  statusPanel?: ReactNode
}

function Canvas({ nodes, edges, onNodesChange, onEdgesChange, statusPanel }: PipelineCanvasProps) {
  const { fitView } = useReactFlow()
  const graphRef = useRef<HTMLDivElement>(null)

  // The status panel appearing and the mobile stacked layout both shrink the graph.
  // Refitting on the observed resize (rather than a guessed delay) is what keeps
  // the last node from being clipped off the bottom.
  useEffect(() => {
    const el = graphRef.current
    if (!el) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.2, duration: 150 })
      })
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fitView])

  return (
    <div className="canvas-pane">
      <div ref={graphRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          minZoom={0.4}
          maxZoom={1.5}
          aria-label="Agent pipeline graph"
        >
          <Background color="rgba(255,255,255,0.025)" gap={28} size={1} />
          <Controls showInteractive={false} showZoom={false} showFitView={true} />
        </ReactFlow>
      </div>
      {statusPanel}
    </div>
  )
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  )
}
