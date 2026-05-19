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
import json
import math
from collections import defaultdict
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


def extract_face_mesh(face, face_index: int) -> tuple[dict | None, str | None]:
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
        "mapping_confidence": "unmapped",
    }, None


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


def round_vec(vec, ndigits: int = ROUND_DIGITS):
    if not is_point3(vec):
        return None
    return tuple(round(float(value), ndigits) for value in vec[:3])


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
            vertex["mapping_confidence"] = "high"
            mapped += 1
        elif len(candidates) > 1:
            vertex["mapping_confidence"] = "ambiguous"
            ambiguous += 1

    return vertices, {
        "vertex_mapping_method": "coordinate_signature",
        "vertex_mapped_count": mapped,
        "vertex_unmapped_count": len(vertices) - mapped,
        "vertex_ambiguous_count": ambiguous,
        "notes": notes,
    }


def build_step_edge_signatures(graph: dict) -> tuple[dict, list[str]]:
    signatures = defaultdict(list)
    notes = []

    for step_id, attr in graph.get("geometry_attributes", {}).items():
        if attr.get("type") != "EDGE_CURVE":
            continue
        signature = edge_signature(
            attr.get("edge_start_coordinates"),
            attr.get("edge_end_coordinates"),
            attr.get("edge_geometry_type"),
            edge_radius(attr),
        )
        if signature:
            signatures[signature].append(step_id)

    for signature, step_ids in signatures.items():
        if len(step_ids) > 1:
            notes.append(f"Ambiguous EDGE_CURVE signature {signature}: {step_ids}")

    return dict(signatures), notes


def map_edges_by_signature(edges: list[dict], graph: dict) -> tuple[list[dict], dict]:
    signatures, notes = build_step_edge_signatures(graph)
    mapped = 0
    ambiguous = 0

    for edge in edges:
        points = edge.get("points", [])
        signature = None
        if len(points) >= 2:
            signature = edge_signature(points[0], points[-1], edge.get("curve_type"), None)
        candidates = signatures.get(signature, []) if signature else []
        if len(candidates) == 1:
            edge["step_id"] = candidates[0]
            edge["mapping_confidence"] = "high"
            mapped += 1
        elif len(candidates) > 1:
            edge["mapping_confidence"] = "ambiguous"
            ambiguous += 1

    return edges, {
        "edge_mapping_method": "geometry_signature",
        "edge_mapped_count": mapped,
        "edge_unmapped_count": len(edges) - mapped,
        "edge_ambiguous_count": ambiguous,
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
            notes.append(f"Ambiguous ADVANCED_FACE signature {signature}: {step_ids}")

    return dict(signatures), notes


def map_faces_by_signature(faces: list[dict], graph: dict) -> tuple[list[dict], dict]:
    signatures, notes = build_step_face_signatures(graph)
    mapped = 0
    ambiguous = 0

    for face in faces:
        signature = face_signature(face.get("surface_type"), face.get("surface"))
        candidates = signatures.get(signature, []) if signature else []
        if len(candidates) == 1:
            face["step_id"] = candidates[0]
            face["mapping_confidence"] = "high"
            mapped += 1
        elif len(candidates) > 1:
            face["mapping_confidence"] = "ambiguous"
            ambiguous += 1

    method = "signature" if signatures else "unmapped_face_index_only"
    return faces, {
        "face_mapping_method": method,
        "face_mapped_count": mapped,
        "face_unmapped_count": len(faces) - mapped,
        "face_ambiguous_count": ambiguous,
        "notes": notes,
    }


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

    shape = read_step_shape(step_path)
    mesh_shape(shape, linear_deflection, angular_deflection)

    faces = []
    for index, face in enumerate(iter_faces(shape)):
        face_mesh, warning = extract_face_mesh(face, index)
        if warning:
            notes.append(warning)
        if face_mesh is not None:
            faces.append(face_mesh)

    edges = []
    for index, edge in enumerate(iter_edges(shape)):
        edge_mesh, warning = sample_edge_points(edge, index, edge_samples)
        if warning:
            notes.append(warning)
        edges.append(edge_mesh)

    vertices = [
        extract_vertex_marker(vertex, index)
        for index, vertex in enumerate(iter_vertices(shape))
    ]

    vertices, vertex_quality = map_vertices_by_coordinate(vertices, graph)
    edges, edge_quality = map_edges_by_signature(edges, graph)
    faces, face_quality = map_faces_by_signature(faces, graph)

    quality_notes = (
        notes
        + face_quality.pop("notes", [])
        + edge_quality.pop("notes", [])
        + vertex_quality.pop("notes", [])
    )

    model_mesh = {
        "source": {
            "step_file": str(step_path),
            "graph_file": str(graph_path) if graph_path else None,
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


def normalize_curve_type(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    aliases = {
        "B_SPLINE_CURVE_WITH_KNOTS": "B_SPLINE_CURVE",
        "B_SPLINE_CURVE": "B_SPLINE_CURVE",
    }
    return aliases.get(value, value)


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
