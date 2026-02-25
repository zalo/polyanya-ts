import { expect, test, describe } from "bun:test"
import { computeConvexRegions } from "@tscircuit/find-convex-regions"
import { buildMeshFromConvexRegions } from "./lib/from-convex-regions.ts"
import { SearchInstance } from "./lib/search.ts"

describe("Integration with find-convex-regions", () => {
  test("pathfind around rectangular obstacle", () => {
    const result = computeConvexRegions({
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      rects: [
        {
          center: { x: 0, y: 0 },
          width: 4,
          height: 4,
          ccwRotation: 0,
        },
      ],
      clearance: 0.5,
      concavityTolerance: 0.5,
    })

    expect(result.regions.length).toBeGreaterThan(0)

    const mesh = buildMeshFromConvexRegions(result.regions)
    expect(mesh.vertices.length).toBeGreaterThan(0)
    expect(mesh.polygons.length).toBeGreaterThan(0)

    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -8, y: 0 }, { x: 8, y: 0 })
    const found = search.search()
    expect(found).toBe(true)

    const path = search.getPathPoints()
    expect(path.length).toBeGreaterThanOrEqual(2)
    expect(search.getCost()).toBeGreaterThan(0)

    // Path should go around the obstacle, so cost > direct distance (16)
    expect(search.getCost()).toBeGreaterThan(16)
  })

  test("pathfind with multiple vias", () => {
    const result = computeConvexRegions({
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      vias: [
        { center: { x: -3, y: 0 }, diameter: 2 },
        { center: { x: 3, y: 0 }, diameter: 2 },
      ],
      clearance: 0.3,
      concavityTolerance: 0.5,
    })

    const mesh = buildMeshFromConvexRegions(result.regions)
    const search = new SearchInstance(mesh)
    // Use points well within the mesh bounds
    search.setStartGoal({ x: -8, y: 0 }, { x: 8, y: 0 })
    const found = search.search()
    expect(found).toBe(true)

    const path = search.getPathPoints()
    expect(path.length).toBeGreaterThanOrEqual(2)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("trivial path with no obstacles", () => {
    const result = computeConvexRegions({
      bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
      clearance: 0.1,
      concavityTolerance: 0.5,
    })

    const mesh = buildMeshFromConvexRegions(result.regions)
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -3, y: 0 }, { x: 3, y: 0 })
    const found = search.search()
    expect(found).toBe(true)

    // Without obstacles, path cost should approximately equal direct distance
    const directDist = Math.sqrt(36) // = 6
    expect(search.getCost()).toBeCloseTo(directDist, 1)
  })
})
