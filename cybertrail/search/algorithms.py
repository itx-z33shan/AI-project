"""The six educational search strategies over the evidence graph."""

from __future__ import annotations

import heapq
import time
from collections import deque
from typing import Dict, List, Optional

from .graph import Graph

# Large finite stand-in for an infinite heuristic (node cannot reach goal).
INF = 10**9

ALGORITHM_METADATA: List[dict] = [
    {
        "id": "bfs",
        "name": "Breadth-First Search",
        "short": "BFS",
        "family": "Uninformed",
        "evaluation": "FIFO queue",
        "guarantee": "Hop-optimal",
        "optimal": True,
        "description": "Expands every node one hop away before going deeper. Finds the route with the fewest evidence links while ignoring differences in review cost.",
    },
    {
        "id": "dfs",
        "name": "Depth-First Search",
        "short": "DFS",
        "family": "Uninformed",
        "evaluation": "LIFO stack",
        "guarantee": "No optimality guarantee",
        "optimal": False,
        "description": "Dives as deep as possible along each branch before backtracking. Cheap on memory but the returned route depends on edge order and is not optimal.",
    },
    {
        "id": "ucs",
        "name": "Uniform-Cost Search",
        "short": "UCS",
        "family": "Uninformed",
        "evaluation": "Min accumulated cost g(n)",
        "guarantee": "Cost-optimal (positive costs)",
        "optimal": True,
        "description": "Always expands the node with the smallest accumulated review cost. Returns the least-effort route whenever every edge cost is positive.",
    },
    {
        "id": "greedy",
        "name": "Greedy Best-First Search",
        "short": "Greedy",
        "family": "Informed",
        "evaluation": "Estimated remaining hops h(n)",
        "guarantee": "No optimality guarantee",
        "optimal": False,
        "description": "Chases the node that looks fewest hops from the target. Goal-directed and fast, yet it ignores the effort already spent and can pick costly links.",
    },
    {
        "id": "astar",
        "name": "A* Search",
        "short": "A*",
        "family": "Informed",
        "evaluation": "f(n) = g(n) + h(n)",
        "guarantee": "Cost-optimal (admissible h)",
        "optimal": True,
        "description": "Balances spent effort g(n) against an admissible lower-bound heuristic h(n), giving the least-cost route while exploring fewer nodes than UCS.",
    },
    {
        "id": "hill",
        "name": "Hill Climbing",
        "short": "Hill",
        "family": "Local search",
        "evaluation": "Neighbor nearest to the target",
        "guarantee": "Incomplete — local optima & dead ends",
        "optimal": False,
        "description": "Moves only to the adjacent node that looks geometrically closer to the target. Low-memory, but a convincing decoy can lure it into a dead end.",
    },
]

_METADATA_BY_ID = {item["id"]: item for item in ALGORITHM_METADATA}


def _reconstruct(parent: Dict[str, Optional[str]], goal: str) -> List[str]:
    if goal not in parent:
        return []
    path: List[str] = []
    current: Optional[str] = goal
    seen = set()
    while current is not None:
        if current in seen:  # defensive against cycles
            break
        seen.add(current)
        path.append(current)
        current = parent[current]
    path.reverse()
    return path


def _path_cost(graph: Graph, path: List[str]) -> Optional[float]:
    if not path:
        return None
    total = 0.0
    for source, target in zip(path, path[1:]):
        edge = graph.edge(source, target)
        if edge is None:
            return None
        total += edge["cost"]
    return total


def _build_result(
    algorithm: str,
    graph: Graph,
    goal: str,
    expanded: List[str],
    parent: Dict[str, Optional[str]],
    runtime_ms: float,
    status: Optional[str] = None,
    stuck_at: Optional[str] = None,
) -> dict:
    path = _reconstruct(parent, goal)
    reachable = bool(path) and path[-1] == goal
    if status is None:
        status = "success" if reachable else "unreachable"
    return {
        "algorithm": algorithm,
        "status": status,
        "reachable": reachable,
        "path": path,
        "path_links": max(len(path) - 1, 0),
        "path_cost": _path_cost(graph, path),
        "expanded": expanded,
        "expanded_count": len(expanded),
        "runtime_ms": round(runtime_ms, 3),
        "stuck_at": stuck_at,
    }


# --------------------------------------------------------------------------- #
# Individual strategies
# --------------------------------------------------------------------------- #

def _bfs(graph: Graph, start: str, goal: str):
    queue = deque([start])
    discovered = {start}
    parent: Dict[str, Optional[str]] = {start: None}
    expanded: List[str] = []

    while queue:
        current = queue.popleft()
        expanded.append(current)
        if current == goal:
            break
        for edge in graph.outgoing(current):
            neighbor = edge["target"]
            if neighbor not in discovered:
                discovered.add(neighbor)
                parent[neighbor] = current
                queue.append(neighbor)
    return expanded, parent, None


def _dfs(graph: Graph, start: str, goal: str):
    stack = [start]
    parent: Dict[str, Optional[str]] = {start: None}
    visited: set[str] = set()
    expanded: List[str] = []

    while stack:
        current = stack.pop()
        if current in visited:
            continue
        visited.add(current)
        expanded.append(current)
        if current == goal:
            break
        # Reverse so the first declared edge is explored first (LIFO order).
        for edge in reversed(graph.outgoing(current)):
            neighbor = edge["target"]
            if neighbor not in visited and neighbor not in parent:
                parent[neighbor] = current
                stack.append(neighbor)
    return expanded, parent, None


