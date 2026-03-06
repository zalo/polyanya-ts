/**
 * Topological Rubberband Routing
 *
 * Phase 1 — Initial path via A* on CDT edges.
 * Phase 2 — String-pull against obstacles (CDT line-walk).
 * Phase 3 — String-pull against other traces (maintain sidedness).
 * Phase 4 — Circular arcs at attachment points (obstacle clearance).
 *
 * Reference: Tal Dayan, "Rubber-Band Based Topological Router", PhD Dissertation, UCSC, 1997
 */

import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { distance } from "./geometry.ts"

export interface Trace {
  id: number
  start: Point
  end: Point
}

export interface TraceRoute {
  trace: Trace
  initialPath: Point[]
  initialVertexPath: number[]
  corridor: number[]
  rubberbandPath: Point[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Route traces with full topological rubberband routing.
 *
 * @param clearance - radius for circular arcs at obstacle corners (0 = sharp corners)
 */
export function routeTraces(mesh: Mesh, traces: Trace[], clearance = 0): TraceRoute[] {
  if (traces.length === 0) return []

  const adj = buildVertexAdjacency(mesh)

  // Phase 1: A* on CDT edges — establishes topology
  const phase1: {
    trace: Trace
    initialPath: Point[]
    initialVertexPath: number[]
  }[] = []

  for (const trace of traces) {
    const startVi = findNearestVertex(mesh, trace.start)
    const endVi = findNearestVertex(mesh, trace.end)
    const vertexPath = edgeAstar(mesh, adj, startVi, endVi)
    const pointPath = vertexPath.map((vi) => mesh.vertices[vi]!.p)
    if (pointPath.length > 0) {
      if (distance(trace.start, pointPath[0]!) > 1e-6) pointPath.unshift(trace.start)
      if (distance(trace.end, pointPath[pointPath.length - 1]!) > 1e-6) pointPath.push(trace.end)
    }
    phase1.push({ trace, initialPath: pointPath, initialVertexPath: vertexPath })
  }

  // Phase 2: String-pull each trace against obstacles only
  let paths: Point[][] = phase1.map(({ initialPath }) =>
    initialPath.length >= 2 ? stringPull(mesh, initialPath, []) : [...initialPath],
  )

  // Phase 3: Iterative string-pull against other traces (sidedness).
  // Each trace re-pulls treating other traces' current paths as barriers.
  // Iterate until paths stabilize or max iterations reached.
  const MAX_ITERS = 5
  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let changed = false
    const newPaths: Point[][] = []

    for (let i = 0; i < phase1.length; i++) {
      const { initialPath } = phase1[i]!
      if (initialPath.length < 2) {
        newPaths.push(paths[i]!)
        continue
      }

      // Collect other traces' paths as barrier segments
      const otherPaths: Point[][] = []
      for (let j = 0; j < paths.length; j++) {
        if (j !== i && paths[j]!.length >= 2) otherPaths.push(paths[j]!)
      }

      const pulled = stringPull(mesh, initialPath, otherPaths)

      // Check if this path changed
      if (!pathsEqual(pulled, paths[i]!)) changed = true
      newPaths.push(pulled)
    }

    paths = newPaths
    if (!changed) break
  }

  // Phase 4: Add circular arcs at obstacle corner attachment points
  if (clearance > 0) {
    for (let i = 0; i < paths.length; i++) {
      paths[i] = addClearanceArcs(mesh, paths[i]!, clearance)
    }
  }

  // Build results
  return phase1.map(({ trace, initialPath, initialVertexPath }, i) => ({
    trace,
    initialPath,
    initialVertexPath,
    corridor: corridorFromVertexPath(mesh, initialVertexPath),
    rubberbandPath: paths[i]!,
  }))
}

function pathsEqual(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]!.x - b[i]!.x) > 1e-8 || Math.abs(a[i]!.y - b[i]!.y) > 1e-8) return false
  }
  return true
}

// ---------------------------------------------------------------------------
// String-pulling with obstacle + trace barriers
// ---------------------------------------------------------------------------

/**
 * String-pull a path. Checks line-of-sight against:
 * 1. CDT boundary edges (obstacles)
 * 2. Other traces' path segments (trace-to-trace sidedness)
 */
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

/**
 * Line-of-sight check: walk CDT triangles from→to.
 * Blocked if the ray crosses a boundary edge OR any segment of otherTraces.
 */
