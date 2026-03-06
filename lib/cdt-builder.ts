import cdt2d from "cdt2d"
import { resolveConstraintCrossings } from "./resolve-constraint-crossings.ts"
import type { Point, WeightedRegion } from "./types.ts"

/**
 * Result of CDT triangulation including per-region weight data.
 */
export interface CdtResult {
  regions: Point[][]
  regionWeights: { weight: number; penalty: number }[]
}

/**
 * CDT-triangulate the free space inside `bounds` around obstacle polygons.
 *
 * Each obstacle is a closed polygon (array of Point). The function generates
 * boundary sample points, builds constraint edges, runs constrained Delaunay
 * triangulation via cdt2d, and filters out triangles whose centroid falls
 * inside an obstacle. Returns CdtResult with regions and per-region weights.
 *
 * For rectangular obstacles with clearance, expand the rects into polygons
 * before calling this function.
 */
export function cdtTriangulate(input: {
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  obstacles: Point[][]
  weightedRegions?: WeightedRegion[]
  /** Extra unconstrained Steiner points to insert into the CDT (e.g. trace endpoints) */
  steinerPoints?: Point[]
}): CdtResult {
  const { bounds, obstacles, weightedRegions, steinerPoints } = input
  const { minX, maxX, minY, maxY } = bounds

  const pts: [number, number][] = []
  const edges: [number, number][] = []
  const ringBoundaries: number[] = []

  // --- Bounds ring (4 corners only, matching gEDA's board constraint style) ---
  ringBoundaries.push(edges.length)
  const boundsStart = pts.length
  pts.push([minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY])
  const boundsEnd = pts.length
  // 4 constraint edges forming the boundary rectangle
  edges.push([boundsStart, boundsStart + 1]) // bottom
  edges.push([boundsStart + 1, boundsStart + 2]) // right
  edges.push([boundsStart + 2, boundsStart + 3]) // top
  edges.push([boundsStart + 3, boundsStart]) // left

  // --- Obstacle polygon rings ---
  for (const obstacle of obstacles) {
    if (obstacle.length < 3) continue

    // Deduplicate consecutive coincident points (including wrap-around)
    // to avoid zero-length constraint edges that crash cdt2d.
    const deduped: Point[] = []
    for (let i = 0; i < obstacle.length; i++) {
      const p = obstacle[i]!
      const prev = deduped.length > 0 ? deduped[deduped.length - 1]! : null
      if (!prev || Math.abs(p.x - prev.x) > 1e-9 || Math.abs(p.y - prev.y) > 1e-9) {
        deduped.push(p)
      }
    }
    // Check wrap-around: last vs first
    if (deduped.length > 1) {
      const first = deduped[0]!
      const last = deduped[deduped.length - 1]!
      if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
        deduped.pop()
      }
    }
    if (deduped.length < 3) continue

    ringBoundaries.push(edges.length)
    const ringStart = pts.length
    // Add tiny jitter to prevent degenerate collinear inputs
    for (let i = 0; i < deduped.length; i++) {
      const p = deduped[i]!
      pts.push([
        p.x + ((i % 7) - 3) * 1e-8,
        p.y + ((i % 5) - 2) * 1e-8,
      ])
    }
    // Constraint edges forming the closed ring
    for (let i = 0; i < deduped.length; i++) {
      edges.push([ringStart + i, ringStart + (i + 1) % deduped.length])
    }
  }

  // --- Weighted region vertices (added as Steiner points, NOT constraint edges) ---
  // Adding only vertices ensures the CDT refines triangles near region boundaries
  // without creating holes (closed constraint rings would be treated as holes by cdt2d).
  // First, merge overlapping weighted regions that share the same weight+penalty
  // to reduce Steiner point count and avoid near-degenerate triangulations.
  const wrPolygons = mergeWeightedRegions(
    (weightedRegions ?? []).filter(wr => wr.weight !== 1 || wr.penalty !== 0)
  )
  for (const wr of wrPolygons) {
    if (wr.polygon.length < 3) continue
    for (let i = 0; i < wr.polygon.length; i++) {
      const p = wr.polygon[i]!
      pts.push([
        p.x + ((i % 7) - 3) * 1e-8,
        p.y + ((i % 5) - 2) * 1e-8,
      ])
    }
  }

  // --- Steiner points (e.g. trace endpoints) ---
  // Added as unconstrained vertices so the CDT includes them as triangle vertices.
  if (steinerPoints) {
    for (let i = 0; i < steinerPoints.length; i++) {
      const p = steinerPoints[i]!
      pts.push([
        p.x + ((i % 7) - 3) * 1e-8,
        p.y + ((i % 5) - 2) * 1e-8,
      ])
    }
  }

  // --- Resolve crossing constraint edges from overlapping obstacles ---
  const resolved = resolveConstraintCrossings(pts, edges, ringBoundaries)

  // --- Run CDT (with retry on degenerate input) ---
  // cdt2d can crash on near-degenerate geometry (near-collinear constraint edges,
  // very close points). Retry with progressively more jitter if it fails.
  let triangles: [number, number, number][]
  try {
    triangles = cdt2d(resolved.pts, resolved.constraintEdges, { exterior: false })
  } catch {
    // Retry with stronger random jitter on all non-bounds points
    const jitteredPts = resolved.pts.map((p, i) => {
      if (i < boundsEnd) return p // keep bounds precise
      return [
        p[0] + (Math.random() - 0.5) * 1e-5,
        p[1] + (Math.random() - 0.5) * 1e-5,
      ] as [number, number]
    })
    try {
      triangles = cdt2d(jitteredPts, resolved.constraintEdges, { exterior: false })
      // Update resolved.pts so downstream uses the jittered version
      for (let i = 0; i < jitteredPts.length; i++) {
        resolved.pts[i] = jitteredPts[i]!
      }
    } catch {
      // CDT is fundamentally broken for this input — return empty result
      return { regions: [], regionWeights: [] }
    }
  }

  // --- Filter: remove triangles whose centroid is inside any obstacle ---
  const rPts = resolved.pts
  const filtered = triangles.filter((tri) => {
    const [a, b, c] = tri
    const cx = (rPts[a]![0] + rPts[b]![0] + rPts[c]![0]) / 3
    const cy = (rPts[a]![1] + rPts[b]![1] + rPts[c]![1]) / 3
    return !pointInAnyObstacle(cx, cy, obstacles)
  })

  // --- Convert to Point[][] regions with weight assignment ---
  const regions: Point[][] = []
  const regionWeights: { weight: number; penalty: number }[] = []

  for (const [a, b, c] of filtered) {
    const pa = { x: rPts[a]![0], y: rPts[a]![1] }
    const pb = { x: rPts[b]![0], y: rPts[b]![1] }
    const pc = { x: rPts[c]![0], y: rPts[c]![1] }
    // Ensure CCW winding
    const cross = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x)
    regions.push(cross >= 0 ? [pa, pb, pc] : [pa, pc, pb])

    // Determine weight from weighted regions (test centroid)
    const cx = (pa.x + pb.x + pc.x) / 3
    const cy = (pa.y + pb.y + pc.y) / 3
    let rw = { weight: 1, penalty: 0 }
    for (const wr of wrPolygons) {
      if (pointInPolygon(cx, cy, wr.polygon)) {
        rw = { weight: wr.weight, penalty: wr.penalty }
        break
      }
    }
    regionWeights.push(rw)
  }

  return { regions, regionWeights }
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
 * Merge overlapping weighted regions that share the same weight+penalty.
 * Computes axis-aligned bounding box for each polygon, then iteratively
 * merges overlapping/touching AABBs with matching weight+penalty into a
 * single rect polygon. This reduces Steiner point count and prevents
 * near-degenerate triangulations from many tiny overlapping squares.
 */
