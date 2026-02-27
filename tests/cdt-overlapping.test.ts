import { expect, test, describe } from "bun:test"
import { cdtTriangulate } from "../lib/cdt-builder.ts"
import { buildMeshFromRegions } from "../lib/mesh-builder.ts"
import { SearchInstance } from "../lib/search.ts"
import type { Point } from "../lib/types.ts"

/** Generate octagon centered at (cx, cy) with given radius. */
function octagon(cx: number, cy: number, radius: number): Point[] {
  const pts: Point[] = []
  for (let i = 0; i < 8; i++) {
    const angle = (2 * Math.PI * i) / 8
    pts.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    })
  }
  return pts
}

const bounds = { minX: -50, maxX: 50, minY: -50, maxY: 50 }

describe("cdtTriangulate with overlapping obstacles", () => {
  test("two overlapping octagons produce valid regions", () => {
    const obstacles = [
      octagon(-3, 0, 8),
      octagon(3, 0, 8),
    ]
    const regions = cdtTriangulate({ bounds, obstacles })
    // Previously this produced 0 regions due to crossing constraint edges
    expect(regions.length).toBeGreaterThan(0)
  })

  test("overlapping octagons produce valid mesh with pathfinding", () => {
    const obstacles = [
      octagon(-3, 0, 8),
      octagon(3, 0, 8),
    ]
    const regions = cdtTriangulate({ bounds, obstacles })
    expect(regions.length).toBeGreaterThan(0)

    const mesh = buildMeshFromRegions({ regions })
    expect(mesh.polygons.length).toBeGreaterThan(0)

    // Pathfinding around the obstacles should work
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -40, y: 0 }, { x: 40, y: 0 })
    const found = search.search()
    expect(found).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("contained obstacle handled correctly", () => {
    const obstacles = [
      octagon(0, 0, 10), // large
      octagon(0, 0, 3),  // fully inside
    ]
    const regions = cdtTriangulate({ bounds, obstacles })
    expect(regions.length).toBeGreaterThan(0)

    // No region centroid should be inside the large obstacle
    for (const region of regions) {
      let cx = 0
      let cy = 0
      for (const p of region) {
        cx += p.x
        cy += p.y
      }
      cx /= region.length
      cy /= region.length
      const dist = Math.sqrt(cx * cx + cy * cy)
      // Centroid should be outside the large obstacle (radius 10)
      expect(dist).toBeGreaterThan(9)
    }
  })

  test("non-overlapping obstacles unchanged", () => {
    const obstacles = [
      octagon(-25, 0, 5),
      octagon(25, 0, 5),
    ]
    const regions = cdtTriangulate({ bounds, obstacles })
    expect(regions.length).toBeGreaterThan(0)

    const mesh = buildMeshFromRegions({ regions })
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -40, y: 0 }, { x: 40, y: 0 })
    expect(search.search()).toBe(true)
  })

  test("three overlapping octagons in a row produce valid regions", () => {
    const obstacles = [
      octagon(-6, 0, 6),
      octagon(0, 0, 6),
      octagon(6, 0, 6),
    ]
    const regions = cdtTriangulate({ bounds, obstacles })
    expect(regions.length).toBeGreaterThan(0)

    const mesh = buildMeshFromRegions({ regions })
    expect(mesh.polygons.length).toBeGreaterThan(0)
  })
})
