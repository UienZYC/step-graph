import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { HelpBadge, HelpBar, HelpLabel, HelpProvider, Tooltip } from './components/Tooltip'
import {
  TOOLTIP_TEXT,
  geometryTooltip,
  mappingValueTooltip,
  stepTypeTooltip,
  summaryTooltip,
  treeLabelTooltip,
} from './tooltips'
import './App.css'

type Entity = {
  id: string
  type: string
  args_raw?: string
  refs?: string[]
  raw?: string
  fields?: Record<string, unknown>
}

type SemanticEdge = {
  from: string
  to: string
  role?: string
  from_type?: string
  to_type?: string
}

type BasicEdge = {
  from: string
  to: string
  role?: string
  from_type?: string
  to_type?: string
}

type GeometryAttribute = Record<string, unknown> & {
  id?: string
  type?: string
}

type UnknownRecord = Record<string, unknown>

type SourceMetadata = {
  file?: string
  file_name?: string
  step_file?: string
  step_file_name?: string
  step_file_sha256?: string | null
  graph_file?: string | null
  graph_file_sha256?: string | null
  generator?: string
  generated_at?: string
}

type GraphData = {
  source?: string | SourceMetadata
  entities?: Record<string, Entity>
  edges?: BasicEdge[]
  semantic_edges?: SemanticEdge[]
  geometry_attributes?: Record<string, GeometryAttribute>
  brep_tree?: UnknownRecord
  face_adjacency_graph?: UnknownRecord
  summary?: Record<string, unknown>
}

type MeshFace = {
  step_id?: string | null
  face_index?: number
  kind?: string
  surface_type?: string
  vertices?: number[][]
  triangles?: number[][]
  normal?: number[]
  bbox?: MeshBbox
  mapping_source?: string | null
  mapping_method?: string | null
  mapping_confidence?: string | null
  mapping_evidence?: UnknownRecord
  surface?: {
    origin?: number[]
    axis_direction?: number[]
    ref_direction_ratios?: number[]
  }
}

type MeshEdge = {
  step_id?: string | null
  edge_index?: number
  kind?: string
  curve_type?: string
  points?: number[][]
  mapping_source?: string | null
  mapping_method?: string | null
  mapping_confidence?: string | null
  mapping_evidence?: UnknownRecord
}

type MeshVertex = {
  step_id?: string | null
  vertex_index?: number
  kind?: string
  position?: number[]
  mapping_source?: string | null
  mapping_method?: string | null
  mapping_confidence?: string | null
  mapping_evidence?: UnknownRecord
}

type ModelMeshData = {
  source?: SourceMetadata
  faces?: MeshFace[]
  edges?: MeshEdge[]
  vertices?: MeshVertex[]
}

type SourceConsistencyStatus = 'ok' | 'mismatch' | 'unknown'

type SourceConsistency = {
  status: SourceConsistencyStatus
  graphStepHash: string | null
  meshStepHash: string | null
  meshGraphHash: string | null
  message: string
}

type VisualElement = {
  stepId: string | null
  kind: VisualKind
  index?: number
  mappingSource: string
  mappingMethod: string
  mappingConfidence: string
  mappingEvidence?: UnknownRecord
  raw: MeshFace | MeshEdge | MeshVertex
}

type MeshBbox = {
  min?: number[]
  max?: number[]
}

type GraphFaceCandidate = {
  stepId: string
  surfaceType?: string
  origin?: [number, number, number]
  axisDirection?: [number, number, number]
  boundaryBbox?: Required<MeshBbox>
}

type VisualKind = 'face' | 'edge' | 'vertex'
type PickMode = 'auto' | VisualKind

type SelectableUserData = {
  stepId?: string | null
  kind?: VisualKind | string
  edgeIndex?: number
  faceIndex?: number
  vertexIndex?: number
  mappingSource?: string
  mappingMethod?: string
  mappingConfidence?: string
  edgeHighlight?: boolean
  edgeHover?: boolean
  edgePickTarget?: boolean
  normalColor?: number
  previewColor?: number
  selectedColor?: number
  normalOpacity?: number
  previewOpacity?: number
  selectedOpacity?: number
  normalScale?: number
  previewScale?: number
  selectedScale?: number
}

type VisualObjectMaps = Record<VisualKind, Map<string, THREE.Object3D[]>>
type VisualPickGroups = Record<VisualKind, THREE.Object3D[]>
type VisualStyleState = 'normal' | 'preview' | 'selected'
type VisualPickResult = {
  object: THREE.Object3D
  data: SelectableUserData
  distance: number
  debug: VisualPickDebug
}
type ResolvedVisualMapping = {
  stepId: string | null
  mappingSource: string
  mappingMethod: string
  mappingConfidence: string
}
type VisualPickDebug = {
  pickMode: PickMode
  transparentFaces: boolean
  faceHitsCount: number
  edgeHitsCount: number
  vertexHitsCount: number
  filteredEdgeHitsCount: number
  filteredVertexHitsCount: number
  nearestFaceDistance: number | null
  selectedKind: string | null
  selectedStepId: string | null
  selectedDistance: number | null
}

type EntitySelect = (id: string) => void
type EntityPreviewSelect = (id: string | null) => void

const refPattern = /^#\d+$/
const TreeSharedIdsContext = createContext<Set<string>>(new Set())

