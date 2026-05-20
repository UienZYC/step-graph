export const TOOLTIP_TEXT = {
  panels: {
    summary:
      'File-level and B-Rep statistics extracted from graph.json. Counts describe parsed data, not recognized design features.',
    brepTree:
      'A hierarchical view of the boundary representation structure extracted from STEP. It is shown as a tree for readability, although STEP references are actually graph-like.',
    entityDetail: 'Structured details of the selected STEP entity.',
    geometryAttributes:
      'A normalized view of explicit geometric facts extracted from STEP entities, such as coordinates, directions, radius, origin, and axis. This is still extracted data, not design intent.',
    mappingEvidence:
      'The evidence used to justify why a 3D visual element was mapped to a STEP entity.',
    relations: 'Reference and neighborhood relationships for the selected STEP entity.',
    rawStep:
      'The original STEP statement for this entity. This is source evidence used by the parser.',
    viewer:
      'A display mesh generated from the STEP model using OCP/OCCT. The mesh is for visualization and picking; STEP/B-Rep remains the semantic source.',
  },
  summary: {
    source: 'The STEP file path or source metadata reported by graph.json.',
    entity_count:
      'Number of STEP entities parsed from the DATA section. This is a file-level count, not the number of visible CAD features.',
    entities:
      'Number of STEP entities parsed from the DATA section. This is a file-level count, not the number of visible CAD features.',
    type_count: 'Number of distinct STEP entity types found in the parsed file.',
    skipped_count:
      'Number of STEP statements the parser could not parse. A nonzero value may indicate incomplete graph extraction.',
    semantic_edge_count:
      'Number of reference edges with semantic roles such as bounds, face_geometry, or edge_element.',
    geometry_attribute_count:
      'Number of geometry-related entities whose explicit attributes were normalized for easier reading.',
    solid_count: 'Number of detected MANIFOLD_SOLID_BREP entities.',
    shell_count: 'Number of detected CLOSED_SHELL or OPEN_SHELL entities.',
    face_count:
      'Number of ADVANCED_FACE entities or mapped visual faces, depending on the panel.',
    faces: 'Number of ADVANCED_FACE entities or mapped visual faces, depending on the panel.',
    edge_curve_count:
      'Number of visual edge instances or EDGE_CURVE entities, depending on context. One STEP EDGE_CURVE may appear multiple times in the visual mesh.',
    edges:
      'Number of visual edge instances or EDGE_CURVE entities, depending on context. One STEP EDGE_CURVE may appear multiple times in the visual mesh.',
    vertex_point_count:
      'Number of visual vertex instances or VERTEX_POINT entities. Multiple topology instances may share the same coordinates.',
    vertices:
      'Number of visual vertex instances or VERTEX_POINT entities. Multiple topology instances may share the same coordinates.',
    adjacency_count: 'Number of face adjacency relationships found from shared edge curves.',
    adjacent: 'Number of face adjacency relationships found from shared edge curves.',
    boundary_edge_count: 'Number of edge curves detected as boundary edges in adjacency analysis.',
    non_manifold_edge_count:
      'Number of edge curves shared by more faces than expected for a manifold solid.',
  },
  source: {
    consistency:
      'Checks whether graph.json and model_mesh.json appear to come from the same STEP file. If this is unknown or mismatched, 3D mapping may be unreliable.',
    hash:
      'A SHA256 hash is a file fingerprint. It helps detect whether two generated JSON files came from the same source data.',
  },
  brep: {
    sharedInTree:
      'This entity appears more than once in the displayed B-Rep tree. This marker is based on repeated tree occurrences, not necessarily the full STEP reference graph.',
    selectedTreeNode:
      'The currently selected STEP entity. The 3D viewer will try to highlight the corresponding visual element if mapping is available.',
  },
  entity: {
    id:
      'The original STEP entity id, such as #120. It is a file-level reference label used inside the STEP file.',
    type: 'The STEP entity type, such as ADVANCED_FACE, EDGE_CURVE, or CARTESIAN_POINT.',
    fields:
      'Parsed arguments of this STEP entity with semantic field names when known. Unknown schemas may fall back to arg_0, arg_1, etc.',
    refs: 'Other STEP entities directly referenced by this entity.',
    args_raw:
      'The raw argument text extracted from the STEP entity before semantic interpretation.',
    raw: 'The original STEP statement for this entity.',
    complexEntity:
      'A STEP complex entity combines multiple entity types in one instance. Some complex entity fields may not yet be fully interpreted.',
    referenceButton:
      'Click to navigate to this referenced STEP entity. Hover may preview its 3D mapping if available.',
    field: 'A parsed field name from this STEP entity.',
    value: 'The parsed value for this field. STEP #id references can be clicked.',
  },
  geometry: {
    coordinates: 'The XYZ coordinates of a CARTESIAN_POINT.',
    direction_ratios:
      'Direction vector components from a STEP DIRECTION entity. They may not always be normalized.',
    origin: 'The location point of a placement or positioned geometry.',
    axis_direction:
      'The main axis direction of a placement or surface, such as the axis of a cylinder.',
    ref_direction_ratios:
      'Reference direction used to orient the local coordinate system of a placement.',
    radius:
      'Radius value explicitly stored in the STEP geometry, such as a circle or cylindrical surface radius.',
    center: 'The center point of a circle or spherical geometry when available.',
    surface_type:
      'The type of underlying geometric surface used by an ADVANCED_FACE, for example PLANE or CYLINDRICAL_SURFACE.',
    edge_geometry_type:
      'The type of curve geometry used by an EDGE_CURVE, such as LINE, CIRCLE, or B_SPLINE_CURVE.',
    same_sense:
      'A STEP orientation flag indicating whether the face or edge uses the same direction as the underlying geometry.',
    position: 'A STEP placement entity that locates and orients this geometry.',
    location: 'A referenced CARTESIAN_POINT used as a placement location.',
    axis: 'A referenced DIRECTION used as the main placement axis.',
    ref_direction: 'A referenced DIRECTION used as the placement reference direction.',
    point: 'A point coordinate derived from a referenced CARTESIAN_POINT.',
    pnt: 'A referenced point used by a geometric curve such as LINE.',
    dir: 'A referenced VECTOR used by a geometric curve such as LINE.',
    magnitude: 'The scalar magnitude stored on a STEP VECTOR.',
    face_geometry: 'The surface entity used by an ADVANCED_FACE.',
    edge_geometry: 'The curve entity used by an EDGE_CURVE.',
    edge_start: 'The starting VERTEX_POINT reference of an EDGE_CURVE.',
    edge_end: 'The ending VERTEX_POINT reference of an EDGE_CURVE.',
    edge_start_coordinates: 'Coordinates resolved from the starting VERTEX_POINT of an EDGE_CURVE.',
    edge_end_coordinates: 'Coordinates resolved from the ending VERTEX_POINT of an EDGE_CURVE.',
    vertex_geometry: 'The CARTESIAN_POINT referenced by a VERTEX_POINT.',
    surface: 'A compact copy of common surface geometry used for display and mapping.',
  },
  mapping: {
    source:
      'Where the STEP-to-3D mapping came from. "backend" means it was written into model_mesh.json by generate_model_mesh.py. "frontend_fallback" means the browser inferred it at runtime. "none" means no reliable mapping is available.',
    method:
      'The algorithm used to map a visual 3D element to a STEP entity, such as boundary_edge_set, endpoint_curve_signature, coordinate_signature, or boundary_bbox.',
    confidence:
      'A qualitative confidence label for the mapping. High confidence does not mean mathematically guaranteed; it means the current evidence uniquely matched under the implemented rules.',
    stepId:
      'The STEP entity id assigned to this visual element, when a mapping is available.',
    kind: 'The kind of visual mesh element: face, edge, or vertex.',
    index:
      'The visual element index generated while exporting model_mesh.json. It is not a STEP entity id.',
    values: {
      backend: 'This mapping was generated by the backend and saved in model_mesh.json.',
      frontend_fallback:
        'This mapping was inferred in the browser because model_mesh.json did not contain a confirmed step_id. Treat it as a fallback, not a backend-confirmed mapping.',
      none: 'No mapping source is available for this visual element.',
      unknown: 'The mapping metadata is missing or unknown for this visual element.',
      boundary_edge_set:
        'A face mapping method that compares the set of boundary EDGE_CURVE ids of a visual face with the boundary edges of STEP ADVANCED_FACE entities.',
      boundary_edge_set_partial:
        'A partial boundary edge set match. It may be useful but is less reliable than a complete boundary edge set match.',
      endpoint_curve_signature:
        'An edge mapping method based on curve type and direction-independent endpoint coordinates. It may be ambiguous if multiple curves share the same type and endpoints.',
      endpoint_curve_signature_frontend:
        'A browser-side fallback edge mapping based on curve type and endpoint coordinates. It is not backend-confirmed.',
      endpoint_only_signature:
        'An edge mapping fallback based only on endpoint coordinates. It is weaker than endpoint_curve_signature.',
      coordinate_signature: 'A vertex mapping method based on rounded XYZ coordinates.',
      boundary_bbox:
        'A fallback face mapping method based on the bounding box of a face boundary. It is useful for disambiguation but less reliable than boundary edge set matching.',
      surface_signature:
        'A face mapping fallback based on surface type and placement data. It may be ambiguous for repeated or coplanar faces.',
      high:
        'The implemented matching rules found a unique strong match. This is not a mathematical guarantee.',
      medium:
        'The implemented matching rules found a plausible match, but the evidence is weaker than a high-confidence match.',
      low: 'A weak match. Use with caution.',
      fallback:
        'A runtime fallback mapping, usually inferred in the frontend. It is not backend-confirmed.',
      ambiguous:
        'Multiple STEP entities matched the same evidence, so the system should not force a single mapping.',
      unmapped: 'No reliable STEP entity mapping is available for this visual element.',
    },
  },
  evidence: {
    boundary_edge_step_ids:
      'The STEP EDGE_CURVE ids found on the boundary of this visual face after edge mapping.',
    matched_step_face_edge_ids:
      'The boundary EDGE_CURVE ids of the matched STEP ADVANCED_FACE.',
    edge_set_jaccard:
      'Similarity between two edge sets. 1.0 means the sets are identical; lower values indicate partial overlap.',
    candidate_step_faces: 'Candidate ADVANCED_FACE entities considered during face mapping.',
    score:
      'A relative score used by the mapping algorithm. It helps compare candidates but is not a physical measurement.',
    bbox_similarity:
      'Similarity between bounding boxes. It is a weak auxiliary signal and should not be treated as definitive identity.',
    reason: 'A short explanation of why this mapping decision was made.',
    surface_type_match: 'Whether the mapped visual face and STEP face had compatible surface types.',
  },
  relation: {
    references: 'Entities directly referenced by the selected STEP entity.',
    referencedBy: 'Entities that reference the selected STEP entity.',
    faceNeighbors: 'Adjacent faces that share an EDGE_CURVE with the selected ADVANCED_FACE.',
    sharedEdge: 'The EDGE_CURVE through which two faces are adjacent.',
    role:
      'The semantic role of a reference, such as bounds, face_geometry, edge_element, or vertex_geometry.',
  },
  viewer: {
    pickMode: 'Controls which kind of 3D element can be selected: Auto, Face, Edge, or Vertex.',
    auto:
      'Automatically chooses among vertices, faces, and edges using the current picking priority and visibility rules.',
    face: 'Only faces can be selected. Useful when edge or vertex picking gets in the way.',
    edge: 'Only edges can be selected. Useful when you want to inspect EDGE_CURVE mappings.',
    vertex: 'Only vertices can be selected. Useful when inspecting VERTEX_POINT mappings.',
    transparentFaces:
      'Makes faces semi-transparent for inspection. In transparent mode, hidden or back-side elements may become selectable depending on picking rules.',
    opaque:
      'Faces are opaque. The viewer tries to prevent selecting edges or vertices hidden behind the front face.',
    selectedVisual: 'The 3D visual element currently linked to the selected STEP entity.',
    previewVisual:
      'The 3D visual element currently highlighted by hover preview. This does not change the selected entity.',
    noVisualObject:
      'The selected STEP entity has no corresponding face, edge, or vertex in model_mesh.json.',
    modelMesh:
      'The JSON file containing display mesh data and STEP-to-visual mapping for faces, edges, and vertices.',
    displayMode: 'Shows whether faces are currently opaque or transparent.',
    lastPicked: 'The most recent 3D picking result reported by the viewer.',
  },
  raw: {
    dataSection:
      'The part of the STEP file that contains numbered entities such as #120 = ADVANCED_FACE(...).',
    headerSection:
      'The part of the STEP file that contains metadata such as file name, schema, and authoring information.',
  },
  stepTypes: {
    ADVANCED_FACE:
      'A bounded portion of a geometric surface. It is defined by an underlying surface such as PLANE or CYLINDRICAL_SURFACE plus trimming boundaries.',
    EDGE_CURVE:
      'A topological edge with start and end vertices and an underlying geometric curve such as LINE, CIRCLE, or B_SPLINE_CURVE.',
    ORIENTED_EDGE:
      'A directed use of an underlying EDGE_CURVE. The same EDGE_CURVE can be used with different orientations.',
    EDGE_LOOP: 'An ordered loop of oriented edges used to define a face boundary.',
    FACE_BOUND:
      'A trimming loop of a face. It may represent an inner boundary, such as a hole loop.',
    FACE_OUTER_BOUND: 'The outer trimming loop of a face.',
    CLOSED_SHELL: 'A connected set of faces forming a closed boundary of a solid.',
    OPEN_SHELL: 'A connected set of faces that does not necessarily form a closed boundary.',
    MANIFOLD_SOLID_BREP:
      'A closed solid body represented by boundary surfaces. It usually contains an outer shell.',
    VERTEX_POINT: 'A topological vertex that refers to a geometric CARTESIAN_POINT.',
    CARTESIAN_POINT: 'A geometric point storing explicit coordinate values.',
    DIRECTION: 'A geometric direction storing vector ratios. It may not always be normalized.',
    VECTOR: 'A direction plus magnitude used by some curve definitions.',
    AXIS2_PLACEMENT_3D:
      'A 3D local coordinate placement with location, main axis, and reference direction.',
    AXIS2_PLACEMENT_2D: 'A 2D local coordinate placement with location and reference direction.',
    PLANE: 'An infinite planar surface positioned by a placement entity.',
    CYLINDRICAL_SURFACE:
      'An infinite cylindrical surface with an axis placement and radius.',
    CONICAL_SURFACE: 'An infinite conical surface with placement, radius, and semi-angle.',
    SPHERICAL_SURFACE: 'A spherical surface with a center placement and radius.',
    TOROIDAL_SURFACE: 'A torus surface with major and minor radius values.',
    LINE: 'A geometric line defined by a point and direction vector.',
    CIRCLE: 'A circle curve defined by a placement and radius.',
    ELLIPSE: 'An ellipse curve defined by a placement and two semi-axis lengths.',
    B_SPLINE_CURVE: 'A spline curve. This viewer may show it, but detailed spline expansion is limited.',
    B_SPLINE_CURVE_WITH_KNOTS:
      'A B-spline curve with knot data. This version keeps only limited normalized geometry for it.',
    B_SPLINE_SURFACE_WITH_KNOTS:
      'A B-spline surface with knot data. This version keeps only limited normalized geometry for it.',
    SURFACE_CURVE:
      'A curve associated with one or more surfaces. It may wrap a basis curve and p-curve data.',
    SEAM_CURVE:
      'A curve used on periodic surfaces such as cylinders or tori to represent a seam. It may have multiple p-curves in the surface parameter domain, so 3D endpoints alone may not fully identify it.',
    PCURVE:
      'A 2D curve in the parameter domain of a surface. It helps define how a 3D edge trims a face.',
    DEFINITIONAL_REPRESENTATION:
      'A STEP representation used to define supporting geometry such as p-curves.',
    ADVANCED_BREP_SHAPE_REPRESENTATION:
      'A STEP shape representation containing advanced B-Rep topology and geometry.',
  },
} as const

