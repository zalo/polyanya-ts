/**
 * Topological Rubberband Routing
 *
 * Implements the SURF rubberband routing approach for PCB autorouting:
 *
 * Phase 1 — Initial embedding:
 *   Route all traces independently via Polyanya to establish topological corridors.
 *   The initial paths define the topology: which triangles each trace crosses,
 *   and the relative ordering of traces at shared portals.
 *
 * Phase 2 — Read crossing order:
 *   At each portal edge shared by multiple traces, determine the crossing order
 *   from the initial paths (left-to-right parameter along the portal edge).
 *   This crossing order IS the topology — it's order-independent and emerges
 *   from the geometry of the initial embedding.
 *
 * Phase 3 — Simultaneous rubberband:
 *   Subdivide each shared portal into sub-channels based on the crossing order,
 *   then funnel-optimize each trace within its assigned sub-portals. All traces
 *   are optimized simultaneously — no trace has priority over another.
 *
 * The result: traces naturally push apart at shared portals like physical rubber
 * bands, with spacing proportional to the number of traces sharing each portal.
 * The topological ordering at each portal is determined by geometry, not by
 * routing order.
 *
 * Reference: Tal Dayan, "Rubber-Band Based Topological Router", PhD Dissertation, UCSC, 1997
 */

import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { SearchInstance } from "./search.ts"
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
  /** The initial path found through the triangulation */
  initialPath: Point[]
  /** The corridor of polygon indices the path passes through */
  corridor: number[]
  /** The rubberband-optimized (funnel algorithm) path */
  rubberbandPath: Point[]
}

/** Minimum spacing between traces at shared portals (world units) */
const TRACE_SPACING = 1.5

/**
 * Route traces through a navigation mesh using topological rubberband routing.
 *
 * All traces are embedded simultaneously — routing order does not matter.
 * The topological ordering at shared portals emerges from the initial
 * Polyanya paths, and the rubberband optimization respects that ordering.
 */
