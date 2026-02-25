import { expect, test, describe } from "bun:test"
import { Mesh } from "./lib/mesh.ts"
import { SearchInstance } from "./lib/search.ts"
import { distance } from "./lib/index.ts"
import { StepEventType } from "./lib/types.ts"

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

describe("SearchInstance", () => {
  test("finds trivial path (same polygon)", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 0.25, y: 0.25 }, { x: 0.4, y: 0.4 })
    const found = search.search()
    expect(found).toBe(true)

    const path = search.getPathPoints()
    expect(path.length).toBeGreaterThanOrEqual(2)

    // Cost should be the direct distance
    const expectedCost = distance({ x: 0.25, y: 0.25 }, { x: 0.4, y: 0.4 })
    expect(search.getCost()).toBeCloseTo(expectedCost, 3)
  })

  test("finds path across polygons", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    const search = new SearchInstance(mesh)
    // Start in upper-right region, goal in lower-left
    search.setStartGoal({ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 })
    const found = search.search()
    expect(found).toBe(true)

    const path = search.getPathPoints()
    expect(path.length).toBeGreaterThanOrEqual(2)
    // Path should start at start and end at goal
    expect(path[0]!.x).toBeCloseTo(0.5)
    expect(path[0]!.y).toBeCloseTo(0.5)
    expect(path[path.length - 1]!.x).toBeCloseTo(-0.5)
    expect(path[path.length - 1]!.y).toBeCloseTo(-0.5)

    // Direct distance
    const directDist = distance({ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 })
    // Path cost should be close to direct distance (straight line through center)
    expect(search.getCost()).toBeCloseTo(directDist, 2)
  })

  test("returns false for off-mesh goal", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 0.25, y: 0.25 }, { x: 10, y: 10 })
    const found = search.search()
    expect(found).toBe(false)
    expect(search.getCost()).toBe(-1)
    expect(search.getPathPoints()).toEqual([])
  })

  test("step-by-step search works", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 })

    const initEvents = search.searchInit()
    expect(initEvents.length).toBeGreaterThan(0)
    expect(initEvents[0]!.type).toBe(StepEventType.INIT)

    // Step until complete
    let maxSteps = 100
    while (!search.isSearchComplete() && maxSteps > 0) {
      const events = search.step()
      expect(events.length).toBeGreaterThan(0)
      maxSteps--
    }

    expect(search.isSearchComplete()).toBe(true)
    const path = search.getPathPoints()
    expect(path.length).toBeGreaterThanOrEqual(2)
  })

  test("statistics are tracked", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 0.5, y: 0.5 }, { x: -0.5, y: -0.5 })
    search.search()

    expect(search.nodesGenerated).toBeGreaterThan(0)
    expect(search.nodesPushed).toBeGreaterThan(0)
    expect(search.nodesPopped).toBeGreaterThan(0)
  })
})

describe("SearchInstance with arena mesh", () => {
  test("finds path on arena mesh", async () => {
    const meshData = await Bun.file(
      "./meshes/arena.mesh",
    ).text()
    const mesh = Mesh.fromString(meshData)

    expect(mesh.vertices.length).toBe(112)
    expect(mesh.polygons.length).toBe(120)

    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 5, y: 5 }, { x: 20, y: 15 })
    const found = search.search()
    expect(found).toBe(true)

    const path = search.getPathPoints()
    expect(path.length).toBeGreaterThanOrEqual(2)
    expect(search.getCost()).toBeGreaterThan(0)
  })
})