def _ucs(graph: Graph, start: str, goal: str):
    counter = 0
    frontier = [(0.0, counter, start)]
    best_g = {start: 0.0}
    parent: Dict[str, Optional[str]] = {start: None}
    closed: set[str] = set()
    expanded: List[str] = []

    while frontier:
        g_cost, _, current = heapq.heappop(frontier)
        if current in closed:
            continue
        closed.add(current)
        expanded.append(current)
        if current == goal:
            break
        for edge in graph.outgoing(current):
            neighbor = edge["target"]
            if neighbor in closed:
                continue
            tentative = g_cost + edge["cost"]
            if tentative < best_g.get(neighbor, INF):
                best_g[neighbor] = tentative
                parent[neighbor] = current
                counter += 1
                heapq.heappush(frontier, (tentative, counter, neighbor))
    return expanded, parent, None


def _heuristic_hops(graph: Graph, goal: str):
    hops = graph.reverse_hops(goal)
    return lambda node: hops.get(node, INF)


def _greedy(graph: Graph, start: str, goal: str):
    h = _heuristic_hops(graph, goal)
    counter = 0
    frontier = [(h(start), counter, start)]
    parent: Dict[str, Optional[str]] = {start: None}
    closed: set[str] = set()
    expanded: List[str] = []

    while frontier:
        _, _, current = heapq.heappop(frontier)
        if current in closed:
            continue
        closed.add(current)
        expanded.append(current)
        if current == goal:
            break
        for edge in graph.outgoing(current):
            neighbor = edge["target"]
            if neighbor in closed or neighbor in parent:
                continue
            parent[neighbor] = current
            counter += 1
            heapq.heappush(frontier, (h(neighbor), counter, neighbor))
    return expanded, parent, None


def _astar(graph: Graph, start: str, goal: str):
    hops = graph.reverse_hops(goal)
    min_cost = graph.min_edge_cost()

    def h(node):
        return hops.get(node, INF) * min_cost

    counter = 0
    frontier = [(h(start), counter, start)]
    best_g = {start: 0.0}
    parent: Dict[str, Optional[str]] = {start: None}
    closed: set[str] = set()
    expanded: List[str] = []

    while frontier:
        _, _, current = heapq.heappop(frontier)
        if current in closed:
            continue
        closed.add(current)
        expanded.append(current)
        if current == goal:
            break
        for edge in graph.outgoing(current):
            neighbor = edge["target"]
            if neighbor in closed:
                continue
            tentative = best_g[current] + edge["cost"]
            if tentative < best_g.get(neighbor, INF):
                best_g[neighbor] = tentative
                parent[neighbor] = current
                counter += 1
                heapq.heappush(frontier, (tentative + h(neighbor), counter, neighbor))
    return expanded, parent, None


def _hill_climbing(graph: Graph, start: str, goal: str):
    """Greedy local move using geometric proximity as the local cue.

    A node only moves to a neighbor strictly closer to the goal. When no
    neighbor is closer the search is stuck at a local optimum; when every
    neighbor was already visited it has hit a dead end.
    """
    parent: Dict[str, Optional[str]] = {start: None}
    expanded = [start]
    visited = {start}
    current = start
    status = None
    stuck_at = None

    while current != goal:
        candidates = [
            edge
            for edge in graph.outgoing(current)
            if edge["target"] not in visited
        ]
        if not candidates:
            status = "dead_end"
            stuck_at = current
            break

        best_edge = min(
            candidates,
            key=lambda e: (graph.distance(e["target"], goal), e["cost"], e["target"]),
        )
        neighbor = best_edge["target"]
        if graph.distance(neighbor, goal) >= graph.distance(current, goal):
            status = "local_optimum"
            stuck_at = current
            break

        parent[neighbor] = current
        visited.add(neighbor)
        expanded.append(neighbor)
        current = neighbor

    return expanded, parent, {"status": status, "stuck_at": stuck_at}


_STRATEGIES = {
    "bfs": _bfs,
    "dfs": _dfs,
    "ucs": _ucs,
    "greedy": _greedy,
    "astar": _astar,
    "hill": _hill_climbing,
}


def run_algorithm(algorithm_id: str, graph: Graph, start: str, goal: str) -> dict:
    if algorithm_id not in _STRATEGIES_BY_ID:
        raise ValueError(f"Unknown algorithm: {algorithm_id}")

    started = time.perf_counter()
    expanded, parent, extra = _STRATEGIES[algorithm_id](graph, start, goal)
    runtime_ms = (time.perf_counter() - started) * 1000.0

    return _build_result(
        algorithm=algorithm_id,
        graph=graph,
        goal=goal,
        expanded=expanded,
        parent=parent,
        runtime_ms=runtime_ms,
        status=(extra or {}).get("status"),
        stuck_at=(extra or {}).get("stuck_at"),
    )


# Re-exported for callers that validate against the metadata table.
_STRATEGIES_BY_ID = _METADATA_BY_ID