function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [modelMesh, setModelMesh] = useState<ModelMeshData | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [previewEntityId, setPreviewEntityId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [modelMeshLoading, setModelMeshLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modelMeshError, setModelMeshError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadGraph() {
      try {
        const response = await fetch('/graph.json')
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} while loading /graph.json`)
        }

        const text = await response.text()
        const parsed = JSON.parse(text) as GraphData

        if (cancelled) return

        setGraph(parsed)
        setSelectedEntityId(getDefaultEntityId(parsed))
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unknown graph load error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadGraph()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadModelMesh() {
      try {
        const response = await fetch('/model_mesh.json')
        if (!response.ok) {
          throw new Error('3D mesh not available. Please generate public/model_mesh.json first.')
        }

        const parsed = (await response.json()) as ModelMeshData
        if (!cancelled) {
          setModelMesh(parsed)
          setModelMeshError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setModelMesh(null)
          setModelMeshError(err instanceof Error ? err.message : '3D mesh not available.')
        }
      } finally {
        if (!cancelled) setModelMeshLoading(false)
      }
    }

    loadModelMesh()

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <HelpProvider>
        <div className="app app-state">
          <div className="panel state-panel">Loading graph.json...</div>
          <HelpBar />
        </div>
      </HelpProvider>
    )
  }

  if (error || !graph) {
    return (
      <HelpProvider>
        <div className="app app-state">
          <div className="panel state-panel">
            <h1 className="state-title">STEP Graph Viewer</h1>
            <p className="muted">Failed to load public/graph.json.</p>
            <pre className="raw-block">{error ?? 'No graph data returned.'}</pre>
          </div>
          <HelpBar />
        </div>
      </HelpProvider>
    )
  }

  return (
    <HelpProvider>
      <div className="app">
        <Header graph={graph} selectedEntityId={selectedEntityId} />
        <div className="layout">
          <aside className="sidebar">
            <SummaryPanel graph={graph} />
            <BrepTree
              graph={graph}
              selectedEntityId={selectedEntityId}
              setSelectedEntityId={setSelectedEntityId}
            />
          </aside>

          <main className="main-panel">
            <EntityDetail
              graph={graph}
              selectedEntityId={selectedEntityId}
              setSelectedEntityId={setSelectedEntityId}
              setPreviewEntityId={setPreviewEntityId}
            />
            <GeometryAttributesPanel
              graph={graph}
              selectedEntityId={selectedEntityId}
              setSelectedEntityId={setSelectedEntityId}
              setPreviewEntityId={setPreviewEntityId}
            />
            <MappingEvidencePanel
              graph={graph}
              selectedEntityId={selectedEntityId}
              modelMesh={modelMesh}
              setSelectedEntityId={setSelectedEntityId}
              setPreviewEntityId={setPreviewEntityId}
            />
            <RelationPanel
              graph={graph}
              selectedEntityId={selectedEntityId}
              setSelectedEntityId={setSelectedEntityId}
              setPreviewEntityId={setPreviewEntityId}
            />
            <RawStepPanel graph={graph} selectedEntityId={selectedEntityId} />
          </main>

          <aside className="right-panel">
            <ThreeDViewer
              graph={graph}
              modelMesh={modelMesh}
              modelMeshLoading={modelMeshLoading}
              modelMeshError={modelMeshError}
              selectedEntityId={selectedEntityId}
              previewEntityId={previewEntityId}
              setSelectedEntityId={setSelectedEntityId}
            />
          </aside>
        </div>
        <HelpBar />
      </div>
    </HelpProvider>
  )
}

function Header({ graph, selectedEntityId }: { graph: GraphData; selectedEntityId: string | null }) {
  const source = getSourceText(graph.source)
  const summary = graph.summary ?? {}
  const brepSummary = asRecord(graph.brep_tree?.summary)
  const adjacencySummary = asRecord(graph.face_adjacency_graph?.summary)

  return (
    <header className="header">
      <div>
        <h1 className="header-title">STEP Graph Viewer</h1>
        <div className="header-meta">
          <span>{source}</span>
          <HelpBadge label={`selected ${selectedEntityId ?? '-'}`} tooltip={TOOLTIP_TEXT.brep.selectedTreeNode} />
          <HelpBadge label={`entities ${formatStat(summary.entity_count)}`} tooltip={summaryTooltip('entities')} />
          <HelpBadge label={`faces ${formatStat(brepSummary.face_count)}`} tooltip={summaryTooltip('faces')} />
          <HelpBadge label={`edges ${formatStat(brepSummary.edge_curve_count)}`} tooltip={summaryTooltip('edges')} />
          <HelpBadge label={`vertices ${formatStat(brepSummary.vertex_point_count)}`} tooltip={summaryTooltip('vertices')} />
          <HelpBadge label={`adjacent ${formatStat(adjacencySummary.adjacency_count)}`} tooltip={summaryTooltip('adjacent')} />
        </div>
      </div>
    </header>
  )
}

function SummaryPanel({ graph }: { graph: GraphData }) {
  const [open, setOpen] = useState(false)
  const summary = graph.summary ?? {}
  const brepSummary = asRecord(graph.brep_tree?.summary)
  const adjacencySummary = asRecord(graph.face_adjacency_graph?.summary)
  const compactItems: Array<[string, unknown]> = [
    ['Entities', summary.entity_count],
    ['Faces', brepSummary.face_count],
    ['Edges', brepSummary.edge_curve_count],
    ['Vertices', brepSummary.vertex_point_count],
    ['Adjacent', adjacencySummary.adjacency_count],
  ]
  const items: Array<[string, unknown]> = [
    ['source', getSourceText(graph.source)],
    ['entity_count', summary.entity_count],
    ['type_count', summary.type_count],
    ['skipped_count', summary.skipped_count],
    ['semantic_edge_count', summary.semantic_edge_count],
    ['geometry_attribute_count', summary.geometry_attribute_count],
    ['solid_count', brepSummary.solid_count],
    ['shell_count', brepSummary.shell_count],
    ['face_count', brepSummary.face_count],
    ['edge_curve_count', brepSummary.edge_curve_count],
    ['vertex_point_count', brepSummary.vertex_point_count],
    ['adjacency_count', adjacencySummary.adjacency_count],
    ['boundary_edge_count', adjacencySummary.boundary_edge_count],
    ['non_manifold_edge_count', adjacencySummary.non_manifold_edge_count],
  ]

  return (
    <section className="panel summary-panel">
      <button
        type="button"
        className="panel-header-button"
        onClick={() => setOpen((value) => !value)}
      >
        Summary {open ? '▲' : '▼'}
      </button>
      <div className="panel-help">
        <HelpLabel label="Summary help" tooltip={TOOLTIP_TEXT.panels.summary} />
      </div>
      <div className="compact-summary">
        {compactItems.map(([label, value]) => (
          <HelpBadge
            key={label}
            label={`${label}: ${formatStat(value)}`}
            tooltip={summaryTooltip(label)}
          />
        ))}
      </div>
      {open ? (
        <dl className="summary-grid">
          {items.map(([label, value]) => (
            <div className="summary-row" key={label}>
              <dt><HelpLabel label={label} tooltip={summaryTooltip(label)} /></dt>
              <dd>{formatStat(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}

function BrepTree({
  graph,
  selectedEntityId,
  setSelectedEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const solids = asArray(graph.brep_tree?.solids)
  const treeRef = useRef<HTMLDivElement | null>(null)
  const treeMaps = useMemo(() => buildTreeMaps(solids), [solids])
  const [manualExpandedNodeIds, setManualExpandedNodeIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [manualCollapsedNodeIds, setManualCollapsedNodeIds] = useState<Set<string>>(
    () => new Set(),
  )
  const expandedNodeIds = useMemo(() => {
    const next = new Set([...treeMaps.initialExpandedIds, ...manualExpandedNodeIds])
    for (const id of manualCollapsedNodeIds) next.delete(id)
    if (selectedEntityId && treeMaps.allNodeIds.has(selectedEntityId)) {
      for (const ancestor of getAncestors(selectedEntityId, treeMaps.parentMap)) {
        next.add(ancestor)
      }
      next.add(selectedEntityId)
    }
    return next
  }, [manualCollapsedNodeIds, manualExpandedNodeIds, selectedEntityId, treeMaps])

  useEffect(() => {
    if (!selectedEntityId) return
    if (!treeMaps.allNodeIds.has(selectedEntityId)) return

    window.setTimeout(() => {
      const scrollContainer = treeRef.current
      const selectedElement = Array.from(
        scrollContainer?.querySelectorAll<HTMLElement>('[data-entity-id]') ?? [],
      ).find((element) => element.dataset.entityId === selectedEntityId)

      if (!scrollContainer || !selectedElement) return

      const containerRect = scrollContainer.getBoundingClientRect()
      const nodeRect = selectedElement.getBoundingClientRect()
      const offset = nodeRect.top - containerRect.top
      scrollContainer.scrollTop += offset - scrollContainer.clientHeight / 2 + nodeRect.height / 2
    }, 80)
  }, [selectedEntityId, treeMaps])

  function toggleNode(id: string) {
    const isExpanded = expandedNodeIds.has(id)
    if (isExpanded) {
      setManualCollapsedNodeIds((previous) => new Set(previous).add(id))
      setManualExpandedNodeIds((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    } else {
      setManualExpandedNodeIds((previous) => new Set(previous).add(id))
      setManualCollapsedNodeIds((previous) => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <section className="panel tree-panel">
      <h2 className="panel-title">
        <HelpLabel label="B-Rep Tree" tooltip={TOOLTIP_TEXT.panels.brepTree} />
      </h2>
      {!graph.brep_tree ? (
        <p className="muted">B-Rep tree not available.</p>
      ) : solids.length === 0 ? (
        <p className="muted">No solids found.</p>
      ) : (
        <TreeSharedIdsContext.Provider value={treeMaps.sharedNodeIds}>
          <div className="tree tree-scroll" ref={treeRef}>
            {solids.map((solid, index) => {
              const solidNode = asRecord(solid)

              return (
                <TreeNode
                  key={stringOrFallback(solidNode.id, `solid-${index}`)}
                  id={stringOrUnknown(solidNode.id)}
                  label={`Solid ${stringOrUnknown(solidNode.id)}`}
                  selectedEntityId={selectedEntityId}
                  setSelectedEntityId={setSelectedEntityId}
                  expandedNodeIds={expandedNodeIds}
                  onToggle={toggleNode}
                >
                  <ShellNode
                    shell={solidNode.outer_shell}
                    selectedEntityId={selectedEntityId}
                    setSelectedEntityId={setSelectedEntityId}
                    expandedNodeIds={expandedNodeIds}
                    onToggle={toggleNode}
                  />
                </TreeNode>
              )
            })}
          </div>
        </TreeSharedIdsContext.Provider>
      )}
    </section>
  )
}

function ShellNode({
  shell,
  selectedEntityId,
  setSelectedEntityId,
  expandedNodeIds,
  onToggle,
}: {
  shell: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  expandedNodeIds: Set<string>
  onToggle: (id: string) => void
}) {
  const shellNode = asRecord(shell)

  if (Object.keys(shellNode).length === 0) {
    return <div className="tree-note muted">Shell UNKNOWN</div>
  }

  const faces = asArray(shellNode.faces)

  return (
    <TreeNode
      id={stringOrUnknown(shellNode.id)}
      label={`Shell ${stringOrUnknown(shellNode.id)}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      expandedNodeIds={expandedNodeIds}
      onToggle={onToggle}
    >
      {faces.length === 0 ? (
        <div className="tree-note muted">No faces</div>
      ) : (
        faces.map((face, index) => (
          <FaceNode
            key={stringOrFallback(asRecord(face).id, `face-${index}`)}
            face={face}
            selectedEntityId={selectedEntityId}
            setSelectedEntityId={setSelectedEntityId}
            expandedNodeIds={expandedNodeIds}
            onToggle={onToggle}
          />
        ))
      )}
    </TreeNode>
  )
}

function FaceNode({
  face,
  selectedEntityId,
  setSelectedEntityId,
  expandedNodeIds,
  onToggle,
}: {
  face: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  expandedNodeIds: Set<string>
  onToggle: (id: string) => void
}) {
  const faceNode = asRecord(face)
  const surface = asRecord(faceNode.surface)
  const bounds = asArray(faceNode.bounds)
  const label = getFaceLabel(faceNode, surface)

  return (
    <TreeNode
      id={stringOrUnknown(faceNode.id)}
      label={label}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      expandedNodeIds={expandedNodeIds}
      onToggle={onToggle}
    >
      {bounds.length === 0 ? (
        <div className="tree-note muted">No bounds</div>
      ) : (
        bounds.map((bound, index) => (
          <BoundNode
            key={stringOrFallback(asRecord(bound).id, `bound-${index}`)}
            bound={bound}
            selectedEntityId={selectedEntityId}
            setSelectedEntityId={setSelectedEntityId}
            expandedNodeIds={expandedNodeIds}
            onToggle={onToggle}
          />
        ))
      )}
    </TreeNode>
  )
}

function BoundNode({
  bound,
  selectedEntityId,
  setSelectedEntityId,
  expandedNodeIds,
  onToggle,
}: {
  bound: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  expandedNodeIds: Set<string>
  onToggle: (id: string) => void
}) {
  const boundNode = asRecord(bound)
  const role = stringOrUnknown(boundNode.role)

  return (
    <TreeNode
      id={stringOrUnknown(boundNode.id)}
      label={`Bound ${stringOrUnknown(boundNode.id)} · ${role}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      expandedNodeIds={expandedNodeIds}
      onToggle={onToggle}
    >
      <LoopNode
        loop={boundNode.loop}
        selectedEntityId={selectedEntityId}
        setSelectedEntityId={setSelectedEntityId}
        expandedNodeIds={expandedNodeIds}
        onToggle={onToggle}
      />
    </TreeNode>
  )
}

function LoopNode({
  loop,
  selectedEntityId,
  setSelectedEntityId,
  expandedNodeIds,
  onToggle,
}: {
  loop: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  expandedNodeIds: Set<string>
  onToggle: (id: string) => void
}) {
  const loopNode = asRecord(loop)

  if (Object.keys(loopNode).length === 0) {
    return <div className="tree-note muted">Loop UNKNOWN</div>
  }

  const orientedEdges = asArray(loopNode.oriented_edges)

  return (
    <TreeNode
      id={stringOrUnknown(loopNode.id)}
      label={`Loop ${stringOrUnknown(loopNode.id)}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      expandedNodeIds={expandedNodeIds}
      onToggle={onToggle}
    >
      {orientedEdges.length === 0 ? (
        <div className="tree-note muted">No oriented edges</div>
      ) : (
        orientedEdges.map((orientedEdge, index) => (
          <OrientedEdgeNode
            key={stringOrFallback(asRecord(orientedEdge).id, `oriented-edge-${index}`)}
            orientedEdge={orientedEdge}
            selectedEntityId={selectedEntityId}
            setSelectedEntityId={setSelectedEntityId}
            expandedNodeIds={expandedNodeIds}
            onToggle={onToggle}
          />
        ))
      )}
    </TreeNode>
  )
}

function OrientedEdgeNode({
  orientedEdge,
  selectedEntityId,
  setSelectedEntityId,
  expandedNodeIds,
  onToggle,
}: {
  orientedEdge: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  expandedNodeIds: Set<string>
  onToggle: (id: string) => void
}) {
  const orientedEdgeNode = asRecord(orientedEdge)
  const edgeCurve = orientedEdgeNode.edge_curve ?? orientedEdgeNode.edge_element

  return (
    <TreeNode
      id={stringOrUnknown(orientedEdgeNode.id)}
      label={`OrientedEdge ${stringOrUnknown(orientedEdgeNode.id)}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      expandedNodeIds={expandedNodeIds}
      onToggle={onToggle}
    >
      {edgeCurve ? (
        <EdgeCurveNode
          edgeCurve={edgeCurve}
          selectedEntityId={selectedEntityId}
          setSelectedEntityId={setSelectedEntityId}
          expandedNodeIds={expandedNodeIds}
          onToggle={onToggle}
        />
      ) : (
        <div className="tree-note muted">EdgeCurve UNKNOWN</div>
      )}
    </TreeNode>
  )
}

function EdgeCurveNode({
  edgeCurve,
  selectedEntityId,
  setSelectedEntityId,
  expandedNodeIds,
  onToggle,
}: {
  edgeCurve: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  expandedNodeIds: Set<string>
  onToggle: (id: string) => void
}) {
  const edgeCurveNode = asRecord(edgeCurve)
  const geometry = asRecord(edgeCurveNode.geometry)
  const geometryType = stringOrUnknown(geometry.type)
  const start = asRecord(edgeCurveNode.start ?? edgeCurveNode.edge_start)
  const end = asRecord(edgeCurveNode.end ?? edgeCurveNode.edge_end)

  return (
    <TreeNode
      id={stringOrUnknown(edgeCurveNode.id)}
      label={`EdgeCurve ${stringOrUnknown(edgeCurveNode.id)} · ${geometryType}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      expandedNodeIds={expandedNodeIds}
      onToggle={onToggle}
    >
      {Object.keys(start).length > 0 ? (
        <TreeLeaf
          id={stringOrUnknown(start.id)}
          label={`Vertex ${stringOrUnknown(start.id)}`}
          selectedEntityId={selectedEntityId}
          setSelectedEntityId={setSelectedEntityId}
        />
      ) : null}
      {Object.keys(end).length > 0 ? (
        <TreeLeaf
          id={stringOrUnknown(end.id)}
          label={`Vertex ${stringOrUnknown(end.id)}`}
          selectedEntityId={selectedEntityId}
          setSelectedEntityId={setSelectedEntityId}
        />
      ) : null}
    </TreeNode>
  )
}

function TreeNode({
  id,
  label,
  selectedEntityId,
  setSelectedEntityId,
  expandedNodeIds,
  onToggle,
  children,
}: {
  id?: string
  label: string
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  expandedNodeIds: Set<string>
  onToggle: (id: string) => void
  children?: ReactNode
}) {
  const hasChildren = Boolean(children)
  const selectable = Boolean(id && id !== 'UNKNOWN')
  const selected = selectable && selectedEntityId === id
  const open = Boolean(id && expandedNodeIds.has(id))
  const sharedNodeIds = useContext(TreeSharedIdsContext)
  const shared = selectable && Boolean(id && sharedNodeIds.has(id))

  return (
    <div className="tree-node" data-entity-id={selectable ? id : undefined}>
      <div className="tree-node-row">
        <button
          type="button"
          className="tree-toggle"
          onClick={() => {
            if (id) onToggle(id)
          }}
          aria-label={open ? 'Collapse node' : 'Expand node'}
          disabled={!hasChildren}
        >
          {hasChildren ? (open ? '-' : '+') : ''}
        </button>
        <button
          type="button"
          className={`tree-node-label${selected ? ' tree-node-selected selected-tree-node' : ''}`}
          onClick={() => {
            if (selectable && id) setSelectedEntityId(id)
          }}
          disabled={!selectable}
        >
          <Tooltip text={treeLabelTooltip(label)}>
            <span>{label}</span>
          </Tooltip>
          {shared ? <SharedEntityBadge /> : null}
        </button>
      </div>
      {hasChildren && open ? <div className="tree-children">{children}</div> : null}
    </div>
  )
}

function TreeLeaf({
  id,
  label,
  selectedEntityId,
  setSelectedEntityId,
}: {
  id?: string
  label: string
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const selectable = Boolean(id && id !== 'UNKNOWN')
  const selected = selectable && selectedEntityId === id
  const sharedNodeIds = useContext(TreeSharedIdsContext)
  const shared = selectable && Boolean(id && sharedNodeIds.has(id))

  return (
    <div className="tree-node tree-leaf" data-entity-id={selectable ? id : undefined}>
      <button
        type="button"
        className={`tree-node-label${selected ? ' tree-node-selected selected-tree-node' : ''}`}
        onClick={() => {
          if (selectable && id) setSelectedEntityId(id)
        }}
        disabled={!selectable}
      >
        <Tooltip text={treeLabelTooltip(label)}>
          <span>{label}</span>
        </Tooltip>
        {shared ? <SharedEntityBadge /> : null}
      </button>
    </div>
  )
}

function SharedEntityBadge() {
  return (
    <span
      className="tree-shared-badge"
    >
      <Tooltip text={TOOLTIP_TEXT.brep.sharedInTree}>
        <span>(shared)</span>
      </Tooltip>
    </span>
  )
}

function DataConsistencyPanel({ consistency }: { consistency: SourceConsistency }) {
  const statusText = consistency.status === 'ok'
    ? 'Source consistency: OK'
    : consistency.status === 'mismatch'
      ? '⚠ Source mismatch detected.'
      : 'Source consistency: Unknown'

  return (
    <div className={`source-consistency source-consistency-${consistency.status}`}>
      <div className="source-consistency-title">
        <HelpLabel label={statusText} tooltip={TOOLTIP_TEXT.source.consistency} />
      </div>
      <div className="source-consistency-grid">
        <HelpLabel label={`Graph STEP hash: ${shortHash(consistency.graphStepHash)}`} tooltip={TOOLTIP_TEXT.source.hash} />
        <HelpLabel label={`Mesh STEP hash: ${shortHash(consistency.meshStepHash)}`} tooltip={TOOLTIP_TEXT.source.hash} />
        <HelpLabel label={`Mesh graph hash: ${shortHash(consistency.meshGraphHash)}`} tooltip={TOOLTIP_TEXT.source.hash} />
      </div>
      {consistency.status !== 'ok' ? (
        <div className="source-consistency-message">{consistency.message}</div>
      ) : null}
    </div>
  )
}

function buildTreeMaps(solids: unknown[]) {
  const parentMap = new Map<string, string>()
  const allNodeIds = new Set<string>()
  const initialExpandedIds: string[] = []
  const occurrenceCount = new Map<string, number>()

  function remember(id: unknown, parentId?: string, expanded = false) {
    if (typeof id !== 'string' || id.length === 0 || id === 'UNKNOWN') return
    allNodeIds.add(id)
    occurrenceCount.set(id, (occurrenceCount.get(id) ?? 0) + 1)
    if (parentId) parentMap.set(id, parentId)
    if (expanded) initialExpandedIds.push(id)
  }

  for (const solid of solids) {
    const solidNode = asRecord(solid)
    const solidId = stringOrFallback(solidNode.id, '')
    remember(solidId, undefined, true)

    const shellNode = asRecord(solidNode.outer_shell)
    const shellId = stringOrFallback(shellNode.id, '')
    remember(shellId, solidId, true)

    for (const face of asArray(shellNode.faces)) {
      const faceNode = asRecord(face)
      const faceId = stringOrFallback(faceNode.id, '')
      remember(faceId, shellId)

      for (const bound of asArray(faceNode.bounds)) {
        const boundNode = asRecord(bound)
        const boundId = stringOrFallback(boundNode.id, '')
        remember(boundId, faceId)

        const loopNode = asRecord(boundNode.loop)
        const loopId = stringOrFallback(loopNode.id, '')
        remember(loopId, boundId)

        for (const orientedEdge of asArray(loopNode.oriented_edges)) {
          const orientedEdgeNode = asRecord(orientedEdge)
          const orientedEdgeId = stringOrFallback(orientedEdgeNode.id, '')
          remember(orientedEdgeId, loopId)

          const edgeCurveNode = asRecord(
            orientedEdgeNode.edge_curve ?? orientedEdgeNode.edge_element,
          )
          const edgeCurveId = stringOrFallback(edgeCurveNode.id, '')
          remember(edgeCurveId, orientedEdgeId)

          const startNode = asRecord(edgeCurveNode.start ?? edgeCurveNode.edge_start)
          remember(stringOrFallback(startNode.id, ''), edgeCurveId)

          const endNode = asRecord(edgeCurveNode.end ?? edgeCurveNode.edge_end)
          remember(stringOrFallback(endNode.id, ''), edgeCurveId)
        }
      }
    }
  }

  const sharedNodeIds = new Set(
    Array.from(occurrenceCount)
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  )

  return { parentMap, allNodeIds, initialExpandedIds, occurrenceCount, sharedNodeIds }
}

function getAncestors(entityId: string, parentMap: Map<string, string>) {
  const ancestors: string[] = []
  let current = parentMap.get(entityId)
  while (current) {
    ancestors.push(current)
    current = parentMap.get(current)
  }
  return ancestors
}

function EntityDetail({
  graph,
  selectedEntityId,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}) {
  const [open, setOpen] = useState(true)
  const entity = selectedEntityId ? graph.entities?.[selectedEntityId] : undefined

  return (
    <section className="panel entity-detail collapsible-panel">
      <button
        type="button"
        className="panel-header-button"
        onClick={() => setOpen((value) => !value)}
      >
        Entity Detail {open ? '▲' : '▼'}
      </button>
      <div className="panel-help">
        <HelpLabel label="Entity Detail help" tooltip={TOOLTIP_TEXT.panels.entityDetail} />
      </div>
      {open ? (!selectedEntityId ? (
        <p className="muted">No entity selected.</p>
      ) : !entity ? (
        <p className="muted">Entity not found: {selectedEntityId}</p>
      ) : (
        <>
          <div className="entity-heading">
            <Tooltip text={TOOLTIP_TEXT.entity.id}>
              <span className="entity-id">{entity.id}</span>
            </Tooltip>
            <Tooltip text={stepTypeTooltip(entity.type) ?? TOOLTIP_TEXT.entity.type}>
              <span className="badge">{entity.type ?? 'UNKNOWN'}</span>
            </Tooltip>
          </div>

          <div className="detail-section">
            <div className="detail-label"><HelpLabel label="args_raw" tooltip={TOOLTIP_TEXT.entity.args_raw} /></div>
            <pre className="inline-raw">{entity.args_raw || '-'}</pre>
          </div>

          <div className="detail-section">
            <div className="detail-label"><HelpLabel label="refs" tooltip={TOOLTIP_TEXT.entity.refs} /></div>
            {Array.isArray(entity.refs) && entity.refs.length > 0 ? (
              <div className="button-list">
                {entity.refs.map((ref) => (
                  <EntityIdButton
                    key={ref}
                    id={ref}
                    graph={graph}
                    setSelectedEntityId={setSelectedEntityId}
                    setPreviewEntityId={setPreviewEntityId}
                  />
                ))}
              </div>
            ) : (
              <p className="muted">No refs.</p>
            )}
          </div>

          <div className="detail-section">
            <div className="detail-label"><HelpLabel label="fields" tooltip={TOOLTIP_TEXT.entity.fields} /></div>
            {entity.fields && Object.keys(entity.fields).length > 0 ? (
              <table className="field-table">
                <thead>
                  <tr>
                    <th><HelpLabel label="Field" tooltip={TOOLTIP_TEXT.entity.field} /></th>
                    <th><HelpLabel label="Value" tooltip={TOOLTIP_TEXT.entity.value} /></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(entity.fields).map(([field, value]) => (
                    <tr key={field}>
                      <td><HelpLabel label={field} tooltip={geometryTooltip(field)} /></td>
                      <td>
                        <ValueView
                          value={value}
                          graph={graph}
                          setSelectedEntityId={setSelectedEntityId}
                          setPreviewEntityId={setPreviewEntityId}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No fields.</p>
            )}
          </div>
        </>
      )) : null}
    </section>
  )
}

function GeometryAttributesPanel({
  graph,
  selectedEntityId,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}) {
  const [open, setOpen] = useState(true)
  const attr = selectedEntityId
    ? graph.geometry_attributes?.[selectedEntityId]
    : undefined

  return (
    <section className="panel geometry-panel collapsible-panel">
      <button
        type="button"
        className="panel-header-button"
        onClick={() => setOpen((value) => !value)}
      >
        Geometry Attributes {open ? '▲' : '▼'}
      </button>
      <div className="panel-help">
        <HelpLabel label="Geometry Attributes help" tooltip={TOOLTIP_TEXT.panels.geometryAttributes} />
      </div>
      {open ? (!selectedEntityId ? (
        <p className="muted">No entity selected.</p>
      ) : !graph.geometry_attributes ? (
        <p className="muted">Geometry attributes not available.</p>
      ) : !attr ? (
        <p className="muted">No geometry attributes for this entity.</p>
      ) : (
        <table className="field-table geometry-table">
          <thead>
            <tr>
              <th><HelpLabel label="Field" tooltip={TOOLTIP_TEXT.entity.field} /></th>
              <th><HelpLabel label="Value" tooltip={TOOLTIP_TEXT.entity.value} /></th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(attr).map(([field, value]) => (
              <tr key={field}>
                <td><HelpLabel label={field} tooltip={geometryTooltip(field)} /></td>
                <td className="geometry-value">
                  <ValueView
                    value={value}
                    graph={graph}
                    setSelectedEntityId={setSelectedEntityId}
                    setPreviewEntityId={setPreviewEntityId}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )) : null}
    </section>
  )
}

function MappingEvidencePanel({
  graph,
  selectedEntityId,
  modelMesh,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
  modelMesh: ModelMeshData | null
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}) {
  const [open, setOpen] = useState(true)
  const visualElements = useMemo(
    () => getVisualElementsForStepId(modelMesh, selectedEntityId),
    [modelMesh, selectedEntityId],
  )
  const visualElement = visualElements[0]
  const evidence = asRecord(visualElement?.mappingEvidence)

  return (
    <section className="panel mapping-evidence-panel collapsible-panel">
      <button
        type="button"
        className="panel-header-button"
        onClick={() => setOpen((value) => !value)}
      >
        Mapping Evidence {open ? '▲' : '▼'}
      </button>
      <div className="panel-help">
        <HelpLabel label="Mapping Evidence help" tooltip={TOOLTIP_TEXT.panels.mappingEvidence} />
      </div>
      {open ? (!selectedEntityId ? (
        <p className="muted">No entity selected.</p>
      ) : !modelMesh ? (
        <p className="muted">3D mapping data not available.</p>
      ) : !visualElement ? (
        <p className="muted">No visual mapping evidence for this entity.</p>
      ) : (
        <>
          <div className="mapping-evidence-grid">
            <MappingEvidenceRow
              label="Mapping source"
              value={<HelpLabel label={visualElement.mappingSource} tooltip={mappingValueTooltip(visualElement.mappingSource)} />}
            />
            <MappingEvidenceRow
              label="Mapping method"
              value={<HelpLabel label={visualElement.mappingMethod} tooltip={mappingValueTooltip(visualElement.mappingMethod)} />}
            />
            <MappingEvidenceRow
              label="Mapping confidence"
              value={<HelpLabel label={visualElement.mappingConfidence} tooltip={mappingValueTooltip(visualElement.mappingConfidence)} />}
            />
            <MappingEvidenceRow label="Step id" value={visualElement.stepId ?? '-'} />
            <MappingEvidenceRow label="Kind" value={<HelpLabel label={visualElement.kind} tooltip={TOOLTIP_TEXT.mapping.kind} />} />
            <MappingEvidenceRow label={indexLabelForVisualElement(visualElement)} value={visualElement.index ?? '-'} />
          </div>

          <MappingWarnings visualElement={visualElement} />

          {Object.keys(evidence).length > 0 ? (
            <div className="mapping-evidence-detail">
              <div className="detail-label">Evidence detail</div>
              <MappingIdList
                title="Boundary edges used"
                ids={stringArrayFromUnknown(evidence.boundary_edge_step_ids)}
                graph={graph}
                setSelectedEntityId={setSelectedEntityId}
                setPreviewEntityId={setPreviewEntityId}
              />
              <MappingIdList
                title="Matched STEP face edges"
                ids={stringArrayFromUnknown(evidence.matched_step_face_edge_ids)}
                graph={graph}
                setSelectedEntityId={setSelectedEntityId}
                setPreviewEntityId={setPreviewEntityId}
              />
              <MappingEvidenceRow
                label="Edge set Jaccard"
                value={formatNullableEvidenceValue(evidence.edge_set_jaccard)}
              />
              <MappingCandidateList
                candidates={asArray(evidence.candidate_step_faces)}
                graph={graph}
                setSelectedEntityId={setSelectedEntityId}
                setPreviewEntityId={setPreviewEntityId}
              />
              <MappingEvidenceRow
                label="Surface type match"
                value={formatNullableEvidenceValue(evidence.surface_type_match)}
              />
              <MappingEvidenceRow
                label="BBox similarity"
                value={formatNullableEvidenceValue(evidence.bbox_similarity, 'not used')}
              />
              <MappingEvidenceRow
                label="Reason"
                value={formatNullableEvidenceValue(evidence.reason)}
              />
            </div>
          ) : (
            <p className="muted">No detailed mapping_evidence for this visual element.</p>
          )}

          {visualElements.length > 1 ? (
            <p className="muted">Visual instances for this STEP id: {visualElements.length}</p>
          ) : null}
        </>
      )) : null}
    </section>
  )
}

function MappingEvidenceRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mapping-evidence-row">
      <span><HelpLabel label={label} tooltip={mappingEvidenceLabelTooltip(label)} /></span>
      <strong>{value}</strong>
    </div>
  )
}

function MappingWarnings({ visualElement }: { visualElement: VisualElement }) {
  if (visualElement.mappingSource === 'frontend_fallback') {
    return (
      <div className="mapping-warning">
        ⚠ Frontend fallback mapping
        <br />
        This mapping was inferred in the browser and is not backend-confirmed.
      </div>
    )
  }

  if (visualElement.mappingConfidence === 'ambiguous') {
    return (
      <div className="mapping-warning">
        Mapping is ambiguous. No backend-confirmed STEP id should be assumed unless explicitly assigned.
      </div>
    )
  }

  if (visualElement.mappingConfidence === 'unmapped') {
    return (
      <div className="mapping-warning">
        No STEP entity mapping is available for this visual element.
      </div>
    )
  }

  return null
}

function MappingIdList({
  title,
  ids,
  graph,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  title: string
  ids: string[]
  graph: GraphData
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}) {
  return (
    <div className="mapping-evidence-list">
      <div className="detail-label"><HelpLabel label={title} tooltip={mappingEvidenceLabelTooltip(title)} /></div>
      {ids.length > 0 ? (
        <div className="button-list">
          {ids.map((id) => (
            <EntityIdButton
              key={id}
              id={id}
              graph={graph}
              setSelectedEntityId={setSelectedEntityId}
              setPreviewEntityId={setPreviewEntityId}
            />
          ))}
        </div>
      ) : (
        <p className="muted">not available</p>
      )}
    </div>
  )
}

function MappingCandidateList({
  candidates,
  graph,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  candidates: unknown[]
  graph: GraphData
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}) {
  return (
    <div className="mapping-evidence-list">
      <div className="detail-label">
        <HelpLabel label="Candidate faces" tooltip={TOOLTIP_TEXT.evidence.candidate_step_faces} />
      </div>
      {candidates.length > 0 ? (
        <div className="mapping-candidate-list">
          {candidates.map((candidate, index) => {
            const record = asRecord(candidate)
            const stepId = typeof record.step_id === 'string' ? record.step_id : null
            return (
              <div className="mapping-candidate" key={`${stepId ?? 'candidate'}-${index}`}>
                {stepId ? (
                  <EntityIdButton
                    id={stepId}
                    graph={graph}
                    setSelectedEntityId={setSelectedEntityId}
                    setPreviewEntityId={setPreviewEntityId}
                  />
                ) : (
                  <span className="muted">unknown face</span>
                )}
                <HelpLabel label={`score=${formatNullableEvidenceValue(record.score)}`} tooltip={TOOLTIP_TEXT.evidence.score} />
                <HelpLabel label={formatNullableEvidenceValue(record.reason)} tooltip={TOOLTIP_TEXT.evidence.reason} />
              </div>
            )
          })}
        </div>
      ) : (
        <p className="muted">not available</p>
      )}
    </div>
  )
}

function ThreeDViewer({
  graph,
  modelMesh,
  modelMeshLoading,
  modelMeshError,
  selectedEntityId,
  previewEntityId,
  setSelectedEntityId,
}: {
  graph: GraphData
  modelMesh: ModelMeshData | null
  modelMeshLoading: boolean
  modelMeshError: string | null
  selectedEntityId: string | null
  previewEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const selectableObjectsRef = useRef<THREE.Object3D[]>([])
  const visualObjectMapsRef = useRef<VisualObjectMaps>(createVisualObjectMaps())
  const visualPickGroupsRef = useRef<VisualPickGroups>(createVisualPickGroups())
  const transparentFacesRef = useRef(false)
  const pickModeRef = useRef<PickMode>('auto')
  const graphEdgeStepIdsBySignature = useMemo(() => buildGraphEdgeSignatureMap(graph), [graph])
  const graphFaceCandidates = useMemo(() => buildGraphFaceCandidates(graph), [graph])
  const meshData = modelMesh
  const loading = modelMeshLoading
  const error = modelMeshError
  const [visualStepIds, setVisualStepIds] = useState<Set<string>>(new Set())
  const [transparentFaces, setTransparentFaces] = useState(false)
  const [pickMode, setPickMode] = useState<PickMode>('auto')
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null)
  const [hoveredKind, setHoveredKind] = useState<string | null>(null)
  const [hoveredUnmappedText, setHoveredUnmappedText] = useState<string | null>(null)
  const [lastPickedText, setLastPickedText] = useState<string | null>(null)
  const [viewerNotice, setViewerNotice] = useState<string | null>(null)
  const visualUserDataByStepId = useMemo(
    () => buildVisualUserDataByStepId(meshData, graphFaceCandidates, graphEdgeStepIdsBySignature),
    [graphEdgeStepIdsBySignature, graphFaceCandidates, meshData],
  )

  useEffect(() => {
    transparentFacesRef.current = transparentFaces
  }, [transparentFaces])

  useEffect(() => {
    pickModeRef.current = pickMode
  }, [pickMode])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !meshData) return undefined
    const viewerContainer = container

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf8fafc)

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000)
    camera.position.set(3, 3, 3)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.tabIndex = -1
    viewerContainer.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AxesHelper(1))
    scene.add(new THREE.AmbientLight(0xffffff, 0.72))

    const light = new THREE.DirectionalLight(0xffffff, 1.1)
    light.position.set(4, 5, 6)
    scene.add(light)

    const root = new THREE.Group()
    scene.add(root)

    const selectableObjects: THREE.Object3D[] = []
    const visualObjectMaps = createVisualObjectMaps()
    const visualPickGroups = createVisualPickGroups()
    const stepIds = new Set<string>()
    const modelSize = getModelSize(meshData)
    const vertexRadius = Math.max(modelSize * 0.016, 0.025)

    for (const face of meshData.faces ?? []) {
      const faceMapping = getResolvedFaceMapping(face, graphFaceCandidates)
      const mesh = createFaceMesh(face, faceMapping)
      if (!mesh) continue
      root.add(mesh)
      selectableObjects.push(mesh)
      visualPickGroups.face.push(mesh)
      registerVisualObject(visualObjectMaps, 'face', faceMapping.stepId, mesh)
      if (faceMapping.stepId) stepIds.add(faceMapping.stepId)
    }

    for (const edge of meshData.edges ?? []) {
      const edgeMapping = getResolvedEdgeMapping(edge, graphEdgeStepIdsBySignature)
      const line = createEdgeLine(edge, edgeMapping)
      if (!line) continue
      root.add(line)
      selectableObjects.push(line)
      visualPickGroups.edge.push(...getPickObjects(line, 'edge'))
      registerVisualObject(visualObjectMaps, 'edge', edgeMapping.stepId, line)
      if (edgeMapping.stepId) stepIds.add(edgeMapping.stepId)
    }

    for (const vertex of meshData.vertices ?? []) {
      const vertexMapping = getExplicitVisualMapping(vertex.step_id, vertex)
      const marker = createVertexMarker(vertex, vertexRadius, vertexMapping)
      if (!marker) continue
      root.add(marker)
      selectableObjects.push(marker)
      visualPickGroups.vertex.push(marker)
      registerVisualObject(visualObjectMaps, 'vertex', vertexMapping.stepId, marker)
      if (vertexMapping.stepId) stepIds.add(vertexMapping.stepId)
    }

    selectableObjectsRef.current = selectableObjects
    visualObjectMapsRef.current = visualObjectMaps
    visualPickGroupsRef.current = visualPickGroups
    setVisualStepIds(stepIds)
    fitCameraToObject(camera, controls, root)

    const raycaster = new THREE.Raycaster()
    raycaster.params.Line = { threshold: Math.max(modelSize * 0.0015, 1e-6) }
    const mouse = new THREE.Vector2()

    function resize() {
      const width = Math.max(viewerContainer.clientWidth, 1)
      const height = Math.max(viewerContainer.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    function handleClick(event: MouseEvent) {
      event.preventDefault()
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)

      const result = pickVisualObject(
        raycaster,
        visualPickGroups,
        pickModeRef.current,
        transparentFacesRef.current,
        modelSize,
      )
      const data = result?.data ?? null
      const stepId = getUserDataStepId(data)
      console.debug('3D pick', result?.debug ?? createEmptyPickDebug(pickModeRef.current, transparentFacesRef.current))

      if (stepId) {
        setViewerNotice(null)
        setLastPickedText(`${data?.kind ?? 'unknown'} ${stepId}`)
        setSelectedEntityId(stepId)
      } else if (data) {
        const kind = data?.kind ?? 'unknown'
        const index =
          data?.edgeIndex ?? data?.faceIndex ?? data?.vertexIndex
        setLastPickedText(`${kind} unmapped${typeof index === 'number' ? ` index=${index}` : ''}`)
        setViewerNotice(
          `Selected mesh element has no STEP id mapping. (${kind}${typeof index === 'number' ? `Index=${index}` : ''})`,
        )
      }
    }

    let lastHoverKey = ''
    function handlePointerMove(event: PointerEvent) {
      event.preventDefault()
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)

      const result = pickVisualObject(
        raycaster,
        visualPickGroups,
        pickModeRef.current,
        transparentFacesRef.current,
        modelSize,
      )
      const data = result?.data ?? null
      const stepId = getUserDataStepId(data)
      const hoverKey = stepId ?? `${data?.kind ?? 'none'}:${data?.edgeIndex ?? data?.faceIndex ?? data?.vertexIndex ?? 'none'}`
      if (hoverKey === lastHoverKey) return
      lastHoverKey = hoverKey

      setHoveredEntityId(stepId)
      setHoveredKind(typeof data?.kind === 'string' ? data.kind : null)
      if (!stepId && data) {
        const index = data.edgeIndex ?? data.faceIndex ?? data.vertexIndex
        setHoveredUnmappedText(
          `Preview mesh element has no STEP id mapping. (${data.kind ?? 'unknown'}${typeof index === 'number' ? `Index=${index}` : ''})`,
        )
      } else {
        setHoveredUnmappedText(null)
      }
    }

    function handlePointerLeave() {
      lastHoverKey = ''
      setHoveredEntityId(null)
      setHoveredKind(null)
      setHoveredUnmappedText(null)
    }

    function preventViewerDefault(event: Event) {
      event.preventDefault()
    }

    renderer.domElement.addEventListener('pointerdown', preventViewerDefault)
    renderer.domElement.addEventListener('mousedown', preventViewerDefault)
    renderer.domElement.addEventListener('wheel', preventViewerDefault, { passive: false })
    renderer.domElement.addEventListener('click', handleClick)
    renderer.domElement.addEventListener('pointermove', handlePointerMove)
    renderer.domElement.addEventListener('pointerleave', handlePointerLeave)

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(viewerContainer)
    resize()

    let animationFrame = 0
    function animate() {
      controls.update()
      renderer.render(scene, camera)
      animationFrame = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', preventViewerDefault)
      renderer.domElement.removeEventListener('mousedown', preventViewerDefault)
      renderer.domElement.removeEventListener('wheel', preventViewerDefault)
      renderer.domElement.removeEventListener('click', handleClick)
      renderer.domElement.removeEventListener('pointermove', handlePointerMove)
      renderer.domElement.removeEventListener('pointerleave', handlePointerLeave)
      controls.dispose()
      selectableObjectsRef.current = []
      visualObjectMapsRef.current = createVisualObjectMaps()
      visualPickGroupsRef.current = createVisualPickGroups()
      setVisualStepIds(new Set())
      disposeObject(scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [graphEdgeStepIdsBySignature, graphFaceCandidates, meshData, setSelectedEntityId])

  useEffect(() => {
    updateVisualStyles(
      selectableObjectsRef.current,
      visualObjectMapsRef.current,
      selectedEntityId,
      hoveredEntityId ?? previewEntityId,
      transparentFaces,
    )
  }, [hoveredEntityId, previewEntityId, selectedEntityId, transparentFaces])

  const faceCount = meshData?.faces?.length ?? 0
  const edgeCount = meshData?.edges?.length ?? 0
  const vertexCount = meshData?.vertices?.length ?? 0
  const sourceConsistency = getSourceConsistency(graph.source, meshData?.source)
  const hasSelectedVisual = Boolean(selectedEntityId && visualStepIds.has(selectedEntityId))
  const previewVisualId = hoveredEntityId ?? previewEntityId
  const hasPreviewVisual = Boolean(previewVisualId && visualStepIds.has(previewVisualId))
  const selectedVisualData = selectedEntityId
    ? visualUserDataByStepId.get(selectedEntityId) ?? null
    : null
  const selectedMappingSource = selectedVisualData?.mappingSource ?? (hasSelectedVisual ? 'unknown' : '-')
  const selectedMappingMethod = selectedVisualData?.mappingMethod ?? (hasSelectedVisual ? 'unknown' : '-')
  const selectedMappingConfidence = selectedVisualData?.mappingConfidence ?? (hasSelectedVisual ? 'unknown' : '-')

  return (
    <section className="panel viewer-panel">
      <div className="viewer-header">
        <h2 className="panel-title">
          <HelpLabel label="3D Model" tooltip={TOOLTIP_TEXT.panels.viewer} />
        </h2>
        <div className="viewer-status">
          <HelpBadge label={`Faces: ${faceCount}`} tooltip={summaryTooltip('faces')} />
          <HelpBadge label={`Edges: ${edgeCount}`} tooltip={summaryTooltip('edges')} />
          <HelpBadge label={`Vertices: ${vertexCount}`} tooltip={summaryTooltip('vertices')} />
        </div>
      </div>
      <div className="viewer-toolbar">
        <label className="viewer-toggle">
          <HelpLabel label="Pick mode:" tooltip={TOOLTIP_TEXT.viewer.pickMode} />
          <select
            className="viewer-select"
            value={pickMode}
            onChange={(event) => {
              setPickMode(event.currentTarget.value as PickMode)
              setHoveredEntityId(null)
              setHoveredKind(null)
              setHoveredUnmappedText(null)
            }}
          >
            <option value="auto">Auto</option>
            <option value="face">Face</option>
            <option value="edge">Edge</option>
            <option value="vertex">Vertex</option>
          </select>
        </label>
        <label className="viewer-toggle">
          <input
            type="checkbox"
            checked={transparentFaces}
            onChange={(event) => setTransparentFaces(event.currentTarget.checked)}
          />
          <HelpLabel label="Transparent faces" tooltip={TOOLTIP_TEXT.viewer.transparentFaces} />
        </label>
        <HelpBadge
          label={`Display: ${transparentFaces ? 'Transparent' : 'Opaque'}`}
          tooltip={transparentFaces ? TOOLTIP_TEXT.viewer.transparentFaces : TOOLTIP_TEXT.viewer.opaque}
        />
        <HelpBadge label={`Pick mode: ${formatPickMode(pickMode)}`} tooltip={pickModeTooltip(pickMode)} />
      </div>
      {!loading && !error ? (
        <DataConsistencyPanel consistency={sourceConsistency} />
      ) : null}

      {loading ? <p className="muted">Loading model_mesh.json...</p> : null}
      {!loading && error ? (
        <div className="viewer-error">
          3D mesh not available.
          <br />
          Please generate public/model_mesh.json first.
        </div>
      ) : null}
      {!loading && !error ? (
        <>
          <div className="viewer-canvas-container" ref={containerRef} />
          <div className="viewer-status viewer-selection">
            <HelpLabel
              label={
                hasSelectedVisual
                  ? `Selected visual: ${selectedEntityId}`
                  : 'No visual object for selected entity'
              }
              tooltip={hasSelectedVisual ? TOOLTIP_TEXT.viewer.selectedVisual : TOOLTIP_TEXT.viewer.noVisualObject}
            />
            <HelpLabel label={`Kind: ${selectedVisualData?.kind ?? '-'}`} tooltip={TOOLTIP_TEXT.mapping.kind} />
            <HelpLabel label={`Mapping source: ${selectedMappingSource}`} tooltip={TOOLTIP_TEXT.mapping.source} />
            <HelpLabel label={`Mapping method: ${selectedMappingMethod}`} tooltip={TOOLTIP_TEXT.mapping.method} />
            <HelpLabel label={`Mapping confidence: ${selectedMappingConfidence}`} tooltip={TOOLTIP_TEXT.mapping.confidence} />
            <HelpLabel
              label={
                hasPreviewVisual
                  ? `Preview visual: ${previewVisualId}${hoveredKind ? ` (${hoveredKind})` : ''}`
                  : 'Preview visual: none'
              }
              tooltip={TOOLTIP_TEXT.viewer.previewVisual}
            />
            <HelpLabel label={`Last picked: ${lastPickedText ?? 'none'}`} tooltip={TOOLTIP_TEXT.viewer.lastPicked} />
            {pickMode !== 'auto' ? (
              <HelpLabel label={`${formatPickMode(pickMode)}-only selection enabled.`} tooltip={pickModeTooltip(pickMode)} />
            ) : null}
            {selectedMappingSource === 'frontend_fallback' ? (
              <span className="viewer-warning viewer-warning-block">
                ⚠ Frontend fallback mapping. This mapping was inferred in the browser and is not backend-confirmed.
              </span>
            ) : null}
            {hoveredUnmappedText ? <span className="viewer-warning">{hoveredUnmappedText}</span> : null}
            {viewerNotice ? <span className="viewer-warning">{viewerNotice}</span> : null}
          </div>
        </>
      ) : null}
    </section>
  )
}

function RelationPanel({
  graph,
  selectedEntityId,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}) {
  const [open, setOpen] = useState(true)
  const entity = selectedEntityId ? graph.entities?.[selectedEntityId] : undefined
  const outgoing = useOutgoingRelations(graph, selectedEntityId)
  const incoming = useIncomingRelations(graph, selectedEntityId)
  const faceNeighbors = getFaceNeighbors(graph, selectedEntityId)
  const showFaceNeighbors = entity?.type === 'ADVANCED_FACE' && graph.face_adjacency_graph

  return (
    <section className="panel collapsible-panel">
      <button
        type="button"
        className="panel-header-button"
        onClick={() => setOpen((value) => !value)}
      >
        Relations {open ? '▲' : '▼'}
      </button>
      <div className="panel-help">
        <HelpLabel label="Relations help" tooltip={TOOLTIP_TEXT.panels.relations} />
      </div>
      {open ? (!selectedEntityId ? (
        <p className="muted">No entity selected.</p>
      ) : (
        <>
          <RelationSection title="References">
            {outgoing.length > 0 ? (
              outgoing.map((relation, index) => (
                <div className="relation-item" key={`${relation.to}-${relation.role}-${index}`}>
                  <Tooltip text={TOOLTIP_TEXT.relation.role}>
                    <span className="relation-role">{relation.role ?? 'ref'}</span>
                  </Tooltip>
                  <span>→</span>
                  <EntityIdButton
                    id={relation.to}
                    graph={graph}
                    setSelectedEntityId={setSelectedEntityId}
                    setPreviewEntityId={setPreviewEntityId}
                  />
                  <span className="muted">{relation.to_type ?? getEntityType(graph, relation.to)}</span>
                </div>
              ))
            ) : (
              <p className="muted">No references.</p>
            )}
          </RelationSection>

          <RelationSection title="Referenced By">
            {incoming.length > 0 ? (
              incoming.map((relation, index) => (
                <div className="relation-item" key={`${relation.from}-${relation.role}-${index}`}>
                  <EntityIdButton
                    id={relation.from}
                    graph={graph}
                    setSelectedEntityId={setSelectedEntityId}
                    setPreviewEntityId={setPreviewEntityId}
                  />
                  <span className="muted">{relation.from_type ?? getEntityType(graph, relation.from)}</span>
                  <span className="relation-arrow">--{relation.role ?? 'ref'}--&gt;</span>
                  <span>{selectedEntityId}</span>
                </div>
              ))
            ) : (
              <p className="muted">No incoming references.</p>
            )}
          </RelationSection>

          {showFaceNeighbors ? (
            <RelationSection title="Face Neighbors">
              {faceNeighbors.length > 0 ? (
                faceNeighbors.map((neighbor, index) => {
                  const neighborNode = asRecord(neighbor)

                  return (
                    <div
                      className="relation-item relation-stack"
                      key={`${String(neighborNode.face)}-${index}`}
                    >
                    <div>
                      face{' '}
                      <EntityIdButton
                        id={String(neighborNode.face ?? 'UNKNOWN')}
                        graph={graph}
                        setSelectedEntityId={setSelectedEntityId}
                        setPreviewEntityId={setPreviewEntityId}
                      />
                    </div>
                    <div>
                      <HelpLabel label="shared_edge_curve" tooltip={TOOLTIP_TEXT.relation.sharedEdge} />{' '}
                      <EntityIdButton
                        id={String(neighborNode.shared_edge_curve ?? 'UNKNOWN')}
                        graph={graph}
                        setSelectedEntityId={setSelectedEntityId}
                        setPreviewEntityId={setPreviewEntityId}
                      />
                    </div>
                    <div className="muted">
                      oriented_edge {String(neighborNode.oriented_edge ?? '-')} · orientation{' '}
                      {String(neighborNode.orientation ?? '-')}
                    </div>
                    </div>
                  )
                })
              ) : (
                <p className="muted">No face neighbors.</p>
              )}
            </RelationSection>
          ) : null}
        </>
      )) : null}
    </section>
  )
}

function RelationSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="relation-section">
      <h3><HelpLabel label={title} tooltip={relationSectionTooltip(title)} /></h3>
      {children}
    </div>
  )
}

function RawStepPanel({
  graph,
  selectedEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
}) {
  const [open, setOpen] = useState(false)
  const entity = selectedEntityId ? graph.entities?.[selectedEntityId] : undefined

  return (
    <section className={`panel raw-panel collapsible-panel${open ? '' : ' raw-collapsed'}`}>
      <button
        type="button"
        className="panel-header-button"
        onClick={() => setOpen((value) => !value)}
      >
        Raw STEP {open ? '▲' : '▼'}
      </button>
      {open ? (
        <>
          <div className="detail-label"><HelpLabel label="Raw STEP" tooltip={TOOLTIP_TEXT.panels.rawStep} /></div>
          <pre className="raw-block">{entity?.raw || 'No raw STEP text.'}</pre>
        </>
      ) : null}
    </section>
  )
}

function ValueView({
  value,
  graph,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  value: unknown
  graph: GraphData
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}): ReactNode {
  if (typeof value === 'string') {
    return isReference(value) ? (
      <EntityIdButton
        id={value}
        graph={graph}
        setSelectedEntityId={setSelectedEntityId}
        setPreviewEntityId={setPreviewEntityId}
      />
    ) : (
      <span>{value}</span>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">[]</span>

    if (isNumericArray(value)) {
      return <code className="numeric-vector">[{value.map(formatNumber).join(', ')}]</code>
    }

    return (
      <div className="value-list">
        {value.map((item, index) => (
          <span className="value-chip" key={`${String(item)}-${index}`}>
            <ValueView
              value={item}
              graph={graph}
              setSelectedEntityId={setSelectedEntityId}
              setPreviewEntityId={setPreviewEntityId}
            />
          </span>
        ))}
      </div>
    )
  }

  if (value && typeof value === 'object') {
    return <pre className="value-code">{safeStringify(value, 2)}</pre>
  }

  if (value === null || value === undefined) {
    return <span className="muted">-</span>
  }

  return <span>{String(value)}</span>
}

function EntityIdButton({
  id,
  graph,
  setSelectedEntityId,
  setPreviewEntityId,
}: {
  id: string
  graph: GraphData
  setSelectedEntityId: EntitySelect
  setPreviewEntityId: EntityPreviewSelect
}) {
  const exists = Boolean(graph.entities?.[id])

  return (
    <Tooltip text={exists ? TOOLTIP_TEXT.entity.referenceButton : `${id} not found in entities.`}>
      <button
        type="button"
        className={`entity-id-button${exists ? '' : ' entity-id-button-missing'}`}
        onClick={() => setSelectedEntityId(id)}
        onFocus={() => setPreviewEntityId(id)}
        onBlur={() => setPreviewEntityId(null)}
        onMouseEnter={() => setPreviewEntityId(id)}
        onMouseLeave={() => setPreviewEntityId(null)}
      >
        {id}
      </button>
    </Tooltip>
  )
}

function buildVisualUserDataByStepId(
  meshData: ModelMeshData | null,
  graphFaceCandidates: GraphFaceCandidate[],
  graphEdgeStepIdsBySignature: Map<string, string>,
): Map<string, SelectableUserData> {
  const userDataByStepId = new Map<string, SelectableUserData>()
  if (!meshData) return userDataByStepId

  for (const face of meshData.faces ?? []) {
    const mapping = getResolvedFaceMapping(face, graphFaceCandidates)
    registerVisualUserData(userDataByStepId, mapping, {
      kind: 'face',
      faceIndex: face.face_index,
    })
  }

  for (const edge of meshData.edges ?? []) {
    const mapping = getResolvedEdgeMapping(edge, graphEdgeStepIdsBySignature)
    registerVisualUserData(userDataByStepId, mapping, {
      kind: 'edge',
      edgeIndex: edge.edge_index,
    })
  }

  for (const vertex of meshData.vertices ?? []) {
    const mapping = getExplicitVisualMapping(vertex.step_id, vertex)
    registerVisualUserData(userDataByStepId, mapping, {
      kind: 'vertex',
      vertexIndex: vertex.vertex_index,
    })
  }

  return userDataByStepId
}

function getVisualElementsForStepId(
  modelMesh: ModelMeshData | null,
  selectedEntityId: string | null,
): VisualElement[] {
  if (!modelMesh || !selectedEntityId) return []
  const elements: VisualElement[] = []

  for (const face of modelMesh.faces ?? []) {
    if (face.step_id === selectedEntityId) {
      elements.push(createVisualElement('face', face, face.face_index))
    }
  }

  for (const edge of modelMesh.edges ?? []) {
    if (edge.step_id === selectedEntityId) {
      elements.push(createVisualElement('edge', edge, edge.edge_index))
    }
  }

  for (const vertex of modelMesh.vertices ?? []) {
    if (vertex.step_id === selectedEntityId) {
      elements.push(createVisualElement('vertex', vertex, vertex.vertex_index))
    }
  }

  return elements
}

function createVisualElement(
  kind: VisualKind,
  raw: MeshFace | MeshEdge | MeshVertex,
  index?: number,
): VisualElement {
  return {
    stepId: raw.step_id ?? null,
    kind,
    index,
    mappingSource: getMappingText(raw.mapping_source, raw.step_id ? 'unknown' : 'none'),
    mappingMethod: getMappingText(raw.mapping_method, raw.step_id ? 'unknown' : 'unmapped'),
    mappingConfidence: getMappingText(raw.mapping_confidence, raw.step_id ? 'unknown' : 'unmapped'),
    mappingEvidence: raw.mapping_evidence,
    raw,
  }
}

function indexLabelForVisualElement(visualElement: VisualElement): string {
  if (visualElement.kind === 'face') return 'Face index'
  if (visualElement.kind === 'edge') return 'Edge index'
  return 'Vertex index'
}

function stringArrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function formatNullableEvidenceValue(value: unknown, nullText = 'not available'): string {
  if (value === null || value === undefined || value === '') return nullText
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value
  return safeStringify(value, 0)
}

function registerVisualUserData(
  userDataByStepId: Map<string, SelectableUserData>,
  mapping: ResolvedVisualMapping,
  data: Pick<SelectableUserData, 'kind' | 'faceIndex' | 'edgeIndex' | 'vertexIndex'>,
) {
  if (!mapping.stepId || userDataByStepId.has(mapping.stepId)) return
  userDataByStepId.set(mapping.stepId, {
    ...data,
    stepId: mapping.stepId,
    mappingSource: mapping.mappingSource,
    mappingMethod: mapping.mappingMethod,
    mappingConfidence: mapping.mappingConfidence,
  })
}

function createFaceMesh(face: MeshFace, mapping: ResolvedVisualMapping): THREE.Mesh | null {
  if (!Array.isArray(face.vertices) || !Array.isArray(face.triangles)) {
    return null
  }

  const vertices = face.vertices
    .filter(isVector3)
    .map(([x, y, z]) => [x, y, z] satisfies [number, number, number])
  const triangles = face.triangles.filter(isTriangle)
  if (vertices.length < 3 || triangles.length === 0) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3))
  geometry.setIndex(triangles.flat())

  if (isVector3(face.normal)) {
    const normals = vertices.flatMap(() => face.normal ?? [0, 0, 1])
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  } else {
    geometry.computeVertexNormals()
  }

  const material = new THREE.MeshPhongMaterial({
    color: 0x9db2c8,
    opacity: 1,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    shininess: 26,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData = {
    stepId: mapping.stepId,
    kind: 'face' satisfies VisualKind,
    faceIndex: face.face_index,
    mappingSource: mapping.mappingSource,
    mappingMethod: mapping.mappingMethod,
    mappingConfidence: mapping.mappingConfidence,
    normalColor: 0x9db2c8,
    previewColor: 0x38bdf8,
    selectedColor: 0xffb020,
    normalOpacity: 1,
    previewOpacity: 1,
    selectedOpacity: 1,
  }
  return mesh
}

function createEdgeLine(edge: MeshEdge, mapping: ResolvedVisualMapping): THREE.Object3D | null {
  if (!Array.isArray(edge.points)) return null

  const points = edge.points.filter(isVector3)
  if (points.length < 2) return null

  const baseGeometry = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  )
  const baseMaterial = new THREE.LineBasicMaterial({
    color: 0x334155,
    linewidth: 1,
  })
  const highlightMaterial = new THREE.LineBasicMaterial({
    color: 0xff3b00,
    linewidth: 1,
    depthTest: false,
  })
  const hoverMaterial = new THREE.LineBasicMaterial({
    color: 0x06b6d4,
    linewidth: 1,
    depthTest: false,
  })
  const line = new THREE.Line(baseGeometry, baseMaterial)
  const highlight = new THREE.Line(baseGeometry.clone(), highlightMaterial)
  const hover = new THREE.Line(baseGeometry.clone(), hoverMaterial)
  highlight.visible = false
  highlight.renderOrder = 5
  hover.visible = false
  hover.renderOrder = 4

  const group = new THREE.Group()
  const edgeUserData: SelectableUserData = {
    stepId: mapping.stepId,
    kind: 'edge' satisfies VisualKind,
    edgeIndex: edge.edge_index,
    mappingSource: mapping.mappingSource,
    mappingMethod: mapping.mappingMethod,
    mappingConfidence: mapping.mappingConfidence,
    normalColor: 0x334155,
    previewColor: 0x06b6d4,
    selectedColor: 0xef4444,
  }
  group.userData = edgeUserData
  line.userData = { ...edgeUserData, edgePickTarget: true }
  highlight.userData = { ...edgeUserData, edgeHighlight: true }
  hover.userData = { ...edgeUserData, edgeHover: true }
  group.add(line, hover, highlight)
  return group
}

function createVertexMarker(
  vertex: MeshVertex,
  radius: number,
  mapping: ResolvedVisualMapping,
): THREE.Mesh | null {
  if (!isVector3(vertex.position)) return null

  const geometry = new THREE.SphereGeometry(radius, 16, 12)
  const material = new THREE.MeshPhongMaterial({ color: 0x1d4ed8 })
  const marker = new THREE.Mesh(geometry, material)
  marker.position.set(vertex.position[0], vertex.position[1], vertex.position[2])
  marker.userData = {
    stepId: mapping.stepId,
    kind: 'vertex' satisfies VisualKind,
    vertexIndex: vertex.vertex_index,
    mappingSource: mapping.mappingSource,
    mappingMethod: mapping.mappingMethod,
    mappingConfidence: mapping.mappingConfidence,
    normalColor: 0x1d4ed8,
    previewColor: 0x06b6d4,
    selectedColor: 0xff4d00,
    normalScale: 1,
    previewScale: 1.35,
    selectedScale: 1.7,
  }
  return marker
}

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
) {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) {
    camera.position.set(3, 3, 3)
    controls.target.set(0, 0, 0)
    controls.update()
    return
  }

  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const fov = THREE.MathUtils.degToRad(camera.fov)
  const distance = (maxDim / (2 * Math.tan(fov / 2))) * 1.8
  const direction = new THREE.Vector3(1, 0.85, 0.75).normalize()

  camera.near = Math.max(distance / 1000, 0.001)
  camera.far = distance * 1000
  camera.position.copy(center).add(direction.multiplyScalar(distance))
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
}

