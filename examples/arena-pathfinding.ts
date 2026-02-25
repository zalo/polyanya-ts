/**
 * Arena pathfinding example.
 *
 * Loads the arena mesh (from Dragon Age: Origins) and finds paths.
 *
 * Run with: bun examples/arena-pathfinding.ts
 */
import { Mesh } from "../lib/mesh.ts"
import { SearchInstance } from "../lib/search.ts"

async function main() {
  const meshData = await Bun.file("./meshes/arena.mesh").text()
  const mesh = Mesh.fromString(meshData)
  console.log(
    `Loaded arena mesh: ${mesh.vertices.length} vertices, ${mesh.polygons.length} polygons`,
  )

  const search = new SearchInstance(mesh)

  // Run multiple queries
  const queries: [
    { x: number; y: number },
    { x: number; y: number },
  ][] = [
    [
      { x: 5, y: 5 },
      { x: 20, y: 15 },
    ],
    [
      { x: 2, y: 2 },
      { x: 23, y: 45 },
    ],
    [
      { x: 15, y: 15 },
      { x: 15, y: 48 },
    ],
  ]

  for (const [start, goal] of queries) {
    search.setStartGoal(start, goal)
    const found = search.search()

    console.log(
      `\n(${start.x}, ${start.y}) -> (${goal.x}, ${goal.y}): ${found ? "FOUND" : "NOT FOUND"}`,
    )
    if (found) {
      const path = search.getPathPoints()
      console.log(`  Cost: ${search.getCost().toFixed(4)}`)
      console.log(`  Waypoints: ${path.length}`)
      console.log(
        `  Stats: generated=${search.nodesGenerated}, pushed=${search.nodesPushed}, popped=${search.nodesPopped}, pruned=${search.nodesPrunedPostPop}`,
      )
    }
  }
}

main()
