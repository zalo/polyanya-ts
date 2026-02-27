import cdt2d from "cdt2d"
import { resolveConstraintCrossings } from "./resolve-constraint-crossings.ts"
import type { Point } from "./types.ts"

/**
 * CDT-triangulate the free space inside `bounds` around obstacle polygons.
 *
 * Each obstacle is a closed polygon (array of Point). The function generates
 * boundary sample points, builds constraint edges, runs constrained Delaunay
 * triangulation via cdt2d, and filters out triangles whose centroid falls
 * inside an obstacle. Returns Point[][] regions (triangles) suitable for
 * buildMeshFromRegions.
 *
 * For rectangular obstacles with clearance, expand the rects into polygons
 * before calling this function.
 */
export function cdtTriangulate(input: {
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  obstacles: Point[][]
}): Point[][] {
  const { bounds, obstacles } = input
  const { minX, maxX, minY, maxY } = bounds

  const pts: [number, number][] = []
  const edges: [number, number][] = []
  const ringBoundaries: number[] = []

  // --- Bounds ring (4 corners + samples along edges) ---
  ringBoundaries.push(edges.length)
  const edgeSamples = 10
  const boundsStart = pts.length
  pts.push([minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY])
  for (let i = 1; i < edgeSamples; i++) {
    const t = i / edgeSamples
    pts.push([minX + t * (maxX - minX), minY]) // bottom
    pts.push([maxX, minY + t * (maxY - minY)]) // right
    pts.push([maxX - t * (maxX - minX), maxY]) // top
    pts.push([minX, maxY - t * (maxY - minY)]) // left
  }
  const boundsEnd = pts.length
  // Constraint edges for bounds ring (connect all bounds points in order)
  // The 4 corners are at boundsStart..boundsStart+3,
  // then edge samples are interleaved. Build a proper ring:
  // bottom: corner0, samples[0], samples[4], ..., corner1
  // right:  corner1, samples[1], samples[5], ..., corner2
  // etc.
  const boundsEdgePoints: number[][] = [[], [], [], []] // bottom, right, top, left
  boundsEdgePoints[0]!.push(boundsStart) // corner 0
  boundsEdgePoints[1]!.push(boundsStart + 1) // corner 1
  boundsEdgePoints[2]!.push(boundsStart + 2) // corner 2
  boundsEdgePoints[3]!.push(boundsStart + 3) // corner 3
  for (let i = 1; i < edgeSamples; i++) {
    const base = boundsStart + 4 + (i - 1) * 4
    boundsEdgePoints[0]!.push(base)     // bottom
    boundsEdgePoints[1]!.push(base + 1) // right
    boundsEdgePoints[2]!.push(base + 2) // top
    boundsEdgePoints[3]!.push(base + 3) // left
  }
  boundsEdgePoints[0]!.push(boundsStart + 1) // close bottom → corner1
  boundsEdgePoints[1]!.push(boundsStart + 2) // close right → corner2
  boundsEdgePoints[2]!.push(boundsStart + 3) // close top → corner3
  boundsEdgePoints[3]!.push(boundsStart)     // close left → corner0

  for (const side of boundsEdgePoints) {
    for (let i = 0; i < side.length - 1; i++) {
      edges.push([side[i]!, side[i + 1]!])
    }
  }

  // --- Obstacle polygon rings ---
  for (const obstacle of obstacles) {
    if (obstacle.length < 3) continue
    ringBoundaries.push(edges.length)
    const ringStart = pts.length
    // Add tiny jitter to prevent degenerate collinear inputs
    for (let i = 0; i < obstacle.length; i++) {
      const p = obstacle[i]!
      pts.push([
        p.x + ((i % 7) - 3) * 1e-8,
        p.y + ((i % 5) - 2) * 1e-8,
      ])
    }
    // Constraint edges forming the closed ring
    for (let i = 0; i < obstacle.length; i++) {
      edges.push([ringStart + i, ringStart + (i + 1) % obstacle.length])
    }
  }

  // --- Resolve crossing constraint edges from overlapping obstacles ---
  const resolved = resolveConstraintCrossings(pts, edges, ringBoundaries)

  // --- Run CDT ---
  const triangles: [number, number, number][] = cdt2d(resolved.pts, resolved.constraintEdges, { exterior: false })

  // --- Filter: remove triangles whose centroid is inside any obstacle ---
  const rPts = resolved.pts
  const filtered = triangles.filter((tri) => {
    const [a, b, c] = tri
    const cx = (rPts[a]![0] + rPts[b]![0] + rPts[c]![0]) / 3
    const cy = (rPts[a]![1] + rPts[b]![1] + rPts[c]![1]) / 3
    return !pointInAnyObstacle(cx, cy, obstacles)
  })

  // --- Convert to Point[][] regions ---
  return filtered.map(([a, b, c]) => {
    const pa = { x: rPts[a]![0], y: rPts[a]![1] }
    const pb = { x: rPts[b]![0], y: rPts[b]![1] }
    const pc = { x: rPts[c]![0], y: rPts[c]![1] }
    // Ensure CCW winding
    const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x)
    return cross >= 0 ? [pa, pb, pc] : [pa, pc, pb]
  })
}

/** Ray-casting point-in-polygon test */
function pointInPolygon(px: number, py: number, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!, pj = poly[j]!
    if ((pi.y > py) !== (pj.y > py) &&
        px < (pj.x - pi.x) * (py - pi.y) / (pj.y - pi.y) + pi.x) {
      inside = !inside
    }
  }
  return inside
}

function pointInAnyObstacle(px: number, py: number, obstacles: Point[][]): boolean {
  for (const obstacle of obstacles) {
    if (pointInPolygon(px, py, obstacle)) return true
  }
  return false
}

/**
 * Expand a rectangle (center, width, height) with clearance into a polygon.
 */
export function rectToPolygon(
  cx: number, cy: number, w: number, h: number, clearance: number,
): Point[] {
  const hw = w / 2 + clearance
  const hh = h / 2 + clearance
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ]
}
