import { expect, test, describe } from "bun:test"
import { buildMeshFromRegions } from "./lib/mesh-builder.ts"
import { SearchInstance } from "./lib/search.ts"
import { distance } from "./lib/index.ts"

describe("buildMeshFromRegions", () => {
  test("builds mesh from two triangles", () => {
    // Two triangles forming a square:
    //  (0,1)
    //  / |
    // (0,0)-(1,0)
    //
    const regions = [
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      [
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    ]

    const mesh = buildMeshFromRegions({ regions })
    expect(mesh.vertices.length).toBe(4)
    expect(mesh.polygons.length).toBe(2)
  })

  test("pathfinding works on built mesh", () => {
    // Four triangles forming a diamond around center (0,0)
    const regions = [
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: -1, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 0, y: -1 },
        { x: 1, y: 0 },
      ],
    ]

    const mesh = buildMeshFromRegions({ regions })
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: 0.25, y: 0.25 }, { x: -0.25, y: -0.25 })
    const found = search.search()
    expect(found).toBe(true)

    const path = search.getPathPoints()
    expect(path.length).toBeGreaterThanOrEqual(2)

    const directDist = distance(
      { x: 0.25, y: 0.25 },
      { x: -0.25, y: -0.25 },
    )
    expect(search.getCost()).toBeCloseTo(directDist, 2)
  })
})
