import { expect, test, describe } from "bun:test"
import { buildMeshFromRegions } from "../lib/mesh-builder.ts"
import { SearchInstance } from "../lib/search.ts"
import { StepEventType } from "../lib/types.ts"

// Two separate triangles with NO shared edges → two islands
const DISCONNECTED_REGIONS = [
  // Island 0: triangle at x=[0,2]
  [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 2 },
  ],
  // Island 1: triangle at x=[10,12], far away
  [
    { x: 10, y: 0 },
    { x: 12, y: 0 },
    { x: 11, y: 2 },
  ],
]

// Two triangles sharing an edge → one island
const CONNECTED_REGIONS = [
  [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 2 },
  ],
  [
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
  ],
]

describe("Island detection", () => {
  test("disconnected mesh has two islands", () => {
    const mesh = buildMeshFromRegions({ regions: DISCONNECTED_REGIONS })
    expect(mesh.polygons.length).toBe(2)
    expect(mesh.sameIsland(0, 1)).toBe(false)
  })

  test("connected mesh is one island", () => {
    const mesh = buildMeshFromRegions({ regions: CONNECTED_REGIONS })
    expect(mesh.polygons.length).toBe(2)
    expect(mesh.sameIsland(0, 1)).toBe(true)
  })

  test("sameIsland returns false for invalid indices", () => {
    const mesh = buildMeshFromRegions({ regions: CONNECTED_REGIONS })
    expect(mesh.sameIsland(-1, 0)).toBe(false)
    expect(mesh.sameIsland(0, -1)).toBe(false)
  })

  test("search returns false instantly for disconnected islands", () => {
    const mesh = buildMeshFromRegions({ regions: DISCONNECTED_REGIONS })
    const search = new SearchInstance(mesh)
    // Start in island 0, goal in island 1
    search.setStartGoal({ x: 1, y: 1 }, { x: 11, y: 1 })
    const found = search.search()
    expect(found).toBe(false)
    // No nodes should have been pushed (instant rejection)
    expect(search.nodesPushed).toBe(0)
    expect(search.nodesPopped).toBe(0)
  })

  test("searchInit reports different islands", () => {
    const mesh = buildMeshFromRegions({ regions: DISCONNECTED_REGIONS })
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 1, y: 1 }, { x: 11, y: 1 })
    const events = search.searchInit()
    const exhausted = events.find(
      (e) => e.type === StepEventType.SEARCH_EXHAUSTED,
    )
    expect(exhausted).toBeDefined()
    expect(exhausted!.message).toContain("different islands")
  })

  test("connected mesh still finds paths", () => {
    const mesh = buildMeshFromRegions({ regions: CONNECTED_REGIONS })
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 0.5, y: 0.5 }, { x: 1.8, y: 1.5 })
    const found = search.search()
    expect(found).toBe(true)
    expect(search.getPathPoints().length).toBeGreaterThanOrEqual(2)
  })
})
