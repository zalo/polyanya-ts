import { expect, test, describe } from "bun:test"
import { Mesh } from "./lib/mesh.ts"
import { PointLocationType } from "./lib/types.ts"

const SQUARE_MESH = `mesh
2
5 4
0 1 3 -1 1 0
1 0 3 -1 0 3
0 -1 3 -1 3 2
-1 0 3 -1 2 1
0 0 4 0 1 2 3
3 4 1 0 1 3 -1
3 4 0 3 2 0 -1
3 4 3 2 3 1 -1
3 4 2 1 0 2 -1`

describe("Mesh loading", () => {
  test("parses square.mesh correctly", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    expect(mesh.vertices.length).toBe(5)
    expect(mesh.polygons.length).toBe(4)
    expect(mesh.maxPolySides).toBe(3)
  })

  test("vertex positions are correct", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    expect(mesh.vertices[0]!.p).toEqual({ x: 0, y: 1 })
    expect(mesh.vertices[1]!.p).toEqual({ x: 1, y: 0 })
    expect(mesh.vertices[2]!.p).toEqual({ x: 0, y: -1 })
    expect(mesh.vertices[3]!.p).toEqual({ x: -1, y: 0 })
    expect(mesh.vertices[4]!.p).toEqual({ x: 0, y: 0 })
  })

  test("corner vertices identified correctly", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    // All outer vertices touch -1 (obstacle)
    expect(mesh.vertices[0]!.isCorner).toBe(true)
    expect(mesh.vertices[1]!.isCorner).toBe(true)
    expect(mesh.vertices[2]!.isCorner).toBe(true)
    expect(mesh.vertices[3]!.isCorner).toBe(true)
    // Center vertex is NOT a corner
    expect(mesh.vertices[4]!.isCorner).toBe(false)
  })

  test("polygon adjacency is correct", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    // Polygon 0: vertices 4,1,0 — adjacent to 1,3,-1
    expect(mesh.polygons[0]!.vertices).toEqual([4, 1, 0])
    expect(mesh.polygons[0]!.polygons).toEqual([1, 3, -1])
  })

  test("point location works for center", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    // Point at (0.25, 0.25) should be inside a polygon
    const loc = mesh.getPointLocation({ x: 0.25, y: 0.25 })
    expect(loc.type).toBe(PointLocationType.IN_POLYGON)
  })

  test("point location returns NOT_ON_MESH for outside point", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    const loc = mesh.getPointLocation({ x: 5, y: 5 })
    expect(loc.type).toBe(PointLocationType.NOT_ON_MESH)
  })

  test("point location on vertex", () => {
    const mesh = Mesh.fromString(SQUARE_MESH)
    const loc = mesh.getPointLocation({ x: 0, y: 0 })
    // Center vertex (4) is non-corner
    expect(loc.type).toBe(PointLocationType.ON_NON_CORNER_VERTEX)
    expect(loc.vertex1).toBe(4)
  })
})
