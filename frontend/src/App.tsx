import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
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

type UnknownRecord = Record<string, unknown>

type GraphData = {
  source?: string | { file?: string; file_name?: string }
  entities?: Record<string, Entity>
  edges?: BasicEdge[]
  semantic_edges?: SemanticEdge[]
  brep_tree?: UnknownRecord
  face_adjacency_graph?: UnknownRecord
  summary?: Record<string, unknown>
}

type EntitySelect = (id: string) => void

const refPattern = /^#\d+$/

function App() {
  const [graph, setGraph] = useState<GraphData | null>(null)
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  if (loading) {
    return (
      <div className="app app-state">
        <div className="panel state-panel">Loading graph.json...</div>
      </div>
    )
  }

  if (error || !graph) {
    return (
      <div className="app app-state">
        <div className="panel state-panel">
          <h1 className="state-title">STEP Graph Viewer</h1>
          <p className="muted">Failed to load public/graph.json.</p>
          <pre className="raw-block">{error ?? 'No graph data returned.'}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Header graph={graph} />
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
          />
        </main>

        <aside className="right-panel">
          <RelationPanel
            graph={graph}
            selectedEntityId={selectedEntityId}
            setSelectedEntityId={setSelectedEntityId}
          />
          <RawStepPanel graph={graph} selectedEntityId={selectedEntityId} />
        </aside>
      </div>
    </div>
  )
}

function Header({ graph }: { graph: GraphData }) {
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
          <span>entity_count {formatStat(summary.entity_count)}</span>
          <span>face_count {formatStat(brepSummary.face_count)}</span>
          <span>adjacency_count {formatStat(adjacencySummary.adjacency_count)}</span>
        </div>
      </div>
    </header>
  )
}

