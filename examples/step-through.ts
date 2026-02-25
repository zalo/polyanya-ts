/**
 * Step-through visualization example.
 *
 * Demonstrates how to step through the Polyanya algorithm one node at a time,
 * observing every pop, expansion, push, and prune event. This is useful for
 * understanding the algorithm's internals and building visual debuggers.
 *
 * Run with: bun examples/step-through.ts
 */
import { Mesh } from "../lib/mesh.ts"
import { SearchInstance } from "../lib/search.ts"
import { StepEventType } from "../lib/types.ts"

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
const search = new SearchInstance(mesh)

const start = { x: 0.5, y: 0.5 }
const goal = { x: -0.5, y: -0.5 }
search.setStartGoal(start, goal)

console.log("=== Polyanya Step-Through Demo ===")
console.log(
  `Searching from (${start.x}, ${start.y}) to (${goal.x}, ${goal.y})`,
)
console.log()

// Initialize the search
const initEvents = search.searchInit()
for (const event of initEvents) {
  printEvent(event)
}

// Step through the algorithm
let stepNumber = 0
while (!search.isSearchComplete()) {
  stepNumber++
  console.log(`\n--- Step ${stepNumber} ---`)

  const events = search.step()
  for (const event of events) {
    printEvent(event)
  }

  // Show open list state
  const openNodes = search.getOpenListNodes()
  console.log(`  Open list size: ${openNodes.length}`)
}

// Show final path
console.log("\n=== Result ===")
const path = search.getPathPoints()
if (path.length > 0) {
  console.log(`Path found! Cost: ${search.getCost().toFixed(4)}`)
  console.log("Waypoints:")
  for (const p of path) {
    console.log(`  (${p.x.toFixed(4)}, ${p.y.toFixed(4)})`)
  }
} else {
  console.log("No path found.")
}

function printEvent(event: import("../lib/types.ts").StepEvent) {
  const icons: Record<string, string> = {
    [StepEventType.INIT]: "[INIT]",
    [StepEventType.NODE_POPPED]: "[POP ]",
    [StepEventType.NODE_EXPANDED]: "[EXPD]",
    [StepEventType.NODE_PUSHED]: "[PUSH]",
    [StepEventType.NODE_PRUNED]: "[PRUN]",
    [StepEventType.GOAL_REACHED]: "[GOAL]",
    [StepEventType.SEARCH_EXHAUSTED]: "[DONE]",
  }

  const icon = icons[event.type] || "[????]"
  console.log(`  ${icon} ${event.message || ""}`)

  if (event.node) {
    const n = event.node
    console.log(
      `         root=${n.root}, interval=[${fmtPt(n.left)}, ${fmtPt(n.right)}], f=${n.f.toFixed(4)}, g=${n.g.toFixed(4)}, poly=${n.nextPolygon}`,
    )
  }

  if (event.successors && event.successors.length > 0) {
    for (const s of event.successors) {
      console.log(
        `         -> ${s.type}: [${fmtPt(s.left)}, ${fmtPt(s.right)}]`,
      )
    }
  }
}

function fmtPt(p: { x: number; y: number }): string {
  return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)})`
}
