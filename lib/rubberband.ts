/**
 * Topological Rubberband Routing (Salewski/Dayan-style)
 *
 * Core concept: the Dijkstra search operates on REGIONS, not raw vertices.
 * Each CDT vertex starts with one incident Region. When a trace is routed
 * through a vertex, that vertex's region SPLITS into two — one on each
 * side of the trace. Future traces see the split regions and naturally
 * maintain sidedness.
 *
 * Key data structures:
 * - Region: wraps a CDT vertex, tracks neighbors, offset for split disambiguation
 * - Cut: tracks available capacity on a CDT edge (distance - copper - clearances)
 * - Step: records a routed trace's passage through a vertex (prev/next/side)
 *
 * Algorithm:
 * 1. Build region graph from CDT (one region per vertex)
 * 2. Build cuts for all CDT edges
 * 3. For each trace: Dijkstra on regions → route path → split regions
 * 4. Compute final geometry with tangent lines between clearance circles
 *
 * References:
 * - Stefan Salewski, Ruby topological router (reference/salewski/Router/router.rb)
 * - Tal Dayan, "Rubber-Band Based Topological Router", PhD thesis, UCSC 1997
 * - gEDA PCB toporouter (reference/toporouter.c)
 */

import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { distance } from "./geometry.ts"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Trace { id: number; start: Point; end: Point }

export interface TraceRoute {
  trace: Trace
  /** Dijkstra path through regions (vertex positions) */
  initialPath: Point[]
  initialVertexPath: number[]
  corridor: number[]
  /** Final path with tangent-line geometry */
  rubberbandPath: Point[]
  arcs: { centre: Point; radius: number }[]
}

// ---------------------------------------------------------------------------
// Region: the core topological data structure
// ---------------------------------------------------------------------------

let regionIdCounter = 0

class Region {
  id: number
  vertexIdx: number
  vertex: Point
  /** Neighboring regions (connected through CDT edges) */
  neighbors: Region[] = []
  /** True if this is an incident (unsplit / terminal) region */
  incident = true
  /** Offset from vertex for disambiguating split regions */
  ox = 0; oy = 0
  /** Effective position (vertex + offset) */
  get rx() { return this.vertex.x + this.ox }
  get ry() { return this.vertex.y + this.oy }
  /** Radius of the vertex (copper core + attached trace widths) */
  radius: number
  /** Clearance of the vertex */
  separation: number
  /** Inward direction constraints from previous traces */
  idirs: [number, number][] = []

  constructor(vertexIdx: number, vertex: Point, radius: number, separation: number) {
    this.id = regionIdCounter++
    this.vertexIdx = vertexIdx
    this.vertex = vertex
    this.radius = radius
    this.separation = separation
  }

  distanceTo(other: Region): number {
    return Math.hypot(this.rx - other.rx, this.ry - other.ry)
  }
}

// ---------------------------------------------------------------------------
// Cut: capacity tracking on CDT edges
// ---------------------------------------------------------------------------

class Cut {
  /** Total edge length */
  cap: number
  /** Available capacity (cap minus endpoint copper) */
  freeCap: number
  /** Clearances of the two endpoint vertices */
  cv1: number; cv2: number
  /** Array of clearances for each trace passing through */
  cl: number[] = []

  constructor(v1Radius: number, v1Sep: number, v2Radius: number, v2Sep: number, dist: number) {
    this.cap = dist
    this.freeCap = dist - v1Radius - v2Radius
    this.cv1 = v1Sep
    this.cv2 = v2Sep
  }

  /**
   * Returns a cost for routing through this cut.
   * Returns Infinity if there's no room, otherwise a congestion cost
   * that approaches 0 as more room is available.
   */
  squeezeStrength(traceWidth: number, traceClearance: number): number {
    let s: number
    if (this.cl.length === 0) {
      s = Math.max(this.cv1, traceClearance) + Math.max(this.cv2, traceClearance)
    } else {
      // Estimate space needed for all existing traces plus the new one
      const allCl = [...this.cl, traceClearance].sort((a, b) => b - a)
      const half = Math.floor(allCl.length / 2)
      const top = allCl.slice(0, half + 1)
      const expanded = [...top, ...top]
      if (allCl.length % 2 === 0) expanded.pop()
      expanded.push(this.cv1, this.cv2)
      expanded.sort((a, b) => a - b)
      expanded.shift(); expanded.shift() // remove two smallest
      s = expanded.reduce((sum, v) => sum + v, 0)
    }
    s = this.freeCap - traceWidth - s
    return s < 0 ? Infinity : 100 / (10 + s)
  }

