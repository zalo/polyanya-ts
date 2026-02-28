import { expect, test, describe } from "bun:test"
import { cdtTriangulate } from "../lib/cdt-builder.ts"
import { buildMeshFromRegions } from "../lib/mesh-builder.ts"
import { mergeMesh } from "../lib/mesh-merger.ts"
import { SearchInstance } from "../lib/search.ts"
import { distance } from "../lib/geometry.ts"
import type { Point, WeightedRegion } from "../lib/types.ts"

const bounds = { minX: -50, maxX: 50, minY: -50, maxY: 50 }

/** Build a mesh with obstacles and weighted regions via the CDT pipeline. */
function buildWeightedMesh(obstacles: Point[][], weightedRegions: WeightedRegion[]) {
  const { regions, regionWeights } = cdtTriangulate({ bounds, obstacles, weightedRegions })
  return buildMeshFromRegions({ regions, regionWeights })
}

describe("weighted regions", () => {
  test("path through a weighted region is found", () => {
    // A single weighted region sitting between start and goal — no way around it
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
    search.setStartGoal({ x: -20, y: 0 }, { x: 20, y: 0 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("start surrounded by high-weight region still finds path", () => {
    // Large weighted region covers the start point — goal is outside it
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
    // Start deep inside the weighted region, goal well outside
    search.setStartGoal({ x: -20, y: 0 }, { x: 30, y: 0 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("start surrounded by weighted region — path costs more than Euclidean", () => {
    // Weighted region covers start; path must traverse it
    const wr: WeightedRegion = {
      polygon: [
        { x: -25, y: -25 },
        { x: 5, y: -25 },
        { x: 5, y: 25 },
        { x: -25, y: 25 },
      ],
      weight: 3.0,
      penalty: 0,
    }
    const mesh = buildWeightedMesh([], [wr])

    const start: Point = { x: -15, y: 0 }
    const goal: Point = { x: 30, y: 0 }
    const euclidean = distance(start, goal)

    const search = new SearchInstance(mesh)
    search.setStartGoal(start, goal)
    expect(search.search()).toBe(true)
    // Path cost should exceed Euclidean because part goes through weight=3 region
    expect(search.getCost()).toBeGreaterThan(euclidean)
  })

  test("path avoids high-weight region when cheaper alternative exists", () => {
    // Weighted region blocks the direct horizontal path; going around is cheaper
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

    const start: Point = { x: -20, y: 0 }
    const goal: Point = { x: 20, y: 0 }
    const directDist = distance(start, goal)

    const search = new SearchInstance(mesh)
    search.setStartGoal(start, goal)
    expect(search.search()).toBe(true)

    // With weight=50, path should route around the region
    // The avoidance path is longer in Euclidean distance but cheaper in weighted cost
    const path = search.getPathPoints()
    // Path should have intermediate points (not a straight line through the region)
    expect(path.length).toBeGreaterThan(2)
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
    // Goal is deep inside the weighted region
    search.setStartGoal({ x: -30, y: 0 }, { x: 0, y: 0 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("both start and goal inside same weighted region", () => {
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
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -5, y: 0 }, { x: 5, y: 0 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("penalty adds flat cost when entering weighted region", () => {
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

    const start: Point = { x: -20, y: 0 }
    const goal: Point = { x: 20, y: 0 }
    const euclidean = distance(start, goal)

    const search = new SearchInstance(mesh)
    search.setStartGoal(start, goal)
    expect(search.search()).toBe(true)
    // Penalty should make the path cost > Euclidean
    expect(search.getCost()).toBeGreaterThan(euclidean)
  })

  test("weighted region with obstacle — path goes around both", () => {
    // Obstacle in the center, weighted region above it
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
    const search = new SearchInstance(mesh)
    search.setStartGoal({ x: -20, y: 10 }, { x: 20, y: 10 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
  })

  test("multiple weighted regions around start", () => {
    // Start is surrounded on 3 sides by weighted regions; must traverse at least one
    const regions: WeightedRegion[] = [
      {
        polygon: [
          { x: -30, y: -5 },
          { x: -10, y: -5 },
          { x: -10, y: 5 },
          { x: -30, y: 5 },
        ],
        weight: 8.0,
        penalty: 0,
      },
      {
        polygon: [
          { x: -15, y: 5 },
          { x: -5, y: 5 },
          { x: -5, y: 25 },
          { x: -15, y: 25 },
        ],
        weight: 8.0,
        penalty: 0,
      },
      {
        polygon: [
          { x: -15, y: -25 },
          { x: -5, y: -25 },
          { x: -5, y: -5 },
          { x: -15, y: -5 },
        ],
        weight: 8.0,
        penalty: 0,
      },
    ]
    const mesh = buildWeightedMesh([], regions)
    const search = new SearchInstance(mesh)
    // Start inside the left weighted region, goal on the far right
    search.setStartGoal({ x: -20, y: 0 }, { x: 30, y: 0 })
    expect(search.search()).toBe(true)
    expect(search.getCost()).toBeGreaterThan(0)
    expect(search.getPathPoints().length).toBeGreaterThanOrEqual(2)
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

    // Build with and without the weight=1 region
    const { regions: rNone } = cdtTriangulate({ bounds, obstacles: [] })
    const meshNone = buildMeshFromRegions({ regions: rNone })

    const { regions: rW1, regionWeights: rwW1 } = cdtTriangulate({ bounds, obstacles: [], weightedRegions: [wr] })
    const meshW1 = buildMeshFromRegions({ regions: rW1, regionWeights: rwW1 })

    // Same number of triangles (no extra Steiner points added)
    expect(rW1.length).toBe(rNone.length)

    // Same merge result
    expect(mergeMesh(meshW1).polygons.length).toBe(mergeMesh(meshNone).polygons.length)

    // Same path costs across multiple queries
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
