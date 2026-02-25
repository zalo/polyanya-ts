/**
 * Building a navigation mesh from obstacles.
 *
 * Shows how to build a navigation mesh around rectangular obstacles
 * using the CDT builder, then pathfind on it.
 *
 * Run with: bun examples/with-convex-regions.ts
 */
import { buildMeshFromRegions } from "../lib/mesh-builder.ts"
import { SearchInstance } from "../lib/search.ts"

// Simulate convex regions output — these form a navigation mesh
// around a rectangular obstacle:
//
//    (-2,2)-----(0,2)-----(2,2)
//    |        /     \       |
//    |      /  obs   \      |
//    |    / (-0.5,0.5)-(0.5,0.5)
//    |   |  |         |     |
//    |   |  (-0.5,-0.5)-(0.5,-0.5)
//    |    \              /  |
//    |      \          /    |
//    (-2,-2)---(0,-2)---(2,-2)
//
const regions = [
  // Top-left triangle
  [
    { x: -2, y: 2 },
    { x: -2, y: -2 },
    { x: -0.5, y: -0.5 },
    { x: -0.5, y: 0.5 },
  ],
  // Top
  [
    { x: -2, y: 2 },
    { x: -0.5, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 2, y: 2 },
  ],
  // Right
  [
    { x: 2, y: 2 },
    { x: 0.5, y: 0.5 },
    { x: 0.5, y: -0.5 },
    { x: 2, y: -2 },
  ],
  // Bottom
  [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 0.5, y: -0.5 },
    { x: -0.5, y: -0.5 },
  ],
]

const mesh = buildMeshFromRegions({ regions })
console.log(
  `Built mesh: ${mesh.vertices.length} vertices, ${mesh.polygons.length} polygons`,
)

const search = new SearchInstance(mesh)

// Find path that must go around the obstacle
const start = { x: -1.5, y: 0 }
const goal = { x: 1.5, y: 0 }
search.setStartGoal(start, goal)

const found = search.search()
console.log(
  `\nPath from (${start.x}, ${start.y}) to (${goal.x}, ${goal.y}): ${found ? "FOUND" : "NOT FOUND"}`,
)

if (found) {
  const path = search.getPathPoints()
  console.log(`Cost: ${search.getCost().toFixed(4)}`)
  console.log("Waypoints:")
  for (const p of path) {
    console.log(`  (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`)
  }
}
