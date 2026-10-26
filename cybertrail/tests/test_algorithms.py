"""Unit tests for the six search strategies."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from data.scenarios import SCENARIOS
from search.algorithms import run_algorithm
from search.graph import Graph

ALL_ALGORITHMS = ["bfs", "dfs", "ucs", "greedy", "astar", "hill"]


def scenario_graph(index=0):
    scenario = SCENARIOS[index]
    return Graph(scenario["nodes"], scenario["edges"])


def edge(source, target, cost=1, confidence=0.9, relationship="r"):
    return {
        "source": source,
        "target": target,
        "cost": cost,
        "confidence": confidence,
        "relationship": relationship,
    }


class ScenarioSmokeTests(unittest.TestCase):
    def test_all_algorithms_run_on_every_scenario(self):
        for scenario in SCENARIOS:
            graph = Graph(scenario["nodes"], scenario["edges"])
            for algo_id in ALL_ALGORITHMS:
                result = run_algorithm(
                    algo_id, graph, scenario["default_start"], scenario["default_goal"]
                )
                self.assertEqual(result["algorithm"], algo_id)
                self.assertIn("status", result)
                self.assertIn("path", result)
                self.assertIn("expanded", result)
                self.assertIsInstance(result["expanded_count"], int)
                self.assertGreaterEqual(result["runtime_ms"], 0.0)

    def test_complete_algorithms_reach_default_goals(self):
        complete = ["bfs", "dfs", "ucs", "greedy", "astar"]
        for scenario in SCENARIOS:
            graph = Graph(scenario["nodes"], scenario["edges"])
            for algo_id in complete:
                result = run_algorithm(
                    algo_id, graph, scenario["default_start"], scenario["default_goal"]
                )
                self.assertTrue(
                    result["reachable"],
                    f"{algo_id} should reach {scenario['default_goal']} in {scenario['id']}",
                )
                self.assertEqual(result["path"][0], scenario["default_start"])
                self.assertEqual(result["path"][-1], scenario["default_goal"])

    def test_ucs_and_astar_agree_on_optimal_cost(self):
        for scenario in SCENARIOS:
            graph = Graph(scenario["nodes"], scenario["edges"])
            ucs = run_algorithm(
                "ucs", graph, scenario["default_start"], scenario["default_goal"]
            )
            astar = run_algorithm(
                "astar", graph, scenario["default_start"], scenario["default_goal"]
            )
            self.assertTrue(ucs["reachable"] and astar["reachable"])
            self.assertEqual(ucs["path_cost"], astar["path_cost"])

    def test_astar_expands_no_more_nodes_than_ucs(self):
        scenario = SCENARIOS[0]
        graph = Graph(scenario["nodes"], scenario["edges"])
        ucs = run_algorithm("ucs", graph, "phish-alert", "finance-db")
        astar = run_algorithm("astar", graph, "phish-alert", "finance-db")
        self.assertLessEqual(astar["expanded_count"], ucs["expanded_count"])


class BFSTradeoffTests(unittest.TestCase):
    def setUp(self):
        # Direct 1-hop link is expensive (10); the 3-hop detour costs only 6.
        nodes = [
            {"id": "s", "label": "S", "type": "alert", "x": 0, "y": 0},
            {"id": "a", "label": "A", "type": "server", "x": 30, "y": 20},
            {"id": "b", "label": "B", "type": "server", "x": 60, "y": 20},
            {"id": "goal", "label": "G", "type": "asset", "x": 100, "y": 0},
        ]
        edges = [
            edge("s", "goal", cost=10),
            edge("s", "a", cost=2),
            edge("a", "b", cost=2),
            edge("b", "goal", cost=2),
        ]
        self.graph = Graph(nodes, edges)

    def test_bfs_prefers_fewest_hops(self):
        result = run_algorithm("bfs", self.graph, "s", "goal")
        self.assertEqual(result["path"], ["s", "goal"])
        self.assertEqual(result["path_links"], 1)
        self.assertEqual(result["path_cost"], 10)

    def test_ucs_prefers_cheapest_route(self):
        result = run_algorithm("ucs", self.graph, "s", "goal")
        self.assertEqual(result["path"], ["s", "a", "b", "goal"])
        self.assertEqual(result["path_cost"], 6)

    def test_astar_matches_ucs_cheapest_route(self):
        result = run_algorithm("astar", self.graph, "s", "goal")
        self.assertEqual(result["path_cost"], 6)


class HillClimbingTests(unittest.TestCase):
    def setUp(self):
        # A geometrically tempting decoy (close to goal on screen) is a dead end.
        nodes = [
            {"id": "s", "label": "S", "type": "alert", "x": 0, "y": 0},
            {"id": "decoy", "label": "Decoy", "type": "server", "x": 90, "y": 30},
            {"id": "good", "label": "Good", "type": "server", "x": 40, "y": 0},
            {"id": "mid", "label": "Mid", "type": "server", "x": 70, "y": 0},
            {"id": "goal", "label": "G", "type": "asset", "x": 100, "y": 0},
        ]
        edges = [
            edge("s", "decoy"),
            edge("s", "good"),
            edge("good", "mid"),
            edge("mid", "goal"),
        ]
        self.graph = Graph(nodes, edges)

    def test_hill_climbing_follows_decoy_into_dead_end(self):
        result = run_algorithm("hill", self.graph, "s", "goal")
        self.assertFalse(result["reachable"])
        self.assertEqual(result["status"], "dead_end")
        self.assertEqual(result["stuck_at"], "decoy")
        self.assertEqual(result["path"], [])

    def test_phishing_scenario_decoy_traps_hill_climbing(self):
        scenario = next(s for s in SCENARIOS if s["id"] == "phishing-finance")
        graph = Graph(scenario["nodes"], scenario["edges"])
        result = run_algorithm("hill", graph, "phish-alert", "finance-db")
        self.assertFalse(result["reachable"])
        self.assertEqual(result["stuck_at"], "decoy-relay")
        self.assertIn("decoy-relay", result["expanded"])


class UnreachableGoalTests(unittest.TestCase):
    def setUp(self):
        nodes = [
            {"id": "s", "label": "S", "type": "alert", "x": 0, "y": 0},
            {"id": "a", "label": "A", "type": "server", "x": 20, "y": 0},
            {"id": "goal", "label": "G", "type": "asset", "x": 100, "y": 0},
        ]
        edges = [edge("s", "a")]  # goal is disconnected
        self.graph = Graph(nodes, edges)

    def test_unreachable_goal_reported_by_complete_algorithms(self):
        for algo_id in ["bfs", "dfs", "ucs", "greedy", "astar"]:
            with self.subTest(algo=algo_id):
                result = run_algorithm(algo_id, self.graph, "s", "goal")
                self.assertFalse(result["reachable"])
                self.assertEqual(result["status"], "unreachable")
                self.assertEqual(result["path"], [])
                self.assertIsNone(result["path_cost"])

    def test_hill_climbing_reports_dead_end(self):
        result = run_algorithm("hill", self.graph, "s", "goal")
        self.assertFalse(result["reachable"])
        self.assertEqual(result["status"], "dead_end")
        self.assertEqual(result["stuck_at"], "a")


if __name__ == "__main__":
    unittest.main()