function getModelSize(meshData: ModelMeshData): number {
  const box = new THREE.Box3()
  let hasPoint = false

  for (const face of meshData.faces ?? []) {
    for (const vertex of face.vertices ?? []) {
      if (!isVector3(vertex)) continue
      box.expandByPoint(new THREE.Vector3(vertex[0], vertex[1], vertex[2]))
      hasPoint = true
    }
  }

  for (const edge of meshData.edges ?? []) {
    for (const point of edge.points ?? []) {
      if (!isVector3(point)) continue
      box.expandByPoint(new THREE.Vector3(point[0], point[1], point[2]))
      hasPoint = true
    }
  }

  for (const vertex of meshData.vertices ?? []) {
    if (!isVector3(vertex.position)) continue
    box.expandByPoint(new THREE.Vector3(vertex.position[0], vertex.position[1], vertex.position[2]))
    hasPoint = true
  }

  if (!hasPoint) return 1
  const size = box.getSize(new THREE.Vector3())
  return Math.max(size.x, size.y, size.z, 1)
}

function buildGraphFaceCandidates(graph: GraphData): GraphFaceCandidate[] {
  const faceNodes = collectBrepFaceNodes(graph.brep_tree)
  return faceNodes
    .map((faceNode) => buildGraphFaceCandidate(faceNode, graph))
    .filter((candidate): candidate is GraphFaceCandidate => candidate !== null)
}