  /** Record that a trace passes through this cut */
  use(traceWidth: number, traceClearance: number): void {
    this.freeCap -= traceWidth
    this.cl.push(traceClearance)
  }
}

// ---------------------------------------------------------------------------
// Tangent-line geometry
// ---------------------------------------------------------------------------

/**
 * Compute tangent line between two circles.
 * Returns [x1, y1, x2, y2] — the tangent point on circle 1 and circle 2.
 *
 * l1, l2: true=left tangent, false=right tangent.
 * When l1===l2: outer tangent. When l1!==l2: inner (cross) tangent.
 *
 * Based on Salewski's get_tangents and standard circle-tangent geometry.
 */
function getTangents(
  x1: number, y1: number, r1: number, l1: boolean,
  x2: number, y2: number, r2: number, l2: boolean,
): [number, number, number, number] {
  const d = Math.hypot(x1 - x2, y1 - y2)
  if (d < 1e-10) return [x1, y1, x2, y2]

  const vx = (x2 - x1) / d
  const vy = (y2 - y1) / d

  const signedR2 = r2 * (l1 === l2 ? 1 : -1)
  const c = (r1 - signedR2) / d

  let h = 1 - c * c
  if (h < 0) h = 0
  h = Math.sqrt(h) * (l1 ? -1 : 1)

  const nx = vx * c - h * vy
  const ny = vy * c + h * vx

  return [
    x1 + r1 * nx, y1 + r1 * ny,
    x2 + signedR2 * nx, y2 + signedR2 * ny,
  ]
}

// ---------------------------------------------------------------------------
// Cross product / winding
// ---------------------------------------------------------------------------

function wind(ax: number, ay: number, bx: number, by: number, ox: number, oy: number): boolean {
  return (ax - ox) * (by - oy) > (ay - oy) * (bx - ox)
}

function windSign(ax: number, ay: number, bx: number, by: number, ox: number, oy: number): number {
  const v = (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)
  return v > 1e-10 ? 1 : v < -1e-10 ? -1 : 0
}

// ---------------------------------------------------------------------------
// Build region graph from mesh
// ---------------------------------------------------------------------------

function buildRegionGraph(
  mesh: Mesh,
  defaultRadius: number,
  defaultClearance: number,
): { regions: Region[]; regionByVertex: Map<number, Region>; cuts: Map<string, Cut> } {
  const regionByVertex = new Map<number, Region>()
  const regions: Region[] = []

  // Create one region per vertex
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i]
    if (!v) continue
    const r = new Region(i, v.p, v.isCorner ? defaultRadius : 0, defaultClearance)
    regions.push(r)
    regionByVertex.set(i, r)
  }

  // Build neighbor relationships from CDT edges
  const edgeSeen = new Set<string>()
  for (const poly of mesh.polygons) {
    if (!poly) continue
    for (let i = 0; i < poly.vertices.length; i++) {
      const a = poly.vertices[i]!
      const b = poly.vertices[(i + 1) % poly.vertices.length]!
      const key = a < b ? `${a},${b}` : `${b},${a}`
      if (edgeSeen.has(key)) continue
      edgeSeen.add(key)

      const ra = regionByVertex.get(a)
      const rb = regionByVertex.get(b)
      if (ra && rb) {
        ra.neighbors.push(rb)
        rb.neighbors.push(ra)
      }
    }
  }

  // Build cuts for all CDT edges
  const cuts = new Map<string, Cut>()
  for (const key of edgeSeen) {
    const [aStr, bStr] = key.split(",")
    const a = Number(aStr), b = Number(bStr)
    const ra = regionByVertex.get(a)!
    const rb = regionByVertex.get(b)!
    const d = distance(ra.vertex, rb.vertex)
    cuts.set(key, new Cut(ra.radius, ra.separation, rb.radius, rb.separation, d))
  }

  return { regions, regionByVertex, cuts }
}

function cutKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`
}

// ---------------------------------------------------------------------------
// Dijkstra on region graph
// ---------------------------------------------------------------------------

interface DijkstraState {
  region: Region
  prev: Region | null
  turnRight: boolean
}

function stateKey(s: DijkstraState): string {
  return `${s.region.id},${s.prev?.id ?? -1},${s.turnRight ? 1 : 0}`
}

/**
 * Dijkstra search on region graph.
 * State is (region, previous_region, turn_direction).
 *
 * At each step, qbors yields reachable neighbors considering:
 * - Turn direction (left/right of the path)
 * - Cut capacity (is there room for this trace?)
 * - Direction constraints from previous splits (idirs)
 */
function dijkstraRegions(
  startRegion: Region,
  endVertexIdx: number,
  traceWidth: number,
  traceClearance: number,
  cuts: Map<string, Cut>,
): Region[] | null {
  // Min-heap by distance
  const heap: { state: DijkstraState; dist: number }[] = []
  const best = new Map<string, number>()
  const parent = new Map<string, DijkstraState | null>()

  const push = (s: DijkstraState, d: number) => {
    heap.push({ state: s, dist: d })
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p]!.dist <= heap[i]!.dist) break
      ;[heap[p], heap[i]] = [heap[i]!, heap[p]!]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]!; const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last; let i = 0
      for (;;) {
        let s = i; const l = 2*i+1, r = 2*i+2
        if (l < heap.length && heap[l]!.dist < heap[s]!.dist) s = l
        if (r < heap.length && heap[r]!.dist < heap[s]!.dist) s = r
        if (s === i) break
        ;[heap[i], heap[s]] = [heap[s]!, heap[i]!]
        i = s
      }
    }
    return top
  }

  // Seed: expand from start with no previous, both turn directions
  for (const turnRight of [true, false]) {
    const s: DijkstraState = { region: startRegion, prev: null, turnRight }
    const k = stateKey(s)
    best.set(k, 0)
    parent.set(k, null)
    // Expand initial neighbors
    for (const nb of startRegion.neighbors) {
      const ns: DijkstraState = { region: nb, prev: startRegion, turnRight }
      const nk = stateKey(ns)
      const d = startRegion.distanceTo(nb)
      if (d < (best.get(nk) ?? Infinity)) {
        best.set(nk, d)
        parent.set(nk, s)
        push(ns, d)
      }
    }
  }

  while (heap.length > 0) {
    const { state: cur, dist: curDist } = pop()
    const curKey = stateKey(cur)
    if (curDist > (best.get(curKey) ?? Infinity)) continue

    // Check if we reached the destination
    if (cur.region.vertexIdx === endVertexIdx && cur.region.incident) {
      // Reconstruct path
      const path: Region[] = [cur.region]
      let sk: string | undefined = curKey
      while (sk) {
        const p = parent.get(sk)
        if (!p) break
        path.push(p.region)
        sk = stateKey(p)
        if (!parent.has(sk)) break
      }
      path.reverse()
      return path
    }

    // Expand neighbors
    const u = cur.prev
    const v = cur.region

    for (const w of v.neighbors) {
      // Skip going back to previous
      if (u && w.id === u.id) continue

      // Determine turn direction at v
      let turnRight: boolean
      if (u) {
        turnRight = wind(u.rx, u.ry, w.rx, w.ry, v.rx, v.ry)
      } else {
        turnRight = cur.turnRight
      }

      // Check cut capacity
      const ck = cutKey(v.vertexIdx, w.vertexIdx)
      const cut = cuts.get(ck)
      if (cut) {
        const squeeze = cut.squeezeStrength(traceWidth, traceClearance)
        if (squeeze >= 1e8) continue // no room
      }

      // Check direction constraints (idirs) from previous splits
      if (v.idirs.length > 0 && u) {
        const ax = u.rx - v.rx, ay = u.ry - v.ry
        const bx = w.rx - v.rx, by = w.ry - v.ry
        let blocked = false
        for (const [zx, zy] of v.idirs) {
          // If the constraint direction is between a and b, this path is blocked
          const sideA = ax * zy - ay * zx
          const sideB = bx * zy - by * zx
          if (turnRight ? (sideA >= 0 && sideB <= 0) : (sideA <= 0 && sideB >= 0)) {
            blocked = true
            break
          }
        }
        if (blocked) continue
      }

      const ns: DijkstraState = { region: w, prev: v, turnRight }
      const nk = stateKey(ns)
      const nd = curDist + v.distanceTo(w)
      if (nd < (best.get(nk) ?? Infinity)) {
        best.set(nk, nd)
        parent.set(nk, cur)
        push(ns, nd)
      }
    }
  }

  return null // no path found
}

// ---------------------------------------------------------------------------
// Region splitting after routing
// ---------------------------------------------------------------------------

/**
 * After routing a path through regions, split each intermediate region
 * into two — one on each side of the trace. This is the core topological
 * operation that maintains sidedness for future traces.
 *
 * Based on Salewski's route() function, lines 1471-1598.
 */
function splitRegionsAlongPath(
  path: Region[],
  regions: Region[],
  regionByVertex: Map<number, Region>,
  cuts: Map<string, Cut>,
  traceWidth: number,
  traceClearance: number,
): void {
  if (path.length < 3) return // no intermediate regions to split

  for (let i = 1; i < path.length - 1; i++) {
    const prv = path[i - 1]!
    const cur = path[i]!
    const nxt = path[i + 1]!

    // Split cur into r1 (one side) and r2 (other side)
    const r1 = new Region(cur.vertexIdx, cur.vertex, cur.radius, cur.separation)
    const r2 = new Region(cur.vertexIdx, cur.vertex, cur.radius, cur.separation)
    r1.idirs = [...cur.idirs]
    r2.idirs = [...cur.idirs]
    r1.incident = cur.incident
    r2.incident = cur.incident

    // Compute offset perpendicular to path direction for disambiguation
    const dx1 = nxt.rx - cur.rx
    const dy1 = nxt.ry - cur.ry
    const dx2 = cur.rx - prv.rx
    const dy2 = cur.ry - prv.ry
    // Perpendicular is (-dy, dx) of the average direction
    let perpX = -(dy1 + dy2)
    let perpY = dx1 + dx2
    const perpLen = Math.hypot(perpX, perpY)
    if (perpLen > 1e-10) {
      perpX /= perpLen
      perpY /= perpLen
      const offsetMag = 0.5 // small offset for disambiguation
      r1.ox = cur.ox + perpX * offsetMag
      r1.oy = cur.oy + perpY * offsetMag
      r2.ox = cur.ox - perpX * offsetMag
      r2.oy = cur.oy - perpY * offsetMag
    }

    // Partition cur's neighbors into two sides using cross product
    const turn = windSign(prv.rx, prv.ry, nxt.rx, nxt.ry, cur.rx, cur.ry)
    const side1: Region[] = [] // left side
    const side2: Region[] = [] // right side

    for (const nb of cur.neighbors) {
      if (nb.id === prv.id || nb.id === nxt.id) continue
      const nbx = nb.rx - cur.rx
      const nby = nb.ry - cur.ry
      const prvx = prv.rx - cur.rx
      const prvy = prv.ry - cur.ry
      const nxtx = nxt.rx - cur.rx
      const nxty = nxt.ry - cur.ry

      // Is nb in the angle from prv to nxt (inner side)?
      const sideOfPrv = prvx * nby - prvy * nbx
      const sideOfNxt = nxtx * nby - nxty * nbx
      if (turn >= 0 ? (sideOfPrv >= 0 && sideOfNxt <= 0) : (sideOfPrv >= 0 || sideOfNxt <= 0)) {
        side1.push(nb)
      } else {
        side2.push(nb)
      }
    }

    // r1 gets side1 neighbors + nxt, r2 gets side2 neighbors + nxt
    // (both sides can reach nxt since path continues there)
    for (const nb of side1) {
      nb.neighbors = nb.neighbors.filter(n => n.id !== cur.id)
      nb.neighbors.push(r1)
      r1.neighbors.push(nb)
    }
    for (const nb of side2) {
      nb.neighbors = nb.neighbors.filter(n => n.id !== cur.id)
      nb.neighbors.push(r2)
      r2.neighbors.push(nb)
    }

    // Connect both split regions to prv and nxt
    prv.neighbors = prv.neighbors.filter(n => n.id !== cur.id)
    nxt.neighbors = nxt.neighbors.filter(n => n.id !== cur.id)
    r1.neighbors.push(nxt)
    r2.neighbors.push(nxt)
    nxt.neighbors.push(r1, r2)
    // prv connects to both too (path came from prv)
    r1.neighbors.push(prv)
    r2.neighbors.push(prv)
    prv.neighbors.push(r1, r2)

    // Add inward direction constraint from the trace path
    const dirX = nxt.rx - prv.rx
    const dirY = nxt.ry - prv.ry
    r1.idirs.push([dirX, dirY])
    r2.idirs.push([-dirX, -dirY])

    // Mark one side as non-incident (trace passes through, not terminating)
    if (turn >= 0) {
      r1.incident = false // inner side
    } else {
      r2.incident = false
    }

    // Update vertex radius for the attached trace
    cur.radius += Math.max(cur.separation, traceClearance) + traceWidth
    cur.separation = traceClearance
    r1.radius = cur.radius
    r2.radius = cur.radius
    r1.separation = cur.separation
    r2.separation = cur.separation

    // Use the cuts that this trace passes through
    const ck1 = cutKey(prv.vertexIdx, cur.vertexIdx)
    const ck2 = cutKey(cur.vertexIdx, nxt.vertexIdx)
    cuts.get(ck1)?.use(traceWidth, traceClearance)
    cuts.get(ck2)?.use(traceWidth, traceClearance)

    // Remove cur from global list, add r1 and r2
    const idx = regions.indexOf(cur)
    if (idx >= 0) regions.splice(idx, 1)
    regions.push(r1, r2)
    // Update regionByVertex to point to r1 (arbitrary — we have split)
    regionByVertex.set(cur.vertexIdx, r1)
  }
}

// ---------------------------------------------------------------------------
// Build final path with tangent-line geometry
// ---------------------------------------------------------------------------

function buildFinalPath(
  mesh: Mesh,
  path: Region[],
  traceWidth: number,
  traceClearance: number,
): { points: Point[]; arcs: { centre: Point; radius: number }[] } {
  if (path.length < 2) return { points: path.map(r => r.vertex), arcs: [] }

  const points: Point[] = []
  const arcs: { centre: Point; radius: number }[] = []

  // Simple approach: output vertex positions, but at obstacle corners
  // use tangent lines with clearance arcs
  for (let i = 0; i < path.length; i++) {
    const cur = path[i]!
    const isCorner = cur.vertexIdx < mesh.vertices.length && mesh.vertices[cur.vertexIdx]?.isCorner

    if (!isCorner || i === 0 || i === path.length - 1) {
      // Not a corner, or a terminal — just use vertex position
      points.push(cur.vertex)
      continue
    }

    // Obstacle corner: compute clearance arc
    const prev = path[i - 1]!
    const next = path[i + 1]!
    const r = traceClearance + traceWidth * 0.5

    // Directions from corner to prev and next
    const dpx = prev.rx - cur.rx, dpy = prev.ry - cur.ry
    const dnx = next.rx - cur.rx, dny = next.ry - cur.ry
    const lenP = Math.hypot(dpx, dpy), lenN = Math.hypot(dnx, dny)
    if (lenP < 1e-10 || lenN < 1e-10) { points.push(cur.vertex); continue }

    const upx = dpx / lenP, upy = dpy / lenP
    const unx = dnx / lenN, uny = dny / lenN

    const dot = upx * unx + upy * uny
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)))
    if (angle < 1e-6 || angle > Math.PI - 1e-6) { points.push(cur.vertex); continue }

    const halfAngle = angle / 2
    const tanDist = Math.min(r / Math.tan(halfAngle), lenP * 0.4, lenN * 0.4)
    if (tanDist < 1e-6) { points.push(cur.vertex); continue }

    // Tangent points
    const t0x = cur.rx + upx * tanDist, t0y = cur.ry + upy * tanDist
    const t1x = cur.rx + unx * tanDist, t1y = cur.ry + uny * tanDist

    // Arc center along bisector
    const bisX = upx + unx, bisY = upy + uny
    const bisLen = Math.hypot(bisX, bisY)
    if (bisLen < 1e-10) { points.push(cur.vertex); continue }

    const centerDist = r / Math.sin(halfAngle)
    const cx = cur.rx + (bisX / bisLen) * centerDist
    const cy = cur.ry + (bisY / bisLen) * centerDist

    // Winding
    const cross = dpx * dny - dpy * dnx
    const ccw = cross < 0

    arcs.push({ centre: { x: cx, y: cy }, radius: r })

    // Sample arc from tangent entry to exit
    const startA = Math.atan2(t0y - cy, t0x - cx)
    const endA = Math.atan2(t1y - cy, t1x - cx)
    let diff = endA - startA
    while (diff > Math.PI) diff -= 2 * Math.PI
    while (diff < -Math.PI) diff += 2 * Math.PI
    if (ccw && diff < 0) diff += 2 * Math.PI
    if (!ccw && diff > 0) diff -= 2 * Math.PI
    if (Math.abs(diff) > Math.PI * 1.5) diff = Math.sign(diff) * Math.PI * 1.5

    const n = Math.max(4, Math.ceil(Math.abs(diff) * r * 0.3))
    for (let s = 0; s <= n; s++) {
      const t = s / n
      const a = startA + diff * t
      points.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  }

  return { points, arcs }
}

function addArcSamples(
  result: Point[],
  centre: Point,
  radius: number,
  fromPt: Point,
  toPt: Point,
  ccw: boolean,
): void {
  const startAngle = Math.atan2(fromPt.y - centre.y, fromPt.x - centre.x)
  const endAngle = Math.atan2(toPt.y - centre.y, toPt.x - centre.x)

  let diff = endAngle - startAngle
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI

  if (ccw && diff < 0) diff += 2 * Math.PI
  if (!ccw && diff > 0) diff -= 2 * Math.PI

  // Clamp
  if (Math.abs(diff) > Math.PI * 1.5) diff = Math.sign(diff) * Math.PI * 1.5

  const n = Math.max(3, Math.ceil(Math.abs(diff) * radius * 0.2))
  for (let s = 1; s <= n; s++) {
    const t = s / (n + 1)
    const a = startAngle + diff * t
    result.push({ x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) })
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function routeTraces(mesh: Mesh, traces: Trace[], clearance = 0): TraceRoute[] {
  if (traces.length === 0) return []

  regionIdCounter = 0
  const traceWidth = 1.0
  const traceClearance = Math.max(clearance, 0.5)
  const defaultRadius = clearance * 0.5

  const { regions, regionByVertex, cuts } = buildRegionGraph(mesh, defaultRadius, traceClearance)

  // Precompute obstacle edges for string-pulling
  const obstacleEdges = collectObstacleEdges(mesh)
  const obstacleCorners: Point[] = mesh.vertices
    .filter((v): v is NonNullable<typeof v> => !!v && v.isCorner)
    .map(v => v.p)

  const results: TraceRoute[] = []

  for (const trace of traces) {
    // Find start and end regions
    const startVi = findNearestVertex(mesh, trace.start)
    const endVi = findNearestVertex(mesh, trace.end)
    const startRegion = regionByVertex.get(startVi)
    const endRegion = regionByVertex.get(endVi)
    if (!startRegion || !endRegion) {
      results.push({
        trace, initialPath: [], initialVertexPath: [],
        corridor: [], rubberbandPath: [], arcs: [],
      })
      continue
    }

    // Dijkstra on regions — establishes topology
    const regionPath = dijkstraRegions(startRegion, endVi, traceWidth, traceClearance, cuts)

    if (!regionPath || regionPath.length < 2) {
      results.push({
        trace, initialPath: [trace.start, trace.end], initialVertexPath: [],
        corridor: [], rubberbandPath: [trace.start, trace.end], arcs: [],
      })
      continue
    }

    const initialPath = regionPath.map(r => r.vertex)
    const initialVertexPath = regionPath.map(r => r.vertexIdx)

    // String-pull: tighten the topological path against obstacles + other traces
    const otherPaths = results.map(r => r.rubberbandPath).filter(p => p.length >= 2)
    const pulled = stringPull(initialPath, obstacleEdges, otherPaths, obstacleCorners)

    // Rebuild the region path to match the pulled vertices (for arc computation)
    // Map pulled points back to regions
    const pulledRegions: Region[] = []
    for (const p of pulled) {
      // Find the region closest to this point
      let bestR = regionPath[0]!, bestD = Infinity
      for (const r of regionPath) {
        const d = distance(p, r.vertex)
        if (d < bestD) { bestD = d; bestR = r }
      }
      if (pulledRegions.length === 0 || pulledRegions[pulledRegions.length - 1] !== bestR) {
        pulledRegions.push(bestR)
      }
    }

    // Build final geometry with tangent arcs at obstacle corners
    const { points: rubberbandPath, arcs } = buildFinalPath(mesh, pulledRegions, traceWidth, traceClearance)

    // Split regions along path for future traces
    splitRegionsAlongPath(regionPath, regions, regionByVertex, cuts, traceWidth, traceClearance)

    const corridor = corridorFromVertexPath(mesh, initialVertexPath)

    results.push({
      trace, initialPath, initialVertexPath,
      corridor, rubberbandPath, arcs,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Obstacle edges + String-pulling
// ---------------------------------------------------------------------------

interface Segment { a: Point; b: Point }

function collectObstacleEdges(mesh: Mesh): Segment[] {
  const edges: Segment[] = []
  const seen = new Set<string>()
  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices
    for (let i = 0; i < V.length; i++) {
      const i2 = (i + 1) % V.length
      const adj = poly.polygons[i2]!
      if (adj !== -1) continue
      const va = V[i]!, vb = V[i2]!
      const key = va < vb ? `${va},${vb}` : `${vb},${va}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ a: mesh.vertices[va]!.p, b: mesh.vertices[vb]!.p })
    }
  }
  return edges
}

