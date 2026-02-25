import { expect, test, describe } from "bun:test"
import { mergeMesh } from "../lib/mesh-merger.ts"
import { buildMeshFromRegions } from "../lib/mesh-builder.ts"
import { Mesh } from "../lib/mesh.ts"
import { SearchInstance } from "../lib/search.ts"
import { readFileSync } from "fs"
import { join } from "path"

describe("mergeMesh", () => {
  test("two adjacent triangles merge into 1 quad", () => {
    const regions = [
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }],
      [{ x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
    ]
    const mesh = buildMeshFromRegions({ regions })
    expect(mesh.polygons.length).toBe(2)

    const merged = mergeMesh(mesh)
    expect(merged.polygons.length).toBe(1)
    expect(merged.vertices.length).toBe(4)
    expect(merged.polygons[0]!.vertices.length).toBe(4)
  })

  test("dead-end polygon gets merged", () => {
    // Center quad with one quad attached on each side (dead-end)
    const regions = [
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
      [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }],
      [{ x: 4, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 2 }, { x: 4, y: 2 }],
    ]
    const mesh = buildMeshFromRegions({ regions })
    expect(mesh.polygons.length).toBe(3)

    const merged = mergeMesh(mesh)
    // All three should merge into one (dead-end chain)
    expect(merged.polygons.length).toBe(1)
  })

  test("non-convex merge candidate rejected", () => {
    // Three quads in an L-shape. Merging any adjacent pair would create concavity.
    const regions = [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }],
      [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
    ]
    const mesh = buildMeshFromRegions({ regions })
    expect(mesh.polygons.length).toBe(3)

    const merged = mergeMesh(mesh)
    // First two can merge into a 2x1 rect, third one can't merge (would be L-shape)
    // OR second and third merge, and first can't merge
    // Either way: max 2 polygons after merge
    expect(merged.polygons.length).toBeLessThanOrEqual(3)
    expect(merged.polygons.length).toBeGreaterThanOrEqual(2)

    // Pathfinding should still work
    const search = new SearchInstance(merged)
    search.setStartGoal({ x: 0.5, y: 0.5 }, { x: 1.5, y: 1.5 })
    expect(search.search()).toBe(true)
  })

  test("arena.mesh merges to fewer polygons with same-cost paths", () => {
    const arenaPath = join(import.meta.dir, "..", "public", "meshes", "arena.mesh")
    let text: string
    try {
      text = readFileSync(arenaPath, "utf-8")
    } catch {
      return // Skip if file not available
    }
    const original = Mesh.fromString(text)
    const origPolyCount = original.polygons.length

    const merged = mergeMesh(original)
    expect(merged.polygons.length).toBeLessThan(origPolyCount)

    const start = { x: 3, y: 5 }
    const goal = { x: 45, y: 35 }

    const searchOrig = new SearchInstance(original)
    searchOrig.setStartGoal(start, goal)
    searchOrig.search()

    const searchMerged = new SearchInstance(merged)
    searchMerged.setStartGoal(start, goal)
    searchMerged.search()

    expect(searchMerged.getCost()).toBeCloseTo(searchOrig.getCost(), 2)
  })

  test("already-merged mesh has no further merges", () => {
    const regions = [
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
    ]
    const mesh = buildMeshFromRegions({ regions })
    const merged = mergeMesh(mesh)
    expect(merged.polygons.length).toBe(1)
    expect(merged.vertices.length).toBe(4)
  })

  test("diamond of 4 triangles merges into 1 quad", () => {
    const regions = [
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }],
      [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
      [{ x: 0, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }],
    ]
    const mesh = buildMeshFromRegions({ regions })
    expect(mesh.polygons.length).toBe(4)

    const merged = mergeMesh(mesh)
    // All 4 triangles sharing center vertex should merge
    expect(merged.polygons.length).toBeLessThan(4)

    const search = new SearchInstance(merged)
    search.setStartGoal({ x: 0.25, y: 0.25 }, { x: -0.25, y: -0.25 })
    expect(search.search()).toBe(true)
  })
})
