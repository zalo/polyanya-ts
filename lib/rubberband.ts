/**
 * Topological Rubberband Routing (gEDA-style)
 *
 * Phase 1 — A* on CDT edges: establishes topology.
 * Phase 2 — String-pull against obstacle edges + other traces.
 * Phase 3 — Divide-and-conquer arc insertion at obstacle corners.
 *
 * Key fix vs previous versions: line-of-sight checks by testing the
 * segment against ALL obstacle (boundary) edges in the mesh, rather
 * than walking the CDT triangle-by-triangle. This is robust for
 * segments starting from vertex positions.
 *
 * Reference: gEDA PCB toporouter by Anthony Blake; Tal Dayan, UCSC 1997.
 */

import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { distance } from "./geometry.ts"

export interface Trace {
  id: number
  start: Point
  end: Point
}

export interface RouteArc {
  centre: Point
  radius: number
  wind: number
  x0: number; y0: number
  x1: number; y1: number
}

export interface TraceRoute {
  trace: Trace
  initialPath: Point[]
  initialVertexPath: number[]
  corridor: number[]
  rubberbandPath: Point[]
  arcs: RouteArc[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function routeTraces(mesh: Mesh, traces: Trace[], clearance = 0): TraceRoute[] {
  if (traces.length === 0) return []

  const adj = buildVertexAdjacency(mesh)

  // Precompute obstacle geometry for LOS checks
  const obstacleEdges = collectObstacleEdges(mesh)
  const obstacleCorners: Point[] = mesh.vertices
    .filter((v): v is NonNullable<typeof v> => !!v && v.isCorner)
    .map(v => v.p)

  const results: TraceRoute[] = []

  for (const trace of traces) {
    // Phase 1: A* on CDT edges
    const startVi = findNearestVertex(mesh, trace.start)
    const endVi = findNearestVertex(mesh, trace.end)
    const vertexPath = edgeAstar(mesh, adj, startVi, endVi)

    const pointPath = vertexPath.map((vi) => mesh.vertices[vi]!.p)
    if (pointPath.length > 0) {
      if (distance(trace.start, pointPath[0]!) > 1e-6) pointPath.unshift(trace.start)
      if (distance(trace.end, pointPath[pointPath.length - 1]!) > 1e-6) pointPath.push(trace.end)
    }

    // Phase 2: String-pull against obstacles + existing routes
    const otherPaths = results.map(r => r.rubberbandPath).filter(p => p.length >= 2)
    const pulled = pointPath.length >= 2
      ? stringPull(pointPath, obstacleEdges, otherPaths, obstacleCorners)
      : [...pointPath]

    // Phase 3: Rubberband arc insertion at obstacle corners
    const arcs = pulled.length >= 3 && clearance > 0
      ? rubberbandArcs(mesh, pulled, clearance)
      : []

    const rubberbandPath = arcs.length > 0
      ? buildPathFromArcs(mesh, pulled, arcs)
      : pulled

    const corridor = corridorFromVertexPath(mesh, vertexPath)
    results.push({
      trace, initialPath: pointPath, initialVertexPath: vertexPath,
      corridor, rubberbandPath, arcs,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Obstacle edge collection
// ---------------------------------------------------------------------------

interface Segment { a: Point; b: Point }

/**
 * Collect all boundary/obstacle edges from the mesh.
 * A boundary edge has polygon adjacency === -1.
 */
function collectObstacleEdges(mesh: Mesh): Segment[] {
  const edges: Segment[] = []
  const seen = new Set<string>()

  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices
    for (let i = 0; i < V.length; i++) {
      const i2 = (i + 1) % V.length
      // Polyanya adjacency: polygons[j] is adj to edge (V[j-1], V[j])
      // Edge from V[i] to V[i2] has adjacency at index i2
      const adj = poly.polygons[i2]!
      if (adj !== -1) continue // interior edge, skip

      const va = V[i]!
      const vb = V[i2]!
      const key = va < vb ? `${va},${vb}` : `${vb},${va}`
      if (seen.has(key)) continue
      seen.add(key)

      edges.push({ a: mesh.vertices[va]!.p, b: mesh.vertices[vb]!.p })
    }
  }

  return edges
}

// ---------------------------------------------------------------------------
// String-pulling
// ---------------------------------------------------------------------------

/**
 * String-pull: try to shortcut between non-adjacent path vertices.
 * A shortcut is blocked if the segment intersects any obstacle edge
 * or any existing trace path segment.
 */
function stringPull(
  path: Point[],
  obstacleEdges: Segment[],
  otherTraces: Point[][],
  obstacleCorners: Point[],
): Point[] {
  if (path.length <= 2) return [...path]

  const result: Point[] = [path[0]!]
  let current = 0

  while (current < path.length - 1) {
    let farthest = current + 1

    for (let target = path.length - 1; target > current + 1; target--) {
      if (hasLineOfSight(path[current]!, path[target]!, obstacleEdges, otherTraces, obstacleCorners)) {
        farthest = target
        break
      }
    }

    result.push(path[farthest]!)
    current = farthest
  }

  return result
}

/**
 * Line-of-sight check: does the segment from→to cross any obstacle edge
 * or pass through any obstacle corner vertex or cross any other trace?
 *
 * Three checks:
 * 1. Proper crossing with obstacle edges (strict intersection)
 * 2. Passing through obstacle corner vertices (within epsilon of a corner
 *    that isn't from or to) — this prevents zero-clearance paths
 * 3. Proper crossing with other trace segments
 */
function hasLineOfSight(
  from: Point,
  to: Point,
  obstacleEdges: Segment[],
  otherTraces: Point[][],
  obstacleCorners?: Point[],
): boolean {
  // Check obstacle edges
  for (const edge of obstacleEdges) {
    if (segmentsProperlyIntersect(from, to, edge.a, edge.b)) return false
  }

  // Check if segment passes through any obstacle corner (zero clearance)
  if (obstacleCorners) {
    for (const c of obstacleCorners) {
      // Skip if corner is one of the endpoints
      if ((Math.abs(c.x - from.x) < 1e-4 && Math.abs(c.y - from.y) < 1e-4) ||
          (Math.abs(c.x - to.x) < 1e-4 && Math.abs(c.y - to.y) < 1e-4)) continue

      // Check if corner is very close to the segment
      const d = pointToSegmentDist(c, from, to)
      if (d < 0.5) return false // closer than half a unit = blocked
    }
  }

  // Check other traces
  for (const trace of otherTraces) {
    for (let i = 0; i < trace.length - 1; i++) {
      if (segmentsProperlyIntersect(from, to, trace[i]!, trace[i + 1]!)) return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Rubberband: arc insertion at obstacle corners
// ---------------------------------------------------------------------------

/**
 * After string-pulling, every interior vertex of the path that sits on
 * an obstacle corner needs a clearance arc. The string-pull already
 * identified these as the vertices the trace must wrap around —
 * the arc adds the physical clearance.
 *
 * This is simpler than gEDA's divide-and-conquer because our string-pull
 * already did the hard work of finding the attachment points. gEDA's
 * rubberband starts from the raw topological path (before string-pull)
 * and must find which vertices to wrap around AND insert arcs in a single
 * pass.
 */
function rubberbandArcs(mesh: Mesh, path: Point[], clearance: number): RouteArc[] {
  if (path.length < 3 || clearance <= 0) return []

  const corners = new Set<string>()
  for (const v of mesh.vertices) {
    if (v?.isCorner) corners.add(`${v.p.x.toFixed(4)},${v.p.y.toFixed(4)}`)
  }

  const arcs: RouteArc[] = []

  // Check every interior vertex — if it's an obstacle corner, insert an arc
  for (let i = 1; i < path.length - 1; i++) {
    const v = path[i]!
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)}`
    if (!corners.has(key)) continue

    const prev = path[i - 1]!
    const next = path[i + 1]!
    const arc = createArcAtCorner(prev, v, next, clearance)
    if (arc) arcs.push(arc)
  }

  return arcs
}

/**
 * Create a circular arc at an obstacle corner.
 * The arc is tangent to both the incoming (prev→corner) and outgoing
 * (corner→next) directions, with the given radius, wrapping around
 * the outside of the corner.
 */
function createArcAtCorner(
  prev: Point,
  corner: Point,
  next: Point,
  radius: number,
): RouteArc | null {
  // Vectors from corner to prev and next
  const dpx = prev.x - corner.x, dpy = prev.y - corner.y
  const dnx = next.x - corner.x, dny = next.y - corner.y
  const lenP = Math.sqrt(dpx * dpx + dpy * dpy)
  const lenN = Math.sqrt(dnx * dnx + dny * dny)
  if (lenP < 1e-10 || lenN < 1e-10) return null

  // Unit vectors away from corner
  const upx = dpx / lenP, upy = dpy / lenP
  const unx = dnx / lenN, uny = dny / lenN

  // Angle between the two directions
  const dot = upx * unx + upy * uny
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
  if (angle < 1e-6 || angle > Math.PI - 1e-6) return null

  const halfAngle = angle / 2

  // Distance from corner to tangent points along each direction
  const tanDist = Math.min(radius / Math.tan(halfAngle), lenP * 0.4, lenN * 0.4)
  if (tanDist < 1e-6) return null

  // Tangent points
  const t0x = corner.x + upx * tanDist, t0y = corner.y + upy * tanDist
  const t1x = corner.x + unx * tanDist, t1y = corner.y + uny * tanDist

  // Arc center: along the angle bisector, at distance r/sin(halfAngle)
  const bisX = upx + unx, bisY = upy + uny
  const bisLen = Math.sqrt(bisX * bisX + bisY * bisY)
  if (bisLen < 1e-10) return null

  const centerDist = radius / Math.sin(halfAngle)
  const cx = corner.x + (bisX / bisLen) * centerDist
  const cy = corner.y + (bisY / bisLen) * centerDist

  // Winding: which way does the path turn at this corner?
  // cross > 0 = CCW turn (arc goes CW), cross < 0 = CW turn (arc goes CCW)
  const cross = dpx * dny - dpy * dnx
  const arcWind = cross > 0 ? -1 : 1

  return {
    centre: { x: cx, y: cy },
    radius,
    wind: arcWind,
    x0: t0x, y0: t0y,
    x1: t1x, y1: t1y,
  }
}

/**
 * Build final path by replacing obstacle corners with arc samples.
 *
 * The arcs list is in path order — arc[0] corresponds to the first
 * obstacle corner in the path, arc[1] to the second, etc.
 * We match arcs to path vertices by checking which interior vertices
 * are obstacle corners (same order as rubberbandArcs produced them).
 */
function buildPathFromArcs(mesh: Mesh, path: Point[], arcs: RouteArc[]): Point[] {
  if (arcs.length === 0) return path

  const corners = new Set<string>()
  for (const v of mesh.vertices) {
    if (v?.isCorner) corners.add(`${v.p.x.toFixed(4)},${v.p.y.toFixed(4)}`)
  }

  const result: Point[] = []
  let arcIdx = 0

  for (let i = 0; i < path.length; i++) {
    const p = path[i]!
    const key = `${p.x.toFixed(4)},${p.y.toFixed(4)}`

    // Is this an interior obstacle corner with a matching arc?
    if (i > 0 && i < path.length - 1 && corners.has(key) && arcIdx < arcs.length) {
      const arc = arcs[arcIdx]!
      arcIdx++

      // Sample the arc from tangent entry to tangent exit
      const startAngle = Math.atan2(arc.y0 - arc.centre.y, arc.x0 - arc.centre.x)
      const endAngle = Math.atan2(arc.y1 - arc.centre.y, arc.x1 - arc.centre.x)

      // Angle difference in the correct winding direction
      let angleDiff = endAngle - startAngle

      // Normalize to [-PI, PI] first
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI

      // Ensure winding matches: wind > 0 = CCW (positive angle), wind < 0 = CW (negative)
      if (arc.wind > 0 && angleDiff < 0) angleDiff += 2 * Math.PI
      if (arc.wind < 0 && angleDiff > 0) angleDiff -= 2 * Math.PI

      // Clamp to prevent full loops (max ~270 degrees)
      if (Math.abs(angleDiff) > Math.PI * 1.5) {
        angleDiff = Math.sign(angleDiff) * Math.PI * 1.5
      }

      const arcR = arc.radius
      const numSamples = Math.max(4, Math.ceil(Math.abs(angleDiff) * arcR * 0.3))

      // Emit arc samples (entry tangent → arc → exit tangent)
      for (let s = 0; s <= numSamples; s++) {
        const t = s / numSamples
        const a = startAngle + angleDiff * t
        result.push({
          x: arc.centre.x + arcR * Math.cos(a),
          y: arc.centre.y + arcR * Math.sin(a),
        })
      }
    } else {
      result.push(p)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}

/**
 * Test if two segments properly intersect (endpoints of one strictly
 * straddle the other). Shared endpoints do NOT count.
 */
function segmentsProperlyIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = triArea2(a1, a2, b1)
  const d2 = triArea2(a1, a2, b2)
  const d3 = triArea2(b1, b2, a1)
  const d4 = triArea2(b1, b2, a2)

  // Strict proper crossing
  if (((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
      ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))) {
    return true
  }
  return false
}

function triArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

// ---------------------------------------------------------------------------
// Corridor (visualization)
// ---------------------------------------------------------------------------

function polysContainingEdge(mesh: Mesh, va: number, vb: number): number[] {
  const result: number[] = []
  const polysA = mesh.vertices[va]!.polygons
  const polysB = new Set(mesh.vertices[vb]!.polygons)
  for (const pi of polysA) { if (pi !== -1 && polysB.has(pi)) result.push(pi) }
  return result
}

function corridorFromVertexPath(mesh: Mesh, vertexPath: number[]): number[] {
  if (vertexPath.length < 2) return []
  const corridor: number[] = []
  for (let i = 0; i < vertexPath.length - 1; i++) {
    const va = vertexPath[i]!, vb = vertexPath[i + 1]!
    const ep = polysContainingEdge(mesh, va, vb)
    if (ep.length === 0) continue
    if (ep.length === 1) { if (corridor.length === 0 || corridor[corridor.length - 1] !== ep[0]!) corridor.push(ep[0]!); continue }
    let ref: number | null = null
    if (i + 2 < vertexPath.length) ref = vertexPath[i + 2]!; else if (i > 0) ref = vertexPath[i - 1]!
    let chosen = ep[0]!
    if (ref !== null) {
      const pA = mesh.vertices[va]!.p, pB = mesh.vertices[vb]!.p, pR = mesh.vertices[ref]!.p, side = triArea2(pA, pB, pR)
      for (const pi of ep) { const tv = mesh.polygons[pi]!.vertices.find(v => v !== va && v !== vb); if (tv !== undefined && (side > 0) === (triArea2(pA, pB, mesh.vertices[tv]!.p) > 0)) { chosen = pi; break } }
    }
    if (corridor.length === 0 || corridor[corridor.length - 1] !== chosen) corridor.push(chosen)
  }
  return corridor
}

// ---------------------------------------------------------------------------
// Vertex adjacency + A*
// ---------------------------------------------------------------------------

type AdjGraph = Map<number, Set<number>>

/**
 * Build vertex adjacency graph from INTERIOR CDT edges only.
 * Edges where polygon adjacency is -1 (obstacle/boundary constraints)
 * are excluded — the A* must not walk along obstacle edges.
 * This prevents traces from "sticking" to obstacle surfaces.
 */
function buildVertexAdjacency(mesh: Mesh): AdjGraph {
  const adj: AdjGraph = new Map()
  const ensure = (v: number) => { if (!adj.has(v)) adj.set(v, new Set()) }

  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices
    for (let i = 0; i < V.length; i++) {
      const i2 = (i + 1) % V.length
      const a = V[i]!, b = V[i2]!
      // polygons[i2] is adjacency for edge (V[i], V[i2])
      const adjPoly = poly.polygons[i2]!
      if (adjPoly === -1) continue // skip boundary/obstacle edges

      ensure(a); ensure(b)
      adj.get(a)!.add(b); adj.get(b)!.add(a)
    }
  }

  // Ensure all vertices have entries even if they have no interior edges
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (mesh.vertices[i] && !adj.has(i)) adj.set(i, new Set())
  }

  return adj
}

function findNearestVertex(mesh: Mesh, p: Point): number {
  let best = 0, bestD = Infinity
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i]; if (!v) continue
    const d = distance(p, v.p); if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function edgeAstar(mesh: Mesh, adj: AdjGraph, start: number, goal: number): number[] {
  if (start === goal) return [start]
  const goalP = mesh.vertices[goal]!.p
  const gBest = new Map<number, number>()
  const from = new Map<number, number>()
  const heap: { vi: number; f: number; g: number }[] = []
  const push = (e: typeof heap[0]) => {
    heap.push(e); let i = heap.length - 1
    while (i > 0) { const p = (i-1)>>1; if (heap[p]!.f <= heap[i]!.f) break; [heap[p],heap[i]] = [heap[i]!,heap[p]!]; i = p }
  }
  const pop = () => {
    const top = heap[0]!; const last = heap.pop()!
    if (heap.length > 0) { heap[0] = last; let i = 0; for(;;) { let s=i; const l=2*i+1,r=2*i+2; if(l<heap.length&&heap[l]!.f<heap[s]!.f)s=l; if(r<heap.length&&heap[r]!.f<heap[s]!.f)s=r; if(s===i)break; [heap[i],heap[s]]=[heap[s]!,heap[i]!]; i=s } }
    return top
  }
  gBest.set(start, 0)
  push({ vi: start, g: 0, f: distance(mesh.vertices[start]!.p, goalP) })
  while (heap.length > 0) {
    const cur = pop()
    if (cur.g > (gBest.get(cur.vi) ?? Infinity)) continue
    if (cur.vi === goal) {
      const path = [goal]; let v = goal
      while (from.has(v)) { v = from.get(v)!; path.push(v) }
      return path.reverse()
    }
    for (const nvi of adj.get(cur.vi) ?? []) {
      const ng = cur.g + distance(mesh.vertices[cur.vi]!.p, mesh.vertices[nvi]!.p)
      if (ng < (gBest.get(nvi) ?? Infinity)) {
        gBest.set(nvi, ng); from.set(nvi, cur.vi)
        push({ vi: nvi, g: ng, f: ng + distance(mesh.vertices[nvi]!.p, goalP) })
      }
    }
  }
  return []
}
