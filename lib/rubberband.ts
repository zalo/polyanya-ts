/**
 * Topological Rubberband Routing (gEDA-style)
 *
 * Based on the gEDA PCB toporouter by Anthony Blake, which implements
 * Tal Dayan's rubber-band routing from his 1997 UCSC dissertation.
 *
 * Phase 1 — A* through triangle faces:
 *   Search expands through CDT triangles. At each triangle, candidate
 *   vertices are generated on the opposite edge, offset from existing
 *   routes by clearance. Routes are stored on edges in sorted order.
 *
 * Phase 2 — Rubberband (divide-and-conquer arc insertion):
 *   For each straight segment of the path, check all intermediate path
 *   vertices. Find the CDT vertex that "pushes" hardest against the
 *   segment (needs the most clearance arc). Insert an arc there, then
 *   recurse on both sub-segments. Produces a sequence of arcs and
 *   straight segments.
 *
 * Key concepts from gEDA:
 * - edge_routing: sorted list of routed vertices on each CDT edge
 * - candidate_vertices: positions offset by clearance from existing routes
 * - winding: cross-product sign tracks sidedness
 * - arcs: first-class objects with centre, radius, winding, tangent points
 */

import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { distance } from "./geometry.ts"

export interface Trace {
  id: number
  start: Point
  end: Point
}

/** An arc wrapping around a CDT vertex */
export interface RouteArc {
  centre: Point
  radius: number
  /** Winding direction: 1 = CCW, -1 = CW */
  wind: number
  /** Tangent point from incoming segment */
  x0: number; y0: number
  /** Tangent point to outgoing segment */
  x1: number; y1: number
}

