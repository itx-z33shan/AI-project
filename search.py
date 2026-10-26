"""Search strategies for synthetic cyber-evidence graphs.

Edge cost is estimated analyst effort to review a telemetry relationship, not a
probability of compromise. Edge confidence is descriptive metadata, not the cost.
"""
from collections import deque
from heapq import heappush, heappop
from itertools import count
from time import perf_counter

ALGORITHMS = {
    "bfs": {"name":"Breadth-First Search", "family":"Uninformed Search", "guarantee":"Fewest evidence links (hops); ignores review effort differences"},
    "dfs": {"name":"Depth-First Search", "family":"Uninformed Search", "guarantee":"Finds a route, but not necessarily the fewest links or least effort"},
    "ucs": {"name":"Uniform-Cost Search", "family":"Uninformed Search", "guarantee":"Least summed review effort for positive edge costs"},
    "greedy": {"name":"Greedy Best-First Search", "family":"Informed Search", "guarantee":"Goal-directed using heuristic h(n); not guaranteed least-cost"},
    "astar": {"name":"A* Search", "family":"Informed Search", "guarantee":"Least review-effort path with admissible heuristic f(n)=g(n)+h(n)"},
    "hill": {"name":"Hill Climbing", "family":"Local Search", "guarantee":"Locally greedy; can stop at a local optimum or dead end"},
}


def _reverse_hops(nodes, edges, goal):
    incoming = {n["id"]: [] for n in nodes}
    for e in edges:
        incoming[e["to"]].append(e["from"])
    dist = {goal: 0}
    q = deque([goal])
    while q:
        node = q.popleft()
        for prev in incoming[node]:
            if prev not in dist:
                dist[prev] = dist[node] + 1
                q.append(prev)
    return dist


def _reconstruct(parent, goal):
    if goal not in parent:
        return []
    route = [goal]
    while parent[route[-1]] is not None:
        route.append(parent[route[-1]])
    return route[::-1]


