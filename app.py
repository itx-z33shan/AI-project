from flask import Flask, jsonify, render_template, request
from pathlib import Path
import json
from search import ALGORITHMS, search_graph

app = Flask(__name__)
SCENARIOS_PATH = Path(__file__).parent / "data" / "scenarios.json"


def scenarios():
    return json.loads(SCENARIOS_PATH.read_text(encoding="utf-8"))


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/scenarios")
def list_scenarios():
    return jsonify(scenarios())


@app.get("/api/algorithms")
def list_algorithms():
    return jsonify(ALGORITHMS)


@app.post("/api/search")
def run_search():
    data = request.get_json(silent=True) or {}
    scenario_id = data.get("scenario_id")
    scenario = next((s for s in scenarios() if s["id"] == scenario_id), None)
    if scenario is None:
        return jsonify(error="Choose a valid investigation scenario."), 400
    start = data.get("start", scenario["start"])
    goal = data.get("goal", scenario["goal"])
    algorithms = data.get("algorithms", [data.get("algorithm", "astar")])
    if not isinstance(start, str) or not isinstance(goal, str):
        return jsonify(error="Start and target must be node IDs."), 400
    if not isinstance(algorithms, list) or not algorithms:
        return jsonify(error="Choose at least one search algorithm."), 400
    algorithms = [a for a in algorithms if a in ALGORITHMS]
    if not algorithms:
        return jsonify(error="Select at least one supported search algorithm."), 400
    node_ids = {node["id"] for node in scenario["nodes"]}
    if start not in node_ids or goal not in node_ids:
        return jsonify(error="Start and target must be nodes in the selected evidence graph."), 400
    if start == goal:
        return jsonify(error="Select a different start alert and target asset."), 400
    results = {}
    for algorithm in dict.fromkeys(algorithms):
        results[algorithm] = search_graph(scenario["nodes"], scenario["edges"], start, goal, algorithm)
    return jsonify(scenario={"id":scenario["id"],"name":scenario["name"]},start=start,goal=goal,results=results)


@app.get("/health")
def health():
    return {"status":"ok","service":"CyberTrail Investigation Search"}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
