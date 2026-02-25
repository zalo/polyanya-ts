/**
 * Basic Polyanya pathfinding example.
 *
 * Loads a mesh file and finds the shortest any-angle path between two points.
 *
 * Run with: bun examples/basic-search.ts
 */
import { Mesh } from "../lib/mesh.ts"
import { SearchInstance } from "../lib/search.ts"

// Load the square mesh (4 triangles forming a diamond)
const SQUARE_MESH = `mesh
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
3 4 2 1 0 2 -1`

const mesh = Mesh.fromString(SQUARE_MESH)
console.log(
  `Loaded mesh: ${mesh.vertices.length} vertices, ${mesh.polygons.length} polygons`,
)

// Create search instance
const search = new SearchInstance(mesh)

// Find path from upper-right to lower-left
const start = { x: 0.5, y: 0.5 }
const goal = { x: -0.5, y: -0.5 }
search.setStartGoal(start, goal)

const found = search.search()
console.log(`\nSearch from (${start.x}, ${start.y}) to (${goal.x}, ${goal.y})`)
console.log(`Path found: ${found}`)

if (found) {
  const path = search.getPathPoints()
  console.log(`Path cost: ${search.getCost().toFixed(4)}`)
  console.log(`Waypoints (${path.length}):`)
  for (const p of path) {
    console.log(`  (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`)
  }

  console.log(`\nStatistics:`)
  console.log(`  Nodes generated: ${search.nodesGenerated}`)
  console.log(`  Nodes pushed: ${search.nodesPushed}`)
  console.log(`  Nodes popped: ${search.nodesPopped}`)
  console.log(`  Nodes pruned: ${search.nodesPrunedPostPop}`)
  console.log(`  Successor calls: ${search.successorCalls}`)
}
