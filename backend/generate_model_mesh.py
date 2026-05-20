from __future__ import annotations

"""Generate a three.js display mesh with best-effort STEP entity ids.

This script uses OCP / cadquery-ocp, the OCCT binding used by the CadQuery
ecosystem. Install it manually in the backend environment:

    uv add cadquery-ocp

If VTK-related dependencies are a concern, try:

    uv add cadquery-ocp-novtk

The output is custom JSON, not STL. STL drops STEP/B-Rep semantic ids such as
ADVANCED_FACE, EDGE_CURVE, and VERTEX_POINT.
"""

import argparse
import hashlib
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from OCP.BRep import BRep_Tool
    from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
    from OCP.BRepMesh import BRepMesh_IncrementalMesh
    from OCP.GeomAbs import (
        GeomAbs_BSplineCurve,
        GeomAbs_BSplineSurface,
        GeomAbs_Circle,
        GeomAbs_Cone,
        GeomAbs_Cylinder,
        GeomAbs_Ellipse,
        GeomAbs_Line,
        GeomAbs_Plane,
        GeomAbs_Sphere,
        GeomAbs_Torus,
    )
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_REVERSED, TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopLoc import TopLoc_Location
    from OCP.TopoDS import TopoDS

    OCP_IMPORT_ERROR: ImportError | None = None
except ImportError as exc:
    OCP_IMPORT_ERROR = exc


DEFAULT_LINEAR_DEFLECTION = 0.1
DEFAULT_ANGULAR_DEFLECTION = 0.5
DEFAULT_EDGE_SAMPLES = 24
ROUND_DIGITS = 6


def compute_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_ocp() -> None:
    if OCP_IMPORT_ERROR is None:
        return
    raise RuntimeError(
        "OCP / cadquery-ocp is required for generate_model_mesh.py.\n"
        "Install it manually from the backend directory:\n"
        "  uv add cadquery-ocp\n"
        "Or, to try a smaller package without VTK-related dependencies:\n"
        "  uv add cadquery-ocp-novtk"
    ) from OCP_IMPORT_ERROR


