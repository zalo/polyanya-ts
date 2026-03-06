/**
 * Topological Rubberband Routing
 *
 * Implements a simplified version of the SURF rubberband routing approach:
 * 1. Build a Constrained Delaunay Triangulation (CDT) with obstacles and trace endpoints
 * 2. Find an initial path through the triangulation corridor (using Polyanya)
 * 3. Extract the "corridor" of triangles the path passes through
 * 4. Apply the funnel algorithm to produce the shortest path within that corridor
 *    (the "rubberband" path)
 *
 * Multi-trace handling:
 * When multiple traces share overlapping corridors, they are routed sequentially.
 * Each trace's funnel portals are narrowed by previously routed traces that pass
 * through the same portal edges, pushing the new trace to one side of the existing
 * ones (like rubber bands being pushed apart). This is the core of the topological
 * routing approach from Dayan's dissertation — traces maintain their relative
 * topological ordering within shared corridors.
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

/** Spacing between traces sharing a corridor (in world units) */
const TRACE_SPACING = 1.5

/**
 * Route traces through a navigation mesh using topological rubberband routing.
 *
 * Traces are routed sequentially. When multiple traces share the same corridor
 * portals, the funnel algorithm narrows the portals to account for previously
 * placed traces, maintaining topological ordering and spacing.
 */
export function routeTraces(mesh: Mesh, traces: Trace[]): TraceRoute[] {
  const results: TraceRoute[] = []

  // Track which portal edges have been used by previously routed traces,
  // and from which side. Portal key -> list of crossing points on that portal.
  const portalOccupancy = new Map<string, PortalCrossing[]>()

  for (const trace of traces) {
    const route = routeSingleTrace(mesh, trace, portalOccupancy)
    results.push(route)

    // Record this trace's crossings on shared portals
    if (route.corridor.length > 1) {
      recordPortalCrossings(mesh, route, portalOccupancy)
    }
  }

  return results
}

interface PortalCrossing {
  /** Parameter t along the portal edge [0,1] where the trace crosses */
  t: number
  /** Which side of the portal the trace enters from (sign of cross product) */
  side: number
}

/** Canonical key for a portal edge between two vertex indices */
function portalKey(mesh: Mesh, polyIdxA: number, polyIdxB: number): string {
  const polyA = mesh.polygons[polyIdxA]!
  const polyB = mesh.polygons[polyIdxB]!
  const shared = findSharedVertexPair(polyA, polyB)
  if (!shared) return ""
  const [a, b] = shared[0] < shared[1] ? shared : [shared[1], shared[0]]
  return `${a},${b}`
}

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

function recordPortalCrossings(
  mesh: Mesh,
  route: TraceRoute,
  occupancy: Map<string, PortalCrossing[]>,
) {
  const corridor = route.corridor
  const rbPath = route.rubberbandPath

  for (let i = 0; i < corridor.length - 1; i++) {
    const key = portalKey(mesh, corridor[i]!, corridor[i + 1]!)
    if (!key) continue

    const polyA = mesh.polygons[corridor[i]!]!
    const polyB = mesh.polygons[corridor[i + 1]!]!
    const shared = findSharedVertexPair(polyA, polyB)
    if (!shared) continue

    const pLeft = mesh.vertices[shared[0]!]!.p
    const pRight = mesh.vertices[shared[1]!]!.p

    // Find where the rubberband path crosses this portal
    const crossing = findPathPortalCrossing(rbPath, pLeft, pRight)
    if (crossing !== null) {
      let list = occupancy.get(key)
      if (!list) {
        list = []
        occupancy.set(key, list)
      }
      list.push(crossing)
      // Sort crossings by t so we can compute spacing correctly
      list.sort((a, b) => a.t - b.t)
    }
  }
}

/** Find where a path crosses a portal edge, returning the t parameter */
function findPathPortalCrossing(
  path: Point[],
  portalLeft: Point,
  portalRight: Point,
): PortalCrossing | null {
  const edgeDx = portalRight.x - portalLeft.x
  const edgeDy = portalRight.y - portalLeft.y
  const edgeLenSq = edgeDx * edgeDx + edgeDy * edgeDy
  if (edgeLenSq < 1e-12) return null

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!

    // Line-line intersection
    const dx = b.x - a.x
    const dy = b.y - a.y
    const denom = dx * edgeDy - dy * edgeDx
    if (Math.abs(denom) < 1e-10) continue

    const t1 =
      ((portalLeft.x - a.x) * edgeDy - (portalLeft.y - a.y) * edgeDx) / denom
    const t2 =
      ((portalLeft.x - a.x) * dy - (portalLeft.y - a.y) * dx) / denom

    if (t1 >= -0.01 && t1 <= 1.01 && t2 >= -0.01 && t2 <= 1.01) {
      const side = triArea2(portalLeft, portalRight, a)
      return { t: Math.max(0, Math.min(1, t2)), side }
    }
  }

  return null
}

