/**
 * Topological Rubberband Routing
 *
 * Phase 1 — CDT construction:
 *   Trace start/end points are added as Steiner points in the CDT so the
 *   triangulation naturally includes edges radiating from each terminal.
 *
 * Phase 2 — Initial path via A* on CDT edges:
 *   Find shortest vertex-to-vertex path along CDT edges from each trace's
 *   start to end. This edge-following path naturally defines the corridor
 *   (the triangles adjacent to the traversed edges) and the topological
 *   crossing order at shared portals.
 *
 * Phase 3 — Simultaneous rubberband:
 *   Read crossing order at each shared portal from the initial edge paths.
 *   Subdivide shared portals into sub-channels. Funnel-optimize each trace
 *   within its corridor and assigned sub-portals. All traces optimized
 *   simultaneously — no ordering dependency.
 *
 * Reference: Tal Dayan, "Rubber-Band Based Topological Router", PhD Dissertation, UCSC, 1997
 */

import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { distance } from "./geometry.ts"

/** A trace connecting two points on the PCB */
export interface Trace {
  id: number
  start: Point
  end: Point
}

/** Result of routing a single trace */
export interface TraceRoute {
  trace: Trace
  /** The initial A* path along CDT edges (vertex-to-vertex) */
  initialPath: Point[]
  /** Vertex indices of the initial path */
  initialVertexPath: number[]
  /** The corridor of polygon indices the path passes through */
  corridor: number[]
  /** The rubberband-optimized (funnel algorithm) path */
  rubberbandPath: Point[]
}

/** Minimum spacing between traces at shared portals (world units) */
const TRACE_SPACING = 1.5

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Route traces through a mesh using topological rubberband routing.
 *
 * Trace endpoints must already be vertices in the mesh (inserted as
 * Steiner points during CDT construction). All traces are processed
 * simultaneously — routing order does not matter.
 */
export function routeTraces(mesh: Mesh, traces: Trace[]): TraceRoute[] {
  if (traces.length === 0) return []

  // Build vertex adjacency graph from the mesh
  const adj = buildVertexAdjacency(mesh)

  // Phase 1: A* on CDT edges for all traces
  const initialResults: {
    trace: Trace
    initialPath: Point[]
    initialVertexPath: number[]
    corridor: number[]
  }[] = []

  for (const trace of traces) {
    const startVi = findNearestVertex(mesh, trace.start)
    const endVi = findNearestVertex(mesh, trace.end)
    const vertexPath = edgeAstar(mesh, adj, startVi, endVi)
    const pointPath = vertexPath.map((vi) => mesh.vertices[vi]!.p)
    // Prepend actual start / append actual end if they differ from the snapped vertex
    if (pointPath.length > 0) {
      const first = pointPath[0]!
      if (distance(trace.start, first) > 1e-6) pointPath.unshift(trace.start)
      const last = pointPath[pointPath.length - 1]!
      if (distance(trace.end, last) > 1e-6) pointPath.push(trace.end)
    }
    const corridor = corridorFromVertexPath(mesh, vertexPath)
    initialResults.push({
      trace,
      initialPath: pointPath,
      initialVertexPath: vertexPath,
      corridor,
    })
  }

  // Phase 2: Build portal crossing order from initial paths
  const portalCrossings = buildPortalCrossingOrder(mesh, initialResults)

  // Phase 3: Rubberband-optimize each trace
  const results: TraceRoute[] = []
  for (const ir of initialResults) {
    const { trace, initialPath, initialVertexPath, corridor } = ir

    if (corridor.length <= 1 || initialPath.length < 2) {
      results.push({
        trace,
        initialPath,
        initialVertexPath,
        corridor,
        rubberbandPath: initialPath,
      })
      continue
    }

    const rubberbandPath = funnelWithTopology(
      mesh,
      corridor,
      trace.start,
      trace.end,
      trace.id,
      portalCrossings,
    )

    results.push({ trace, initialPath, initialVertexPath, corridor, rubberbandPath })
  }

  return results
}

