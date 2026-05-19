import argparse
import json
import re
from pathlib import Path


ENTITY_RE = re.compile(
    r"^\s*(#\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;?\s*$",
    re.I | re.S,
)

REF_RE = re.compile(r"#\d+")

ROLE_SCHEMAS = {
    "PRODUCT": ["id", "name", "description", "frame_of_reference"],
    "PRODUCT_DEFINITION": ["id", "description", "formation", "frame_of_reference"],
    "PRODUCT_DEFINITION_FORMATION": ["id", "description", "of_product"],
    "PRODUCT_DEFINITION_SHAPE": ["name", "description", "definition"],
    "SHAPE_DEFINITION_REPRESENTATION": ["definition", "used_representation"],
    "SHAPE_REPRESENTATION": ["name", "items", "context_of_items"],

    "MANIFOLD_SOLID_BREP": ["name", "outer"],
    "CLOSED_SHELL": ["name", "cfs_faces"],
    "OPEN_SHELL": ["name", "cfs_faces"],

    "ADVANCED_FACE": ["name", "bounds", "face_geometry", "same_sense"],
    "FACE_OUTER_BOUND": ["name", "bound", "orientation"],
    "FACE_BOUND": ["name", "bound", "orientation"],
    "EDGE_LOOP": ["name", "edge_list"],

    "ORIENTED_EDGE": ["name", "edge_start", "edge_end", "edge_element", "orientation"],
    "EDGE_CURVE": ["name", "edge_start", "edge_end", "edge_geometry", "same_sense"],
    "VERTEX_POINT": ["name", "vertex_geometry"],

    "CARTESIAN_POINT": ["name", "coordinates"],
    "DIRECTION": ["name", "direction_ratios"],
    "VECTOR": ["name", "orientation", "magnitude"],

    "AXIS2_PLACEMENT_3D": ["name", "location", "axis", "ref_direction"],
    "AXIS2_PLACEMENT_2D": ["name", "location", "ref_direction"],

    "PLANE": ["name", "position"],
    "CYLINDRICAL_SURFACE": ["name", "position", "radius"],
    "CONICAL_SURFACE": ["name", "position", "radius", "semi_angle"],
    "SPHERICAL_SURFACE": ["name", "position", "radius"],
    "TOROIDAL_SURFACE": ["name", "position", "major_radius", "minor_radius"],

    "LINE": ["name", "pnt", "dir"],
    "CIRCLE": ["name", "position", "radius"],
    "ELLIPSE": ["name", "position", "semi_axis_1", "semi_axis_2"],

    "B_SPLINE_CURVE_WITH_KNOTS": [
        "name",
        "degree",
        "control_points_list",
        "curve_form",
        "closed_curve",
        "self_intersect",
        "knot_multiplicities",
        "knots",
        "knot_spec",
    ],

    "B_SPLINE_SURFACE_WITH_KNOTS": [
        "name",
        "u_degree",
        "v_degree",
        "control_points_list",
        "surface_form",
        "u_closed",
        "v_closed",
        "self_intersect",
        "u_multiplicities",
        "v_multiplicities",
        "u_knots",
        "v_knots",
        "knot_spec",
    ],
}