function collectBrepFaceNodes(value: unknown): UnknownRecord[] {
  const nodes: UnknownRecord[] = []

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }

    const record = asRecord(node)
    if (Object.keys(record).length === 0) return

    if (record.type === 'ADVANCED_FACE' && typeof record.id === 'string') {
      nodes.push(record)
      return
    }

    Object.values(record).forEach(visit)
  }

  visit(value)
  return nodes
}

function buildGraphFaceCandidate(
  faceNode: UnknownRecord,
  graph: GraphData,
): GraphFaceCandidate | null {
  const stepId = typeof faceNode.id === 'string' ? faceNode.id : null
  if (!stepId) return null

  const attr = graph.geometry_attributes?.[stepId]
  const surface = asRecord(attr?.surface ?? faceNode.surface)
  const boundaryPoints = collectFaceBoundaryPoints(faceNode, graph)
  const boundaryBbox = bboxFromPoints(boundaryPoints)

  return {
    stepId,
    surfaceType: optionalString(attr?.surface_type ?? asRecord(faceNode.surface).type),
    origin: vector3OrUndefined(surface.origin),
    axisDirection: vector3OrUndefined(surface.axis_direction),
    boundaryBbox: boundaryBbox ?? undefined,
  }
}

function collectFaceBoundaryPoints(faceNode: UnknownRecord, graph: GraphData): Array<[number, number, number]> {
  const edgeIds = new Set<string>()

  function visit(node: unknown) {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }

    const record = asRecord(node)
    if (Object.keys(record).length === 0) return

    if (record.type === 'EDGE_CURVE' && typeof record.id === 'string') {
      edgeIds.add(record.id)
      return
    }

    Object.values(record).forEach(visit)
  }

  visit(faceNode.bounds)

  const points: Array<[number, number, number]> = []
  for (const edgeId of edgeIds) {
    const edgeAttr = graph.geometry_attributes?.[edgeId]
    if (!edgeAttr) continue
    const start = vector3OrUndefined(edgeAttr.edge_start_coordinates)
    const end = vector3OrUndefined(edgeAttr.edge_end_coordinates)
    if (start) points.push(start)
    if (end) points.push(end)
  }

  return points
}