function SummaryPanel({ graph }: { graph: GraphData }) {
  const summary = graph.summary ?? {}
  const brepSummary = asRecord(graph.brep_tree?.summary)
  const adjacencySummary = asRecord(graph.face_adjacency_graph?.summary)
  const items: Array<[string, unknown]> = [
    ['source', getSourceText(graph.source)],
    ['entity_count', summary.entity_count],
    ['type_count', summary.type_count],
    ['skipped_count', summary.skipped_count],
    ['semantic_edge_count', summary.semantic_edge_count],
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
    <section className="panel">
      <h2 className="panel-title">Summary</h2>
      <dl className="summary-grid">
        {items.map(([label, value]) => (
          <div className="summary-row" key={label}>
            <dt>{label}</dt>
            <dd>{formatStat(value)}</dd>
          </div>
        ))}
      </dl>
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

  return (
    <section className="panel tree-panel">
      <h2 className="panel-title">B-Rep Tree</h2>
      {!graph.brep_tree ? (
        <p className="muted">B-Rep tree not available.</p>
      ) : solids.length === 0 ? (
        <p className="muted">No solids found.</p>
      ) : (
        <div className="tree">
          {solids.map((solid, index) => {
            const solidNode = asRecord(solid)

            return (
              <TreeNode
                key={stringOrFallback(solidNode.id, `solid-${index}`)}
                id={stringOrUnknown(solidNode.id)}
                label={`Solid ${stringOrUnknown(solidNode.id)}`}
                selectedEntityId={selectedEntityId}
                setSelectedEntityId={setSelectedEntityId}
                defaultOpen
              >
                <ShellNode
                  shell={solidNode.outer_shell}
                  selectedEntityId={selectedEntityId}
                  setSelectedEntityId={setSelectedEntityId}
                />
              </TreeNode>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ShellNode({
  shell,
  selectedEntityId,
  setSelectedEntityId,
}: {
  shell: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
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
      defaultOpen
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
}: {
  face: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const faceNode = asRecord(face)
  const surface = asRecord(faceNode.surface)
  const bounds = asArray(faceNode.bounds)
  const surfaceType = stringOrUnknown(surface.type)

  return (
    <TreeNode
      id={stringOrUnknown(faceNode.id)}
      label={`Face ${stringOrUnknown(faceNode.id)} · ${surfaceType}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      defaultOpen={false}
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
}: {
  bound: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const boundNode = asRecord(bound)
  const role = stringOrUnknown(boundNode.role)

  return (
    <TreeNode
      id={stringOrUnknown(boundNode.id)}
      label={`Bound ${stringOrUnknown(boundNode.id)} · ${role}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      defaultOpen={false}
    >
      <LoopNode
        loop={boundNode.loop}
        selectedEntityId={selectedEntityId}
        setSelectedEntityId={setSelectedEntityId}
      />
    </TreeNode>
  )
}

function LoopNode({
  loop,
  selectedEntityId,
  setSelectedEntityId,
}: {
  loop: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
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
      defaultOpen={false}
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
}: {
  orientedEdge: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const orientedEdgeNode = asRecord(orientedEdge)
  const edgeCurve = orientedEdgeNode.edge_curve ?? orientedEdgeNode.edge_element

  return (
    <TreeNode
      id={stringOrUnknown(orientedEdgeNode.id)}
      label={`OrientedEdge ${stringOrUnknown(orientedEdgeNode.id)}`}
      selectedEntityId={selectedEntityId}
      setSelectedEntityId={setSelectedEntityId}
      defaultOpen={false}
    >
      {edgeCurve ? (
        <EdgeCurveNode
          edgeCurve={edgeCurve}
          selectedEntityId={selectedEntityId}
          setSelectedEntityId={setSelectedEntityId}
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
}: {
  edgeCurve: unknown
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
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
      defaultOpen={false}
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
  defaultOpen = false,
  children,
}: {
  id?: string
  label: string
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
  defaultOpen?: boolean
  children?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const hasChildren = Boolean(children)
  const selectable = Boolean(id && id !== 'UNKNOWN')
  const selected = selectable && selectedEntityId === id

  return (
    <div className="tree-node">
      <div className="tree-node-row">
        <button
          type="button"
          className="tree-toggle"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? 'Collapse node' : 'Expand node'}
          disabled={!hasChildren}
        >
          {hasChildren ? (open ? '-' : '+') : ''}
        </button>
        <button
          type="button"
          className={`tree-node-label${selected ? ' tree-node-selected' : ''}`}
          onClick={() => {
            if (selectable && id) setSelectedEntityId(id)
          }}
          disabled={!selectable}
        >
          {label}
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

  return (
    <div className="tree-node tree-leaf">
      <button
        type="button"
        className={`tree-node-label${selected ? ' tree-node-selected' : ''}`}
        onClick={() => {
          if (selectable && id) setSelectedEntityId(id)
        }}
        disabled={!selectable}
      >
        {label}
      </button>
    </div>
  )
}

function EntityDetail({
  graph,
  selectedEntityId,
  setSelectedEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const entity = selectedEntityId ? graph.entities?.[selectedEntityId] : undefined

  return (
    <section className="panel entity-detail">
      <h2 className="panel-title">Entity Detail</h2>
      {!selectedEntityId ? (
        <p className="muted">No entity selected.</p>
      ) : !entity ? (
        <p className="muted">Entity not found: {selectedEntityId}</p>
      ) : (
        <>
          <div className="entity-heading">
            <span className="entity-id">{entity.id}</span>
            <span className="badge">{entity.type ?? 'UNKNOWN'}</span>
          </div>

          <div className="detail-section">
            <div className="detail-label">args_raw</div>
            <pre className="inline-raw">{entity.args_raw || '-'}</pre>
          </div>

          <div className="detail-section">
            <div className="detail-label">refs</div>
            {Array.isArray(entity.refs) && entity.refs.length > 0 ? (
              <div className="button-list">
                {entity.refs.map((ref) => (
                  <EntityIdButton
                    key={ref}
                    id={ref}
                    graph={graph}
                    setSelectedEntityId={setSelectedEntityId}
                  />
                ))}
              </div>
            ) : (
              <p className="muted">No refs.</p>
            )}
          </div>

          <div className="detail-section">
            <div className="detail-label">fields</div>
            {entity.fields && Object.keys(entity.fields).length > 0 ? (
              <table className="field-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(entity.fields).map(([field, value]) => (
                    <tr key={field}>
                      <td>{field}</td>
                      <td>
                        <ValueView
                          value={value}
                          graph={graph}
                          setSelectedEntityId={setSelectedEntityId}
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
      )}
    </section>
  )
}

function RelationPanel({
  graph,
  selectedEntityId,
  setSelectedEntityId,
}: {
  graph: GraphData
  selectedEntityId: string | null
  setSelectedEntityId: EntitySelect
}) {
  const entity = selectedEntityId ? graph.entities?.[selectedEntityId] : undefined
  const outgoing = useOutgoingRelations(graph, selectedEntityId)
  const incoming = useIncomingRelations(graph, selectedEntityId)
  const faceNeighbors = getFaceNeighbors(graph, selectedEntityId)
  const showFaceNeighbors = entity?.type === 'ADVANCED_FACE' && graph.face_adjacency_graph

  return (
    <section className="panel">
      <h2 className="panel-title">Relations</h2>
      {!selectedEntityId ? (
        <p className="muted">No entity selected.</p>
      ) : (
        <>
          <RelationSection title="References">
            {outgoing.length > 0 ? (
              outgoing.map((relation, index) => (
                <div className="relation-item" key={`${relation.to}-${relation.role}-${index}`}>
                  <span className="relation-role">{relation.role ?? 'ref'}</span>
                  <span>→</span>
                  <EntityIdButton
                    id={relation.to}
                    graph={graph}
                    setSelectedEntityId={setSelectedEntityId}
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
                      />
                    </div>
                    <div>
                      shared_edge_curve{' '}
                      <EntityIdButton
                        id={String(neighborNode.shared_edge_curve ?? 'UNKNOWN')}
                        graph={graph}
                        setSelectedEntityId={setSelectedEntityId}
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
      )}
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
      <h3>{title}</h3>
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
  const entity = selectedEntityId ? graph.entities?.[selectedEntityId] : undefined

  return (
    <section className="panel raw-panel">
      <h2 className="panel-title">Raw STEP</h2>
      <pre className="raw-block">{entity?.raw || 'No raw STEP text.'}</pre>
    </section>
  )
}

function ValueView({
  value,
  graph,
  setSelectedEntityId,
}: {
  value: unknown
  graph: GraphData
  setSelectedEntityId: EntitySelect
}): ReactNode {
  if (typeof value === 'string') {
    return isReference(value) ? (
      <EntityIdButton id={value} graph={graph} setSelectedEntityId={setSelectedEntityId} />
    ) : (
      <span>{value}</span>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="muted">[]</span>

    return (
      <div className="value-list">
        {value.map((item, index) => (
          <span className="value-chip" key={`${String(item)}-${index}`}>
            <ValueView value={item} graph={graph} setSelectedEntityId={setSelectedEntityId} />
          </span>
        ))}
      </div>
    )
  }

  if (value && typeof value === 'object') {
    return <code className="json-value">{safeStringify(value)}</code>
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
}: {
  id: string
  graph: GraphData
  setSelectedEntityId: EntitySelect
}) {
  const exists = Boolean(graph.entities?.[id])

  return (
    <button
      type="button"
      className={`entity-id-button${exists ? '' : ' entity-id-button-missing'}`}
      onClick={() => setSelectedEntityId(id)}
      title={exists ? `Open ${id}` : `${id} not found in entities`}
    >
      {id}
    </button>
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
    return source.file ?? source.file_name ?? '-'
  }
  return '-'
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

function stringOrUnknown(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'UNKNOWN'
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

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export default App