function hasLineOfSight(
  mesh: Mesh,
  from: Point,
  to: Point,
  otherTraces: Point[][],
): boolean {
  // First check: does the segment cross any other trace?
  for (const trace of otherTraces) {
    for (let i = 0; i < trace.length - 1; i++) {
      if (segmentsProperlyIntersect(from, to, trace[i]!, trace[i + 1]!)) {
        return false
      }
    }
  }

  // Second check: walk the CDT to verify no obstacle edge is crossed
  const loc = mesh.getPointLocation(from)
  let startPoly = loc.poly1
  if (startPoly < 0) startPoly = loc.poly2
  if (startPoly < 0) {
    const nudge: Point = {
      x: from.x + (to.x - from.x) * 1e-6,
      y: from.y + (to.y - from.y) * 1e-6,
    }
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
      const adjIdx = i2
      const adj = poly.polygons[adjIdx]!
      if (adj === prevPoly) continue

      const ea = mesh.vertices[V[i]!]!.p
      const eb = mesh.vertices[V[i2]!]!.p

      if (rayProperlyIntersectsEdge(from, to, ea, eb)) {
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

/**
 * Test if two segments properly intersect (cross each other's interiors).
 * Endpoint-touching does NOT count as an intersection.
 */
function segmentsProperlyIntersect(
  a1: Point, a2: Point, b1: Point, b2: Point,
): boolean {
  const d1 = triArea2(a1, a2, b1)
  const d2 = triArea2(a1, a2, b2)
  const d3 = triArea2(b1, b2, a1)
  const d4 = triArea2(b1, b2, a2)

  // Both endpoints of each segment must be on strictly opposite sides
  if (((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
      ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))) {
    return true
  }
  return false
}

function rayProperlyIntersectsEdge(
  from: Point, to: Point, ea: Point, eb: Point,
): boolean {
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

  const hasNeg = d1 < -1e-10 || d2 < -1e-10 || d3 < -1e-10
  const hasPos = d1 > 1e-10 || d2 > 1e-10 || d3 > 1e-10

  return !(hasNeg && hasPos)
}

// ---------------------------------------------------------------------------
// Phase 4: Circular arcs at obstacle corners
// ---------------------------------------------------------------------------

/**
 * At each interior vertex of the path that is an obstacle corner,
 * replace the sharp corner with a circular arc of the given radius.
 *
 * The arc wraps around the obstacle corner, maintaining clearance.
 * This is the "spokes" concept from Dayan's dissertation.
 */
function addClearanceArcs(mesh: Mesh, path: Point[], radius: number): Point[] {
  if (path.length < 3 || radius <= 0) return path

  const result: Point[] = [path[0]!]

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]!
    const curr = path[i]!
    const next = path[i + 1]!

    // Check if this vertex is an obstacle corner
    if (!isObstacleCorner(mesh, curr)) {
      result.push(curr)
      continue
    }

    // Compute the arc around this corner
    const arcPoints = computeArc(prev, curr, next, radius)
    for (const p of arcPoints) result.push(p)
  }

  result.push(path[path.length - 1]!)
  return result
}

/**
 * Check if a point coincides with an obstacle corner vertex in the mesh.
 */
function isObstacleCorner(mesh: Mesh, p: Point): boolean {
  for (const v of mesh.vertices) {
    if (!v || !v.isCorner) continue
    if (Math.abs(v.p.x - p.x) < 1e-4 && Math.abs(v.p.y - p.y) < 1e-4) {
      return true
    }
  }
  return false
}

/**
 * Compute arc sample points around a corner vertex.
 *
 * The arc is tangent to both incoming (prev→curr) and outgoing (curr→next)
 * segments, with the given radius, wrapping around the corner.
 */
function computeArc(
  prev: Point,
  corner: Point,
  next: Point,
  radius: number,
): Point[] {
  // Direction vectors from corner to prev and next
  const dxP = prev.x - corner.x
  const dyP = prev.y - corner.y
  const dxN = next.x - corner.x
  const dyN = next.y - corner.y

  const lenP = Math.sqrt(dxP * dxP + dyP * dyP)
  const lenN = Math.sqrt(dxN * dxN + dyN * dyN)
  if (lenP < 1e-10 || lenN < 1e-10) return [corner]

  // Unit vectors
  const upx = dxP / lenP, upy = dyP / lenP
  const unx = dxN / lenN, uny = dyN / lenN

  // Half-angle between the two segments
  const dot = upx * unx + upy * uny
  const halfAngle = Math.acos(Math.max(-1, Math.min(1, dot))) / 2

  if (halfAngle < 1e-6 || halfAngle > Math.PI - 1e-6) return [corner]

  // Distance from corner to the tangent points
  const tangentDist = Math.min(radius / Math.tan(halfAngle), lenP * 0.4, lenN * 0.4)
  if (tangentDist < 1e-6) return [corner]

  // Tangent points on each segment
  const t1: Point = { x: corner.x + upx * tangentDist, y: corner.y + upy * tangentDist }
  const t2: Point = { x: corner.x + unx * tangentDist, y: corner.y + uny * tangentDist }

  // Arc center: offset from corner along the angle bisector
  const bisX = upx + unx
  const bisY = upy + uny
  const bisLen = Math.sqrt(bisX * bisX + bisY * bisY)
  if (bisLen < 1e-10) return [corner]

  const centerDist = tangentDist / Math.cos(Math.PI / 2 - halfAngle)
  const cx = corner.x + (bisX / bisLen) * centerDist
  const cy = corner.y + (bisY / bisLen) * centerDist

  // Compute arc angles
  const startAngle = Math.atan2(t1.y - cy, t1.x - cx)
  let endAngle = Math.atan2(t2.y - cy, t2.x - cx)

  // Determine arc direction (shorter arc that wraps around the corner)
  const cross = upx * uny - upy * unx
  let angleDiff = endAngle - startAngle
  if (cross > 0) {
    // CCW turn — arc should go CW (negative angle diff)
    if (angleDiff > 0) angleDiff -= 2 * Math.PI
  } else {
    // CW turn — arc should go CCW (positive angle diff)
    if (angleDiff < 0) angleDiff += 2 * Math.PI
  }

  // Sample the arc
  const arcRadius = Math.sqrt((t1.x - cx) * (t1.x - cx) + (t1.y - cy) * (t1.y - cy))
  const numSamples = Math.max(3, Math.ceil(Math.abs(angleDiff) * arcRadius / (radius * 0.5)))
  const points: Point[] = []

  for (let s = 0; s <= numSamples; s++) {
    const t = s / numSamples
    const angle = startAngle + angleDiff * t
    points.push({
      x: cx + arcRadius * Math.cos(angle),
      y: cy + arcRadius * Math.sin(angle),
    })
  }

  return points
}

// ---------------------------------------------------------------------------
// Corridor (for visualization)
// ---------------------------------------------------------------------------

function polysContainingEdge(mesh: Mesh, va: number, vb: number): number[] {
  const result: number[] = []
  const polysA = mesh.vertices[va]!.polygons
  const polysB = new Set(mesh.vertices[vb]!.polygons)
  for (const pi of polysA) {
    if (pi !== -1 && polysB.has(pi)) result.push(pi)
  }
  return result
}

function corridorFromVertexPath(mesh: Mesh, vertexPath: number[]): number[] {
  if (vertexPath.length < 2) return []
  const corridor: number[] = []

  for (let i = 0; i < vertexPath.length - 1; i++) {
    const va = vertexPath[i]!
    const vb = vertexPath[i + 1]!
    const edgePolys = polysContainingEdge(mesh, va, vb)
    if (edgePolys.length === 0) continue

    if (edgePolys.length === 1) {
      const pi = edgePolys[0]!
      if (corridor.length === 0 || corridor[corridor.length - 1] !== pi) corridor.push(pi)
      continue
    }

    let refVertex: number | null = null
    if (i + 2 < vertexPath.length) refVertex = vertexPath[i + 2]!
    else if (i > 0) refVertex = vertexPath[i - 1]!

    let chosen = edgePolys[0]!
    if (refVertex !== null) {
      const pA = mesh.vertices[va]!.p
      const pB = mesh.vertices[vb]!.p
      const pRef = mesh.vertices[refVertex]!.p
      const sideRef = triArea2(pA, pB, pRef)
      for (const pi of edgePolys) {
        const poly = mesh.polygons[pi]!
        const thirdV = poly.vertices.find((v) => v !== va && v !== vb)
        if (thirdV !== undefined) {
          const pThird = mesh.vertices[thirdV]!.p
          if ((sideRef > 0) === (triArea2(pA, pB, pThird) > 0)) { chosen = pi; break }
        }
      }
    }

    if (corridor.length === 0 || corridor[corridor.length - 1] !== chosen) corridor.push(chosen)
  }

  return corridor
}

// ---------------------------------------------------------------------------
// Vertex adjacency graph + A*
// ---------------------------------------------------------------------------

type AdjacencyGraph = Map<number, Set<number>>

function buildVertexAdjacency(mesh: Mesh): AdjacencyGraph {
  const adj: AdjacencyGraph = new Map()
  const ensure = (v: number) => { if (!adj.has(v)) adj.set(v, new Set()) }
  for (const poly of mesh.polygons) {
    if (!poly) continue
    for (let i = 0; i < poly.vertices.length; i++) {
      const a = poly.vertices[i]!
      const b = poly.vertices[(i + 1) % poly.vertices.length]!
      ensure(a); ensure(b)
      adj.get(a)!.add(b); adj.get(b)!.add(a)
    }
  }
  return adj
}

function findNearestVertex(mesh: Mesh, p: Point): number {
  let best = 0, bestD = Infinity
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i]
    if (!v) continue
    const d = distance(p, v.p)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function edgeAstar(mesh: Mesh, adj: AdjacencyGraph, start: number, goal: number): number[] {
  if (start === goal) return [start]
  const goalP = mesh.vertices[goal]!.p
  const gBest = new Map<number, number>()
  const from = new Map<number, number>()
  const heap: { vi: number; f: number; g: number }[] = []

  const push = (e: typeof heap[0]) => {
    heap.push(e); let i = heap.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p]!.f <= heap[i]!.f) break; [heap[p], heap[i]] = [heap[i]!, heap[p]!]; i = p }
  }
  const pop = () => {
    const top = heap[0]!; const last = heap.pop()!
    if (heap.length > 0) { heap[0] = last; let i = 0; for (;;) { let s = i; const l = 2*i+1, r = 2*i+2; if (l < heap.length && heap[l]!.f < heap[s]!.f) s = l; if (r < heap.length && heap[r]!.f < heap[s]!.f) s = r; if (s === i) break; [heap[i], heap[s]] = [heap[s]!, heap[i]!]; i = s } }
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

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function triArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