function getResolvedFaceMapping(
  face: MeshFace,
  graphFaceCandidates: GraphFaceCandidate[],
): ResolvedVisualMapping {
  const explicitStepId = normalizeStepId(face.step_id)
  if (explicitStepId) return getExplicitVisualMapping(explicitStepId, face)

  const meshBbox = bboxFromValue(face.bbox) ?? bboxFromPoints(
    (face.vertices ?? []).filter(isVector3),
  )
  if (!meshBbox) return getUnmappedVisualMapping(face)

  const surfaceType = typeof face.surface_type === 'string' ? face.surface_type : undefined
  const origin = vector3OrUndefined(face.surface?.origin)
  const axisDirection = vector3OrUndefined(face.surface?.axis_direction)
  const tolerance = Math.max(bboxSize(meshBbox) * 0.002, 1e-5)

  const matches = graphFaceCandidates
    .map((candidate) => ({
      candidate,
      score: scoreFaceCandidate(candidate, meshBbox, surfaceType, origin, axisDirection, tolerance),
    }))
    .filter((entry) => entry.score !== null)
    .sort((first, second) => (first.score ?? 0) - (second.score ?? 0))

  if (matches.length === 0) return getUnmappedVisualMapping(face)
  const best = matches[0]
  const second = matches[1]
  if (best.score === null) return getUnmappedVisualMapping(face)
  if (second?.score !== null && second?.score !== undefined && Math.abs(second.score - best.score) <= tolerance) {
    return getUnmappedVisualMapping(face, 'ambiguous')
  }

  return {
    stepId: best.candidate.stepId,
    mappingSource: 'frontend_fallback',
    mappingMethod: 'boundary_bbox',
    mappingConfidence: 'fallback',
  }
}