def load_graph(graph_path: Path | None) -> dict:
    if graph_path is None:
        return {"_warning": "No graph.json path was provided. STEP id mapping is disabled."}
    if not graph_path.exists():
        return {
            "_warning": f"graph.json not found: {graph_path}. Mesh will be exported without STEP id mapping."
        }

    try:
        return json.loads(graph_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return {
            "_warning": f"graph.json is not valid JSON: {graph_path}: {exc}. Mesh will be exported without STEP id mapping."
        }


def read_step_shape(step_path: Path):
    require_ocp()
    reader = STEPControl_Reader()
    status = reader.ReadFile(str(step_path))
    if status != IFSelect_RetDone:
        raise RuntimeError(f"Failed to read STEP file: {step_path}")

    transferred = reader.TransferRoots()
    if transferred == 0:
        raise RuntimeError(f"STEP file was read, but no roots were transferred: {step_path}")

    shape = reader.OneShape()
    if shape.IsNull():
        raise RuntimeError(f"STEP transfer produced a null shape: {step_path}")
    return shape


def mesh_shape(shape, linear_deflection: float, angular_deflection: float) -> None:
    require_ocp()
    mesher = BRepMesh_IncrementalMesh(
        shape,
        linear_deflection,
        False,
        angular_deflection,
        True,
    )
    mesher.Perform()
    if hasattr(mesher, "IsDone") and not mesher.IsDone():
        raise RuntimeError("OCP / OCCT meshing did not complete.")


def iter_faces(shape) -> list:
    return explore_shapes(shape, TopAbs_FACE, cast_face)


def iter_edges(shape) -> list:
    return explore_shapes(shape, TopAbs_EDGE, cast_edge)


def iter_vertices(shape) -> list:
    return explore_shapes(shape, TopAbs_VERTEX, cast_vertex)


def explore_shapes(shape, shape_kind, caster) -> list:
    require_ocp()
    explorer = TopExp_Explorer(shape, shape_kind)
    items = []
    while explorer.More():
        items.append(caster(explorer.Current()))
        explorer.Next()
    return items


def cast_face(shape):
    return TopoDS.Face_s(shape) if hasattr(TopoDS, "Face_s") else shape


def cast_edge(shape):
    return TopoDS.Edge_s(shape) if hasattr(TopoDS, "Edge_s") else shape


def cast_vertex(shape):
    return TopoDS.Vertex_s(shape) if hasattr(TopoDS, "Vertex_s") else shape


def point_to_list(pnt) -> list[float]:
    return [float(pnt.X()), float(pnt.Y()), float(pnt.Z())]


def apply_location_to_point(pnt, location) -> list[float]:
    try:
        transformed = pnt.Transformed(location.Transformation())
    except AttributeError:
        transformed = pnt
        transformed.Transform(location.Transformation())
    return point_to_list(transformed)


def bbox_of_points(points: list[list[float]]) -> dict | None:
    valid = [point for point in points if is_point3(point)]
    if not valid:
        return None

    return {
        "min": [min(point[index] for point in valid) for index in range(3)],
        "max": [max(point[index] for point in valid) for index in range(3)],
    }


def surface_type_of_face(face) -> str:
    require_ocp()
    try:
        adaptor = BRepAdaptor_Surface(face)
        return surface_type_name(adaptor.GetType())
    except Exception:
        return "UNKNOWN"


def curve_type_of_edge(edge) -> str:
    require_ocp()
    try:
        adaptor = BRepAdaptor_Curve(edge)
        return curve_type_name(adaptor.GetType())
    except Exception:
        return "UNKNOWN"


def estimate_triangle_normal(
    vertices: list[list[float]],
    triangles: list[list[int]],
) -> list[float] | None:
    for i, j, k in triangles:
        if min(i, j, k) < 0 or max(i, j, k) >= len(vertices):
            continue
        p0, p1, p2 = vertices[i], vertices[j], vertices[k]
        normal = cross(subtract(p1, p0), subtract(p2, p0))
        length = math.sqrt(sum(value * value for value in normal))
        if length > 1e-12:
            return [value / length for value in normal]
    return None


def extract_face_mesh(
    face,
    face_index: int,
    global_edges: list | None = None,
) -> tuple[dict | None, str | None]:
    require_ocp()
    location = TopLoc_Location()
    triangulation = brep_tool("Triangulation", face, location)
    if triangulation is None:
        return None, f"Face {face_index} has no triangulation and was skipped."

    vertices = []
    for node_index in range(1, triangulation.NbNodes() + 1):
        vertices.append(apply_location_to_point(triangulation.Node(node_index), location))

    triangles = []
    reversed_face = face.Orientation() == TopAbs_REVERSED
    for triangle_index in range(1, triangulation.NbTriangles() + 1):
        indices = triangle_indices(triangulation.Triangle(triangle_index))
        zero_based = [index - 1 for index in indices]
        if reversed_face:
            zero_based = [zero_based[0], zero_based[2], zero_based[1]]
        triangles.append(zero_based)

    surface = surface_properties(face)
    return {
        "step_id": None,
        "face_index": face_index,
        "kind": "ADVANCED_FACE",
        "surface_type": surface.get("surface_type", "UNKNOWN"),
        "vertices": vertices,
        "triangles": triangles,
        "normal": estimate_triangle_normal(vertices, triangles),
        "bbox": bbox_of_points(vertices),
        "surface": compact_surface(surface),
        "edge_indices": extract_ocp_face_edge_indices(face, global_edges or []),
        "mapping_source": "none",
        "mapping_method": "unmapped",
        "mapping_confidence": "unmapped",
    }, None


def extract_ocp_face_edge_indices(face, global_edges: list) -> list[int]:
    if not global_edges:
        return []

    indices = []
    for face_edge in iter_edges(face):
        for edge_index, global_edge in enumerate(global_edges):
            if same_topods_shape(face_edge, global_edge):
                indices.append(edge_index)
                break
    return sorted(set(indices))


def same_topods_shape(first, second) -> bool:
    for method_name in ("IsSame", "IsEqual"):
        method = getattr(first, method_name, None)
        if method is None:
            continue
        try:
            if method(second):
                return True
        except Exception:
            pass
    return False


def triangle_indices(triangle) -> list[int]:
    if hasattr(triangle, "Get"):
        values = triangle.Get()
        return [int(values[0]), int(values[1]), int(values[2])]
    return [int(triangle.Value(index)) for index in range(1, 4)]


def sample_edge_points(
    edge,
    edge_index: int,
    samples: int = DEFAULT_EDGE_SAMPLES,
) -> tuple[dict, str | None]:
    require_ocp()
    points = []
    warning = None
    curve_type = "UNKNOWN"

    try:
        adaptor = BRepAdaptor_Curve(edge)
        curve_type = curve_type_name(adaptor.GetType())
        first = float(adaptor.FirstParameter())
        last = float(adaptor.LastParameter())

        if not math.isfinite(first) or not math.isfinite(last) or first == last:
            warning = f"Edge {edge_index} has invalid curve parameter range."
        else:
            sample_count = max(2, samples)
            for index in range(sample_count):
                ratio = index / (sample_count - 1)
                parameter = first + (last - first) * ratio
                points.append(point_to_list(adaptor.Value(parameter)))
    except Exception as exc:
        warning = f"Edge {edge_index} could not be sampled: {exc}"

    return {
        "step_id": None,
        "edge_index": edge_index,
        "kind": "EDGE_CURVE",
        "curve_type": curve_type,
        "points": points,
        "bbox": bbox_of_points(points),
        "mapping_source": "none",
        "mapping_method": "unmapped",
        "mapping_confidence": "unmapped",
    }, warning


def extract_vertex_marker(vertex, vertex_index: int) -> dict:
    require_ocp()
    pnt = brep_tool("Pnt", vertex)
    return {
        "step_id": None,
        "vertex_index": vertex_index,
        "kind": "VERTEX_POINT",
        "position": point_to_list(pnt),
        "mapping_source": "none",
        "mapping_method": "unmapped",
        "mapping_confidence": "unmapped",
    }


def surface_properties(face) -> dict:
    require_ocp()
    props = {"surface_type": surface_type_of_face(face)}

    try:
        adaptor = BRepAdaptor_Surface(face)
        surface_type = props["surface_type"]
        if surface_type == "PLANE":
            axis = adaptor.Plane().Axis()
            props["origin"] = point_to_list(axis.Location())
            props["axis_direction"] = direction_to_list(axis.Direction())
        elif surface_type == "CYLINDRICAL_SURFACE":
            cylinder = adaptor.Cylinder()
            axis = cylinder.Axis()
            props["origin"] = point_to_list(axis.Location())
            props["axis_direction"] = direction_to_list(axis.Direction())
            props["radius"] = float(cylinder.Radius())
        elif surface_type == "CONICAL_SURFACE":
            cone = adaptor.Cone()
            axis = cone.Axis()
            props["origin"] = point_to_list(axis.Location())
            props["axis_direction"] = direction_to_list(axis.Direction())
            props["radius"] = float(cone.RefRadius())
            props["semi_angle"] = float(cone.SemiAngle())
        elif surface_type == "SPHERICAL_SURFACE":
            sphere = adaptor.Sphere()
            props["origin"] = point_to_list(sphere.Location())
            props["radius"] = float(sphere.Radius())
        elif surface_type == "TOROIDAL_SURFACE":
            torus = adaptor.Torus()
            axis = torus.Axis()
            props["origin"] = point_to_list(axis.Location())
            props["axis_direction"] = direction_to_list(axis.Direction())
            props["major_radius"] = float(torus.MajorRadius())
            props["minor_radius"] = float(torus.MinorRadius())
    except Exception:
        pass

    return props


def brep_tool(function_name: str, *args):
    if hasattr(BRep_Tool, function_name):
        return getattr(BRep_Tool, function_name)(*args)

    static_name = f"{function_name}_s"
    if hasattr(BRep_Tool, static_name):
        return getattr(BRep_Tool, static_name)(*args)

    raise AttributeError(f"BRep_Tool has no {function_name} or {static_name}")


def compact_surface(surface: dict) -> dict:
    keep = {
        "origin",
        "axis_direction",
        "radius",
        "semi_angle",
        "major_radius",
        "minor_radius",
    }
    return {key: value for key, value in surface.items() if key in keep}


def surface_type_name(kind) -> str:
    names = {
        GeomAbs_Plane: "PLANE",
        GeomAbs_Cylinder: "CYLINDRICAL_SURFACE",
        GeomAbs_Cone: "CONICAL_SURFACE",
        GeomAbs_Sphere: "SPHERICAL_SURFACE",
        GeomAbs_Torus: "TOROIDAL_SURFACE",
        GeomAbs_BSplineSurface: "B_SPLINE_SURFACE",
    }
    return names.get(kind, "UNKNOWN")


def curve_type_name(kind) -> str:
    names = {
        GeomAbs_Line: "LINE",
        GeomAbs_Circle: "CIRCLE",
        GeomAbs_Ellipse: "ELLIPSE",
        GeomAbs_BSplineCurve: "B_SPLINE_CURVE",
    }
    return names.get(kind, "UNKNOWN")


def direction_to_list(direction) -> list[float]:
    return [float(direction.X()), float(direction.Y()), float(direction.Z())]


def round_number(x: Any, ndigits: int = ROUND_DIGITS) -> float | None:
    try:
        value = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(value):
        return None
    rounded = round(value, ndigits)
    return 0.0 if rounded == 0 else rounded


def round_vec(vec, ndigits: int = ROUND_DIGITS):
    if not is_point3(vec):
        return None
    rounded = [round_number(value, ndigits) for value in vec[:3]]
    if any(value is None for value in rounded):
        return None
    return tuple(rounded)


def build_step_vertex_signatures(graph: dict) -> tuple[dict, list[str]]:
    signatures = defaultdict(list)
    notes = []

    for step_id, attr in graph.get("geometry_attributes", {}).items():
        if attr.get("type") != "VERTEX_POINT":
            continue
        signature = vertex_signature(attr.get("coordinates"))
        if signature:
            signatures[signature].append(step_id)

    for signature, step_ids in signatures.items():
        if len(step_ids) > 1:
            notes.append(f"Ambiguous VERTEX_POINT signature {signature}: {step_ids}")

    return dict(signatures), notes


def map_vertices_by_coordinate(vertices: list[dict], graph: dict) -> tuple[list[dict], dict]:
    signatures, notes = build_step_vertex_signatures(graph)
    mapped = 0
    ambiguous = 0

    for vertex in vertices:
        signature = vertex_signature(vertex.get("position"))
        candidates = signatures.get(signature, []) if signature else []
        if len(candidates) == 1:
            vertex["step_id"] = candidates[0]
            set_mapping_metadata(vertex, "backend", "coordinate_signature", "high")
            mapped += 1
        elif len(candidates) > 1:
            set_mapping_metadata(vertex, "none", "ambiguous", "ambiguous")
            ambiguous += 1
        else:
            set_mapping_metadata(vertex, "none", "unmapped", "unmapped")

    return vertices, {
        "vertex_mapping_method": "coordinate_signature",
        "vertex_mapped_count": mapped,
        "vertex_unmapped_count": len(vertices) - mapped,
        "vertex_ambiguous_count": ambiguous,
        "notes": notes,
    }


def set_mapping_metadata(
    element: dict,
    source: str,
    method: str,
    confidence: str,
) -> None:
    element["mapping_source"] = source
    element["mapping_method"] = method
    element["mapping_confidence"] = confidence


def make_directionless_endpoint_signature(p1: Any, p2: Any):
    first = round_vec(p1)
    second = round_vec(p2)
    if first is None or second is None:
        return None
    return tuple(sorted([first, second]))


def resolve_edge_geometry_type(edge_attr: dict, graph: dict) -> str:
    edge_geometry_type = normalize_curve_type(edge_attr.get("edge_geometry_type"))
    if edge_geometry_type in {"LINE", "CIRCLE", "ELLIPSE", "B_SPLINE_CURVE"}:
        return edge_geometry_type

    edge_geometry_id = edge_attr.get("edge_geometry")
    entities = graph.get("entities", {})
    geometry_attributes = graph.get("geometry_attributes", {})
    entity = entities.get(edge_geometry_id, {}) if isinstance(edge_geometry_id, str) else {}

    refs = []
    fields = entity.get("fields", {}) if isinstance(entity, dict) else {}
    for key in ("curve_3d", "basis_curve", "arg_1"):
        refs.extend(collect_refs(fields.get(key)))
    refs.extend(collect_refs(entity.get("refs") if isinstance(entity, dict) else None))
    refs.extend(collect_refs(fields))

    for ref in refs:
        attr_type = normalize_curve_type(geometry_attributes.get(ref, {}).get("type"))
        entity_type = normalize_curve_type(entities.get(ref, {}).get("type"))
        resolved = attr_type if attr_type != "UNKNOWN" else entity_type
        if resolved in {"LINE", "CIRCLE", "ELLIPSE", "B_SPLINE_CURVE"}:
            return resolved

    return edge_geometry_type


def collect_refs(value: Any) -> list[str]:
    refs = []
    if isinstance(value, str):
        if value.startswith("#") and value[1:].isdigit():
            refs.append(value)
    elif isinstance(value, list):
        for item in value:
            refs.extend(collect_refs(item))
    elif isinstance(value, dict):
        for item in value.values():
            refs.extend(collect_refs(item))
    return refs


def build_step_edge_signatures(graph: dict) -> tuple[dict, dict]:
    signatures = defaultdict(list)
    step_edge_debug = {}

    for step_id, attr in graph.get("geometry_attributes", {}).items():
        if attr.get("type") != "EDGE_CURVE":
            continue
        endpoint_signature = make_directionless_endpoint_signature(
            attr.get("edge_start_coordinates"),
            attr.get("edge_end_coordinates"),
        )
        if endpoint_signature is None:
            continue
        curve_type = resolve_edge_geometry_type(attr, graph)
        signature = (curve_type, endpoint_signature)
        if signature:
            signatures[signature].append(step_id)
            step_edge_debug[step_id] = {
                "signature": signature,
                "endpoint_signature": endpoint_signature,
                "curve_type": curve_type,
                "p1": attr.get("edge_start_coordinates"),
                "p2": attr.get("edge_end_coordinates"),
            }

    return dict(signatures), step_edge_debug


def make_ocp_edge_signature(edge_mesh: dict):
    points = edge_mesh.get("points", [])
    if not isinstance(points, list) or len(points) < 2:
        return None
    endpoint_signature = make_directionless_endpoint_signature(points[0], points[-1])
    if endpoint_signature is None:
        return None
    curve_type = normalize_curve_type(edge_mesh.get("curve_type"))
    return (curve_type, endpoint_signature)


def map_edges_by_signature(edges: list[dict], graph: dict) -> tuple[list[dict], dict]:
    signatures, step_edge_debug = build_step_edge_signatures(graph)
    endpoint_signatures = defaultdict(list)
    notes = []
    mapped = 0
    ambiguous = 0
    endpoint_fallback_count = 0

    for step_id, debug in step_edge_debug.items():
        endpoint_signatures[debug["endpoint_signature"]].append(step_id)

    for signature, step_ids in signatures.items():
        if len(step_ids) > 1:
            notes.append(
                "Ambiguous EDGE_CURVE endpoint_curve_signature "
                f"{signature}: candidates {step_ids}; affected edges keep step_id null."
            )

    for endpoint_signature, step_ids in endpoint_signatures.items():
        if len(step_ids) > 1:
            notes.append(
                "Endpoint-only EDGE_CURVE fallback would be ambiguous "
                f"for signature {endpoint_signature}: candidates {step_ids}; "
                "typed endpoint_curve_signature may still resolve these edges."
            )

    for edge in edges:
        signature = make_ocp_edge_signature(edge)
        candidates = signatures.get(signature, []) if signature else []
        if len(candidates) == 1:
            edge["step_id"] = candidates[0]
            set_mapping_metadata(edge, "backend", "endpoint_curve_signature", "high")
            edge["resolved_curve_type"] = signature[0]
            mapped += 1
            continue

        if len(candidates) > 1:
            set_mapping_metadata(edge, "none", "ambiguous", "ambiguous")
            ambiguous += 1
            notes.append(
                f"Edge {edge.get('edge_index')} ambiguous endpoint_curve_signature {signature}: "
                f"candidates {candidates}; leaving step_id null."
            )
            continue

        endpoint_signature = signature[1] if signature else None
        endpoint_candidates = (
            endpoint_signatures.get(endpoint_signature, []) if endpoint_signature else []
        )
        if len(endpoint_candidates) == 1:
            edge["step_id"] = endpoint_candidates[0]
            set_mapping_metadata(edge, "backend", "endpoint_only_signature", "medium")
            edge["resolved_curve_type"] = signature[0] if signature else "UNKNOWN"
            mapped += 1
            endpoint_fallback_count += 1
            notes.append(
                f"Used endpoint-only fallback for edge_index {edge.get('edge_index')} -> {endpoint_candidates[0]}"
            )
        elif len(endpoint_candidates) > 1:
            set_mapping_metadata(edge, "none", "ambiguous", "ambiguous")
            ambiguous += 1
            notes.append(
                f"Edge {edge.get('edge_index')} ambiguous endpoint_only_signature {endpoint_signature}: "
                f"candidates {endpoint_candidates}; leaving step_id null."
            )
        else:
            set_mapping_metadata(edge, "none", "unmapped", "unmapped")

    unmapped = len(edges) - mapped - ambiguous
    if edges and mapped == 0:
        notes.append(
            "All edge STEP id mapping failed. Check whether geometry_attributes contains EDGE_CURVE endpoint coordinates and whether OCP edge endpoints use same units/tolerance."
        )

    return edges, {
        "edge_mapping_method": "endpoint_curve_signature",
        "edge_mapped_count": mapped,
        "edge_unmapped_count": unmapped,
        "edge_ambiguous_count": ambiguous,
        "edge_endpoint_fallback_count": endpoint_fallback_count,
        "notes": notes,
    }


def build_step_face_signatures(graph: dict) -> tuple[dict, list[str]]:
    signatures = defaultdict(list)
    notes = []

    for step_id, attr in graph.get("geometry_attributes", {}).items():
        if attr.get("type") != "ADVANCED_FACE":
            continue
        signature = face_signature(attr.get("surface_type"), attr.get("surface"))
        if signature:
            signatures[signature].append(step_id)

    for signature, step_ids in signatures.items():
        if len(step_ids) > 1:
            notes.append(
                "Ambiguous ADVANCED_FACE surface_signature "
                f"{signature}: candidates {step_ids}; affected faces keep step_id null."
            )

    return dict(signatures), notes


def build_step_face_boundary_edge_sets(graph: dict) -> dict:
    result = {}

    for face_node in collect_brep_face_nodes(graph.get("brep_tree")):
        face_id = face_node.get("id")
        if not isinstance(face_id, str):
            continue
        edge_ids = sorted(collect_edge_curve_ids_from_node(face_node.get("bounds")))
        if edge_ids:
            result[face_id] = {
                "edge_ids": edge_ids,
                "surface_type": face_node.get("surface", {}).get("type")
                if isinstance(face_node.get("surface"), dict)
                else None,
                "bound_count": len(face_node.get("bounds", []))
                if isinstance(face_node.get("bounds"), list)
                else 0,
                "edge_count": len(edge_ids),
            }

    for face_id, attr in graph.get("geometry_attributes", {}).items():
        if attr.get("type") != "ADVANCED_FACE" or face_id in result:
            continue
        edge_ids = sorted(collect_entity_face_edge_ids(graph, face_id))
        if edge_ids:
            result[face_id] = {
                "edge_ids": edge_ids,
                "surface_type": attr.get("surface_type"),
                "bound_count": len(graph.get("entities", {}).get(face_id, {}).get("fields", {}).get("bounds", [])),
                "edge_count": len(edge_ids),
            }

    return result


def collect_brep_face_nodes(value: Any) -> list[dict]:
    faces = []

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        if node.get("type") == "ADVANCED_FACE" and isinstance(node.get("id"), str):
            faces.append(node)
            return
        for item in node.values():
            visit(item)

    visit(value)
    return faces


def collect_edge_curve_ids_from_node(value: Any) -> set[str]:
    edge_ids = set()

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                visit(item)
            return
        if not isinstance(node, dict):
            return
        if node.get("type") == "EDGE_CURVE" and isinstance(node.get("id"), str):
            edge_ids.add(node["id"])
            return
        for item in node.values():
            visit(item)

    visit(value)
    return edge_ids


def collect_entity_face_edge_ids(graph: dict, face_id: str) -> set[str]:
    entities = graph.get("entities", {})
    face = entities.get(face_id, {})
    fields = face.get("fields", {}) if isinstance(face, dict) else {}
    pending = collect_refs(fields.get("bounds"))
    visited = set()
    edge_ids = set()

    while pending:
        entity_id = pending.pop()
        if entity_id in visited:
            continue
        visited.add(entity_id)
        entity = entities.get(entity_id, {})
        if not isinstance(entity, dict):
            continue
        if entity.get("type") == "EDGE_CURVE":
            edge_ids.add(entity_id)
            continue
        entity_fields = entity.get("fields", {})
        if isinstance(entity_fields, dict):
            pending.extend(collect_refs(entity_fields))
        pending.extend(collect_refs(entity.get("refs")))

    return edge_ids


def map_faces_by_boundary_edge_set(
    faces: list[dict],
    edges: list[dict],
    graph: dict,
) -> tuple[list[dict], dict]:
    boundary_sets = build_step_face_boundary_edge_sets(graph)
    boundary_signatures = defaultdict(list)
    signatures, _surface_notes = build_step_face_signatures(graph)
    notes = []
    mapped = 0
    ambiguous = 0
    boundary_mapped = 0
    boundary_partial_mapped = 0
    surface_mapped = 0

    for face_id, data in boundary_sets.items():
        signature = frozenset(data.get("edge_ids", []))
        if signature:
            boundary_signatures[signature].append(face_id)

    for face in faces:
        edge_set = face_boundary_step_edge_ids(face, edges)
        face["boundary_edge_step_ids"] = sorted(edge_set)
        face["mapping_evidence"] = make_face_mapping_evidence(edge_set)

        if edge_set:
            exact_candidates = boundary_signatures.get(frozenset(edge_set), [])
            exact_candidate_entries = face_candidate_entries(
                exact_candidates,
                score=1.0,
                reason="exact boundary edge set match",
            )
            if len(exact_candidates) == 1:
                matched_face_id = exact_candidates[0]
                face["step_id"] = matched_face_id
                set_mapping_metadata(face, "backend", "boundary_edge_set", "high")
                set_face_mapping_evidence(
                    face,
                    boundary_sets,
                    candidate_step_faces=exact_candidate_entries,
                    reason="exact boundary edge set match",
                    matched_step_face_id=matched_face_id,
                    edge_set_jaccard=1.0,
                )
                mapped += 1
                boundary_mapped += 1
                continue
            if len(exact_candidates) > 1:
                set_mapping_metadata(face, "none", "ambiguous", "ambiguous")
                set_face_mapping_evidence(
                    face,
                    boundary_sets,
                    candidate_step_faces=exact_candidate_entries,
                    reason="ambiguous candidates",
                    edge_set_jaccard=1.0,
                )
                ambiguous += 1
                notes.append(
                    f"Face index {face.get('face_index')} has ambiguous ADVANCED_FACE candidates: "
                    f"{', '.join(exact_candidates)}"
                )
                continue

            partial_candidates = partial_boundary_matches(edge_set, boundary_sets)
            if partial_candidates:
                top_score = partial_candidates[0]["score"]
                best_candidates = [
                    item
                    for item in partial_candidates
                    if math.isclose(item["score"], top_score, abs_tol=1e-9)
                ]
                if len(best_candidates) > 1:
                    set_mapping_metadata(face, "none", "ambiguous", "ambiguous")
                    set_face_mapping_evidence(
                        face,
                        boundary_sets,
                        candidate_step_faces=face_candidate_entries(
                            [item["face_id"] for item in partial_candidates],
                            score_by_face_id={
                                item["face_id"]: item["score"]
                                for item in partial_candidates
                            },
                            reason="partial boundary edge set match",
                        ),
                        reason="ambiguous candidates",
                    )
                    ambiguous += 1
                    notes.append(
                        f"Face index {face.get('face_index')} has ambiguous ADVANCED_FACE candidates: "
                        f"{', '.join(item['face_id'] for item in best_candidates)}"
                    )
                    continue

                partial = partial_candidates[0]
                matched_face_id = partial["face_id"]
                face["step_id"] = matched_face_id
                set_mapping_metadata(face, "backend", "boundary_edge_set_partial", "medium")
                set_face_mapping_evidence(
                    face,
                    boundary_sets,
                    candidate_step_faces=face_candidate_entries(
                        [item["face_id"] for item in partial_candidates],
                        score_by_face_id={
                            item["face_id"]: item["score"]
                            for item in partial_candidates
                        },
                        reason="partial boundary edge set match",
                    ),
                    reason="partial boundary edge set match",
                    matched_step_face_id=matched_face_id,
                    edge_set_jaccard=partial["score"],
                )
                mapped += 1
                boundary_partial_mapped += 1
                notes.append(
                    f"Face {face.get('face_index')} mapped by partial boundary_edge_set "
                    f"to {matched_face_id} with Jaccard {partial['score']:.3f}."
                )
                continue

        signature = face_signature(face.get("surface_type"), face.get("surface"))
        candidates = signatures.get(signature, []) if signature else []
        surface_candidate_entries = face_candidate_entries(
            candidates,
            score=1.0,
            reason="surface signature match",
        )
        if len(candidates) == 1:
            matched_face_id = candidates[0]
            face["step_id"] = matched_face_id
            set_mapping_metadata(face, "backend", "surface_signature", "medium")
            set_face_mapping_evidence(
                face,
                boundary_sets,
                candidate_step_faces=surface_candidate_entries,
                reason="surface signature fallback match",
                matched_step_face_id=matched_face_id,
                edge_set_jaccard=(
                    edge_set_jaccard(
                        edge_set,
                        set(boundary_sets.get(matched_face_id, {}).get("edge_ids", [])),
                    )
                    if edge_set
                    else None
                ),
            )
            mapped += 1
            surface_mapped += 1
        elif len(candidates) > 1:
            set_mapping_metadata(face, "none", "ambiguous", "ambiguous")
            set_face_mapping_evidence(
                face,
                boundary_sets,
                candidate_step_faces=surface_candidate_entries,
                reason="ambiguous candidates",
            )
            ambiguous += 1
            notes.append(
                f"Face index {face.get('face_index')} has ambiguous ADVANCED_FACE candidates: "
                f"{', '.join(candidates)}"
            )
        else:
            set_mapping_metadata(face, "none", "unmapped", "unmapped")
            set_face_mapping_evidence(
                face,
                boundary_sets,
                candidate_step_faces=[],
                reason="no matching ADVANCED_FACE",
            )

    method = "boundary_edge_set" if boundary_sets else "surface_signature" if signatures else "unmapped"
    return faces, {
        "face_mapping_method": method,
        "face_mapped_count": mapped,
        "face_unmapped_count": len(faces) - mapped - ambiguous,
        "face_ambiguous_count": ambiguous,
        "face_boundary_edge_set_mapped_count": boundary_mapped,
        "face_boundary_edge_set_partial_mapped_count": boundary_partial_mapped,
        "face_surface_signature_mapped_count": surface_mapped,
        "notes": notes,
    }


def face_boundary_step_edge_ids(face: dict, edges: list[dict]) -> set[str]:
    edge_ids = set()
    for edge_index in face.get("edge_indices", []):
        if not isinstance(edge_index, int) or edge_index < 0 or edge_index >= len(edges):
            continue
        step_id = edges[edge_index].get("step_id")
        if isinstance(step_id, str):
            edge_ids.add(step_id)
    return edge_ids


def make_face_mapping_evidence(edge_set: set[str]) -> dict:
    return {
        "boundary_edge_step_ids": sorted(edge_set),
        "matched_step_face_edge_ids": None,
        "edge_set_jaccard": None,
        "candidate_step_faces": [],
        "surface_type_match": None,
        "bbox_similarity": None,
    }


def set_face_mapping_evidence(
    face: dict,
    boundary_sets: dict,
    candidate_step_faces: list[dict],
    reason: str,
    matched_step_face_id: str | None = None,
    edge_set_jaccard: float | None = None,
) -> None:
    evidence = face.setdefault(
        "mapping_evidence",
        make_face_mapping_evidence(set(face.get("boundary_edge_step_ids", []))),
    )
    evidence["candidate_step_faces"] = candidate_step_faces
    evidence["reason"] = reason
    evidence["edge_set_jaccard"] = rounded_evidence_score(edge_set_jaccard)
    evidence["bbox_similarity"] = None

    if matched_step_face_id:
        matched_data = boundary_sets.get(matched_step_face_id, {})
        matched_edge_ids = matched_data.get("edge_ids", [])
        evidence["matched_step_face_edge_ids"] = sorted(matched_edge_ids)
        evidence["surface_type_match"] = surface_type_matches(face, matched_data)


def face_candidate_entries(
    face_ids: list[str],
    score: float | None = None,
    score_by_face_id: dict[str, float] | None = None,
    reason: str = "",
) -> list[dict]:
    entries = []
    for face_id in face_ids:
        candidate_score = score_by_face_id.get(face_id) if score_by_face_id else score
        entries.append(
            {
                "step_id": face_id,
                "score": rounded_evidence_score(candidate_score),
                "reason": reason,
            }
        )
    return entries


def surface_type_matches(face: dict, step_face_boundary_data: dict) -> bool | None:
    face_type = face.get("surface_type")
    step_face_type = step_face_boundary_data.get("surface_type")
    if not isinstance(face_type, str) or not isinstance(step_face_type, str):
        return None
    return normalize_surface_type(face_type) == normalize_surface_type(step_face_type)


def rounded_evidence_score(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 6)


def edge_set_jaccard(first: set[str], second: set[str]) -> float | None:
    union = first | second
    if not union:
        return None
    return len(first & second) / len(union)


def partial_boundary_matches(
    edge_set: set[str],
    boundary_sets: dict,
    threshold: float = 0.8,
) -> list[dict]:
    scored = []
    for face_id, data in boundary_sets.items():
        candidate = set(data.get("edge_ids", []))
        score = edge_set_jaccard(edge_set, candidate)
        if score is not None and score >= threshold:
            scored.append({"face_id": face_id, "score": score})

    return sorted(scored, key=lambda item: item["score"], reverse=True)


def best_partial_boundary_match(edge_set: set[str], boundary_sets: dict):
    scored = []
    for face_id, data in boundary_sets.items():
        candidate = set(data.get("edge_ids", []))
        if not candidate:
            continue
        union = edge_set | candidate
        if not union:
            continue
        score = len(edge_set & candidate) / len(union)
        if score >= 0.8:
            scored.append({"face_id": face_id, "score": score})

    scored.sort(key=lambda item: item["score"], reverse=True)
    if not scored:
        return None
    if len(scored) > 1 and math.isclose(scored[0]["score"], scored[1]["score"], abs_tol=1e-9):
        return None
    return scored[0]


def build_model_mesh(
    step_path: Path,
    graph_path: Path | None,
    output_path: Path,
    linear_deflection: float,
    angular_deflection: float,
    edge_samples: int,
) -> dict:
    notes = []
    graph = load_graph(graph_path)
    if graph.get("_warning"):
        notes.append(graph["_warning"])
    graph_file_sha256 = (
        compute_file_sha256(graph_path)
        if graph_path is not None and graph_path.exists()
        else None
    )

    shape = read_step_shape(step_path)
    mesh_shape(shape, linear_deflection, angular_deflection)

    ocp_faces = iter_faces(shape)
    ocp_edges = iter_edges(shape)
    ocp_vertices = iter_vertices(shape)

    faces = []
    for index, face in enumerate(ocp_faces):
        face_mesh, warning = extract_face_mesh(face, index, ocp_edges)
        if warning:
            notes.append(warning)
        if face_mesh is not None:
            faces.append(face_mesh)

    edges = []
    for index, edge in enumerate(ocp_edges):
        edge_mesh, warning = sample_edge_points(edge, index, edge_samples)
        if warning:
            notes.append(warning)
        edges.append(edge_mesh)

    vertices = [
        extract_vertex_marker(vertex, index)
        for index, vertex in enumerate(ocp_vertices)
    ]

    vertices, vertex_quality = map_vertices_by_coordinate(vertices, graph)
    edges, edge_quality = map_edges_by_signature(edges, graph)
    faces, face_quality = map_faces_by_boundary_edge_set(faces, edges, graph)

    quality_notes = (
        notes
        + face_quality.pop("notes", [])
        + edge_quality.pop("notes", [])
        + vertex_quality.pop("notes", [])
    )

    model_mesh = {
        "source": {
            "step_file": str(step_path),
            "step_file_name": step_path.name,
            "step_file_sha256": compute_file_sha256(step_path),
            "graph_file": str(graph_path) if graph_path else None,
            "graph_file_sha256": graph_file_sha256,
            "generator": "generate_model_mesh.py",
            "generated_at": utc_timestamp(),
        },
        "backend": "OCP",
        "units": "unknown",
        "mapping_quality": {
            **face_quality,
            **edge_quality,
            **vertex_quality,
            "notes": quality_notes,
        },
        "faces": faces,
        "edges": edges,
        "vertices": vertices,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(model_mesh, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return model_mesh


def vertex_signature(point: Any):
    rounded = round_vec(point)
    return ("VERTEX_POINT", *rounded) if rounded else None


def edge_signature(start: Any, end: Any, curve_type: Any, radius: Any):
    start_signature = round_vec(start)
    end_signature = round_vec(end)
    if start_signature is None or end_signature is None:
        return None
    endpoints = tuple(sorted([start_signature, end_signature]))
    normalized_type = normalize_curve_type(curve_type)
    return (normalized_type, endpoints, rounded_optional(radius))


def face_signature(surface_type: Any, surface: Any):
    if not isinstance(surface_type, str):
        return None
    surface_dict = surface if isinstance(surface, dict) else {}
    return (
        normalize_surface_type(surface_type),
        rounded_optional(surface_dict.get("radius")),
        round_vec(surface_dict.get("origin")),
        round_vec(surface_dict.get("axis_direction")),
    )


def edge_radius(attr: dict):
    geometry = attr.get("geometry")
    if isinstance(geometry, dict):
        return geometry.get("radius")
    return None


def normalize_curve_type(value: Any) -> str:
    if not isinstance(value, str):
        return "UNKNOWN"
    normalized = value.upper()
    if normalized.startswith("GEOMABS_"):
        normalized = normalized.removeprefix("GEOMABS_")
    aliases = {
        "LINE": "LINE",
        "CIRCLE": "CIRCLE",
        "ELLIPSE": "ELLIPSE",
        "B_SPLINE_CURVE_WITH_KNOTS": "B_SPLINE_CURVE",
        "B_SPLINE_CURVE": "B_SPLINE_CURVE",
        "BSPLINE_CURVE": "B_SPLINE_CURVE",
        "SURFACE_CURVE": "SURFACE_CURVE",
        "SEAM_CURVE": "SEAM_CURVE",
        "BOUNDED_CURVE": "BOUNDED_CURVE",
        "COMPOSITE_CURVE": "COMPOSITE_CURVE",
        "UNKNOWN": "UNKNOWN",
    }
    return aliases.get(normalized, normalized)


def normalize_surface_type(value: str) -> str:
    aliases = {
        "B_SPLINE_SURFACE_WITH_KNOTS": "B_SPLINE_SURFACE",
        "B_SPLINE_SURFACE": "B_SPLINE_SURFACE",
    }
    return aliases.get(value, value)


def rounded_optional(value: Any) -> float | None:
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return round(float(value), ROUND_DIGITS)
    return None


def is_point3(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) >= 3
        and all(
            isinstance(item, (int, float)) and math.isfinite(float(item))
            for item in value[:3]
        )
    )


def subtract(a: list[float], b: list[float]) -> list[float]:
    return [a[index] - b[index] for index in range(3)]


def cross(a: list[float], b: list[float]) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate three.js-friendly display mesh JSON from STEP using OCP / cadquery-ocp."
    )
    parser.add_argument("step_file", type=Path)
    parser.add_argument("-g", "--graph", type=Path, default=Path("outputs/graph.json"))
    parser.add_argument("-o", "--output", type=Path, default=Path("outputs/model_mesh.json"))
    parser.add_argument("--linear-deflection", type=float, default=DEFAULT_LINEAR_DEFLECTION)
    parser.add_argument("--angular-deflection", type=float, default=DEFAULT_ANGULAR_DEFLECTION)
    parser.add_argument("--edge-samples", type=int, default=DEFAULT_EDGE_SAMPLES)
    args = parser.parse_args()

    model_mesh = build_model_mesh(
        step_path=args.step_file,
        graph_path=args.graph,
        output_path=args.output,
        linear_deflection=args.linear_deflection,
        angular_deflection=args.angular_deflection,
        edge_samples=args.edge_samples,
    )
    quality = model_mesh["mapping_quality"]
    face_count = len(model_mesh["faces"])
    edge_count = len(model_mesh["edges"])
    vertex_count = len(model_mesh["vertices"])

    print("OCP backend: ok")
    print(f"Faces: {face_count}")
    print(f"Edges: {edge_count}")
    print(f"Vertices: {vertex_count}")
    print(f"Face mapped: {quality.get('face_mapped_count', 0)} / {face_count}")
    print(f"Edge mapped: {quality.get('edge_mapped_count', 0)} / {edge_count}")
    print(f"Vertex mapped: {quality.get('vertex_mapped_count', 0)} / {vertex_count}")
    print(f"Written: {args.output}")
    if quality.get("notes"):
        print(f"Warnings: {len(quality['notes'])}")


if __name__ == "__main__":
    main()
