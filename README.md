# polyanya

TypeScript port of **Polyanya** — compromise-free any-angle pathfinding on navigation meshes.

Based on the algorithm from [Cui, Harabor & Grastien, "Compromise-free Pathfinding on a Navigation Mesh" (IJCAI 2017)](https://bitbucket.org/dharabor/pathfinding/src/master/anyangle/polyanya/).

## Installation

```sh
bun add polyanya
```

## Quick Start

```ts
import { Mesh, SearchInstance } from "polyanya"

const mesh = Mesh.fromString(`mesh
2
5 4
0 1 3 -1 1 0
1 0 3 -1 0 3
0 -1 3 -1 3 2
-1 0 3 -1 2 1
0 0 4 0 1 2 3
3 4 1 0 1 3 -1
3 4 0 3 2 0 -1
3 4 3 2 3 1 -1
3 4 2 1 0 2 -1`)

const search = new SearchInstance(mesh)
search.setStartGoal({ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 })
search.search()

const path = search.getPathPoints()
// [{ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 }]
```

## Usage with find-convex-regions

Build a navigation mesh from obstacles and pathfind around them:

```ts
import { computeConvexRegions } from "@tscircuit/find-convex-regions"
import { buildMeshFromConvexRegions, SearchInstance } from "polyanya"

const result = computeConvexRegions({
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  rects: [{ center: { x: 0, y: 0 }, width: 4, height: 4, ccwRotation: 0 }],
  clearance: 0.5,
  concavityTolerance: 0.5,
})

const mesh = buildMeshFromConvexRegions(result.regions)
const search = new SearchInstance(mesh)
search.setStartGoal({ x: -8, y: 0 }, { x: 8, y: 0 })
search.search()

const path = search.getPathPoints()
const cost = search.getCost()
```

## Step-Through Debugging

Step through the algorithm one node at a time to visualize internals:

```ts
import { Mesh, SearchInstance, StepEventType } from "polyanya"

const mesh = Mesh.fromString(meshData)
const search = new SearchInstance(mesh)
search.setStartGoal(start, goal)

// Initialize search
const initEvents = search.searchInit()

// Step one node at a time
while (!search.isSearchComplete()) {
  const events = search.step()
  for (const event of events) {
    switch (event.type) {
      case StepEventType.NODE_POPPED:
        console.log("Popped:", event.node)
        break
      case StepEventType.NODE_EXPANDED:
        console.log("Expanded:", event.successors?.length, "successors")
        break
      case StepEventType.NODE_PUSHED:
        console.log("Pushed:", event.node)
        break
      case StepEventType.NODE_PRUNED:
        console.log("Pruned:", event.message)
        break
      case StepEventType.GOAL_REACHED:
        console.log("Goal reached!")
        break
    }
  }
}

// Get the open list at any point
const openNodes = search.getOpenListNodes()
```

## Loading Mesh Files

Load `.mesh` files (version 2 format):

```ts
const meshData = await Bun.file("arena.mesh").text()
const mesh = Mesh.fromString(meshData)
```

## Building Meshes Programmatically

Build from convex polygon regions:

```ts
import { buildMeshFromRegions, SearchInstance } from "polyanya"

const mesh = buildMeshFromRegions({
  regions: [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }],
  ],
})

const search = new SearchInstance(mesh)
```

## API

### `Mesh.fromString(data: string): Mesh`

Parse a `.mesh` file string.

### `Mesh.fromData(vertices: Vertex[], polygons: Polygon[]): Mesh`

Build a mesh from vertex and polygon arrays.

### `buildMeshFromRegions(input: { regions: Point[][] }): Mesh`

Build a mesh from convex regions (arrays of points in CCW order).

### `buildMeshFromConvexRegions(regions: Point[][]): Mesh`

Shorthand for use with `find-convex-regions` output.

### `SearchInstance`

| Method | Description |
|--------|-------------|
| `setStartGoal(start, goal)` | Set start and goal points |
| `search(): boolean` | Run full search, returns true if path found |
| `searchInit(): StepEvent[]` | Initialize step-through search |
| `step(): StepEvent[]` | Execute one search step |
| `isSearchComplete(): boolean` | Check if search is done |
| `getPathPoints(): Point[]` | Get path waypoints |
| `getCost(): number` | Get path cost (-1 if not found) |
| `getOpenListNodes(): SearchNode[]` | Get current open list |
| `getSearchTree(): SearchNode[]` | Get search tree from final node |

### Statistics

After a search, these fields are available on the `SearchInstance`:

- `nodesGenerated` — Total nodes created
- `nodesPushed` — Nodes pushed onto open list
- `nodesPopped` — Nodes popped from open list
- `nodesPrunedPostPop` — Nodes pruned after pop (root-level pruning)
- `successorCalls` — Times successor generation was called

### Step Events

| Event Type | Description |
|-----------|-------------|
| `INIT` | Search initialized |
| `NODE_POPPED` | Node removed from open list |
| `NODE_EXPANDED` | Node expanded, successors generated |
| `NODE_PUSHED` | Node pushed onto open list |
| `NODE_PRUNED` | Node pruned (better path to same root exists) |
| `GOAL_REACHED` | Goal polygon reached |
| `SEARCH_EXHAUSTED` | Open list empty, no path exists |

## How It Works

Polyanya finds **optimal any-angle paths** on navigation meshes:

1. **Point Location**: Locate start and goal in the mesh using a slab-based spatial index
2. **Initial Nodes**: Generate search intervals on all edges of the start polygon
3. **A\* Search**: Expand intervals through polygons using a priority queue
4. **Successor Generation**: For each polygon, compute observable and non-observable intervals using orientation tests and binary search
5. **Collinear Collapsing**: When a single successor has the same root, skip the open list and expand immediately
6. **Root Pruning**: Track best g-value per root vertex to prune dominated nodes

The algorithm guarantees optimal paths with no grid artifacts or suboptimal compromises.

## Mesh File Format

Version 2 `.mesh` files:

```
mesh
2
V P                          # vertex count, polygon count

x y n p0 p1 ... pn-1         # per vertex: position, neighbor polygons (-1 = obstacle)

n v0 v1 ... vn-1 p0 p1 ...   # per polygon: vertices (CCW), adjacent polygons
```

## Examples

See the `examples/` directory:

- `basic-search.ts` — Simple pathfinding
- `step-through.ts` — Algorithm step visualization
- `arena-pathfinding.ts` — Larger mesh from Dragon Age: Origins
- `with-convex-regions.ts` — Integration with obstacle decomposition

Run with:

```sh
bun examples/basic-search.ts
bun examples/step-through.ts
```

## Credits

- Algorithm: Cui, Harabor & Grastien (IJCAI 2017)
- C++ reference: [bitbucket.org/dharabor/pathfinding](https://bitbucket.org/dharabor/pathfinding/src/master/anyangle/polyanya/)