export interface TraceRoute {
  trace: Trace
  /** Initial A* path through triangle faces (vertex positions) */
  initialPath: Point[]
  initialVertexPath: number[]
  /** Corridor of polygon indices */
  corridor: number[]
  /** Final rubberband path (straight segments + arc samples) */
  rubberbandPath: Point[]
  /** Arcs inserted by rubberband */
  arcs: RouteArc[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function routeTraces(mesh: Mesh, traces: Trace[], clearance = 0): TraceRoute[] {
  if (traces.length === 0) return []

  // Build adjacency: for each polygon, which polygons are adjacent (and through which edge)
  const adj = buildVertexAdjacency(mesh)

  // Route each trace
  const results: TraceRoute[] = []

  // Shared edge routing state: tracks which vertices are routed on each edge
  const edgeRouting = new Map<string, RoutedVertex[]>()

  for (const trace of traces) {
    // Phase 1: A* on CDT vertex graph (establishes topology)
    const startVi = findNearestVertex(mesh, trace.start)
    const endVi = findNearestVertex(mesh, trace.end)
    const vertexPath = edgeAstar(mesh, adj, startVi, endVi)

    const pointPath = vertexPath.map((vi) => mesh.vertices[vi]!.p)
    if (pointPath.length > 0) {
      if (distance(trace.start, pointPath[0]!) > 1e-6) pointPath.unshift(trace.start)
      if (distance(trace.end, pointPath[pointPath.length - 1]!) > 1e-6) pointPath.push(trace.end)
    }

    // Phase 2: String-pull against obstacles and existing routes
    const otherPaths = results.map(r => r.rubberbandPath).filter(p => p.length >= 2)
    const pulled = pointPath.length >= 2
      ? stringPull(mesh, pointPath, otherPaths)
      : [...pointPath]

    // Phase 3: Rubberband — divide-and-conquer arc insertion
    const arcs = pulled.length >= 2
      ? rubberbandArcs(mesh, pulled, clearance)
      : []

    // Phase 4: Build final path from arcs
    const rubberbandPath = arcs.length > 0
      ? buildPathFromArcs(pulled, arcs)
      : pulled

    // Record routed vertices on edges for subsequent traces
    recordRouteOnEdges(mesh, vertexPath, edgeRouting, trace.id)

    const corridor = corridorFromVertexPath(mesh, vertexPath)
    results.push({
      trace,
      initialPath: pointPath,
      initialVertexPath: vertexPath,
      corridor,
      rubberbandPath,
      arcs,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Edge routing (gEDA concept: routes stored on edges)
// ---------------------------------------------------------------------------

interface RoutedVertex {
  traceId: number
  /** Parameter t along the edge [0=v1, 1=v2] */
  t: number
  point: Point
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`
}

function recordRouteOnEdges(
  mesh: Mesh,
  vertexPath: number[],
  edgeRouting: Map<string, RoutedVertex[]>,
  traceId: number,
): void {
  for (let i = 0; i < vertexPath.length - 1; i++) {
    const va = vertexPath[i]!
    const vb = vertexPath[i + 1]!
    const key = edgeKey(va, vb)
    if (!edgeRouting.has(key)) edgeRouting.set(key, [])
    const pA = mesh.vertices[va]!.p
    const pB = mesh.vertices[vb]!.p
    const mid: Point = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 }
    edgeRouting.get(key)!.push({ traceId, t: 0.5, point: mid })
  }
}

// ---------------------------------------------------------------------------
// String-pulling with obstacle + trace barriers
// ---------------------------------------------------------------------------

function stringPull(mesh: Mesh, path: Point[], otherTraces: Point[][]): Point[] {
  if (path.length <= 2) return [...path]

  const result: Point[] = [path[0]!]
  let current = 0

  while (current < path.length - 1) {
    let farthest = current + 1

    for (let target = path.length - 1; target > current + 1; target--) {
      if (hasLineOfSight(mesh, path[current]!, path[target]!, otherTraces)) {
        farthest = target
        break
      }
    }

    result.push(path[farthest]!)
    current = farthest
  }

  return result
}

function hasLineOfSight(
  mesh: Mesh, from: Point, to: Point, otherTraces: Point[][],
): boolean {
  // Check against other traces
  for (const trace of otherTraces) {
    for (let i = 0; i < trace.length - 1; i++) {
      if (segmentsProperlyIntersect(from, to, trace[i]!, trace[i + 1]!)) return false
    }
  }

  // Walk CDT to check obstacle edges
  const loc = mesh.getPointLocation(from)
  let startPoly = loc.poly1
  if (startPoly < 0) startPoly = loc.poly2
  if (startPoly < 0) {
    const nudge: Point = { x: from.x + (to.x - from.x) * 1e-6, y: from.y + (to.y - from.y) * 1e-6 }
    const loc2 = mesh.getPointLocation(nudge)
    startPoly = loc2.poly1 >= 0 ? loc2.poly1 : loc2.poly2
    if (startPoly < 0) return false
  }

  let currentPoly = startPoly
  let prevPoly = -1

  for (let steps = 0; steps < 500; steps++) {
    const poly = mesh.polygons[currentPoly]!
    const V = poly.vertices

    if (pointInTriangleLoose(to, mesh, V)) return true

    let foundNext = false
    for (let i = 0; i < V.length; i++) {
      const i2 = (i + 1) % V.length
      const adj = poly.polygons[i2]!
      if (adj === prevPoly) continue

      const ea = mesh.vertices[V[i]!]!.p
      const eb = mesh.vertices[V[i2]!]!.p

      if (rayIntersectsEdge(from, to, ea, eb)) {
        if (adj === -1) return false
        prevPoly = currentPoly
        currentPoly = adj
        foundNext = true
        break
      }
    }

    if (!foundNext) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Rubberband: divide-and-conquer arc insertion (gEDA-style)
// ---------------------------------------------------------------------------

/**
 * gEDA rubberband algorithm:
 * For a straight segment from t1 to t2, walk all intermediate path vertices.
 * For each vertex v on the path that lies on a CDT edge, check if the edge
 * endpoints are "pushing" against the segment (closer than clearance).
 * The vertex with maximum push distance gets an arc inserted.
 * Then recurse on both sub-segments.
 */
function rubberbandArcs(mesh: Mesh, path: Point[], clearance: number): RouteArc[] {
  if (path.length < 2 || clearance <= 0) return []
  return rubberbandSegment(mesh, path, 0, path.length - 1, clearance)
}

function rubberbandSegment(
  mesh: Mesh,
  path: Point[],
  startIdx: number,
  endIdx: number,
  clearance: number,
): RouteArc[] {
  if (endIdx - startIdx < 2) return []

  const p1 = path[startIdx]!
  const p2 = path[endIdx]!

  // Find the intermediate vertex that pushes hardest against the segment p1→p2
  let maxPush = 0
  let maxIdx = -1
  let maxArcCentre: Point | null = null
  let maxWind = 0

  for (let i = startIdx + 1; i < endIdx; i++) {
    const v = path[i]!

    // Check if this vertex is an obstacle corner
    if (!isObstacleCorner(mesh, v)) continue

    // Perpendicular distance from v to segment p1→p2
    const d = pointToSegmentDist(v, p1, p2)
    const push = clearance - d

    if (push > maxPush) {
      maxPush = push
      maxIdx = i
      maxArcCentre = v
      maxWind = wind(p1, p2, v)
    }
  }

  if (maxIdx < 0 || !maxArcCentre) return []

  // Create the arc at this vertex
  const arc = createArc(p1, p2, maxArcCentre, clearance, maxWind)

  // Recurse on both sub-segments
  const leftArcs = rubberbandSegment(mesh, path, startIdx, maxIdx, clearance)
  const rightArcs = rubberbandSegment(mesh, path, maxIdx, endIdx, clearance)

  return [...leftArcs, arc, ...rightArcs]
}

function createArc(
  from: Point, to: Point, centre: Point, radius: number, winding: number,
): RouteArc {
  // Compute tangent points from the incoming and outgoing lines to the arc circle
  const t0 = tangentPoint(from, centre, radius, winding)
  const t1 = tangentPoint(to, centre, radius, -winding)

  return {
    centre,
    radius,
    wind: winding,
    x0: t0.x, y0: t0.y,
    x1: t1.x, y1: t1.y,
  }
}

/**
 * Compute the tangent point from a line origin to a circle.
 * Returns the tangent point on the circle closest to the line from→centre.
 */
function tangentPoint(from: Point, centre: Point, radius: number, winding: number): Point {
  const dx = centre.x - from.x
  const dy = centre.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 1e-10) return { x: centre.x + radius, y: centre.y }

  // Unit vector from→centre
  const ux = dx / dist
  const uy = dy / dist

  // Perpendicular (rotated by winding direction)
  const px = -uy * winding
  const py = ux * winding

  // Tangent point is offset from centre perpendicular to from→centre
  const r = Math.min(radius, dist * 0.9)
  return {
    x: centre.x + px * r,
    y: centre.y + py * r,
  }
}

/**
 * Build the final path from the string-pulled path and inserted arcs.
 * Each arc is sampled with circular arc points.
 */
function buildPathFromArcs(path: Point[], arcs: RouteArc[]): Point[] {
  if (arcs.length === 0) return path

  const result: Point[] = [path[0]!]

  for (const arc of arcs) {
    // Add tangent entry point
    result.push({ x: arc.x0, y: arc.y0 })

    // Sample the arc
    const startAngle = Math.atan2(arc.y0 - arc.centre.y, arc.x0 - arc.centre.x)
    let endAngle = Math.atan2(arc.y1 - arc.centre.y, arc.x1 - arc.centre.x)

    let angleDiff = endAngle - startAngle
    if (arc.wind > 0) {
      if (angleDiff < 0) angleDiff += 2 * Math.PI
    } else {
      if (angleDiff > 0) angleDiff -= 2 * Math.PI
    }

    const arcR = Math.sqrt(
      (arc.x0 - arc.centre.x) ** 2 + (arc.y0 - arc.centre.y) ** 2,
    )
    const numSamples = Math.max(4, Math.ceil(Math.abs(angleDiff) * arcR / (arc.radius * 0.3)))

    for (let s = 1; s < numSamples; s++) {
      const t = s / numSamples
      const angle = startAngle + angleDiff * t
      result.push({
        x: arc.centre.x + arcR * Math.cos(angle),
        y: arc.centre.y + arcR * Math.sin(angle),
      })
    }

    // Add tangent exit point
    result.push({ x: arc.x1, y: arc.y1 })
  }

  result.push(path[path.length - 1]!)
  return result
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function isObstacleCorner(mesh: Mesh, p: Point): boolean {
  for (const v of mesh.vertices) {
    if (!v || !v.isCorner) continue
    if (Math.abs(v.p.x - p.x) < 1e-4 && Math.abs(v.p.y - p.y) < 1e-4) return true
  }
  return false
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  const proj: Point = { x: a.x + t * dx, y: a.y + t * dy }
  return distance(p, proj)
}

function wind(a: Point, b: Point, c: Point): number {
  const v = triArea2(a, b, c)
  return v > 1e-10 ? 1 : v < -1e-10 ? -1 : 0
}

function segmentsProperlyIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = triArea2(a1, a2, b1)
  const d2 = triArea2(a1, a2, b2)
  const d3 = triArea2(b1, b2, a1)
  const d4 = triArea2(b1, b2, a2)
  if (((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
      ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))) return true
  return false
}

function rayIntersectsEdge(from: Point, to: Point, ea: Point, eb: Point): boolean {
  const d1 = triArea2(from, to, ea)
  const d2 = triArea2(from, to, eb)
  if (d1 * d2 >= -1e-20) return false
  const d3 = triArea2(ea, eb, from)
  const d4 = triArea2(ea, eb, to)
  if ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10)) return true
  if (Math.abs(d3) <= 1e-10 && Math.abs(d4) > 1e-10) return true
  return false
}

function pointInTriangleLoose(p: Point, mesh: Mesh, V: number[]): boolean {
  if (V.length < 3) return false
  const a = mesh.vertices[V[0]!]!.p
  const b = mesh.vertices[V[1]!]!.p
  const c = mesh.vertices[V[2]!]!.p
  const d1 = triArea2(a, b, p)
  const d2 = triArea2(b, c, p)
  const d3 = triArea2(c, a, p)
  return !((d1 < -1e-10 || d2 < -1e-10 || d3 < -1e-10) && (d1 > 1e-10 || d2 > 1e-10 || d3 > 1e-10))
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
    const edgePolys = polysContainingEdge(mesh, va, vb)
    if (edgePolys.length === 0) continue
    if (edgePolys.length === 1) {
      if (corridor.length === 0 || corridor[corridor.length - 1] !== edgePolys[0]!) corridor.push(edgePolys[0]!)
      continue
    }
    let ref: number | null = null
    if (i + 2 < vertexPath.length) ref = vertexPath[i + 2]!
    else if (i > 0) ref = vertexPath[i - 1]!
    let chosen = edgePolys[0]!
    if (ref !== null) {
      const pA = mesh.vertices[va]!.p, pB = mesh.vertices[vb]!.p, pR = mesh.vertices[ref]!.p
      const side = triArea2(pA, pB, pR)
      for (const pi of edgePolys) {
        const thirdV = mesh.polygons[pi]!.vertices.find((v) => v !== va && v !== vb)
        if (thirdV !== undefined && (side > 0) === (triArea2(pA, pB, mesh.vertices[thirdV]!.p) > 0)) { chosen = pi; break }
      }
    }
    if (corridor.length === 0 || corridor[corridor.length - 1] !== chosen) corridor.push(chosen)
  }
  return corridor
}

// ---------------------------------------------------------------------------
// Vertex adjacency + A*
// ---------------------------------------------------------------------------

type AdjGraph = Map<number, Set<number>>

function buildVertexAdjacency(mesh: Mesh): AdjGraph {
  const adj: AdjGraph = new Map()
  for (const poly of mesh.polygons) {
    if (!poly) continue
    for (let i = 0; i < poly.vertices.length; i++) {
      const a = poly.vertices[i]!, b = poly.vertices[(i + 1) % poly.vertices.length]!
      if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set())
      adj.get(a)!.add(b); adj.get(b)!.add(a)
    }
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
