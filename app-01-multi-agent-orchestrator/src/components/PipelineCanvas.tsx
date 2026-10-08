import { useEffect, useRef } from 'react'
import {
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
}

function Canvas({ nodes, edges, onNodesChange, onEdgesChange }: PipelineCanvasProps) {
  const { fitView } = useReactFlow()
  const graphRef = useRef<HTMLDivElement>(null)

  // Refit on the observed resize, not a guessed delay, so the last node is never clipped.
  useEffect(() => {
    const el = graphRef.current
    if (!el) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.15, duration: 150 })
      })
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [fitView])

  return (
    <div ref={graphRef} className="pipeline-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        minZoom={0.4}
        maxZoom={1.2}
        aria-label="Pipeline: four stages in order"
      >
        <Controls showInteractive={false} showZoom={false} showFitView={true} />
      </ReactFlow>
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