function scoreFaceCandidate(
  candidate: GraphFaceCandidate,
  meshBbox: Required<MeshBbox>,
  surfaceType: string | undefined,
  origin: [number, number, number] | undefined,
  axisDirection: [number, number, number] | undefined,
  tolerance: number,
): number | null {
  if (surfaceType && candidate.surfaceType && candidate.surfaceType !== surfaceType) return null
  if (origin && candidate.origin && vectorDistance(origin, candidate.origin) > tolerance) return null
  if (
    axisDirection
    && candidate.axisDirection
    && Math.min(
      vectorDistance(axisDirection, candidate.axisDirection),
      vectorDistance(axisDirection, negateVector(candidate.axisDirection)),
    ) > tolerance
  ) {
    return null
  }
  if (!candidate.boundaryBbox) return null

  const boundaryScore = scoreBoundaryBbox(candidate.boundaryBbox, meshBbox, tolerance)
  if (boundaryScore === null) return null
  return boundaryScore
}

function scoreBoundaryBbox(
  boundaryBbox: Required<MeshBbox>,
  meshBbox: Required<MeshBbox>,
  tolerance: number,
): number | null {
  let score = 0

  for (let index = 0; index < 3; index += 1) {
    const boundaryMin = boundaryBbox.min[index]
    const boundaryMax = boundaryBbox.max[index]
    const meshMin = meshBbox.min[index]
    const meshMax = meshBbox.max[index]

    if (
      boundaryMin < meshMin - tolerance
      || boundaryMax > meshMax + tolerance
    ) {
      return null
    }

    if (Math.abs(boundaryMax - boundaryMin) <= tolerance) {
      const sideDistance = Math.min(
        Math.abs(boundaryMin - meshMin),
        Math.abs(boundaryMin - meshMax),
      )
      if (sideDistance > tolerance) return null
      score += sideDistance
    } else {
      score += Math.abs(boundaryMin - meshMin) + Math.abs(boundaryMax - meshMax)
    }
  }

  return score
}

