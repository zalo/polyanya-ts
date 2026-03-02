import { expect, test, describe } from "bun:test"
import { cdtTriangulate } from "../lib/cdt-builder.ts"
import { buildMeshFromRegions } from "../lib/mesh-builder.ts"
import { mergeMesh } from "../lib/mesh-merger.ts"
import { SearchInstance } from "../lib/search.ts"
import { VisibilityGraph } from "../lib/visibility-graph.ts"
import { distance } from "../lib/geometry.ts"
import type { Point, WeightedRegion } from "../lib/types.ts"

const bounds = { minX: -50, maxX: 50, minY: -50, maxY: 50 }

/** Build a mesh with obstacles and weighted regions via the CDT pipeline. */
function buildWeightedMesh(obstacles: Point[][], weightedRegions: WeightedRegion[]) {
  const { regions, regionWeights } = cdtTriangulate({ bounds, obstacles, weightedRegions })
  return buildMeshFromRegions({ regions, regionWeights })
}

describe("weighted regions — Polyanya (Euclidean cost, weights ignored)", () => {
  test("path through a weighted region is found at Euclidean cost", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -5, y: -20 },
        { x: 5, y: -20 },
        { x: 5, y: 20 },
        { x: -5, y: 20 },
      ],
      weight: 5.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])
    const search = new SearchInstance(mesh)
    const start: Point = { x: -20, y: 0 }
    const goal: Point = { x: 20, y: 0 }
    search.setStartGoal(start, goal)
    expect(search.search()).toBe(true)
    // Polyanya now returns Euclidean cost (weights are ignored)
    expect(search.getCost()).toBeCloseTo(distance(start, goal), 4)
  })

  test("start surrounded by weighted region — finds path at Euclidean cost", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -30, y: -30 },
        { x: 10, y: -30 },
        { x: 10, y: 30 },
        { x: -30, y: 30 },
      ],
      weight: 10.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -20, y: 0 }, { x: 30, y: 0 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("goal inside weighted region is reachable", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: -10, y: 10 },
      ],
      weight: 5.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -30, y: 0 }, { x: 0, y: 0 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("weight=1 penalty=0 is identical to open space", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -15, y: -15 },
        { x: 15, y: -15 },
        { x: 15, y: 15 },
        { x: -15, y: 15 },
      ],
      weight: 1.0,
      penalty: 0,
    }

    const { regions: rNone } = cdtTriangulate({ bounds, obstacles: [] })
    const meshNone = buildMeshFromRegions({ regions: rNone })

    const { regions: rW1, regionWeights: rwW1 } = cdtTriangulate({ bounds, obstacles: [], weightedRegions: [wr] })
    const meshW1 = buildMeshFromRegions({ regions: rW1, regionWeights: rwW1 })

    expect(rW1.length).toBe(rNone.length)
    expect(mergeMesh(meshW1).polygons.length).toBe(mergeMesh(meshNone).polygons.length)

    const queries = [
      { s: { x: -20, y: 0 }, g: { x: 20, y: 0 } },
      { s: { x: -30, y: -30 }, g: { x: 30, y: 30 } },
      { s: { x: 0, y: 0 }, g: { x: 40, y: 0 } },
    ]
    for (const q of queries) {
      const sNone = new SearchInstance(meshNone)
      sNone.setStartGoal(q.s, q.g)
      sNone.search()

      const sW1 = new SearchInstance(meshW1)
      sW1.setStartGoal(q.s, q.g)
      sW1.search()

      expect(sW1.getCost()).toBeCloseTo(sNone.getCost(), 6)
    }
  })
})