def search_graph(nodes, edges, start, goal, algorithm):
    if algorithm not in ALGORITHMS:
        raise ValueError("Unknown search algorithm")
    node_ids = {n["id"] for n in nodes}
    node_names = {n["id"]: n.get("name", n["id"]) for n in nodes}
    if start not in node_ids or goal not in node_ids:
        raise ValueError("Start and target must be valid graph nodes")
    adjacency = {n: [] for n in node_ids}
    for e in edges:
        adjacency[e["from"]].append(e)
    hop_h = _reverse_hops(nodes, edges, goal)
    min_cost = min((float(e["cost"]) for e in edges), default=1)
    h = lambda n: hop_h.get(n, 0) * min_cost
    began = perf_counter()
    expanded, parent, parent_edge = [], {start: None}, {}
    found, goal_cost = False, None
    trace = []

    if algorithm in ("bfs", "dfs"):
        frontier = deque([start]) if algorithm == "bfs" else [start]
        seen = {start}
        while frontier:
            current = frontier.popleft() if algorithm == "bfs" else frontier.pop()
            expanded.append(current)
            if current == goal:
                found = True
                trace.append({
                    "step": len(trace) + 1,
                    "action": "goal_reached",
                    "node": current,
                    "node_name": node_names.get(current, current),
                    "evaluations": [],
                    "summary": f"Target asset {node_names.get(current, current)} reached! Route established."
                })
                break
            step_evals = []
            chosen_nodes = []
            for edge in adjacency[current]:
                nxt = edge["to"]
                nxt_name = node_names.get(nxt, nxt)
                if nxt not in seen:
                    seen.add(nxt)
                    parent[nxt] = current
                    parent_edge[nxt] = edge
                    frontier.append(nxt)
                    chosen_nodes.append(nxt_name)
                    step_evals.append({
                        "from": current,
                        "to": nxt,
                        "cost": edge["cost"],
                        "decision": "chosen",
                        "reason": f"Discovered link ({len(expanded)} hops)" if algorithm == "bfs" else "Deep branch exploration (LIFO)"
                    })
                else:
                    step_evals.append({
                        "from": current,
                        "to": nxt,
                        "cost": edge["cost"],
                        "decision": "rejected",
                        "reason": f"Already discovered in earlier search" if algorithm == "bfs" else "Cycle / already in path"
                    })
            trace.append({
                "step": len(trace) + 1,
                "action": "expand",
                "node": current,
                "node_name": node_names.get(current, current),
                "evaluations": step_evals,
                "summary": f"Expanded {node_names.get(current, current)}: chose {', '.join(chosen_nodes) or 'none'}, rejected {len(step_evals) - len(chosen_nodes)} branch(es)."
            })
        route = _reconstruct(parent, goal) if found else []

    elif algorithm in ("ucs", "greedy", "astar"):
        tie = count()
        best_g = {start: 0}
        closed = set()
        first = 0 if algorithm == "ucs" else h(start)
        frontier = [(first, next(tie), 0, start)]
        while frontier:
            _, _, queued_g, current = heappop(frontier)
            if queued_g != best_g.get(current) or current in closed:
                continue
            closed.add(current)
            expanded.append(current)
            if current == goal:
                found, goal_cost = True, queued_g
                trace.append({
                    "step": len(trace) + 1,
                    "action": "goal_reached",
                    "node": current,
                    "node_name": node_names.get(current, current),
                    "evaluations": [],
                    "summary": f"Target asset {node_names.get(current, current)} reached with review effort {round(queued_g, 2)}m!"
                })
                break
            step_evals = []
            chosen_nodes = []
            for edge in adjacency[current]:
                nxt = edge["to"]
                nxt_name = node_names.get(nxt, nxt)
                edge_cost = float(edge["cost"])
                new_g = queued_g + edge_cost

                # Prune dead-end nodes for A*
                if algorithm == "astar" and nxt not in hop_h:
                    step_evals.append({
                        "from": current,
                        "to": nxt,
                        "cost": edge["cost"],
                        "decision": "rejected",
                        "reason": "Pruned: cannot reach target asset (dead-end lead)"
                    })
                    continue

                if nxt in closed:
                    step_evals.append({
                        "from": current,
                        "to": nxt,
                        "cost": edge["cost"],
                        "decision": "rejected",
                        "reason": f"Already finalized with optimal effort ({round(best_g[nxt], 1)}m)"
                    })
                    continue

                if new_g >= best_g.get(nxt, float("inf")):
                    step_evals.append({
                        "from": current,
                        "to": nxt,
                        "cost": edge["cost"],
                        "decision": "rejected",
                        "reason": f"Higher review effort ({round(new_g, 1)}m >= best {round(best_g[nxt], 1)}m)"
                    })
                else:
                    best_g[nxt] = new_g
                    parent[nxt] = current
                    parent_edge[nxt] = edge
                    if algorithm == "ucs":
                        priority = new_g
                        reason_msg = f"Lowest review cost g={round(new_g, 1)}m"
                    elif algorithm == "greedy":
                        priority = h(nxt)
                        reason_msg = f"Closest estimated hops h={hop_h.get(nxt, 0)}"
                    else:
                        priority = new_g + h(nxt)
                        reason_msg = f"Selected: f={round(priority, 1)}m (g={round(new_g, 1)} + h={round(h(nxt), 1)})"
                    heappush(frontier, (priority, next(tie), new_g, nxt))
                    chosen_nodes.append(nxt_name)
                    step_evals.append({
                        "from": current,
                        "to": nxt,
                        "cost": edge["cost"],
                        "decision": "chosen",
                        "reason": reason_msg
                    })

            trace.append({
                "step": len(trace) + 1,
                "action": "expand",
                "node": current,
                "node_name": node_names.get(current, current),
                "evaluations": step_evals,
                "summary": f"Expanded {node_names.get(current, current)}: chose {', '.join(chosen_nodes) or 'none'}, rejected {len(step_evals) - len(chosen_nodes)} branch(es)."
            })
        route = _reconstruct(parent, goal) if found else []

    else:  # Steepest-descent Hill Climbing using graph-layout proximity.
        coords = {n["id"]:(float(n.get("x",0)),float(n.get("y",0))) for n in nodes}
        gx, gy = coords[goal]
        geometric_h = lambda node: ((coords[node][0]-gx)**2 + (coords[node][1]-gy)**2) ** 0.5
        current, route, seen = start, [start], {start}
        limit = len(node_ids)
        while len(expanded) < limit:
            expanded.append(current)
            if current == goal:
                found = True
                trace.append({
                    "step": len(trace) + 1,
                    "action": "goal_reached",
                    "node": current,
                    "node_name": node_names.get(current, current),
                    "evaluations": [],
                    "summary": f"Target asset {node_names.get(current, current)} reached!"
                })
                break
            candidates = [e for e in adjacency[current] if e["to"] not in seen]
            if not candidates:
                trace.append({
                    "step": len(trace) + 1,
                    "action": "stuck",
                    "node": current,
                    "node_name": node_names.get(current, current),
                    "evaluations": [
                        {
                            "from": current,
                            "to": e["to"],
                            "cost": e["cost"],
                            "decision": "rejected",
                            "reason": "Cycle / already visited in trail"
                        } for e in adjacency[current]
                    ],
                    "summary": f"Dead end at {node_names.get(current, current)}: no unvisited outgoing edges."
                })
                break
            best_edge = min(candidates, key=lambda e: (geometric_h(e["to"]), float(e["cost"])))
            best_dist = geometric_h(best_edge["to"])
            curr_dist = geometric_h(current)
            if best_dist >= curr_dist:
                step_evals = []
                for e in candidates:
                    step_evals.append({
                        "from": current,
                        "to": e["to"],
                        "cost": e["cost"],
                        "decision": "rejected",
                        "reason": f"Local optimum: distance {round(geometric_h(e['to']))}px ≥ current {round(curr_dist)}px"
                    })
                trace.append({
                    "step": len(trace) + 1,
                    "action": "stuck",
                    "node": current,
                    "node_name": node_names.get(current, current),
                    "evaluations": step_evals,
                    "summary": f"Hill Climbing stuck at local optimum {node_names.get(current, current)}: no neighbor is closer to target."
                })
                break

            step_evals = []
            for e in candidates:
                cand_name = node_names.get(e["to"], e["to"])
                if e == best_edge:
                    step_evals.append({
                        "from": current,
                        "to": e["to"],
                        "cost": e["cost"],
                        "decision": "chosen",
                        "reason": f"Closest local step to target ({round(best_dist)}px)"
                    })
                else:
                    step_evals.append({
                        "from": current,
                        "to": e["to"],
                        "cost": e["cost"],
                        "decision": "rejected",
                        "reason": f"Farther from target ({round(geometric_h(e['to']))}px > {round(best_dist)}px)"
                    })

            trace.append({
                "step": len(trace) + 1,
                "action": "expand",
                "node": current,
                "node_name": node_names.get(current, current),
                "evaluations": step_evals,
                "summary": f"At {node_names.get(current, current)}: picked {node_names.get(best_edge['to'], best_edge['to'])}, rejected {len(step_evals)-1} branch(es)."
            })

            current = best_edge["to"]
            seen.add(current)
            route.append(current)
            parent[current] = route[-2]
            parent_edge[current] = best_edge
        if current == goal:
            found = True

    if found and goal_cost is None:
        route_cost = sum(float(parent_edge[n]["cost"]) for n in route[1:])
    else:
        route_cost = goal_cost if found else None
    route_edges = [parent_edge[n] for n in route[1:]] if found else []
    elapsed = (perf_counter() - began) * 1000
    if found:
        note = {
            "bfs":"BFS minimizes link count. It does not account for review effort differences.",
            "dfs":"DFS found a path, but another path may use fewer links or less effort.",
            "ucs":"UCS found the path with minimum summed edge review cost.",
            "greedy":"Greedy follows the estimated remaining distance and may ignore accumulated review cost.",
            "astar":"A* minimizes g(n)+h(n); the hop-distance lower bound is admissible for positive edge costs.",
            "hill":"Hill Climbing uses graph-layout proximity and only accepts a locally closer neighbor; it is not guaranteed optimal and can follow a nearby decoy into a dead end.",
        }[algorithm]
    else:
        note = "No target path was found." if algorithm != "hill" else "Hill Climbing got stuck: no outgoing neighbor had a strictly smaller heuristic value. Other search algorithms may still find a route."
    return {
        "algorithm":algorithm,
        "name":ALGORITHMS[algorithm]["name"],
        "family":ALGORITHMS[algorithm]["family"],
        "guarantee":ALGORITHMS[algorithm]["guarantee"],
        "found":found,
        "path":route if found else [],
        "path_edges":[{"from":e["from"],"to":e["to"],"relation":e["relation"],"cost":e["cost"],"confidence":e["confidence"]} for e in route_edges],
        "expanded":expanded,
        "expanded_count":len(expanded),
        "hops":len(route)-1 if found else None,
        "review_cost":round(route_cost,2) if found else None,
        "average_link_confidence":round(sum(float(e["confidence"]) for e in route_edges)/len(route_edges),3) if route_edges else None,
        "elapsed_ms":round(elapsed,3),
        "note":note,
        "trace":trace,
    }
