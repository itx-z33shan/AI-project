"""API and health-check tests using the Flask test client."""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_dashboard_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"CyberTrail", response.data)

    def test_scenarios_payload(self):
        response = self.client.get("/api/scenarios")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(len(payload), 3)
        first = payload[0]
        self.assertIn("nodes", first)
        self.assertIn("edges", first)
        self.assertEqual(first["node_count"], len(first["nodes"]))

    def test_algorithms_payload(self):
        response = self.client.get("/api/algorithms")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual([a["id"] for a in payload], ["bfs", "dfs", "ucs", "greedy", "astar", "hill"])

    def test_valid_search(self):
        body = {
            "scenario_id": "phishing-finance",
            "start": "phish-alert",
            "goal": "finance-db",
            "algorithms": ["bfs", "astar"],
        }
        response = self.client.post(
            "/api/search", data=json.dumps(body), content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(len(payload["results"]), 2)
        self.assertEqual([r["algorithm"] for r in payload["results"]], ["bfs", "astar"])
        for result in payload["results"]:
            self.assertTrue(result["reachable"])

    def test_compare_all_six(self):
        body = {
            "scenario_id": "ransomware-sweep",
            "start": "ransomware-alert",
            "goal": "domain-controller",
            "algorithms": ["bfs", "dfs", "ucs", "greedy", "astar", "hill"],
        }
        response = self.client.post(
            "/api/search", data=json.dumps(body), content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["results"]), 6)

    def test_unknown_scenario_rejected(self):
        body = {"scenario_id": "nope", "start": "a", "goal": "b", "algorithms": ["bfs"]}
        response = self.client.post(
            "/api/search", data=json.dumps(body), content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.get_json())

    def test_unknown_node_rejected(self):
        body = {
            "scenario_id": "phishing-finance",
            "start": "phish-alert",
            "goal": "not-a-node",
            "algorithms": ["bfs"],
        }
        response = self.client.post(
            "/api/search", data=json.dumps(body), content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)

    def test_start_equals_goal_rejected(self):
        body = {
            "scenario_id": "phishing-finance",
            "start": "phish-alert",
            "goal": "phish-alert",
            "algorithms": ["bfs"],
        }
        response = self.client.post(
            "/api/search", data=json.dumps(body), content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)

    def test_unknown_algorithm_rejected(self):
        body = {
            "scenario_id": "phishing-finance",
            "start": "phish-alert",
            "goal": "finance-db",
            "algorithms": ["magic"],
        }
        response = self.client.post(
            "/api/search", data=json.dumps(body), content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)

    def test_empty_algorithm_list_rejected(self):
        body = {
            "scenario_id": "phishing-finance",
            "start": "phish-alert",
            "goal": "finance-db",
            "algorithms": [],
        }
        response = self.client.post(
            "/api/search", data=json.dumps(body), content_type="application/json"
        )
        self.assertEqual(response.status_code, 400)

    def test_non_json_body_rejected(self):
        response = self.client.post("/api/search", data="not json")
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
