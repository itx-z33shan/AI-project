"""CyberTrail — AI-assisted cyber investigation search dashboard.

Flask entry point. Serves the single-page dashboard and a small JSON API
that runs educational search algorithms over synthetic evidence graphs.
"""

from __future__ import annotations

from flask import Flask, jsonify, render_template, request

from data.scenarios import NODE_TYPES, SCENARIOS
from search.algorithms import ALGORITHM_METADATA, run_algorithm
from search.graph import Graph

app = Flask(__name__)

_SCENARIO_BY_ID = {scenario["id"]: scenario for scenario in SCENARIOS}
_ALGORITHM_IDS = {item["id"] for item in ALGORITHM_METADATA}


def _public_scenario(scenario: dict) -> dict:
    """Scenario payload enriched with graph statistics for the UI."""
    return {
        "id": scenario["id"],
        "name": scenario["name"],
        "brief": scenario["brief"],
        "default_start": scenario["default_start"],
        "default_goal": scenario["default_goal"],
        "node_types": NODE_TYPES,
        "node_count": len(scenario["nodes"]),
        "edge_count": len(scenario["edges"]),
        "nodes": scenario["nodes"],
        "edges": scenario["edges"],
    }


@app.get("/")
def dashboard():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({"status": "ok", "service": "cybertrail"})


@app.get("/api/scenarios")
def get_scenarios():
    return jsonify([_public_scenario(s) for s in SCENARIOS])


@app.get("/api/algorithms")
def get_algorithms():
    return jsonify(ALGORITHM_METADATA)


@app.post("/api/search")
def post_search():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    scenario_id = body.get("scenario_id")
    scenario = _SCENARIO_BY_ID.get(scenario_id)
    if scenario is None:
        return (
            jsonify({"error": f"Unknown scenario_id: {scenario_id!r}."}),
            400,
        )

    graph = Graph(scenario["nodes"], scenario["edges"])
    start = body.get("start")
    goal = body.get("goal")

    if not isinstance(start, str) or start not in graph.nodes:
        return jsonify({"error": "Start node is missing or not in this scenario."}), 400
    if not isinstance(goal, str) or goal not in graph.nodes:
        return jsonify({"error": "Goal node is missing or not in this scenario."}), 400
    if start == goal:
        return jsonify({"error": "Start and goal must be different nodes."}), 400

    algorithms = body.get("algorithms")
    if not isinstance(algorithms, list) or not algorithms:
        return jsonify({"error": "Provide a non-empty 'algorithms' list."}), 400
    if not all(isinstance(a, str) for a in algorithms):
        return jsonify({"error": "Algorithm ids must be strings."}), 400

    unknown = [a for a in algorithms if a not in _ALGORITHM_IDS]
    if unknown:
        return jsonify({"error": f"Unknown algorithm id(s): {', '.join(unknown)}."}), 400

    # Preserve the caller's order while removing accidental duplicates.
    ordered_ids = list(dict.fromkeys(algorithms))
    results = [run_algorithm(algo_id, graph, start, goal) for algo_id in ordered_ids]

    return jsonify(
        {
            "scenario_id": scenario_id,
            "start": start,
            "goal": goal,
            "results": results,
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
