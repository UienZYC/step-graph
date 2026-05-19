import json
import re
from pathlib import Path


step_text = Path("examples/example.step").read_text(encoding="utf-8", errors="ignore")
graph = json.loads(Path("outputs/graph.json").read_text(encoding="utf-8"))

data = re.search(
    r"DATA\s*;(.*?)ENDSEC\s*;",
    step_text,
    flags=re.I | re.S,
).group(1)

step_count = len(re.findall(r"#\d+\s*=", data))
summary = graph["summary"]
entities = graph["entities"]
semantic_edges = graph["semantic_edges"]
brep_tree = graph["brep_tree"]
face_adjacency_graph = graph["face_adjacency_graph"]
type_index = graph["type_index"]

assert summary["entity_count"] == step_count
assert summary["skipped_count"] == 0
assert summary["semantic_edge_count"] == len(semantic_edges)
assert summary["semantic_edge_count"] > 0
assert isinstance(brep_tree["solids"], list)
assert brep_tree["summary"]["solid_count"] == len(type_index.get("MANIFOLD_SOLID_BREP", []))
assert brep_tree["summary"]["face_count"] == len(type_index.get("ADVANCED_FACE", []))
assert summary["solid_count"] == brep_tree["summary"]["solid_count"]
assert summary["face_count"] == brep_tree["summary"]["face_count"]
assert summary["face_adjacency_count"] == face_adjacency_graph["summary"]["adjacency_count"]
assert len(face_adjacency_graph["nodes"]) == len(type_index.get("ADVANCED_FACE", []))
assert face_adjacency_graph["edge_curve_to_faces"]
assert face_adjacency_graph["summary"]["adjacency_count"] == len(face_adjacency_graph["edges"])
assert face_adjacency_graph["summary"]["adjacency_count"] > 0
assert (
    face_adjacency_graph["summary"]["boundary_edge_count"]
    == len(face_adjacency_graph["boundary_edges"])
)
assert (
    face_adjacency_graph["summary"]["non_manifold_edge_count"]
    == len(face_adjacency_graph["non_manifold_edges"])
)

for entity in entities.values():
    if not entity.get("is_complex"):
        assert "fields" in entity


def first_entity(entity_type: str) -> dict:
    entity_ids = type_index.get(entity_type, [])
    assert entity_ids, f"Missing {entity_type}"
    return entities[entity_ids[0]]


advanced_face = first_entity("ADVANCED_FACE")
assert {"bounds", "face_geometry", "same_sense"} <= set(advanced_face["fields"])
assert any(edge["from"] == advanced_face["id"] and edge["role"] == "bounds" for edge in semantic_edges)
assert any(
    edge["from"] == advanced_face["id"] and edge["role"] == "face_geometry"
    for edge in semantic_edges
)

edge_curve = first_entity("EDGE_CURVE")
assert {"edge_start", "edge_end", "edge_geometry", "same_sense"} <= set(edge_curve["fields"])

axis = first_entity("AXIS2_PLACEMENT_3D")
assert {"location", "axis", "ref_direction"} <= set(axis["fields"])

if brep_tree["summary"]["solid_count"]:
    solid = brep_tree["solids"][0]
    assert "outer_shell" in solid
    assert solid["outer_shell"] is not None

    shell = solid["outer_shell"]
    assert "faces" in shell
    assert shell["faces"]

    face = shell["faces"][0]
    assert "surface" in face
    assert "bounds" in face
    assert face["surface"] is not None
    assert {"id", "type"} <= set(face["surface"])
    assert face["bounds"]

    outer_bound = next(
        (bound for bound in face["bounds"] if bound["role"] == "outer"),
        face["bounds"][0],
    )
    assert outer_bound["loop"] is not None
    assert outer_bound["loop"]["oriented_edges"]

    oriented_edge = outer_bound["loop"]["oriented_edges"][0]
    assert oriented_edge["edge_curve"] is not None

    edge_curve_node = oriented_edge["edge_curve"]
    assert "start" in edge_curve_node
    assert "end" in edge_curve_node
    assert "geometry" in edge_curve_node
    assert edge_curve_node["geometry"] is not None

adjacency_edge = face_adjacency_graph["edges"][0]
assert {
    "face1",
    "face2",
    "shared_edge_curve",
    "face1_oriented_edge",
    "face2_oriented_edge",
    "face1_orientation",
    "face2_orientation",
} <= set(adjacency_edge)

face1_neighbors = face_adjacency_graph["face_to_neighbors"][adjacency_edge["face1"]]
face2_neighbors = face_adjacency_graph["face_to_neighbors"][adjacency_edge["face2"]]
assert any(
    item["face"] == adjacency_edge["face2"]
    and item["shared_edge_curve"] == adjacency_edge["shared_edge_curve"]
    for item in face1_neighbors
)
assert any(
    item["face"] == adjacency_edge["face1"]
    and item["shared_edge_curve"] == adjacency_edge["shared_edge_curve"]
    for item in face2_neighbors
)

print("STEP count:", step_count)
print("JSON count:", summary["entity_count"])
print("Skipped:", summary["skipped_count"])
print("Semantic edges:", summary["semantic_edge_count"])
print("Solids:", brep_tree["summary"]["solid_count"])
print("Faces:", brep_tree["summary"]["face_count"])
print("Face adjacency edges:", face_adjacency_graph["summary"]["adjacency_count"])
print("Boundary edges:", face_adjacency_graph["summary"]["boundary_edge_count"])
print("Non-manifold edges:", face_adjacency_graph["summary"]["non_manifold_edge_count"])
print("Checks: OK")