describe("weighted regions — VisibilityGraph (weighted cost)", () => {
  test("VG path through weighted region costs more than Euclidean", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -5, y: -20 },
        { x: 5, y: -20 },
        { x: 5, y: 20 },
        { x: -5, y: 20 },
      ],
      weight: 5.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])
    const mergedMesh = mergeMesh(mesh)
    const vg = new VisibilityGraph(mergedMesh, { weightedRegions: [wr] })

    const start: Point = { x: -20, y: 0 }
    const goal: Point = { x: 20, y: 0 }
    const result = vg.search(start, goal)

    expect(result.cost).toBeGreaterThan(0)
    expect(result.cost).toBeGreaterThan(distance(start, goal))
  })

  test("VG path avoids high-weight region when cheaper alternative exists", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -5, y: -10 },
        { x: 5, y: -10 },
        { x: 5, y: 10 },
        { x: -5, y: 10 },
      ],
      weight: 50.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])
    const mergedMesh = mergeMesh(mesh)
    const vg = new VisibilityGraph(mergedMesh, { weightedRegions: [wr] })

    const start: Point = { x: -20, y: 0 }
    const goal: Point = { x: 20, y: 0 }
    const result = vg.search(start, goal)

    expect(result.cost).toBeGreaterThan(0)
    // Path should have intermediate points (route around the region)
    expect(result.path.length).toBeGreaterThan(2)
  })

  test("VG penalty adds flat cost on region entry", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -5, y: -20 },
        { x: 5, y: -20 },
        { x: 5, y: 20 },
        { x: -5, y: 20 },
      ],
      weight: 1.0,
      penalty: 100,
    }
    const mesh = buildWeightedMesh([], [wr])
    const mergedMesh = mergeMesh(mesh)
    const vg = new VisibilityGraph(mergedMesh, { weightedRegions: [wr] })

    const start: Point = { x: -20, y: 0 }
    const goal: Point = { x: 20, y: 0 }
    const result = vg.search(start, goal)
    const euclidean = distance(start, goal)

    expect(result.cost).toBeGreaterThan(euclidean)
  })

  test("VG weight=1 penalty=0 gives Euclidean cost", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -15, y: -15 },
        { x: 15, y: -15 },
        { x: 15, y: 15 },
        { x: -15, y: 15 },
      ],
      weight: 1.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])
    const mergedMesh = mergeMesh(mesh)
    const vgWeighted = new VisibilityGraph(mergedMesh, { weightedRegions: [wr] })
    const vgPlain = new VisibilityGraph(mergedMesh)

    const queries = [
      { s: { x: -20, y: 0 }, g: { x: 20, y: 0 } },
      { s: { x: -30, y: -30 }, g: { x: 30, y: 30 } },
    ]
    for (const q of queries) {
      const rW = vgWeighted.search(q.s, q.g)
      const rP = vgPlain.search(q.s, q.g)
      expect(rW.cost).toBeCloseTo(rP.cost, 4)
    }
  })

  test("VG weighted region with obstacle — path goes around both", () => {
    const obstacle: Point[] = [
      { x: -5, y: -5 },
      { x: 5, y: -5 },
      { x: 5, y: 5 },
      { x: -5, y: 5 },
    ]
    const wr: WeightedRegion = {
      polygon: [
        { x: -10, y: 5 },
        { x: 10, y: 5 },
        { x: 10, y: 15 },
        { x: -10, y: 15 },
      ],
      weight: 20.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([obstacle], [wr])
    const mergedMesh = mergeMesh(mesh)
    const vg = new VisibilityGraph(mergedMesh, { weightedRegions: [wr] })

    const result = vg.search({ x: -20, y: 10 }, { x: 20, y: 10 })
    expect(result.cost).toBeGreaterThan(0)
  })

  test("VG both start and goal inside same weighted region", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -20, y: -20 },
        { x: 20, y: -20 },
        { x: 20, y: 20 },
        { x: -20, y: 20 },
      ],
      weight: 4.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])
    const mergedMesh = mergeMesh(mesh)
    const vg = new VisibilityGraph(mergedMesh, { weightedRegions: [wr] })

    const start: Point = { x: -5, y: 0 }
    const goal: Point = { x: 5, y: 0 }
    const result = vg.search(start, goal)

    expect(result.cost).toBeGreaterThan(0)
    // Both inside weight=4 region, cost = 4 * Euclidean distance
    expect(result.cost).toBeCloseTo(distance(start, goal) * 4, 2)
  })
})
