# CyberTrail — AI-Assisted Cyber Investigation Search

A CSC262 midterm project with a real-world cybersecurity use case: helping a SOC analyst trace and inspect related evidence from a synthetic alert toward a critical asset. The application compares BFS, DFS, UCS, Greedy Best-First, A*, and Hill Climbing on a directed evidence graph.

**Important:** this is decision-support/search education, not an IDS or autonomous incident-response product. All graph events are synthetic. A graph edge represents an example telemetry relationship. Its **cost** is an illustrative analyst review effort, not probability of compromise. Edge confidence is shown as contextual metadata and is not used as a probability or in the route cost. Search results are not proof of an attack path.

## Run locally

Requirements: Python 3.10+.

```bash
cd cybertrail
python -m venv .venv
# Windows: .venv\Scripts\activate   | macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000. No external APIs, credentials, or database are required.

## Use the interface

1. Choose the synthetic investigation scenario.
2. Select the starting alert/evidence node and target asset (or click a node and set it as source/target).
3. Choose an algorithm and click **Run search**, or click **Compare all**.
4. Watch explored nodes animate; the selected route is highlighted in teal.
5. Compare link count, estimated review cost, expanded nodes, runtime, and algorithm guarantee.
6. Hover over graph edges for relationship, sample cost, and synthetic confidence metadata.

### Interface features

- **Dark SOC-console dashboard** — three-panel layout: controls, animated evidence graph, and live results.
- **Interactive SVG graph** — typed nodes with icons and per-type colors, directed edges with review-cost pills, pan/drag, wheel zoom and fit-to-screen.
- **Node actions** — click any node (or focus it and press Enter) to set it as the start or target; a swap button exchanges endpoints.
- **Step-by-step traversal animation** — nodes flash amber as they are expanded and the final route draws in teal; speed ranges from Slow to Turbo and every run can be replayed.
- **Compare-all table** — all six methods side by side with the best cost / fewest expansions / fastest runtime highlighted; click any row to replay that algorithm's traversal.
- **Failure is visible** — when Hill Climbing hits a dead end or local optimum, the stuck node pulses red and a banner explains why.
- **Edge inspector** — hover any edge for its telemetry relationship, illustrative review cost, and color-coded synthetic confidence.
- **Responsive and accessible** — keyboard-focusable controls, ARIA roles/live regions, toasts for API validation errors, and a stacked layout on narrow screens.
- **Zero front-end build step** — vanilla HTML/CSS/JS with no CDN or external runtime dependencies, so it works fully offline once Flask is running.

## Problem formulation

- **Initial state:** selected alert/evidence node.
- **State:** a node in the directed synthetic telemetry graph.
- **Operators:** follow an outgoing observed relationship to another evidence node.
- **Goal test:** reach the selected critical asset/target node.
- **Path cost:** sum of illustrative analyst review costs on the traversed links.
- **A* heuristic:** reverse-graph minimum hop count to the goal × the minimum edge cost in the graph. This is a lower bound for positive edge costs, so it is admissible and consistent for the defined graph.

## Algorithms

| Method | Frontier / evaluation | What to learn |
|---|---|---|
| BFS | FIFO queue | Fewest evidence links; ignores cost differences |
| DFS | LIFO stack | Deep exploration; path is not optimal |
| UCS | Minimum accumulated cost `g(n)` | Lowest summed review effort for positive edge costs |
| Greedy Best-First | Estimated remaining hops `h(n)` | Goal-directed but may ignore effort already spent |
| A* | `f(n)=g(n)+h(n)` | Least-cost path with the admissible heuristic |
| Hill Climbing | Locally closer-looking adjacent node | Low-memory local search; can follow a decoy into a dead end |

> **Hill Climbing cue:** unlike Greedy and A*, Hill Climbing does not use the reverse-graph hop heuristic. It moves to the adjacent node with the smallest on-screen (geometric) distance to the target, which is exactly how a visually convincing decoy node can lure it into a dead end in the `phishing-finance` scenario.

## API

- `GET /` — dashboard
- `GET /api/scenarios` — synthetic graph scenarios
- `GET /api/algorithms` — algorithm families and guarantees
- `POST /api/search` — run one or more algorithms
- `GET /health` — health status

Example body for `POST /api/search`:

```json
{"scenario_id":"phishing-finance","start":"phish-alert","goal":"finance-db","algorithms":["bfs","ucs","astar"]}
```

## Test

```bash
python -m unittest discover -s tests -v
```

The tests cover all six methods, BFS-versus-UCS trade-offs, UCS/A* optimal-cost agreement, Hill Climbing local-optimum behavior, unreachable goals, API validation, and health checks.