function mergeWeightedRegions(regions: WeightedRegion[]): WeightedRegion[] {
  if (regions.length <= 1) return regions

  // Group by weight+penalty key
  const groups = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; weight: number; penalty: number }[]>()
  for (const wr of regions) {
    const key = `${wr.weight}:${wr.penalty}`
    let group = groups.get(key)
    if (!group) {
      group = []
      groups.set(key, group)
    }
    // Compute AABB from polygon
    let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity
    for (const p of wr.polygon) {
      if (p.x < rMinX) rMinX = p.x
      if (p.y < rMinY) rMinY = p.y
      if (p.x > rMaxX) rMaxX = p.x
      if (p.y > rMaxY) rMaxY = p.y
    }
    group.push({ minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY, weight: wr.weight, penalty: wr.penalty })
  }

  const result: WeightedRegion[] = []

  for (const [, rects] of groups) {
    // Iteratively merge overlapping/touching rects
    let merged = true
    while (merged) {
      merged = false
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!, b = rects[j]!
          // Check overlap/touching (with tiny epsilon for floating point)
          if (a.maxX + 1e-6 >= b.minX && b.maxX + 1e-6 >= a.minX &&
              a.maxY + 1e-6 >= b.minY && b.maxY + 1e-6 >= a.minY) {
            // Merge into a
            a.minX = Math.min(a.minX, b.minX)
            a.minY = Math.min(a.minY, b.minY)
            a.maxX = Math.max(a.maxX, b.maxX)
            a.maxY = Math.max(a.maxY, b.maxY)
            rects.splice(j, 1)
            merged = true
            break
          }
        }
        if (merged) break
      }
    }

    // Convert merged rects back to WeightedRegion polygons
    for (const r of rects) {
      result.push({
        polygon: [
          { x: r.minX, y: r.minY },
          { x: r.maxX, y: r.minY },
          { x: r.maxX, y: r.maxY },
          { x: r.minX, y: r.maxY },
        ],
        weight: r.weight,
        penalty: r.penalty,
      })
    }
  }

  return result
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
