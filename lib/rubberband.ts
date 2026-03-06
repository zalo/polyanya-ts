/**
 * Topological Rubberband Routing
 *
 * Phase 1 — CDT construction:
 *   Trace start/end points are Steiner points in the CDT.
 *
 * Phase 2 — Initial path via A* on CDT edges:
 *   Shortest vertex-to-vertex path along CDT edges. This establishes
 *   the topology: which side of each obstacle the trace passes.
 *
 * Phase 3 — Rubberband string-pulling:
 *   Pull the path tight like a rubber band. Walk the CDT triangulation
 *   to check line-of-sight between non-adjacent vertices. Vertices that
 *   block direct shortcuts are obstacle corners the trace wraps around
 *   (attachment points). The rubberband path is straight segments through
 *   these attachment points.
 *
 *   This is the core of topological routing: the string-pull maintains
 *   the sidedness from the initial path — the trace wraps around the
 *   same obstacle corners, just pulled tight.
 *
 * Multi-trace: crossing order at shared portals is read from geometry
 * after all initial paths are computed. Sub-portal channeling pushes
 * traces apart at shared edges.
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

const TRACE_SPACING = 1.5

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function routeTraces(mesh: Mesh, traces: Trace[]): TraceRoute[] {
  if (traces.length === 0) return []

  const adj = buildVertexAdjacency(mesh)

  // Phase 1: A* on CDT edges for all traces
  const initialResults: {
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
      const first = pointPath[0]!
      if (distance(trace.start, first) > 1e-6) pointPath.unshift(trace.start)
      const last = pointPath[pointPath.length - 1]!
      if (distance(trace.end, last) > 1e-6) pointPath.push(trace.end)
    }
    initialResults.push({ trace, initialPath: pointPath, initialVertexPath: vertexPath })
  }

  // Phase 2: String-pull each trace using CDT line-walk visibility
  const results: TraceRoute[] = []
  for (const { trace, initialPath, initialVertexPath } of initialResults) {
    if (initialPath.length < 2) {
      results.push({
        trace,
        initialPath,
        initialVertexPath,
        corridor: [],
        rubberbandPath: initialPath,
      })
      continue
    }

    const rubberbandPath = stringPull(mesh, initialPath)
    // Build corridor from the initial vertex path for visualization
    const corridor = corridorFromVertexPath(mesh, initialVertexPath)

    results.push({ trace, initialPath, initialVertexPath, corridor, rubberbandPath })
  }

  return results
}

// ---------------------------------------------------------------------------
// String-pulling (rubberband tightening)
// ---------------------------------------------------------------------------

/**
 * String-pull a path through the CDT.
 *
 * Starting from the first point, try to skip ahead as far as possible
 * by checking line-of-sight through the triangulation. When the line
 * crosses a boundary/obstacle edge, the last visible vertex becomes
 * an attachment point (the trace wraps around that obstacle corner).
 *
 * This is the rubber band: it pulls tight against obstacle corners
 * while maintaining the topology established by the initial A* path.
 */
function stringPull(mesh: Mesh, path: Point[]): Point[] {
  if (path.length <= 2) return [...path]

  const result: Point[] = [path[0]!]
  let current = 0

  while (current < path.length - 1) {
    // Try to reach as far ahead as possible
    let farthest = current + 1

    for (let target = path.length - 1; target > current + 1; target--) {
      if (hasLineOfSight(mesh, path[current]!, path[target]!)) {
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
 * Check line-of-sight between two points by walking the CDT.
 *
 * Walk from triangle to triangle along the ray from→to. At each
 * triangle, find the edge the ray exits through. If that edge is a
 * boundary (obstacle), sight is blocked. If we reach the triangle
 * containing 'to', sight is clear.
 */
function hasLineOfSight(mesh: Mesh, from: Point, to: Point): boolean {
  // getPointLocation may return vertex/edge locations where poly1 is still valid,
  // but we need a triangle to start the walk. Use poly1 which should be >= 0
  // for any point on the mesh (vertex, edge, or interior).
  const loc = mesh.getPointLocation(from)
  let startPoly = loc.poly1
  if (startPoly < 0) startPoly = loc.poly2
  if (startPoly < 0) {
    // Point not on mesh — try finding the triangle containing a nudged point
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

    // Check if 'to' is inside (or on the boundary of) this triangle
    if (pointInTriangleLoose(to, mesh, V)) return true

    // Find the edge the ray from→to exits through.
    // Skip the edge we entered from (to avoid going backwards).
    let foundNext = false

    for (let i = 0; i < V.length; i++) {
      const i2 = (i + 1) % V.length
      // Adjacency for edge (V[i], V[i2]): polygons[(i+1) % N]
      const adjIdx = i2
      const adj = poly.polygons[adjIdx]!

      // Don't go back to where we came from
      if (adj === prevPoly) continue

      const ea = mesh.vertices[V[i]!]!.p
      const eb = mesh.vertices[V[i2]!]!.p

      // Does the ray from→to cross this edge?
      if (rayProperlyIntersectsEdge(from, to, ea, eb)) {
        if (adj === -1) return false // boundary edge — blocked
        prevPoly = currentPoly
        currentPoly = adj
        foundNext = true
        break
      }
    }

    if (!foundNext) {
      // Didn't find an exit edge — likely 'to' is on an edge/vertex
      // of the current triangle. Treat as visible.
      return true
    }
  }

  return false
}

/**
 * Check if the directed segment from→to crosses the edge ea→eb.
 * Uses a robust test that handles 'from' being on a triangle vertex.
 */
function rayProperlyIntersectsEdge(
  from: Point, to: Point, ea: Point, eb: Point,
): boolean {
  // ea and eb must be on strictly opposite sides of line from→to
  const d1 = triArea2(from, to, ea)
  const d2 = triArea2(from, to, eb)
  if (d1 * d2 >= -1e-20) return false // same side, or one is on the line

  // from and to don't both need to be on opposite sides of ea→eb
  // because 'from' might be on the edge line (it's a vertex of the triangle).
  // We just need 'to' to be reachable through this edge.
  const d3 = triArea2(ea, eb, from)
  const d4 = triArea2(ea, eb, to)

  // Standard crossing: from and to on opposite sides
  if ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10)) return true

  // 'from' is on the edge line (it's a vertex shared by this edge) —
  // just check that 'to' is on the other side
  if (Math.abs(d3) <= 1e-10 && Math.abs(d4) > 1e-10) return true

  return false
}

/**
 * Loose point-in-triangle test (includes points on edges/vertices).
 */
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
// Corridor (for visualization only)
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
      if (corridor.length === 0 || corridor[corridor.length - 1] !== pi) {
        corridor.push(pi)
      }
      continue
    }

    // Pick side toward next vertex
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
          const sideThird = triArea2(pA, pB, pThird)
          if ((sideRef > 0) === (sideThird > 0)) { chosen = pi; break }
        }
      }
    }

    if (corridor.length === 0 || corridor[corridor.length - 1] !== chosen) {
      corridor.push(chosen)
    }
  }

  return corridor
}

