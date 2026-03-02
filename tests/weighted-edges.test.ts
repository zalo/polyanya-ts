import { expect, test, describe } from "bun:test"
import {
  buildWeightedEdgeContext,
  computeWeightedEdgeCost,
  pointInConvexPolygon,
} from "../lib/weighted-edges.ts"
import { distance } from "../lib/geometry.ts"
import type { Point, WeightedRegion } from "../lib/types.ts"

describe("pointInConvexPolygon", () => {
  const square: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  test("point inside", () => {
    expect(pointInConvexPolygon({ x: 5, y: 5 }, square)).toBe(true)
  })

  test("point outside", () => {
    expect(pointInConvexPolygon({ x: 15, y: 5 }, square)).toBe(false)
    expect(pointInConvexPolygon({ x: -1, y: 5 }, square)).toBe(false)
  })

  test("point on edge", () => {
    expect(pointInConvexPolygon({ x: 5, y: 0 }, square)).toBe(true)
    expect(pointInConvexPolygon({ x: 0, y: 5 }, square)).toBe(true)
  })

  test("point on vertex", () => {
    expect(pointInConvexPolygon({ x: 0, y: 0 }, square)).toBe(true)
    expect(pointInConvexPolygon({ x: 10, y: 10 }, square)).toBe(true)
  })

  test("triangle", () => {
    const tri: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 10 },
    ]
    expect(pointInConvexPolygon({ x: 5, y: 3 }, tri)).toBe(true)
    expect(pointInConvexPolygon({ x: 0, y: 10 }, tri)).toBe(false)
  })
})

describe("computeWeightedEdgeCost", () => {
  test("edge fully outside any region has Euclidean cost", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 110, y: 110 },
        { x: 100, y: 110 },
      ],
      weight: 5.0,
      penalty: 0,
    }
    const ctx = buildWeightedEdgeContext([wr])
    const a: Point = { x: 0, y: 0 }
    const b: Point = { x: 10, y: 0 }
    const cost = computeWeightedEdgeCost(a, b, ctx)
    expect(cost).toBeCloseTo(distance(a, b), 6)
  })

  test("edge fully inside a region has weighted cost", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -20, y: -20 },
        { x: 20, y: -20 },
        { x: 20, y: 20 },
        { x: -20, y: 20 },
      ],
      weight: 3.0,
      penalty: 0,
    }
    const ctx = buildWeightedEdgeContext([wr])
    const a: Point = { x: -5, y: 0 }
    const b: Point = { x: 5, y: 0 }
    const cost = computeWeightedEdgeCost(a, b, ctx)
    expect(cost).toBeCloseTo(distance(a, b) * 3.0, 4)
  })

  test("edge crossing a region boundary is split correctly", () => {
    // Region from x=0 to x=10, edge from x=-10 to x=10
    const wr: WeightedRegion = {
      polygon: [
        { x: 0, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      weight: 3.0,
      penalty: 0,
    }
    const ctx = buildWeightedEdgeContext([wr])
    const a: Point = { x: -10, y: 0 }
    const b: Point = { x: 10, y: 0 }
    // 10 units outside (weight=1) + 10 units inside (weight=3) = 10 + 30 = 40
    const cost = computeWeightedEdgeCost(a, b, ctx)
    expect(cost).toBeCloseTo(40, 2)
  })

  test("penalty is added on region entry", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: 0, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      weight: 1.0,
      penalty: 50,
    }
    const ctx = buildWeightedEdgeContext([wr])
    const a: Point = { x: -10, y: 0 }
    const b: Point = { x: 10, y: 0 }
    // 10 outside + 10 inside (weight=1) + 50 penalty = 70
    const cost = computeWeightedEdgeCost(a, b, ctx)
    expect(cost).toBeCloseTo(70, 2)
  })

  test("edge passing through and exiting a region", () => {
    // Region from x=2 to x=8, edge from x=0 to x=10
    const wr: WeightedRegion = {
      polygon: [
        { x: 2, y: -10 },
        { x: 8, y: -10 },
        { x: 8, y: 10 },
        { x: 2, y: 10 },
      ],
      weight: 4.0,
      penalty: 0,
    }
    const ctx = buildWeightedEdgeContext([wr])
    const a: Point = { x: 0, y: 0 }
    const b: Point = { x: 10, y: 0 }
    // 2 outside + 6 inside (weight=4) + 2 outside = 2 + 24 + 2 = 28
    const cost = computeWeightedEdgeCost(a, b, ctx)
    expect(cost).toBeCloseTo(28, 2)
  })

  test("weight=1 penalty=0 gives Euclidean cost", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -20, y: -20 },
        { x: 20, y: -20 },
        { x: 20, y: 20 },
        { x: -20, y: 20 },
      ],
      weight: 1.0,
      penalty: 0,
    }
    const ctx = buildWeightedEdgeContext([wr])
    const a: Point = { x: -10, y: 0 }
    const b: Point = { x: 10, y: 0 }
    const cost = computeWeightedEdgeCost(a, b, ctx)
    expect(cost).toBeCloseTo(distance(a, b), 6)
  })

  test("zero-length edge has zero cost", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: -10, y: -10 },
        { x: 10, y: -10 },
        { x: 10, y: 10 },
        { x: -10, y: 10 },
      ],
      weight: 5.0,
      penalty: 10,
    }
    const ctx = buildWeightedEdgeContext([wr])
    const cost = computeWeightedEdgeCost({ x: 0, y: 0 }, { x: 0, y: 0 }, ctx)
    expect(cost).toBe(0)
  })

  test("diagonal edge through region", () => {
    const wr: WeightedRegion = {
      polygon: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      weight: 2.0,
      penalty: 0,
    }
    const ctx = buildWeightedEdgeContext([wr])
    // Diagonal from (-5,-5) to (5,5) — crosses region boundary
    const a: Point = { x: -5, y: -5 }
    const b: Point = { x: 5, y: 5 }
    const cost = computeWeightedEdgeCost(a, b, ctx)
    // Half outside (weight=1), half inside (weight=2)
    const half = distance(a, b) / 2
    expect(cost).toBeCloseTo(half * 1 + half * 2, 2)
  })
})