function bboxFromValue(value: unknown): Required<MeshBbox> | null {
  const bbox = asRecord(value)
  const min = vector3OrUndefined(bbox.min)
  const max = vector3OrUndefined(bbox.max)
  return min && max ? { min, max } : null
}

function bboxFromPoints(points: Array<[number, number, number]>): Required<MeshBbox> | null {
  if (points.length === 0) return null
  const min: [number, number, number] = [...points[0]]
  const max: [number, number, number] = [...points[0]]

  for (const point of points.slice(1)) {
    for (let index = 0; index < 3; index += 1) {
      min[index] = Math.min(min[index], point[index])
      max[index] = Math.max(max[index], point[index])
    }
  }

  return { min, max }
}

function bboxSize(bbox: Required<MeshBbox>): number {
  return Math.max(
    Math.abs(bbox.max[0] - bbox.min[0]),
    Math.abs(bbox.max[1] - bbox.min[1]),
    Math.abs(bbox.max[2] - bbox.min[2]),
    1,
  )
}

function vector3OrUndefined(value: unknown): [number, number, number] | undefined {
  return isVector3(value) ? [value[0], value[1], value[2]] : undefined
}

function vectorDistance(first: [number, number, number], second: [number, number, number]): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2])
}

function negateVector(vector: [number, number, number]): [number, number, number] {
  return [-vector[0], -vector[1], -vector[2]]
}

function buildGraphEdgeSignatureMap(graph: GraphData): Map<string, string> {
  const candidates = new Map<string, string[]>()

  for (const [entityId, attr] of Object.entries(graph.geometry_attributes ?? {})) {
    if (attr.type !== 'EDGE_CURVE') continue
    const stepId = typeof attr.id === 'string' && attr.id.length > 0 ? attr.id : entityId
    for (const signature of getGraphEdgeSignatures(attr, graph)) {
      const ids = candidates.get(signature) ?? []
      ids.push(stepId)
      candidates.set(signature, ids)
    }
  }

  const uniqueMatches = new Map<string, string>()
  for (const [signature, ids] of candidates) {
    if (ids.length === 1) uniqueMatches.set(signature, ids[0])
  }

  return uniqueMatches
}

function getResolvedEdgeMapping(
  edge: MeshEdge,
  graphEdgeStepIdsBySignature: Map<string, string>,
): ResolvedVisualMapping {
  const explicitStepId = normalizeStepId(edge.step_id)
  if (explicitStepId) return getExplicitVisualMapping(explicitStepId, edge)

  for (const signature of getMeshEdgeSignatures(edge)) {
    const stepId = graphEdgeStepIdsBySignature.get(signature)
    if (stepId) {
      return {
        stepId,
        mappingSource: 'frontend_fallback',
        mappingMethod: 'endpoint_curve_signature_frontend',
        mappingConfidence: 'fallback',
      }
    }
  }

  return getUnmappedVisualMapping(edge)
}

function getGraphEdgeSignatures(attr: GeometryAttribute, graph: GraphData): string[] {
  const endpointSignature = edgeEndpointSignature(
    attr.edge_start_coordinates,
    attr.edge_end_coordinates,
  )
  if (!endpointSignature) return []

  const curveType = getGraphEdgeCurveType(attr, graph)
  return curveType
    ? [typedEdgeSignature(curveType, endpointSignature), untypedEdgeSignature(endpointSignature)]
    : [untypedEdgeSignature(endpointSignature)]
}

function getMeshEdgeSignatures(edge: MeshEdge): string[] {
  const points = edge.points?.filter(isVector3) ?? []
  if (points.length < 2) return []

  const endpointSignature = edgeEndpointSignature(points[0], points[points.length - 1])
  if (!endpointSignature) return []

  const curveType = normalizeCurveType(edge.curve_type)
  return curveType
    ? [typedEdgeSignature(curveType, endpointSignature), untypedEdgeSignature(endpointSignature)]
    : [untypedEdgeSignature(endpointSignature)]
}

function getGraphEdgeCurveType(attr: GeometryAttribute, graph: GraphData): string | null {
  const directType = normalizeCurveType(attr.edge_geometry_type)
  if (directType) return directType

  const edgeGeometryId = typeof attr.edge_geometry === 'string' ? attr.edge_geometry : null
  if (!edgeGeometryId) return null

  const edgeGeometry = graph.entities?.[edgeGeometryId]
  const fields = edgeGeometry?.fields ?? {}
  const curveRefs = [
    fields.curve_3d,
    fields.basis_curve,
    fields.arg_1,
    edgeGeometry?.refs?.[0],
  ]

  for (const curveRef of curveRefs) {
    if (typeof curveRef !== 'string' || !isReference(curveRef)) continue
    const curveType = normalizeCurveType(
      graph.geometry_attributes?.[curveRef]?.type ?? graph.entities?.[curveRef]?.type,
    )
    if (curveType) return curveType
  }

  return null
}

function normalizeCurveType(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const type = value.toUpperCase()
  if (type.includes('B_SPLINE')) return 'B_SPLINE_CURVE'
  if (type === 'LINE') return 'LINE'
  if (type === 'CIRCLE') return 'CIRCLE'
  if (type === 'ELLIPSE') return 'ELLIPSE'
  return null
}

function typedEdgeSignature(curveType: string, endpointSignature: string): string {
  return `type:${curveType}|${endpointSignature}`
}

function untypedEdgeSignature(endpointSignature: string): string {
  return `endpoints:${endpointSignature}`
}

function edgeEndpointSignature(start: unknown, end: unknown): string | null {
  if (!isVector3(start) || !isVector3(end)) return null
  const endpoints = [vectorSignature(start), vectorSignature(end)].sort()
  return endpoints.join('|')
}

function vectorSignature(vector: [number, number, number]): string {
  return vector.slice(0, 3).map(roundSignatureNumber).join(',')
}

function roundSignatureNumber(value: number): string {
  const rounded = Number(value.toFixed(6))
  return String(Object.is(rounded, -0) ? 0 : rounded)
}

function normalizeStepId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getExplicitVisualMapping(
  stepId: string | null | undefined,
  source: {
    mapping_source?: string | null
    mapping_method?: string | null
    mapping_confidence?: string | null
  },
): ResolvedVisualMapping {
  const normalizedStepId = normalizeStepId(stepId)
  return {
    stepId: normalizedStepId,
    mappingSource: getMappingText(source.mapping_source, normalizedStepId ? 'unknown' : 'none'),
    mappingMethod: getMappingText(source.mapping_method, normalizedStepId ? 'unknown' : 'unmapped'),
    mappingConfidence: getMappingText(source.mapping_confidence, normalizedStepId ? 'unknown' : 'unmapped'),
  }
}

function getUnmappedVisualMapping(
  source: {
    mapping_source?: string | null
    mapping_method?: string | null
    mapping_confidence?: string | null
  },
  reason: 'unmapped' | 'ambiguous' = 'unmapped',
): ResolvedVisualMapping {
  return {
    stepId: null,
    mappingSource: getMappingText(source.mapping_source, 'none'),
    mappingMethod: getMappingText(source.mapping_method, reason),
    mappingConfidence: getMappingText(source.mapping_confidence, reason),
  }
}

function getMappingText(value: string | null | undefined, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function createVisualObjectMaps(): VisualObjectMaps {
  return {
    face: new Map(),
    edge: new Map(),
    vertex: new Map(),
  }
}

function createVisualPickGroups(): VisualPickGroups {
  return {
    face: [],
    edge: [],
    vertex: [],
  }
}

function registerVisualObject(
  maps: VisualObjectMaps,
  kind: VisualKind,
  stepId: string | null | undefined,
  object: THREE.Object3D,
) {
  if (typeof stepId !== 'string' || stepId.length === 0) return
  const objects = maps[kind].get(stepId) ?? []
  objects.push(object)
  maps[kind].set(stepId, objects)
}

function getPickObjects(object: THREE.Object3D, kind: VisualKind): THREE.Object3D[] {
  if (kind !== 'edge') return [object]

  const pickObjects: THREE.Object3D[] = []
  object.traverse((child) => {
    const data = findSelectableUserData(child)
    if (data?.kind === 'edge' && data.edgePickTarget) {
      pickObjects.push(child)
    }
  })
  return pickObjects
}

function pickVisualObject(
  raycaster: THREE.Raycaster,
  pickGroups: VisualPickGroups,
  pickMode: PickMode,
  transparentFaces: boolean,
  modelSize: number,
): VisualPickResult | null {
  const needsFaceHits = pickMode === 'auto' || pickMode === 'face' || !transparentFaces
  const faceHits = needsFaceHits ? getPickHits(raycaster, pickGroups.face, 'face') : []
  const edgeHits = pickMode === 'auto' || pickMode === 'edge'
    ? getPickHits(raycaster, pickGroups.edge, 'edge')
    : []
  const vertexHits = pickMode === 'auto' || pickMode === 'vertex'
    ? getPickHits(raycaster, pickGroups.vertex, 'vertex')
    : []
  const nearestFaceDistance = faceHits[0]?.distance ?? null
  const occlusionEpsilon = Math.max(modelSize * 0.001, 1e-6)

  const visibleEdgeHits = transparentFaces || pickMode === 'face' || nearestFaceDistance === null
    ? edgeHits
    : edgeHits.filter((hit) => hit.distance <= nearestFaceDistance + occlusionEpsilon)
  const visibleVertexHits = transparentFaces || pickMode === 'face' || nearestFaceDistance === null
    ? vertexHits
    : vertexHits.filter((hit) => hit.distance <= nearestFaceDistance + occlusionEpsilon)
  const selectableFaceHits = pickMode === 'auto' || pickMode === 'face' ? faceHits : []
  const selectableEdgeHits = pickMode === 'auto' || pickMode === 'edge' ? visibleEdgeHits : []
  const selectableVertexHits = pickMode === 'auto' || pickMode === 'vertex' ? visibleVertexHits : []

  const candidates = [
    ...selectableVertexHits,
    ...selectableFaceHits,
    ...selectableEdgeHits,
  ]

  const nearestFace = selectableFaceHits[0]
  const nearestEdge = selectableEdgeHits[0]
  const edgeFaceTieEpsilon = Math.max(modelSize * 0.0008, 1e-6)
  if (
    pickMode === 'auto'
    && selectableVertexHits.length === 0
    && nearestFace
    && nearestEdge
    && nearestEdge.distance <= nearestFace.distance + edgeFaceTieEpsilon
  ) {
    const debug: VisualPickDebug = {
      pickMode,
      transparentFaces,
      faceHitsCount: faceHits.length,
      edgeHitsCount: edgeHits.length,
      vertexHitsCount: vertexHits.length,
      filteredEdgeHitsCount: selectableEdgeHits.length,
      filteredVertexHitsCount: selectableVertexHits.length,
      nearestFaceDistance,
      selectedKind: typeof nearestEdge.data.kind === 'string' ? nearestEdge.data.kind : null,
      selectedStepId: getUserDataStepId(nearestEdge.data),
      selectedDistance: nearestEdge.distance,
    }
    return { ...nearestEdge, debug }
  }

  candidates.sort((first, second) => {
    const priorityDelta = visualPriority(first.data.kind) - visualPriority(second.data.kind)
    return priorityDelta || first.distance - second.distance
  })
  const selected = candidates[0] ?? null
  const debug: VisualPickDebug = {
    pickMode,
    transparentFaces,
    faceHitsCount: faceHits.length,
    edgeHitsCount: edgeHits.length,
    vertexHitsCount: vertexHits.length,
    filteredEdgeHitsCount: selectableEdgeHits.length,
    filteredVertexHitsCount: selectableVertexHits.length,
    nearestFaceDistance,
    selectedKind: typeof selected?.data.kind === 'string' ? selected.data.kind : null,
    selectedStepId: getUserDataStepId(selected?.data ?? null),
    selectedDistance: selected?.distance ?? null,
  }

  return selected ? { ...selected, debug } : null
}

function getPickHits(
  raycaster: THREE.Raycaster,
  objects: THREE.Object3D[],
  kind: VisualKind,
): Array<{ object: THREE.Object3D; data: SelectableUserData; distance: number }> {
  return raycaster
    .intersectObjects(objects, true)
    .map((intersection) => {
      const data = findSelectableUserData(intersection.object)
      return {
        object: intersection.object,
        data,
        distance: intersection.distance,
      }
    })
    .filter((hit): hit is { object: THREE.Object3D; data: SelectableUserData; distance: number } => (
      Boolean(hit.data && hit.data.kind === kind)
    ))
    .sort((first, second) => first.distance - second.distance)
}

function visualPriority(kind: unknown): number {
  if (kind === 'vertex') return 0
  if (kind === 'face') return 1
  return 2
}

function createEmptyPickDebug(pickMode: PickMode, transparentFaces: boolean): VisualPickDebug {
  return {
    pickMode,
    transparentFaces,
    faceHitsCount: 0,
    edgeHitsCount: 0,
    vertexHitsCount: 0,
    filteredEdgeHitsCount: 0,
    filteredVertexHitsCount: 0,
    nearestFaceDistance: null,
    selectedKind: null,
    selectedStepId: null,
    selectedDistance: null,
  }
}

function getUserDataStepId(data: SelectableUserData | null): string | null {
  const stepId = data?.stepId
  return typeof stepId === 'string' && stepId.length > 0 ? stepId : null
}

function findSelectableUserData(object: THREE.Object3D | null): SelectableUserData | null {
  let current = object
  while (current) {
    const userData = current.userData as SelectableUserData
    if (userData.kind || userData.stepId) return userData
    current = current.parent
  }
  return null
}

function updateVisualStyles(
  objects: THREE.Object3D[],
  maps: VisualObjectMaps,
  selectedEntityId: string | null,
  previewEntityId: string | null,
  transparentFaces: boolean,
) {
  for (const object of objects) {
    applyVisualState(object, 'normal', transparentFaces)
  }

  if (previewEntityId && previewEntityId !== selectedEntityId) {
    for (const object of getVisualObjectsByStepId(maps, previewEntityId)) {
      applyVisualState(object, 'preview', transparentFaces)
    }
  }

  if (selectedEntityId) {
    for (const object of getVisualObjectsByStepId(maps, selectedEntityId)) {
      applyVisualState(object, 'selected', transparentFaces)
    }
  }
}

function getVisualObjectsByStepId(maps: VisualObjectMaps, stepId: string): THREE.Object3D[] {
  return [
    ...(maps.face.get(stepId) ?? []),
    ...(maps.edge.get(stepId) ?? []),
    ...(maps.vertex.get(stepId) ?? []),
  ]
}

function applyVisualState(
  object: THREE.Object3D,
  state: VisualStyleState,
  transparentFaces: boolean,
) {
  const data = findSelectableUserData(object)
  if (data?.kind === 'edge') {
    applyEdgeState(object, state)
    return
  }

  const material = getObjectMaterial(object)
  if (!material) return

  const color = getStateNumber(data, state, 'normalColor', 'previewColor', 'selectedColor')
  const colorMaterial = material as THREE.Material & { color?: THREE.Color }
  if (typeof color === 'number' && colorMaterial.color) {
    colorMaterial.color.setHex(color)
  }

  if (data?.kind === 'vertex') {
    const scale = getStateNumber(data, state, 'normalScale', 'previewScale', 'selectedScale') ?? 1
    object.scale.setScalar(scale)
  } else if (data?.kind === 'face') {
    applyFaceState(material, data, state, transparentFaces)
  }
}

function applyEdgeState(object: THREE.Object3D, state: VisualStyleState) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Line)) return
    const isHighlight = Boolean(child.userData.edgeHighlight)
    const isHover = Boolean(child.userData.edgeHover)
    child.visible = isHighlight ? state === 'selected' : isHover ? state === 'preview' : true
    const material = getObjectMaterial(child)
    if (!material) return
    const colorMaterial = material as THREE.Material & { color?: THREE.Color }
    if (!isHighlight && !isHover && colorMaterial.color) {
      colorMaterial.color.setHex(state === 'selected' ? 0xef4444 : 0x334155)
    }
  })
}