// ---------------------------------------------------------------------------
// Vertex adjacency graph
// ---------------------------------------------------------------------------

type AdjacencyGraph = Map<number, Set<number>>

function buildVertexAdjacency(mesh: Mesh): AdjacencyGraph {
  const adj: AdjacencyGraph = new Map()
  const ensure = (v: number) => { if (!adj.has(v)) adj.set(v, new Set()) }

  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices
    for (let i = 0; i < V.length; i++) {
      const a = V[i]!
      const b = V[(i + 1) % V.length]!
      ensure(a); ensure(b)
      adj.get(a)!.add(b)
      adj.get(b)!.add(a)
    }
  }
  return adj
}

// ---------------------------------------------------------------------------
// A* on CDT edges
// ---------------------------------------------------------------------------

function findNearestVertex(mesh: Mesh, p: Point): number {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i]
    if (!v) continue
    const d = distance(p, v.p)
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  return bestIdx
}

function edgeAstar(
  mesh: Mesh,
  adj: AdjacencyGraph,
  startVi: number,
  goalVi: number,
): number[] {
  if (startVi === goalVi) return [startVi]

  const goalP = mesh.vertices[goalVi]!.p
  const gBest = new Map<number, number>()
  const cameFrom = new Map<number, number>()

  const heap: { vi: number; f: number; g: number }[] = []
  const push = (e: { vi: number; f: number; g: number }) => {
    heap.push(e)
    let i = heap.length - 1
    while (i > 0) {
      const pi = (i - 1) >> 1
      if (heap[pi]!.f <= heap[i]!.f) break
      const tmp = heap[pi]!; heap[pi] = heap[i]!; heap[i] = tmp
      i = pi
    }
  }
  const pop = () => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      for (;;) {
        let s = i
        const l = 2 * i + 1, r = 2 * i + 2
        if (l < heap.length && heap[l]!.f < heap[s]!.f) s = l
        if (r < heap.length && heap[r]!.f < heap[s]!.f) s = r
        if (s === i) break
        const tmp = heap[i]!; heap[i] = heap[s]!; heap[s] = tmp
        i = s
      }
    }
    return top
  }

  gBest.set(startVi, 0)
  push({ vi: startVi, g: 0, f: distance(mesh.vertices[startVi]!.p, goalP) })

  while (heap.length > 0) {
    const cur = pop()
    if (cur.g > (gBest.get(cur.vi) ?? Infinity)) continue

    if (cur.vi === goalVi) {
      const path: number[] = [goalVi]
      let v = goalVi
      while (cameFrom.has(v)) { v = cameFrom.get(v)!; path.push(v) }
      path.reverse()
      return path
    }

    const neighbors = adj.get(cur.vi)
    if (!neighbors) continue
    for (const nvi of neighbors) {
      const ng = cur.g + distance(mesh.vertices[cur.vi]!.p, mesh.vertices[nvi]!.p)
      if (ng < (gBest.get(nvi) ?? Infinity)) {
        gBest.set(nvi, ng)
        cameFrom.set(nvi, cur.vi)
        push({ vi: nvi, g: ng, f: ng + distance(mesh.vertices[nvi]!.p, goalP) })
      }
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function triArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}