/**
 * String-pull: greedily skip vertices when the shortcut doesn't cross
 * any obstacle edge, doesn't graze any obstacle corner, and doesn't
 * cross any other trace.
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

function hasLineOfSight(
  from: Point, to: Point,
  obstacleEdges: Segment[],
  otherTraces: Point[][],
  obstacleCorners: Point[],
): boolean {
  for (const edge of obstacleEdges) {
    if (segmentsProperlyIntersect(from, to, edge.a, edge.b)) return false
  }
  for (const c of obstacleCorners) {
    if ((Math.abs(c.x - from.x) < 1e-4 && Math.abs(c.y - from.y) < 1e-4) ||
        (Math.abs(c.x - to.x) < 1e-4 && Math.abs(c.y - to.y) < 1e-4)) continue
    if (pointToSegmentDist(c, from, to) < 0.5) return false
  }
  for (const trace of otherTraces) {
    for (let i = 0; i < trace.length - 1; i++) {
      if (segmentsProperlyIntersect(from, to, trace[i]!, trace[i + 1]!)) return false
    }
  }
  return true
}

function segmentsProperlyIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const d1 = triArea2(a1, a2, b1), d2 = triArea2(a1, a2, b2)
  const d3 = triArea2(b1, b2, a1), d4 = triArea2(b1, b2, a2)
  return ((d1 > 1e-10 && d2 < -1e-10) || (d1 < -1e-10 && d2 > 1e-10)) &&
         ((d3 > 1e-10 && d4 < -1e-10) || (d3 < -1e-10 && d4 > 1e-10))
}

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return distance(p, a)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}

function triArea2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findNearestVertex(mesh: Mesh, p: Point): number {
  let best = 0, bestD = Infinity
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i]; if (!v) continue
    const d = distance(p, v.p); if (d < bestD) { bestD = d; best = i }
  }
  return best
}

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
      const pA = mesh.vertices[va]!.p, pB = mesh.vertices[vb]!.p, pR = mesh.vertices[ref]!.p
      const side = (pB.x-pA.x)*(pR.y-pA.y) - (pB.y-pA.y)*(pR.x-pA.x)
      for (const pi of ep) {
        const tv = mesh.polygons[pi]!.vertices.find(v => v !== va && v !== vb)
        if (tv !== undefined) {
          const pT = mesh.vertices[tv]!.p
          const sT = (pB.x-pA.x)*(pT.y-pA.y) - (pB.y-pA.y)*(pT.x-pA.x)
          if ((side > 0) === (sT > 0)) { chosen = pi; break }
        }
      }
    }
    if (corridor.length === 0 || corridor[corridor.length - 1] !== chosen) corridor.push(chosen)
  }
  return corridor
}
