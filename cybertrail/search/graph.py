"""Directed synthetic telemetry graph used by every search algorithm."""

from __future__ import annotations

import math
from collections import deque
from typing import Dict, List


class Graph:
    """Adjacency-list directed graph with layout coordinates and edge costs.

    A node is a piece of synthetic evidence (alert, endpoint, asset, ...).
    An edge is an observed telemetry relationship whose ``cost`` is an
    illustrative analyst review effort (not a probability of compromise).
    """

    def __init__(self, nodes: List[dict], edges: List[dict]):
        self.nodes: Dict[str, dict] = {}
        for node in nodes:
            self.nodes[node["id"]] = dict(node)

        self.edges: List[dict] = [dict(e) for e in edges]
        self.adjacency: Dict[str, List[dict]] = {nid: [] for nid in self.nodes}

        for edge in self.edges:
            source, target = edge["source"], edge["target"]
            if source not in self.nodes or target not in self.nodes:
                raise ValueError(f"Edge references unknown node: {source} -> {target}")
            self.adjacency[source].append(edge)

        self._min_edge_cost = min((e["cost"] for e in self.edges), default=1)

    @property
    def node_ids(self) -> List[str]:
        return list(self.nodes.keys())

    def outgoing(self, node_id: str) -> List[dict]:
        return self.adjacency.get(node_id, [])

    def edge(self, source: str, target: str) -> dict | None:
        for candidate in self.adjacency.get(source, []):
            if candidate["target"] == target:
                return candidate
        return None

    def min_edge_cost(self) -> float:
        return self._min_edge_cost

    def distance(self, a: str, b: str) -> float:
        """Euclidean layout distance — the local cue used by Hill Climbing."""
        na, nb = self.nodes[a], self.nodes[b]
        return math.hypot(na["x"] - nb["x"], na["y"] - nb["y"])

    def reverse_hops(self, goal: str) -> Dict[str, int]:
        """Minimum hop count from every node that can reach ``goal``.

        Computed with BFS over the reversed graph. Nodes that cannot reach
        the goal are absent from the returned mapping.
        """
        reverse: Dict[str, List[str]] = {nid: [] for nid in self.nodes}
        for edge in self.edges:
            reverse[edge["target"]].append(edge["source"])

        hops = {goal: 0}
        queue: deque[str] = deque([goal])
        while queue:
            current = queue.popleft()
            for predecessor in reverse[current]:
                if predecessor not in hops:
                    hops[predecessor] = hops[current] + 1
                    queue.append(predecessor)
        return hops
