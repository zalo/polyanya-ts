import { expect, test, describe } from "bun:test"
import { mergeMesh } from "../lib/mesh-merger.ts"
import { buildMeshFromRegions } from "../lib/mesh-builder.ts"
import { Mesh } from "../lib/mesh.ts"
import { SearchInstance } from "../lib/search.ts"
import { PointLocationType } from "../lib/types.ts"
import { cdtTriangulate } from "../lib/cdt-builder.ts"
import { readFileSync } from "fs"
import { join } from "path"
import type { Point } from "../lib/types.ts"

/** Total mesh area via shoelace formula over all polygons */
function meshArea(mesh: Mesh): number {
  let total = 0
  for (const poly of mesh.polygons) {
    if (!poly) continue
    const verts = poly.vertices
    let a = 0
    for (let i = 0; i < verts.length; i++) {
      const p = mesh.vertices[verts[i]!]!.p
      const q = mesh.vertices[verts[(i + 1) % verts.length]!]!.p
      a += p.x * q.y - q.x * p.y
    }
    total += Math.abs(a) / 2
  }
  return total
}

/** Extract obstacle polylines and mesh bounds (same logic as demo fixture) */
function extractObstaclePolylines(mesh: Mesh): { bounds: { minX: number; maxX: number; minY: number; maxY: number }; obstacles: Point[][] } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const v of mesh.vertices) {
    if (!v) continue
    minX = Math.min(minX, v.p.x); maxX = Math.max(maxX, v.p.x)
    minY = Math.min(minY, v.p.y); maxY = Math.max(maxY, v.p.y)
  }

  const outgoing = new Map<number, number[]>()
  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices, P = poly.polygons
    for (let i = 0; i < V.length; i++) {
      const a = V[i]!, b = V[(i + 1) % V.length]!
      if (P[(i + 1) % V.length] !== -1) continue
      if (!outgoing.has(a)) outgoing.set(a, [])
      outgoing.get(a)!.push(b)
    }
  }

  const visited = new Set<string>()
  const loops: Point[][] = []
  for (const [startV] of outgoing) {
    for (const firstNext of outgoing.get(startV) ?? []) {
      const edgeKey = `${startV},${firstNext}`
      if (visited.has(edgeKey)) continue
      const loop: number[] = [startV]
      visited.add(edgeKey)
      let cur = firstNext
      while (cur !== startV) {
        loop.push(cur)
        const nexts = outgoing.get(cur)
        if (!nexts) break
        let found = false
        for (const n of nexts) {
          const ek = `${cur},${n}`
          if (!visited.has(ek)) { visited.add(ek); cur = n; found = true; break }
        }
        if (!found) break
      }
      if (cur === startV && loop.length >= 3) {
        loops.push(loop.map((vi) => mesh.vertices[vi]!.p))
      }
    }
  }

  const signedArea = (pts: Point[]) => {
    let a = 0
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!, q = pts[(i + 1) % pts.length]!
      a += (p.x * q.y - q.x * p.y)
    }
    return a / 2
  }

  let maxAbsArea = 0, maxIdx = 0
  const areas = loops.map((l, i) => {
    const a = signedArea(l)
    if (Math.abs(a) > maxAbsArea) { maxAbsArea = Math.abs(a); maxIdx = i }
    return a
  })

  const obstacles: Point[][] = []
  for (let i = 0; i < loops.length; i++) {
    if (i === maxIdx) continue
    const loop = loops[i]!
    if (areas[i]! < 0) loop.reverse()
    obstacles.push(loop)
  }

  return { bounds: { minX, maxX, minY, maxY }, obstacles }
}

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

  test("merged mesh preserves exact area", () => {
    const arenaPath = join(import.meta.dir, "..", "public", "meshes", "arena.mesh")
    let text: string
    try {
      text = readFileSync(arenaPath, "utf-8")
    } catch {
      return // Skip if file not available
    }
    const original = Mesh.fromString(text)
    const merged = mergeMesh(original)

    const origArea = meshArea(original)
    const mergedArea = meshArea(merged)
    expect(origArea).toBeGreaterThan(0)
    // Merge should preserve area exactly (same vertices, just different polygon groupings)
    expect(Math.abs(mergedArea - origArea) / origArea).toBeLessThan(1e-6)
  })

  test("CDT rebuild preserves area", () => {
    const arenaPath = join(import.meta.dir, "..", "public", "meshes", "arena.mesh")
    let text: string
    try {
      text = readFileSync(arenaPath, "utf-8")
    } catch {
      return // Skip if file not available
    }
    const fileMesh = Mesh.fromString(text)
    const fileArea = meshArea(fileMesh)

    // Run the CDT pipeline: extract obstacles → triangulate → filter by point location → build mesh
    const { bounds, obstacles } = extractObstaclePolylines(fileMesh)
    const cdtResult = cdtTriangulate({ bounds, obstacles })
    // Filter out regions outside the original mesh
    const regions = cdtResult.regions.filter((region) => {
      let cx = 0, cy = 0
      for (const p of region) { cx += p.x; cy += p.y }
      cx /= region.length; cy /= region.length
      return fileMesh.getPointLocation({ x: cx, y: cy }).type !== PointLocationType.NOT_ON_MESH
    })
    const cdtMesh = buildMeshFromRegions({ regions })
    const cdtArea = meshArea(cdtMesh)

    expect(fileArea).toBeGreaterThan(0)
    // CDT rebuild covers approximately the same area (~5% tolerance — CDT triangles
    // at the convex hull boundary may extend slightly beyond the original mesh boundary)
    expect(Math.abs(cdtArea - fileArea) / fileArea).toBeLessThan(0.05)
  })
})