function applyFaceState(
  material: THREE.Material,
  data: SelectableUserData,
  state: VisualStyleState,
  transparentFaces: boolean,
) {
  if (!material || !('opacity' in material)) return
  const selected = state === 'selected'
  const preview = state === 'preview'

  if (transparentFaces) {
    material.transparent = true
    material.opacity = selected ? 0.72 : preview ? 0.55 : 0.35
    material.depthWrite = false
  } else {
    const opacity = getStateNumber(data, state, 'normalOpacity', 'previewOpacity', 'selectedOpacity') ?? 1
    material.transparent = opacity < 1
    material.opacity = opacity
    material.depthWrite = true
  }
}

function getStateNumber(
  data: SelectableUserData | null,
  state: VisualStyleState,
  normalKey: keyof SelectableUserData,
  previewKey: keyof SelectableUserData,
  selectedKey: keyof SelectableUserData,
): number | undefined {
  const value = state === 'selected'
    ? data?.[selectedKey]
    : state === 'preview'
      ? data?.[previewKey]
      : data?.[normalKey]
  return typeof value === 'number' ? value : undefined
}

function getObjectMaterial(
  object: THREE.Object3D,
): THREE.Material | null {
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    const material = object.material
    return Array.isArray(material) ? material[0] ?? null : material
  }
  return null
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((item: THREE.Object3D) => {
    if (item instanceof THREE.Mesh || item instanceof THREE.Line) {
      item.geometry.dispose()
      const material = item.material
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose())
      } else {
        material.dispose()
      }
    }
  })
}

function isVector3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value)
    && value.length >= 3
    && value.slice(0, 3).every((item) => typeof item === 'number' && Number.isFinite(item))
  )
}

function isTriangle(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value)
    && value.length >= 3
    && value.slice(0, 3).every((item) => Number.isInteger(item) && item >= 0)
  )
}

function useOutgoingRelations(graph: GraphData, selectedEntityId: string | null): SemanticEdge[] {
  return useMemo(() => {
    if (!selectedEntityId) return []

    const semanticEdges = Array.isArray(graph.semantic_edges) ? graph.semantic_edges : []
    const outgoing = semanticEdges.filter((edge) => edge.from === selectedEntityId)
    if (outgoing.length > 0) return outgoing

    const entityRefs = graph.entities?.[selectedEntityId]?.refs ?? []
    if (entityRefs.length > 0) {
      return entityRefs.map((ref) => ({
        from: selectedEntityId,
        to: ref,
        role: 'ref',
        from_type: getEntityType(graph, selectedEntityId),
        to_type: getEntityType(graph, ref),
      }))
    }

    const edges = Array.isArray(graph.edges) ? graph.edges : []
    return edges
      .filter((edge) => edge.from === selectedEntityId)
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        role: edge.role ?? 'ref',
        from_type: edge.from_type ?? getEntityType(graph, edge.from),
        to_type: edge.to_type ?? getEntityType(graph, edge.to),
      }))
  }, [graph, selectedEntityId])
}

function useIncomingRelations(graph: GraphData, selectedEntityId: string | null): SemanticEdge[] {
  return useMemo(() => {
    if (!selectedEntityId) return []

    const semanticEdges = Array.isArray(graph.semantic_edges) ? graph.semantic_edges : []
    const incoming = semanticEdges.filter((edge) => edge.to === selectedEntityId)
    if (incoming.length > 0) return incoming

    const edges = Array.isArray(graph.edges) ? graph.edges : []
    return edges
      .filter((edge) => edge.to === selectedEntityId)
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        role: edge.role ?? 'ref',
        from_type: edge.from_type ?? getEntityType(graph, edge.from),
        to_type: edge.to_type ?? getEntityType(graph, edge.to),
      }))
  }, [graph, selectedEntityId])
}

function getFaceNeighbors(graph: GraphData, selectedEntityId: string | null): unknown[] {
  if (!selectedEntityId) return []

  const faceToNeighbors = asRecord(graph.face_adjacency_graph?.face_to_neighbors)
  const neighbors = faceToNeighbors[selectedEntityId]
  return Array.isArray(neighbors) ? neighbors : []
}

function getDefaultEntityId(graph: GraphData): string | null {
  const solids = asArray(graph.brep_tree?.solids)
  const firstSolid = asRecord(solids[0])
  const firstSolidId = firstSolid.id
  if (typeof firstSolidId === 'string') return firstSolidId

  const firstEntityId = Object.keys(graph.entities ?? {})[0]
  return firstEntityId ?? null
}

function getSourceText(source: GraphData['source']): string {
  if (typeof source === 'string' && source.length > 0) return source
  if (source && typeof source === 'object') {
    return source.step_file ?? source.file ?? source.step_file_name ?? source.file_name ?? '-'
  }
  return '-'
}

function getSourceHash(source: string | SourceMetadata | undefined): string | null {
  if (!source || typeof source === 'string') return null
  return typeof source.step_file_sha256 === 'string' && source.step_file_sha256.length > 0
    ? source.step_file_sha256
    : null
}

function getGraphFileHash(source: SourceMetadata | undefined): string | null {
  return typeof source?.graph_file_sha256 === 'string' && source.graph_file_sha256.length > 0
    ? source.graph_file_sha256
    : null
}

function getSourceConsistency(
  graphSource: GraphData['source'],
  meshSource: SourceMetadata | undefined,
): SourceConsistency {
  const graphStepHash = getSourceHash(graphSource)
  const meshStepHash = getSourceHash(meshSource)
  const meshGraphHash = getGraphFileHash(meshSource)

  if (!graphStepHash || !meshStepHash) {
    return {
      status: 'unknown',
      graphStepHash,
      meshStepHash,
      meshGraphHash,
      message: 'Missing source hash metadata.',
    }
  }

  if (graphStepHash !== meshStepHash) {
    return {
      status: 'mismatch',
      graphStepHash,
      meshStepHash,
      meshGraphHash,
      message: 'graph.json and model_mesh.json may be generated from different STEP files. 3D mapping may be unreliable.',
    }
  }

  return {
    status: 'ok',
    graphStepHash,
    meshStepHash,
    meshGraphHash,
    message: 'Source STEP hashes match.',
  }
}

function shortHash(value: string | null): string {
  return value ? value.slice(0, 12) : '-'
}

function formatPickMode(mode: PickMode): string {
  if (mode === 'auto') return 'Auto'
  if (mode === 'face') return 'Face'
  if (mode === 'edge') return 'Edge'
  return 'Vertex'
}

function pickModeTooltip(mode: PickMode): string {
  if (mode === 'auto') return TOOLTIP_TEXT.viewer.auto
  if (mode === 'face') return TOOLTIP_TEXT.viewer.face
  if (mode === 'edge') return TOOLTIP_TEXT.viewer.edge
  return TOOLTIP_TEXT.viewer.vertex
}

function relationSectionTooltip(title: string): string | undefined {
  if (title === 'References') return TOOLTIP_TEXT.relation.references
  if (title === 'Referenced By') return TOOLTIP_TEXT.relation.referencedBy
  if (title === 'Face Neighbors') return TOOLTIP_TEXT.relation.faceNeighbors
  return undefined
}

function mappingEvidenceLabelTooltip(label: string): string | undefined {
  if (label === 'Mapping source') return TOOLTIP_TEXT.mapping.source
  if (label === 'Mapping method') return TOOLTIP_TEXT.mapping.method
  if (label === 'Mapping confidence') return TOOLTIP_TEXT.mapping.confidence
  if (label === 'Step id') return TOOLTIP_TEXT.mapping.stepId
  if (label === 'Kind') return TOOLTIP_TEXT.mapping.kind
  if (label.includes('index')) return TOOLTIP_TEXT.mapping.index
  if (label === 'Boundary edges used') return TOOLTIP_TEXT.evidence.boundary_edge_step_ids
  if (label === 'Matched STEP face edges') return TOOLTIP_TEXT.evidence.matched_step_face_edge_ids
  if (label === 'Edge set Jaccard') return TOOLTIP_TEXT.evidence.edge_set_jaccard
  if (label === 'Surface type match') return TOOLTIP_TEXT.evidence.surface_type_match
  if (label === 'BBox similarity') return TOOLTIP_TEXT.evidence.bbox_similarity
  if (label === 'Reason') return TOOLTIP_TEXT.evidence.reason
  return undefined
}

function getEntityType(graph: GraphData, id: string): string {
  return graph.entities?.[id]?.type ?? 'UNKNOWN'
}

function formatStat(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  return String(value)
}

function isReference(value: string): boolean {
  return refPattern.test(value)
}

function isNumericArray(value: unknown[]): value is number[] {
  return value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

function getFaceLabel(faceNode: UnknownRecord, surface: UnknownRecord): string {
  const faceId = stringOrUnknown(faceNode.id)
  const surfaceType = stringOrUnknown(surface.type)
  const radius = surface.radius

  if (surfaceType === 'CYLINDRICAL_SURFACE' && radius !== null && radius !== undefined) {
    return `Face ${faceId} · ${surfaceType} · r=${formatStat(radius)}`
  }

  return `Face ${faceId} · ${surfaceType}`
}

function stringOrUnknown(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'UNKNOWN'
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function asRecord(value: unknown): UnknownRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRecord
  }

  return {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function safeStringify(value: unknown, spaces = 0): string {
  try {
    return JSON.stringify(value, null, spaces)
  } catch {
    return String(value)
  }
}

export default App