export function summaryTooltip(label: string): string | undefined {
  return lookup(TOOLTIP_TEXT.summary, label)
}

export function geometryTooltip(field: string): string | undefined {
  return lookup(TOOLTIP_TEXT.geometry, field) ?? mappingValueTooltip(field) ?? stepTypeTooltip(field)
}

export function evidenceTooltip(field: string): string | undefined {
  return lookup(TOOLTIP_TEXT.evidence, field)
}

export function mappingValueTooltip(value: string | null | undefined): string | undefined {
  return value ? lookup(TOOLTIP_TEXT.mapping.values, value) : undefined
}

export function stepTypeTooltip(value: string | null | undefined): string | undefined {
  return value ? lookup(TOOLTIP_TEXT.stepTypes, value) : undefined
}

export function treeLabelTooltip(label: string): string | undefined {
  const firstWord = label.split(/\s+/)[0]
  if (firstWord === 'Solid') return TOOLTIP_TEXT.stepTypes.MANIFOLD_SOLID_BREP
  if (firstWord === 'Shell') return TOOLTIP_TEXT.stepTypes.CLOSED_SHELL
  if (firstWord === 'Face') return TOOLTIP_TEXT.stepTypes.ADVANCED_FACE
  if (firstWord === 'Bound') {
    return label.includes('outer')
      ? TOOLTIP_TEXT.stepTypes.FACE_OUTER_BOUND
      : TOOLTIP_TEXT.stepTypes.FACE_BOUND
  }
  if (firstWord === 'Loop') return TOOLTIP_TEXT.stepTypes.EDGE_LOOP
  if (firstWord === 'OrientedEdge') return TOOLTIP_TEXT.stepTypes.ORIENTED_EDGE
  if (firstWord === 'EdgeCurve') return TOOLTIP_TEXT.stepTypes.EDGE_CURVE
  if (firstWord === 'Vertex') return TOOLTIP_TEXT.stepTypes.VERTEX_POINT
  return undefined
}

function lookup<T extends Record<string, string>>(record: T, key: string): string | undefined {
  const normalized = key.trim().replace(/\s+/g, '_').toLowerCase()
  const direct = record[key as keyof T]
  if (typeof direct === 'string') return direct
  const lower = record[normalized as keyof T]
  if (typeof lower === 'string') return lower
  const upper = record[key.trim().toUpperCase() as keyof T]
  return typeof upper === 'string' ? upper : undefined
}
