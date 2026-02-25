import { expect, test, describe } from "bun:test"
import {
  distance,
  distanceSq,
  getOrientation,
  isCollinear,
  lineIntersect,
  lineIntersectBoundCheck,
  pointsEqual,
  reflectPoint,
  sub,
} from "../lib/geometry.ts"
import { Orientation, ZeroOnePos } from "../lib/types.ts"

describe("Geometry", () => {
  test("distance between points", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5)
    expect(distance({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(0)
  })

  test("distanceSq", () => {
    expect(distanceSq({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(25)
  })

  test("pointsEqual", () => {
    expect(pointsEqual({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true)
    expect(pointsEqual({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false)
    expect(
      pointsEqual({ x: 0, y: 0 }, { x: 1e-9, y: 1e-9 }),
    ).toBe(true) // within EPSILON
  })

  test("getOrientation", () => {
    // CCW turn
    expect(
      getOrientation({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }),
    ).toBe(Orientation.CCW)
    // CW turn
    expect(
      getOrientation({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: -1 }),
    ).toBe(Orientation.CW)
    // Collinear
    expect(
      getOrientation({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }),
    ).toBe(Orientation.COLLINEAR)
  })

  test("isCollinear", () => {
    expect(
      isCollinear({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }),
    ).toBe(true)
    expect(
      isCollinear({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }),
    ).toBe(false)
  })

  test("lineIntersect", () => {
    // Two perpendicular lines crossing at (0.5, 0.5)
    const p = lineIntersect(
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    )
    expect(p.x).toBeCloseTo(0.5)
    expect(p.y).toBeCloseTo(0.5)
  })

  test("lineIntersectBoundCheck", () => {
    expect(lineIntersectBoundCheck(0, 1)).toBe(ZeroOnePos.EQ_ZERO)
    expect(lineIntersectBoundCheck(1, 1)).toBe(ZeroOnePos.EQ_ONE)
    expect(lineIntersectBoundCheck(0.5, 1)).toBe(ZeroOnePos.IN_RANGE)
    expect(lineIntersectBoundCheck(-1, 1)).toBe(ZeroOnePos.LT_ZERO)
    expect(lineIntersectBoundCheck(2, 1)).toBe(ZeroOnePos.GT_ONE)
  })

  test("reflectPoint", () => {
    // Reflect (0, 1) across the x-axis (line from (-1,0) to (1,0))
    const reflected = reflectPoint(
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    )
    expect(reflected.x).toBeCloseTo(0)
    expect(reflected.y).toBeCloseTo(-1)
  })
})