function routeSingleTrace(
  mesh: Mesh,
  trace: Trace,
  portalOccupancy: Map<string, PortalCrossing[]>,
): TraceRoute {
  // 1. Find initial path using Polyanya
  const search = new SearchInstance(mesh)
  search.setStartGoal(trace.start, trace.end)
  search.search()
  const initialPath = search.getPathPoints()

  if (initialPath.length < 2) {
    return {
      trace,
      initialPath,
      corridor: [],
      rubberbandPath: initialPath,
    }
  }

  // 2. Extract the corridor of polygons the path passes through
  const corridor = extractCorridor(mesh, initialPath)

  // 3. Apply funnel algorithm with portal narrowing for shared corridors
  const rubberbandPath =
    corridor.length > 0
      ? funnelPath(mesh, corridor, trace.start, trace.end, portalOccupancy)
      : initialPath

  return {
    trace,
    initialPath,
    corridor,
    rubberbandPath,
  }
}

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
        if (corridor.length === 0 || corridor[corridor.length - 1] !== loc.poly1) {
          corridor.push(loc.poly1)
        }
      }
    }

    const endLoc = mesh.getPointLocation(b)
    if (endLoc.poly1 >= 0) {
      if (corridor.length === 0 || corridor[corridor.length - 1] !== endLoc.poly1) {
        corridor.push(endLoc.poly1)
      }
    }
  }

  return corridor
}

/**
 * Funnel algorithm with multi-trace awareness.
 *
 * Portal edges are narrowed when other traces have already been routed through them.
 * This pushes the new trace to the side of existing traces, maintaining topological
 * ordering — the hallmark of rubberband routing.
 */
function funnelPath(
  mesh: Mesh,
  corridor: number[],
  start: Point,
  end: Point,
  portalOccupancy: Map<string, PortalCrossing[]>,
): Point[] {
  if (corridor.length <= 1) {
    return [start, end]
  }

  const portals = buildPortals(mesh, corridor, start, end, portalOccupancy)

  if (portals.length < 2) {
    return [start, end]
  }

  return runFunnel(portals)
}

interface Portal {
  left: Point
  right: Point
}

/**
 * Build portal edges between consecutive corridor polygons.
 * When a portal has existing trace crossings, the portal edge is narrowed
 * to push the new trace to the side with more available space.
 */
function buildPortals(
  mesh: Mesh,
  corridor: number[],
  start: Point,
  end: Point,
  portalOccupancy: Map<string, PortalCrossing[]>,
): Portal[] {
  const portals: Portal[] = []

  portals.push({ left: start, right: start })

  for (let i = 0; i < corridor.length - 1; i++) {
    const polyA = mesh.polygons[corridor[i]!]!
    const polyB = mesh.polygons[corridor[i + 1]!]!

    const shared = findSharedEdge(mesh, polyA, polyB)
    if (!shared) continue

    // Check if this portal has existing trace crossings
    const key = portalKey(mesh, corridor[i]!, corridor[i + 1]!)
    const crossings = key ? portalOccupancy.get(key) : undefined

    if (crossings && crossings.length > 0) {
      // Narrow the portal: push each side inward based on trace crossings
      const narrowed = narrowPortal(shared, crossings, start)
      portals.push(narrowed)
    } else {
      portals.push(shared)
    }
  }

  portals.push({ left: end, right: end })

  return portals
}

/**
 * Narrow a portal edge to account for existing trace crossings.
 *
 * If traces have already crossed this portal, we offset the portal edge
 * to push the new trace to the side with more available space.
 * The offset is proportional to TRACE_SPACING per existing crossing.
 */
function narrowPortal(
  portal: Portal,
  crossings: PortalCrossing[],
  approachFrom: Point,
): Portal {
  const dx = portal.right.x - portal.left.x
  const dy = portal.right.y - portal.left.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 1e-8) return portal

  // Determine which side of the portal the new trace is approaching from
  const approachSide = triArea2(portal.left, portal.right, approachFrom)

  // Calculate total offset needed (one TRACE_SPACING per existing crossing)
  const numCrossings = crossings.length
  const offsetPerCrossing = TRACE_SPACING / len // Normalized offset

  // Find the range of t values occupied by existing crossings
  const minT = Math.max(0, crossings[0]!.t - offsetPerCrossing)
  const maxT = Math.min(1, crossings[numCrossings - 1]!.t + offsetPerCrossing)

  // Determine which side has more room and push the new trace there
  const leftRoom = minT
  const rightRoom = 1 - maxT

  let newLeft: Point
  let newRight: Point

  if (approachSide >= 0) {
    // Approaching from the left side — push portal left edge inward
    const inset = Math.min(offsetPerCrossing * numCrossings, 0.4)
    newLeft = {
      x: portal.left.x + dx * inset,
      y: portal.left.y + dy * inset,
    }
    newRight = portal.right
  } else {
    // Approaching from the right side — push portal right edge inward
    const inset = Math.min(offsetPerCrossing * numCrossings, 0.4)
    newLeft = portal.left
    newRight = {
      x: portal.right.x - dx * inset,
      y: portal.right.y - dy * inset,
    }
  }

  return { left: newLeft, right: newRight }
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

    // Update left vertex
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

/** Twice the signed area of triangle (a, b, c). Positive = CCW. */
function triArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function ptsEqual(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8
}