export function routeTraces(mesh: Mesh, traces: Trace[]): TraceRoute[] {
  if (traces.length === 0) return []

  // Phase 1: Find initial paths and corridors for ALL traces independently
  const initialResults: {
    trace: Trace
    initialPath: Point[]
    corridor: number[]
  }[] = []

  for (const trace of traces) {
    const search = new SearchInstance(mesh)
    search.setStartGoal(trace.start, trace.end)
    search.search()
    const initialPath = search.getPathPoints()
    const corridor =
      initialPath.length >= 2 ? extractCorridor(mesh, initialPath) : []
    initialResults.push({ trace, initialPath, corridor })
  }

  // Phase 2: Build portal crossing order from initial paths
  // For each portal edge, determine which traces cross it and in what order
  const portalCrossings = buildPortalCrossingOrder(mesh, initialResults)

  // Phase 3: Rubberband-optimize each trace with topology-aware sub-portals
  const results: TraceRoute[] = []

  for (let i = 0; i < initialResults.length; i++) {
    const { trace, initialPath, corridor } = initialResults[i]!

    if (corridor.length <= 1 || initialPath.length < 2) {
      results.push({ trace, initialPath, corridor, rubberbandPath: initialPath })
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

    results.push({ trace, initialPath, corridor, rubberbandPath })
  }

  return results
}

// ---------------------------------------------------------------------------
// Phase 2: Portal crossing order
// ---------------------------------------------------------------------------

/** A trace's crossing of a portal edge */
interface TraceCrossing {
  traceId: number
  /** Parameter t in [0,1] along the portal edge (left=0, right=1) */
  t: number
}

/** Crossing data for one portal, keyed by canonical vertex pair */
interface PortalCrossingData {
  /** Vertex indices of the portal edge, ordered canonically (smaller first) */
  v0: number
  v1: number
  /** Traces crossing this portal, sorted by t (left-to-right order) */
  crossings: TraceCrossing[]
}

/** Map from canonical portal key "v0,v1" to crossing data */
type PortalCrossingMap = Map<string, PortalCrossingData>

function canonicalPortalKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`
}

/**
 * For each portal edge shared by multiple traces, determine the crossing
 * order from the initial Polyanya paths.
 *
 * The crossing order is geometry-derived and independent of routing order.
 */
function buildPortalCrossingOrder(
  mesh: Mesh,
  initialResults: { trace: Trace; initialPath: Point[]; corridor: number[] }[],
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
      const key = canonicalPortalKey(sv0, sv1)
      const pLeft = mesh.vertices[sv0]!.p
      const pRight = mesh.vertices[sv1]!.p

      // Find where this trace's initial path crosses this portal
      const t = findPathCrossingT(initialPath, pLeft, pRight)
      if (t === null) continue

      let data = map.get(key)
      if (!data) {
        data = { v0: Math.min(sv0, sv1), v1: Math.max(sv0, sv1), crossings: [] }
        map.set(key, data)
      }

      // Only add if this trace hasn't already been recorded on this portal
      if (!data.crossings.some((c) => c.traceId === trace.id)) {
        data.crossings.push({ traceId: trace.id, t })
      }
    }
  }

  // Sort crossings at each portal by t (left-to-right)
  for (const data of map.values()) {
    data.crossings.sort((a, b) => a.t - b.t)
  }

  return map
}

/**
 * Find the parameter t in [0,1] where a path crosses a portal edge.
 * t=0 is the left vertex, t=1 is the right vertex.
 */
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

    // t1 = parameter along path segment, t2 = parameter along portal edge
    const t1 =
      ((portalLeft.x - a.x) * edgeDy - (portalLeft.y - a.y) * edgeDx) / denom
    const t2 =
      ((portalLeft.x - a.x) * dy - (portalLeft.y - a.y) * dx) / denom

    if (t1 >= -0.01 && t1 <= 1.01 && t2 >= -0.01 && t2 <= 1.01) {
      return Math.max(0, Math.min(1, t2))
    }
  }

  // Fallback: project the midpoint of the path's crossing segment onto the portal
  // This handles cases where the path doesn't cleanly intersect
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

/**
 * Funnel-optimize a trace through its corridor, using sub-portals that
 * account for the topological crossing order of all traces.
 *
 * At each shared portal, this trace gets a sub-channel within the full
 * portal edge. The sub-channel position is determined by the trace's
 * crossing order relative to other traces — NOT by routing order.
 */
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

    const key = canonicalPortalKey(sharedVerts[0], sharedVerts[1])
    const crossingData = portalCrossings.get(key)

    if (!crossingData || crossingData.crossings.length <= 1) {
      // No other traces share this portal — use full width
      portals.push(shared)
      continue
    }

    // Multiple traces share this portal: compute this trace's sub-channel
    const subPortal = computeSubPortal(shared, crossingData, traceId)
    portals.push(subPortal)
  }

  portals.push({ left: end, right: end })

  if (portals.length < 2) return [start, end]
  return runFunnel(portals)
}

/**
 * Compute the sub-portal for a specific trace within a shared portal.
 *
 * The portal edge is divided into N+1 equal channels (where N = number
 * of traces), with guard bands at the edges. Each trace gets the channel
 * at its position in the crossing order.
 *
 * This ensures traces are evenly spaced and don't overlap, regardless
 * of the order they were processed.
 */
function computeSubPortal(
  fullPortal: Portal,
  crossingData: PortalCrossingData,
  traceId: number,
): Portal {
  const { crossings } = crossingData
  const n = crossings.length
  const idx = crossings.findIndex((c) => c.traceId === traceId)
  if (idx < 0) return fullPortal // trace not found — use full portal

  const dx = fullPortal.right.x - fullPortal.left.x
  const dy = fullPortal.right.y - fullPortal.left.y
  const len = Math.sqrt(dx * dx + dy * dy)

  // Total spacing needed: (n-1) gaps of TRACE_SPACING between trace centers
  const totalSpacing = (n - 1) * TRACE_SPACING
  const margin = TRACE_SPACING * 0.5 // guard band at edges

  if (totalSpacing + 2 * margin >= len) {
    // Portal is too narrow to fit all traces with full spacing.
    // Fall back to even subdivision of the portal.
    const slotWidth = len / (n + 1)
    const center = (idx + 1) * slotWidth / len // normalized [0,1]
    const halfSlot = slotWidth * 0.4 / len

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

  // Portal has enough room: place trace centers evenly with TRACE_SPACING gaps,
  // centered within the portal
  const bandStart = (len - totalSpacing) / 2 // distance from left to first center
  const centerDist = bandStart + idx * TRACE_SPACING
  const centerT = centerDist / len

  // Each trace's sub-portal extends half a TRACE_SPACING in each direction
  // (but clamped so traces don't extend past the portal edges)
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
// Corridor extraction
// ---------------------------------------------------------------------------

/**
 * Extract the sequence of polygon indices that a path passes through.
 */
function extractCorridor(mesh: Mesh, path: Point[]): number[] {
  const corridor: number[] = []

  const startLoc = mesh.getPointLocation(path[0]!)
  if (startLoc.poly1 >= 0) {
    corridor.push(startLoc.poly1)
  }

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!

    const samples = Math.max(2, Math.ceil(distance(a, b) * 2))
    for (let s = 1; s <= samples; s++) {
      const t = s / (samples + 1)
      const mid: Point = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }
      const loc = mesh.getPointLocation(mid)
      if (loc.poly1 >= 0) {
        if (
          corridor.length === 0 ||
          corridor[corridor.length - 1] !== loc.poly1
        ) {
          corridor.push(loc.poly1)
        }
      }
    }

    const endLoc = mesh.getPointLocation(b)
    if (endLoc.poly1 >= 0) {
      if (
        corridor.length === 0 ||
        corridor[corridor.length - 1] !== endLoc.poly1
      ) {
        corridor.push(endLoc.poly1)
      }
    }
  }

  return corridor
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
    if (vSetB.has(va) && vSetB.has(vb)) {
      return [va, vb]
    }
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
      return {
        left: mesh.vertices[va]!.p,
        right: mesh.vertices[vb]!.p,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Funnel algorithm
// ---------------------------------------------------------------------------

/**
 * Simple Stupid Funnel Algorithm.
 *
 * Given a sequence of portal edges (start, shared edges, end),
 * produces the shortest path through the corridor.
 */
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

    // Update right vertex
    if (triArea2(apex, portalRight, right) <= 0) {
      if (
        ptsEqual(apex, portalRight) ||
        triArea2(apex, portalLeft, right) > 0
      ) {
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

    // Update left vertex
    if (triArea2(apex, portalLeft, left) >= 0) {
      if (
        ptsEqual(apex, portalLeft) ||
        triArea2(apex, portalRight, left) < 0
      ) {
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

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Twice the signed area of triangle (a, b, c). Positive = CCW. */
function triArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function ptsEqual(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8
}