// ---------------------------------------------------------------------------
// Vertex adjacency graph
// ---------------------------------------------------------------------------

/** For each vertex index, the set of vertex indices it shares a CDT edge with */
type AdjacencyGraph = Map<number, Set<number>>

function buildVertexAdjacency(mesh: Mesh): AdjacencyGraph {
  const adj: AdjacencyGraph = new Map()
  const ensure = (v: number) => {
    if (!adj.has(v)) adj.set(v, new Set())
  }

  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices
    for (let i = 0; i < V.length; i++) {
      const a = V[i]!
      const b = V[(i + 1) % V.length]!
      ensure(a)
      ensure(b)
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
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx
}

/**
 * A* search on the CDT vertex graph.
 * Returns an array of vertex indices from start to goal.
 */
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

  // Min-heap by f value
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

  const h0 = distance(mesh.vertices[startVi]!.p, goalP)
  gBest.set(startVi, 0)
  push({ vi: startVi, g: 0, f: h0 })

  while (heap.length > 0) {
    const cur = pop()
    if (cur.g > (gBest.get(cur.vi) ?? Infinity)) continue

    if (cur.vi === goalVi) {
      // Reconstruct path
      const path: number[] = [goalVi]
      let v = goalVi
      while (cameFrom.has(v)) {
        v = cameFrom.get(v)!
        path.push(v)
      }
      path.reverse()
      return path
    }

    const neighbors = adj.get(cur.vi)
    if (!neighbors) continue

    for (const nvi of neighbors) {
      const np = mesh.vertices[nvi]!.p
      const ng = cur.g + distance(mesh.vertices[cur.vi]!.p, np)
      if (ng < (gBest.get(nvi) ?? Infinity)) {
        gBest.set(nvi, ng)
        cameFrom.set(nvi, cur.vi)
        push({ vi: nvi, g: ng, f: ng + distance(np, goalP) })
      }
    }
  }

  // No path found
  return []
}

// ---------------------------------------------------------------------------
// Corridor from edge path
// ---------------------------------------------------------------------------

/**
 * Given a vertex path along CDT edges, collect the corridor of polygons
 * touched by those edges. For each edge (vi, vi+1), find the polygon(s)
 * that contain both vertices and add them to the corridor.
 */
function corridorFromVertexPath(mesh: Mesh, vertexPath: number[]): number[] {
  if (vertexPath.length < 2) return []

  const corridor: number[] = []
  const added = new Set<number>()

  for (let i = 0; i < vertexPath.length - 1; i++) {
    const va = vertexPath[i]!
    const vb = vertexPath[i + 1]!

    // Find polygons that share this edge
    const polysA = mesh.vertices[va]!.polygons
    const polysB = new Set(mesh.vertices[vb]!.polygons)

    for (const pi of polysA) {
      if (pi === -1) continue
      if (polysB.has(pi) && !added.has(pi)) {
        corridor.push(pi)
        added.add(pi)
      }
    }
  }

  return corridor
}

// ---------------------------------------------------------------------------
// Phase 2: Portal crossing order
// ---------------------------------------------------------------------------

interface TraceCrossing {
  traceId: number
  t: number
}

interface PortalCrossingData {
  v0: number
  v1: number
  crossings: TraceCrossing[]
}

type PortalCrossingMap = Map<string, PortalCrossingData>

function canonicalEdgeKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`
}

function buildPortalCrossingOrder(
  mesh: Mesh,
  initialResults: {
    trace: Trace
    initialPath: Point[]
    initialVertexPath: number[]
    corridor: number[]
  }[],
): PortalCrossingMap {
  const map: PortalCrossingMap = new Map()

  for (const { trace, initialPath, corridor } of initialResults) {
    if (corridor.length < 2 || initialPath.length < 2) continue

    for (let ci = 0; ci < corridor.length - 1; ci++) {
      const polyA = mesh.polygons[corridor[ci]!]!
      const polyB = mesh.polygons[corridor[ci + 1]!]!
      const shared = findSharedVertexPair(polyA, polyB)
      if (!shared) continue

      const [sv0, sv1] = shared
      const key = canonicalEdgeKey(sv0, sv1)
      const pLeft = mesh.vertices[sv0]!.p
      const pRight = mesh.vertices[sv1]!.p

      const t = findPathCrossingT(initialPath, pLeft, pRight)
      if (t === null) continue

      let data = map.get(key)
      if (!data) {
        data = { v0: Math.min(sv0, sv1), v1: Math.max(sv0, sv1), crossings: [] }
        map.set(key, data)
      }

      if (!data.crossings.some((c) => c.traceId === trace.id)) {
        data.crossings.push({ traceId: trace.id, t })
      }
    }
  }

  for (const data of map.values()) {
    data.crossings.sort((a, b) => a.t - b.t)
  }

  return map
}

function findPathCrossingT(
  path: Point[],
  portalLeft: Point,
  portalRight: Point,
): number | null {
  const edgeDx = portalRight.x - portalLeft.x
  const edgeDy = portalRight.y - portalLeft.y
  const edgeLenSq = edgeDx * edgeDx + edgeDy * edgeDy
  if (edgeLenSq < 1e-12) return null

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const denom = dx * edgeDy - dy * edgeDx
    if (Math.abs(denom) < 1e-10) continue

    const t1 =
      ((portalLeft.x - a.x) * edgeDy - (portalLeft.y - a.y) * edgeDx) / denom
    const t2 =
      ((portalLeft.x - a.x) * dy - (portalLeft.y - a.y) * dx) / denom

    if (t1 >= -0.01 && t1 <= 1.01 && t2 >= -0.01 && t2 <= 1.01) {
      return Math.max(0, Math.min(1, t2))
    }
  }

  // Fallback: project midpoint
  const midIdx = Math.floor(path.length / 2)
  const mid = path[midIdx]!
  const t =
    ((mid.x - portalLeft.x) * edgeDx + (mid.y - portalLeft.y) * edgeDy) /
    edgeLenSq
  return Math.max(0, Math.min(1, t))
}

// ---------------------------------------------------------------------------
// Phase 3: Topology-aware funnel optimization
// ---------------------------------------------------------------------------

interface Portal {
  left: Point
  right: Point
}

function funnelWithTopology(
  mesh: Mesh,
  corridor: number[],
  start: Point,
  end: Point,
  traceId: number,
  portalCrossings: PortalCrossingMap,
): Point[] {
  if (corridor.length <= 1) return [start, end]

  const portals: Portal[] = []
  portals.push({ left: start, right: start })

  for (let ci = 0; ci < corridor.length - 1; ci++) {
    const polyA = mesh.polygons[corridor[ci]!]!
    const polyB = mesh.polygons[corridor[ci + 1]!]!
    const shared = findSharedEdge(mesh, polyA, polyB)
    if (!shared) continue

    const sharedVerts = findSharedVertexPair(polyA, polyB)
    if (!sharedVerts) {
      portals.push(shared)
      continue
    }

    const key = canonicalEdgeKey(sharedVerts[0], sharedVerts[1])
    const crossingData = portalCrossings.get(key)

    if (!crossingData || crossingData.crossings.length <= 1) {
      portals.push(shared)
      continue
    }

    portals.push(computeSubPortal(shared, crossingData, traceId))
  }

  portals.push({ left: end, right: end })

  if (portals.length < 2) return [start, end]
  return runFunnel(portals)
}

function computeSubPortal(
  fullPortal: Portal,
  crossingData: PortalCrossingData,
  traceId: number,
): Portal {
  const { crossings } = crossingData
  const n = crossings.length
  const idx = crossings.findIndex((c) => c.traceId === traceId)
  if (idx < 0) return fullPortal

  const dx = fullPortal.right.x - fullPortal.left.x
  const dy = fullPortal.right.y - fullPortal.left.y
  const len = Math.sqrt(dx * dx + dy * dy)

  const totalSpacing = (n - 1) * TRACE_SPACING
  const margin = TRACE_SPACING * 0.5

  if (totalSpacing + 2 * margin >= len) {
    // Too narrow — even subdivision
    const slotWidth = len / (n + 1)
    const center = ((idx + 1) * slotWidth) / len
    const halfSlot = (slotWidth * 0.4) / len
    return {
      left: {
        x: fullPortal.left.x + dx * Math.max(0, center - halfSlot),
        y: fullPortal.left.y + dy * Math.max(0, center - halfSlot),
      },
      right: {
        x: fullPortal.left.x + dx * Math.min(1, center + halfSlot),
        y: fullPortal.left.y + dy * Math.min(1, center + halfSlot),
      },
    }
  }

  const bandStart = (len - totalSpacing) / 2
  const centerDist = bandStart + idx * TRACE_SPACING
  const centerT = centerDist / len
  const halfWidth = Math.min(TRACE_SPACING * 0.4, bandStart * 0.8) / len

  return {
    left: {
      x: fullPortal.left.x + dx * Math.max(0, centerT - halfWidth),
      y: fullPortal.left.y + dy * Math.max(0, centerT - halfWidth),
    },
    right: {
      x: fullPortal.left.x + dx * Math.min(1, centerT + halfWidth),
      y: fullPortal.left.y + dy * Math.min(1, centerT + halfWidth),
    },
  }
}

// ---------------------------------------------------------------------------
// Shared edge / vertex helpers
// ---------------------------------------------------------------------------

function findSharedVertexPair(
  polyA: { vertices: number[] },
  polyB: { vertices: number[] },
): [number, number] | null {
  const vSetB = new Set(polyB.vertices)
  for (let i = 0; i < polyA.vertices.length; i++) {
    const va = polyA.vertices[i]!
    const vb = polyA.vertices[(i + 1) % polyA.vertices.length]!
    if (vSetB.has(va) && vSetB.has(vb)) return [va, vb]
  }
  return null
}

function findSharedEdge(
  mesh: Mesh,
  polyA: { vertices: number[]; polygons: number[] },
  polyB: { vertices: number[]; polygons: number[] },
): Portal | null {
  const vSetB = new Set(polyB.vertices)
  for (let i = 0; i < polyA.vertices.length; i++) {
    const va = polyA.vertices[i]!
    const vb = polyA.vertices[(i + 1) % polyA.vertices.length]!
    if (vSetB.has(va) && vSetB.has(vb)) {
      return { left: mesh.vertices[va]!.p, right: mesh.vertices[vb]!.p }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Funnel algorithm
// ---------------------------------------------------------------------------

function runFunnel(portals: Portal[]): Point[] {
  const path: Point[] = []
  let apex = portals[0]!.left
  let apexIndex = 0
  let leftIndex = 0
  let rightIndex = 0
  let portalLeft = portals[0]!.left
  let portalRight = portals[0]!.right

  path.push({ ...apex })

  for (let i = 1; i < portals.length; i++) {
    const left = portals[i]!.left
    const right = portals[i]!.right

    if (triArea2(apex, portalRight, right) <= 0) {
      if (ptsEqual(apex, portalRight) || triArea2(apex, portalLeft, right) > 0) {
        portalRight = right
        rightIndex = i
      } else {
        path.push({ ...portalLeft })
        apex = portalLeft
        apexIndex = leftIndex
        portalLeft = apex
        portalRight = apex
        leftIndex = apexIndex
        rightIndex = apexIndex
        i = apexIndex
        continue
      }
    }

    if (triArea2(apex, portalLeft, left) >= 0) {
      if (ptsEqual(apex, portalLeft) || triArea2(apex, portalRight, left) < 0) {
        portalLeft = left
        leftIndex = i
      } else {
        path.push({ ...portalRight })
        apex = portalRight
        apexIndex = rightIndex
        portalLeft = apex
        portalRight = apex
        leftIndex = apexIndex
        rightIndex = apexIndex
        i = apexIndex
        continue
      }
    }
  }

  const last = portals[portals.length - 1]!.left
  if (path.length === 0 || !ptsEqual(path[path.length - 1]!, last)) {
    path.push({ ...last })
  }

  return path
}

function triArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function ptsEqual(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8
}