def read_step(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return path.read_text(encoding="latin-1")


def get_section(text: str, name: str) -> str:
    m = re.search(
        rf"{name}\s*;(.*?)ENDSEC\s*;",
        text,
        flags=re.I | re.S,
    )
    return m.group(1).strip() if m else ""


def split_statements(text: str) -> list[str]:
    """按分号切分 STEP 语句，但忽略字符串中的分号。"""
    result = []
    buf = []
    in_string = False
    i = 0

    while i < len(text):
        ch = text[i]
        buf.append(ch)

        if ch == "'":
            # STEP 字符串里的单引号转义：''
            if in_string and i + 1 < len(text) and text[i + 1] == "'":
                buf.append(text[i + 1])
                i += 2
                continue
            in_string = not in_string

        elif ch == ";" and not in_string:
            stmt = "".join(buf).strip()
            if stmt:
                result.append(stmt)
            buf.clear()

        i += 1

    return result


def split_top_level_args(args_raw: str) -> list[str]:
    """Split entity args on commas that are not inside strings or parentheses."""
    result = []
    buf = []
    depth = 0
    in_string = False
    i = 0

    while i < len(args_raw):
        ch = args_raw[i]

        if ch == "'":
            buf.append(ch)
            if in_string and i + 1 < len(args_raw) and args_raw[i + 1] == "'":
                buf.append(args_raw[i + 1])
                i += 2
                continue
            in_string = not in_string

        elif not in_string:
            if ch == "(":
                depth += 1
                buf.append(ch)
            elif ch == ")":
                depth = max(0, depth - 1)
                buf.append(ch)
            elif ch == "," and depth == 0:
                result.append("".join(buf).strip())
                buf.clear()
            else:
                buf.append(ch)

        else:
            buf.append(ch)

        i += 1

    if buf or args_raw.strip():
        result.append("".join(buf).strip())

    return result


def extract_refs(value: str) -> list[str]:
    refs = []
    for ref in REF_RE.findall(value):
        if ref not in refs:
            refs.append(ref)
    return refs


def build_fields(entity: dict) -> dict:
    if entity.get("is_complex"):
        return {}

    args = split_top_level_args(entity.get("args_raw", ""))
    schema = ROLE_SCHEMAS.get(entity.get("type", ""), [])
    fields = {}

    for index, arg in enumerate(args):
        field_name = schema[index] if index < len(schema) else f"arg_{index}"
        refs = extract_refs(arg)
        is_aggregate = arg.startswith("(") and arg.endswith(")")

        if is_aggregate and refs:
            fields[field_name] = refs
        elif len(refs) == 1:
            fields[field_name] = refs[0]
        elif len(refs) > 1:
            fields[field_name] = refs
        else:
            fields[field_name] = arg

    return fields


def build_semantic_edges(entities: dict) -> list[dict]:
    semantic_edges = []

    for entity_id, entity in entities.items():
        from_type = entity.get("type", "UNKNOWN")

        for role, value in entity.get("fields", {}).items():
            refs = []
            if isinstance(value, str) and REF_RE.fullmatch(value):
                refs = [value]
            elif isinstance(value, list):
                refs = [
                    item
                    for item in value
                    if isinstance(item, str) and REF_RE.fullmatch(item)
                ]

            for ref in refs:
                target = entities.get(ref, {})
                semantic_edges.append(
                    {
                        "from": entity_id,
                        "to": ref,
                        "role": role,
                        "from_type": from_type,
                        "to_type": target.get("type", "UNKNOWN"),
                    }
                )

    return semantic_edges


def get_entity(entities: dict, entity_id: str) -> dict | None:
    return entities.get(entity_id)


def ref_list(value) -> list[str]:
    if isinstance(value, str) and REF_RE.fullmatch(value):
        return [value]
    if isinstance(value, list):
        return [
            item
            for item in value
            if isinstance(item, str) and REF_RE.fullmatch(item)
        ]
    return []


def basic_entity_node(entities: dict, entity_id: str) -> dict:
    entity = get_entity(entities, entity_id)
    if entity is None:
        return {"id": entity_id, "type": "UNKNOWN"}

    node = {
        "id": entity_id,
        "type": entity.get("type", "UNKNOWN"),
    }
    if "fields" in entity:
        node["fields"] = entity.get("fields", {})
    return node


def build_vertex_node(entities: dict, vertex_id: str) -> dict:
    entity = get_entity(entities, vertex_id)
    if entity is None:
        return {"id": vertex_id, "type": "UNKNOWN", "point": None}

    fields = entity.get("fields", {})
    point_refs = ref_list(fields.get("vertex_geometry"))
    point = None

    if point_refs:
        point_id = point_refs[0]
        point_entity = get_entity(entities, point_id)
        if point_entity is None:
            point = {"id": point_id, "type": "UNKNOWN"}
        else:
            point = {
                "id": point_id,
                "type": point_entity.get("type", "UNKNOWN"),
                "coordinates_raw": point_entity.get("fields", {}).get("coordinates"),
            }

    return {
        "id": vertex_id,
        "type": entity.get("type", "UNKNOWN"),
        "point": point,
    }


def build_curve_geometry_node(entities: dict, geometry_id: str) -> dict:
    return basic_entity_node(entities, geometry_id)


def build_edge_curve_node(entities: dict, edge_curve_id: str) -> dict:
    entity = get_entity(entities, edge_curve_id)
    if entity is None:
        return {
            "id": edge_curve_id,
            "type": "UNKNOWN",
            "same_sense": None,
            "start": None,
            "end": None,
            "geometry": None,
        }

    fields = entity.get("fields", {})
    start_refs = ref_list(fields.get("edge_start"))
    end_refs = ref_list(fields.get("edge_end"))
    geometry_refs = ref_list(fields.get("edge_geometry"))

    return {
        "id": edge_curve_id,
        "type": entity.get("type", "UNKNOWN"),
        "same_sense": fields.get("same_sense"),
        "start": build_vertex_node(entities, start_refs[0]) if start_refs else None,
        "end": build_vertex_node(entities, end_refs[0]) if end_refs else None,
        "geometry": (
            build_curve_geometry_node(entities, geometry_refs[0])
            if geometry_refs
            else None
        ),
    }


def build_oriented_edge_node(entities: dict, oriented_edge_id: str) -> dict:
    entity = get_entity(entities, oriented_edge_id)
    if entity is None:
        return {
            "id": oriented_edge_id,
            "type": "UNKNOWN",
            "orientation": None,
            "edge_curve": None,
        }

    fields = entity.get("fields", {})
    edge_refs = ref_list(fields.get("edge_element"))

    return {
        "id": oriented_edge_id,
        "type": entity.get("type", "UNKNOWN"),
        "orientation": fields.get("orientation"),
        "edge_curve": (
            build_edge_curve_node(entities, edge_refs[0]) if edge_refs else None
        ),
    }


def build_loop_node(entities: dict, loop_id: str) -> dict:
    entity = get_entity(entities, loop_id)
    if entity is None:
        return {"id": loop_id, "type": "UNKNOWN", "oriented_edges": []}

    fields = entity.get("fields", {})
    edge_ids = ref_list(fields.get("edge_list"))

    return {
        "id": loop_id,
        "type": entity.get("type", "UNKNOWN"),
        "oriented_edges": [
            build_oriented_edge_node(entities, edge_id) for edge_id in edge_ids
        ],
    }


def build_bound_node(entities: dict, bound_id: str) -> dict:
    entity = get_entity(entities, bound_id)
    if entity is None:
        return {
            "id": bound_id,
            "type": "UNKNOWN",
            "role": "unknown",
            "orientation": None,
            "loop": None,
        }

    entity_type = entity.get("type", "UNKNOWN")
    fields = entity.get("fields", {})
    loop_refs = ref_list(fields.get("bound"))

    if entity_type == "FACE_OUTER_BOUND":
        role = "outer"
    elif entity_type == "FACE_BOUND":
        role = "inner"
    else:
        role = "unknown"

    return {
        "id": bound_id,
        "type": entity_type,
        "role": role,
        "orientation": fields.get("orientation"),
        "loop": build_loop_node(entities, loop_refs[0]) if loop_refs else None,
    }


def build_surface_node(entities: dict, surface_id: str) -> dict:
    return basic_entity_node(entities, surface_id)


def build_face_node(entities: dict, face_id: str) -> dict:
    entity = get_entity(entities, face_id)
    if entity is None:
        return {
            "id": face_id,
            "type": "UNKNOWN",
            "same_sense": None,
            "surface": None,
            "bounds": [],
        }

    fields = entity.get("fields", {})
    surface_refs = ref_list(fields.get("face_geometry"))
    bound_ids = ref_list(fields.get("bounds"))

    return {
        "id": face_id,
        "type": entity.get("type", "UNKNOWN"),
        "same_sense": fields.get("same_sense"),
        "surface": (
            build_surface_node(entities, surface_refs[0]) if surface_refs else None
        ),
        "bounds": [
            build_bound_node(entities, bound_id) for bound_id in bound_ids
        ],
    }


def build_shell_node(entities: dict, shell_id: str) -> dict:
    entity = get_entity(entities, shell_id)
    if entity is None:
        return {"id": shell_id, "type": "UNKNOWN", "faces": []}

    fields = entity.get("fields", {})
    face_ids = ref_list(fields.get("cfs_faces"))

    return {
        "id": shell_id,
        "type": entity.get("type", "UNKNOWN"),
        "faces": [build_face_node(entities, face_id) for face_id in face_ids],
    }


def build_solid_node(entities: dict, solid_id: str) -> dict:
    entity = get_entity(entities, solid_id)
    if entity is None:
        return {"id": solid_id, "type": "UNKNOWN", "outer_shell": None}

    fields = entity.get("fields", {})
    shell_refs = ref_list(fields.get("outer"))

    return {
        "id": solid_id,
        "type": entity.get("type", "UNKNOWN"),
        "name": fields.get("name"),
        "outer_shell": (
            build_shell_node(entities, shell_refs[0]) if shell_refs else None
        ),
    }


def build_brep_tree(entities: dict, type_index: dict) -> dict:
    solid_ids = type_index.get("MANIFOLD_SOLID_BREP", [])

    return {
        "solids": [build_solid_node(entities, solid_id) for solid_id in solid_ids],
        "summary": {
            "solid_count": len(solid_ids),
            "shell_count": (
                len(type_index.get("CLOSED_SHELL", []))
                + len(type_index.get("OPEN_SHELL", []))
            ),
            "face_count": len(type_index.get("ADVANCED_FACE", [])),
            "edge_curve_count": len(type_index.get("EDGE_CURVE", [])),
            "vertex_point_count": len(type_index.get("VERTEX_POINT", [])),
        },
    }


def surface_info(entities: dict, face_id: str) -> dict | None:
    face = get_entity(entities, face_id)
    if face is None:
        return None

    surface_refs = ref_list(face.get("fields", {}).get("face_geometry"))
    if not surface_refs:
        return None

    surface_id = surface_refs[0]
    surface = get_entity(entities, surface_id)
    return {
        "id": surface_id,
        "type": surface.get("type", "UNKNOWN") if surface else "UNKNOWN",
    }


def collect_face_oriented_edges(entities: dict, face_id: str) -> list[dict]:
    face = get_entity(entities, face_id)
    if face is None:
        return []

    result = []
    bound_ids = ref_list(face.get("fields", {}).get("bounds"))

    for bound_id in bound_ids:
        bound = get_entity(entities, bound_id)
        if bound is None:
            continue

        loop_refs = ref_list(bound.get("fields", {}).get("bound"))
        if not loop_refs:
            continue

        loop_id = loop_refs[0]
        loop = get_entity(entities, loop_id)
        if loop is None:
            continue

        oriented_edge_ids = ref_list(loop.get("fields", {}).get("edge_list"))
        for oriented_edge_id in oriented_edge_ids:
            oriented_edge = get_entity(entities, oriented_edge_id)
            if oriented_edge is None:
                continue

            edge_refs = ref_list(oriented_edge.get("fields", {}).get("edge_element"))
            if not edge_refs:
                continue

            result.append(
                {
                    "face": face_id,
                    "bound": bound_id,
                    "bound_type": bound.get("type", "UNKNOWN"),
                    "loop": loop_id,
                    "oriented_edge": oriented_edge_id,
                    "orientation": oriented_edge.get("fields", {}).get("orientation"),
                    "edge_curve": edge_refs[0],
                }
            )

    return result


def build_edge_curve_to_faces(entities: dict, type_index: dict) -> dict:
    edge_curve_to_faces = {}

    for face_id in type_index.get("ADVANCED_FACE", []):
        for item in collect_face_oriented_edges(entities, face_id):
            edge_curve_to_faces.setdefault(item["edge_curve"], []).append(
                {
                    "face": item["face"],
                    "bound": item["bound"],
                    "bound_type": item["bound_type"],
                    "loop": item["loop"],
                    "oriented_edge": item["oriented_edge"],
                    "orientation": item["orientation"],
                }
            )

    return edge_curve_to_faces


def build_face_adjacency_nodes(entities: dict, type_index: dict) -> list[dict]:
    return [
        {
            "id": face_id,
            "type": "ADVANCED_FACE",
            "surface": surface_info(entities, face_id),
        }
        for face_id in type_index.get("ADVANCED_FACE", [])
    ]


def simplified_edge_uses(records: list[dict]) -> list[dict]:
    return [
        {
            "face": record.get("face"),
            "oriented_edge": record.get("oriented_edge"),
            "orientation": record.get("orientation"),
        }
        for record in records
    ]


def build_face_adjacency_edges(
    edge_curve_to_faces: dict,
) -> tuple[list[dict], list[dict], list[dict]]:
    adjacency_edges = []
    boundary_edges = []
    non_manifold_edges = []
    seen = set()

    for edge_curve, records in edge_curve_to_faces.items():
        if len(records) == 1:
            boundary_edges.append(
                {
                    "shared_edge_curve": edge_curve,
                    "uses": simplified_edge_uses(records),
                }
            )
            continue

        non_manifold = len(records) > 2
        if non_manifold:
            non_manifold_edges.append(
                {
                    "shared_edge_curve": edge_curve,
                    "uses": simplified_edge_uses(records),
                }
            )

        for i, first in enumerate(records):
            for second in records[i + 1:]:
                if first["face"] == second["face"]:
                    continue

                if first["face"] <= second["face"]:
                    face1_record = first
                    face2_record = second
                else:
                    face1_record = second
                    face2_record = first

                key = (
                    edge_curve,
                    face1_record["face"],
                    face2_record["face"],
                    face1_record["oriented_edge"],
                    face2_record["oriented_edge"],
                )
                if key in seen:
                    continue
                seen.add(key)

                adjacency_edges.append(
                    {
                        "face1": face1_record["face"],
                        "face2": face2_record["face"],
                        "shared_edge_curve": edge_curve,
                        "face1_oriented_edge": face1_record["oriented_edge"],
                        "face2_oriented_edge": face2_record["oriented_edge"],
                        "face1_orientation": face1_record["orientation"],
                        "face2_orientation": face2_record["orientation"],
                        "non_manifold": non_manifold,
                    }
                )

    return adjacency_edges, boundary_edges, non_manifold_edges


def build_face_to_neighbors(adjacency_edges: list[dict]) -> dict:
    face_to_neighbors = {}

    for edge in adjacency_edges:
        face1 = edge["face1"]
        face2 = edge["face2"]

        face_to_neighbors.setdefault(face1, []).append(
            {
                "face": face2,
                "shared_edge_curve": edge["shared_edge_curve"],
                "oriented_edge": edge["face1_oriented_edge"],
                "orientation": edge["face1_orientation"],
            }
        )
        face_to_neighbors.setdefault(face2, []).append(
            {
                "face": face1,
                "shared_edge_curve": edge["shared_edge_curve"],
                "oriented_edge": edge["face2_oriented_edge"],
                "orientation": edge["face2_orientation"],
            }
        )

    return face_to_neighbors


def build_face_adjacency_graph(entities: dict, type_index: dict) -> dict:
    nodes = build_face_adjacency_nodes(entities, type_index)
    edge_curve_to_faces = build_edge_curve_to_faces(entities, type_index)
    adjacency_edges, boundary_edges, non_manifold_edges = (
        build_face_adjacency_edges(edge_curve_to_faces)
    )

    return {
        "nodes": nodes,
        "edges": adjacency_edges,
        "face_to_neighbors": build_face_to_neighbors(adjacency_edges),
        "edge_curve_to_faces": edge_curve_to_faces,
        "boundary_edges": boundary_edges,
        "non_manifold_edges": non_manifold_edges,
        "summary": {
            "face_count": len(nodes),
            "edge_curve_count": len(edge_curve_to_faces),
            "adjacency_count": len(adjacency_edges),
            "boundary_edge_count": len(boundary_edges),
            "non_manifold_edge_count": len(non_manifold_edges),
        },
    }


def parse_entity(stmt: str) -> dict | None:
    raw = stmt.strip()

    # 普通 entity:
    # #12 = ADVANCED_FACE(...);
    simple_re = re.compile(
        r"^\s*(#\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;?\s*$",
        re.I | re.S,
    )

    m = simple_re.match(raw)
    if m:
        entity_id, entity_type, args_raw = m.groups()

        refs = []
        for ref in REF_RE.findall(args_raw):
            if ref not in refs:
                refs.append(ref)

        return {
            "id": entity_id,
            "type": entity_type.upper(),
            "args_raw": args_raw.strip(),
            "refs": refs,
            "raw": raw,
            "is_complex": False,
        }

    # complex entity:
    # #42 = ( TYPE_A(...) TYPE_B(...) TYPE_C(...) );
    any_re = re.compile(
        r"^\s*(#\d+)\s*=\s*(.*?)\s*;?\s*$",
        re.I | re.S,
    )

    m = any_re.match(raw)
    if not m:
        return None

    entity_id, rhs = m.groups()

    complex_types = re.findall(
        r"\b([A-Z0-9_]+)\s*\(",
        rhs,
        flags=re.I,
    )

    refs = []
    for ref in REF_RE.findall(rhs):
        if ref not in refs:
            refs.append(ref)

    return {
        "id": entity_id,
        "type": "COMPLEX_ENTITY",
        "complex_types": [t.upper() for t in complex_types],
        "args_raw": rhs.strip(),
        "refs": refs,
        "raw": raw,
        "is_complex": True,
    }

def parse_step(path: Path) -> dict:
    text = read_step(path)

    header = get_section(text, "HEADER")
    data = get_section(text, "DATA")

    if not data:
        raise ValueError("没有找到 DATA section，这可能不是有效的 STEP Part 21 文件。")

    entities = {}
    order = []
    skipped = []

    for stmt in split_statements(data):
        entity = parse_entity(stmt)
        if entity is None:
            skipped.append(stmt)
            continue

        entities[entity["id"]] = entity
        order.append(entity["id"])

    edges = [
        {"from": entity_id, "to": ref}
        for entity_id, entity in entities.items()
        for ref in entity["refs"]
    ]

    for entity in entities.values():
        entity["fields"] = build_fields(entity)

    semantic_edges = build_semantic_edges(entities)

    type_index = {}
    for entity_id, entity in entities.items():
        type_index.setdefault(entity["type"], []).append(entity_id)

    brep_tree = build_brep_tree(entities, type_index)
    face_adjacency_graph = build_face_adjacency_graph(entities, type_index)

    return {
        "source": str(path),
        "header_raw": header,
        "entities": entities,
        "edges": edges,
        "semantic_edges": semantic_edges,
        "brep_tree": brep_tree,
        "face_adjacency_graph": face_adjacency_graph,
        "type_index": type_index,
        "order": order,
        "skipped": skipped,
        "summary": {
            "entity_count": len(entities),
            "edge_count": len(edges),
            "semantic_edge_count": len(semantic_edges),
            "solid_count": brep_tree["summary"]["solid_count"],
            "face_count": brep_tree["summary"]["face_count"],
            "face_adjacency_count": (
                face_adjacency_graph["summary"]["adjacency_count"]
            ),
            "type_count": len(type_index),
            "skipped_count": len(skipped),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("step_file", type=Path)
    parser.add_argument("-o", "--output", type=Path, default=Path("graph.json"))
    args = parser.parse_args()

    graph = parse_step(args.step_file)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"输出文件: {args.output}")
    print(f"实体数量: {graph['summary']['entity_count']}")
    print(f"引用边数量: {graph['summary']['edge_count']}")
    print(f"语义引用边数量: {graph['summary']['semantic_edge_count']}")
    print(f"Solid 数量: {graph['brep_tree']['summary']['solid_count']}")
    print(f"Face 数量: {graph['brep_tree']['summary']['face_count']}")
    print(
        "Face 邻接边数量: "
        f"{graph['face_adjacency_graph']['summary']['adjacency_count']}"
    )
    print(
        "Boundary edge 数量: "
        f"{graph['face_adjacency_graph']['summary']['boundary_edge_count']}"
    )
    print(
        "Non-manifold edge 数量: "
        f"{graph['face_adjacency_graph']['summary']['non_manifold_edge_count']}"
    )
    print(f"实体类型数量: {graph['summary']['type_count']}")
    print(f"跳过语句数量: {graph['summary']['skipped_count']}")

    print("\n常见几何/拓扑实体统计:")
    for name in [
        "PRODUCT",
        "MANIFOLD_SOLID_BREP",
        "CLOSED_SHELL",
        "ADVANCED_FACE",
        "EDGE_LOOP",
        "ORIENTED_EDGE",
        "EDGE_CURVE",
        "VERTEX_POINT",
        "CARTESIAN_POINT",
        "PLANE",
        "CYLINDRICAL_SURFACE",
        "CIRCLE",
        "LINE",
    ]:
        count = len(graph["type_index"].get(name, []))
        if count:
            print(f"  {name}: {count}")


if __name__ == "__main__":
    main()
