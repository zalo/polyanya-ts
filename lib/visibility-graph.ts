import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { EPSILON } from "./types.ts"
import { PointLocationType } from "./types.ts"
import { distance } from "./geometry.ts"
import { buildSegmentBVH, queryAABB, type Segment, type BVHNode } from "./bvh.ts"

export interface VisibilityGraphResult {
  path: Point[]
  cost: number
  nodesExpanded: number
  edgeCount: number
  /** Time for this search query in ms (graph construction is precomputed) */
  buildTimeMs: number
  edges: { ax: number; ay: number; bx: number; by: number }[]
}

/**
 * Precomputed visibility graph for a navigation mesh.
 *
 * Build once per mesh, then call search() for each start/goal query.
 * Only convex (reflex) corners are included — vertices where the obstacle
 * subtends < 180°, i.e. where a shortest path might wrap around.
 * Near-flat corners are filtered by `convexityThreshold` (minimum |sin| of
 * the CW turn angle; default 0.02 ≈ 1.1°).
 */
export class VisibilityGraph {
  private readonly mesh: Mesh
  private readonly segments: Segment[]
  private readonly bvh: BVHNode | null
  private readonly cornerIndices: number[]
  private readonly cornerPoints: Point[]
  private readonly coneHasCone: Uint8Array
  private readonly coneDInX: Float64Array
  private readonly coneDInY: Float64Array
  private readonly coneDOutX: Float64Array
  private readonly coneDOutY: Float64Array
  /** Static corner-corner adjacency (indices into cornerPoints) */
  private readonly adj: { to: number; dist: number }[][]

  /** Time taken to precompute the static graph (ms) */
  readonly buildTimeMs: number
  /** Number of static corner-corner edges */
  readonly edgeCount: number
  /** Static corner-corner edges for visualization */
  readonly edges: { ax: number; ay: number; bx: number; by: number }[]

  constructor(mesh: Mesh, convexityThreshold = 0.02) {
    const t0 = performance.now()
    this.mesh = mesh

    // 1. Extract boundary segments + track directed boundary edge adjacency
    const segments: Segment[] = []
    const seen = new Set<string>()
    const boundaryNext = new Map<number, number>()
    const boundaryPrev = new Map<number, number>()
    for (const poly of mesh.polygons) {
      if (!poly) continue
      const V = poly.vertices
      const P = poly.polygons
      const N = V.length
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N
        if (P[j] !== -1) continue
        const a = V[i]!
        const b = V[j]!
        const key = a < b ? `${a},${b}` : `${b},${a}`
        if (seen.has(key)) continue
        seen.add(key)
        const pa = mesh.vertices[a]!.p
        const pb = mesh.vertices[b]!.p
        segments.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y })
        boundaryNext.set(a, b)
        boundaryPrev.set(b, a)
      }
    }
    this.segments = segments
    this.bvh = segments.length > 0 ? buildSegmentBVH(segments) : null

    // 2. Extract convex (reflex) corners only.
    // A boundary vertex is a valid turning point iff the obstacle it borders
    // subtends < 180° — equivalently, the directed boundary makes a CW turn
    // (normalized cross product < 0) at that vertex.
    // Flat and concave corners never lie on a shortest path.
    const cornerIndices: number[] = []
    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i]!
      if (!v.isCorner) continue
      // Ambiguous corners (multiple obstacle gaps): keep without convexity test
      if (v.isAmbig) {
        cornerIndices.push(i)
        continue
      }
      const prevIdx = boundaryPrev.get(i)
      const nextIdx = boundaryNext.get(i)
      if (prevIdx === undefined || nextIdx === undefined) {
        cornerIndices.push(i) // can't determine, keep
        continue
      }
      const A = mesh.vertices[prevIdx]!.p
      const VP = v.p
      const B = mesh.vertices[nextIdx]!.p
      // Vectors: d1 = A→V, d2 = V→B
      const dx1 = VP.x - A.x, dy1 = VP.y - A.y
      const dx2 = B.x - VP.x, dy2 = B.y - VP.y
      const len1Sq = dx1 * dx1 + dy1 * dy1
      const len2Sq = dx2 * dx2 + dy2 * dy2
      if (len1Sq < EPSILON || len2Sq < EPSILON) {
        cornerIndices.push(i) // degenerate edge, keep
        continue
      }
      // Normalized cross = sin(turn angle). Negative = CW = reflex vertex.
      // Filter out near-flat corners (|sin| < threshold).
      const normalizedCross = (dx1 * dy2 - dy1 * dx2) / Math.sqrt(len1Sq * len2Sq)
      if (normalizedCross < -convexityThreshold) {
        cornerIndices.push(i)
      }
    }
    this.cornerIndices = cornerIndices

    const numCorners = cornerIndices.length
    const cornerPoints: Point[] = new Array(numCorners)
    for (let k = 0; k < numCorners; k++) {
      cornerPoints[k] = mesh.vertices[cornerIndices[k]!]!.p
    }
    this.cornerPoints = cornerPoints

    // 3. Precompute obstacle-wedge cone directions for each corner.
    // The wedge is bounded by d_in (direction of incoming boundary edge A→V)
    // and d_out (direction of outgoing boundary edge V→B).
    // An edge pointing into the wedge satisfies cross(d_in, D) < 0 AND cross(d_out, D) < 0.
    const coneHasCone = new Uint8Array(numCorners)
    const coneDInX = new Float64Array(numCorners)
    const coneDInY = new Float64Array(numCorners)
    const coneDOutX = new Float64Array(numCorners)
    const coneDOutY = new Float64Array(numCorners)
    for (let k = 0; k < numCorners; k++) {
      const vi = cornerIndices[k]!
      const v = mesh.vertices[vi]!
      if (v.isAmbig) continue
      const prevIdx = boundaryPrev.get(vi)
      const nextIdx = boundaryNext.get(vi)
      if (prevIdx === undefined || nextIdx === undefined) continue
      const A = mesh.vertices[prevIdx]!.p
      const VP = v.p
      const B = mesh.vertices[nextIdx]!.p
      coneDInX[k] = VP.x - A.x
      coneDInY[k] = VP.y - A.y
      coneDOutX[k] = B.x - VP.x
      coneDOutY[k] = B.y - VP.y
      coneHasCone[k] = 1
    }
    this.coneHasCone = coneHasCone
    this.coneDInX = coneDInX
    this.coneDInY = coneDInY
    this.coneDOutX = coneDOutX
    this.coneDOutY = coneDOutY

    // 4. Build static corner-corner adjacency with nearest-K candidates
    const adj: { to: number; dist: number }[][] = new Array(numCorners)
    for (let k = 0; k < numCorners; k++) adj[k] = []

    let edgeCount = 0
    const visEdges: { ax: number; ay: number; bx: number; by: number }[] = []
    const addedEdge = new Set<string>()
    const K = 150

    for (let i = 0; i < numCorners; i++) {
      const pi = cornerPoints[i]!
      const candidates: { j: number; dist: number }[] = []
      for (let j = 0; j < numCorners; j++) {
        if (j === i) continue
        const pj = cornerPoints[j]!
        if (Math.abs(pi.x - pj.x) < EPSILON && Math.abs(pi.y - pj.y) < EPSILON) continue
        candidates.push({ j, dist: distance(pi, pj) })
      }
      candidates.sort((a, b) => a.dist - b.dist)
      const limit = Math.min(candidates.length, K)

      for (let c = 0; c < limit; c++) {
        const { j, dist: d } = candidates[c]!
        const edgeKey = i < j ? `${i},${j}` : `${j},${i}`
        if (addedEdge.has(edgeKey)) continue
        addedEdge.add(edgeKey)

        const pj = cornerPoints[j]!

        // Cone filter at both endpoints
        if (coneHasCone[i]) {
          const dx = pj.x - pi.x, dy = pj.y - pi.y
          if (coneDInX[i]! * dy - coneDInY[i]! * dx < -EPSILON &&
              coneDOutX[i]! * dy - coneDOutY[i]! * dx < -EPSILON) continue
        }
        if (coneHasCone[j]) {
          const dx = pi.x - pj.x, dy = pi.y - pj.y
          if (coneDInX[j]! * dy - coneDInY[j]! * dx < -EPSILON &&
              coneDOutX[j]! * dy - coneDOutY[j]! * dx < -EPSILON) continue
        }

        if (isVisible(pi, pj, segments, this.bvh, mesh)) {
          adj[i]!.push({ to: j, dist: d })
          adj[j]!.push({ to: i, dist: d })
          visEdges.push({ ax: pi.x, ay: pi.y, bx: pj.x, by: pj.y })
          edgeCount++
        }
      }
    }
    this.adj = adj
    this.edgeCount = edgeCount
    this.edges = visEdges
    this.buildTimeMs = performance.now() - t0
  }

  /**
   * Find the shortest path from start to goal using the precomputed graph.
   * Connects start and goal to all visible corners, then runs A*.
   */
  search(start: Point, goal: Point): VisibilityGraphResult {
    const t0 = performance.now()
    const empty: VisibilityGraphResult = {
      path: [],
      cost: -1,
      nodesExpanded: 0,
      edgeCount: this.edgeCount,
      buildTimeMs: 0,
      edges: this.edges,
    }

    const startLoc = this.mesh.getPointLocation(start)
    const goalLoc = this.mesh.getPointLocation(goal)
    if (startLoc.poly1 < 0 || goalLoc.poly1 < 0) return empty
    if (!this.mesh.sameIsland(startLoc.poly1, goalLoc.poly1)) return empty

    const numCorners = this.cornerIndices.length
    const startIdx = numCorners
    const goalIdx = numCorners + 1
    const numNodes = numCorners + 2

    const nodePoints: Point[] = new Array(numNodes)
    for (let k = 0; k < numCorners; k++) nodePoints[k] = this.cornerPoints[k]!
    nodePoints[startIdx] = start
    nodePoints[goalIdx] = goal

    // Connect start and goal to ALL visible corners.
    // (Matches original behavior where every corner k had start/goal in its candidate set.)
    // cornerToStartDist[k] >= 0 means corner k can see start.
    // cornerToGoalDist[k]  >= 0 means corner k can see goal.
    const cornerToStartDist = new Float64Array(numCorners).fill(-1)
    const cornerToGoalDist = new Float64Array(numCorners).fill(-1)
    const startAdj: { to: number; dist: number }[] = []
    const goalAdj: { to: number; dist: number }[] = []

    for (let k = 0; k < numCorners; k++) {
      const pk = this.cornerPoints[k]!

      // Cone filter at corner k: skip if start/goal is in the obstacle wedge
      const hasStart = !(Math.abs(start.x - pk.x) < EPSILON && Math.abs(start.y - pk.y) < EPSILON)
      const hasGoal  = !(Math.abs(goal.x  - pk.x) < EPSILON && Math.abs(goal.y  - pk.y) < EPSILON)

      if (this.coneHasCone[k]) {
        if (hasStart) {
          const dx = start.x - pk.x, dy = start.y - pk.y
          const inWedge = this.coneDInX[k]! * dy - this.coneDInY[k]! * dx < -EPSILON &&
                          this.coneDOutX[k]! * dy - this.coneDOutY[k]! * dx < -EPSILON
          if (!inWedge && isVisible(start, pk, this.segments, this.bvh, this.mesh)) {
            const d = distance(start, pk)
            startAdj.push({ to: k, dist: d })
            cornerToStartDist[k] = d
          }
        }
        if (hasGoal) {
          const dx = goal.x - pk.x, dy = goal.y - pk.y
          const inWedge = this.coneDInX[k]! * dy - this.coneDInY[k]! * dx < -EPSILON &&
                          this.coneDOutX[k]! * dy - this.coneDOutY[k]! * dx < -EPSILON
          if (!inWedge && isVisible(goal, pk, this.segments, this.bvh, this.mesh)) {
            const d = distance(goal, pk)
            goalAdj.push({ to: k, dist: d })
            cornerToGoalDist[k] = d
          }
        }
      } else {
        if (hasStart && isVisible(start, pk, this.segments, this.bvh, this.mesh)) {
          const d = distance(start, pk)
          startAdj.push({ to: k, dist: d })
          cornerToStartDist[k] = d
        }
        if (hasGoal && isVisible(goal, pk, this.segments, this.bvh, this.mesh)) {
          const d = distance(goal, pk)
          goalAdj.push({ to: k, dist: d })
          cornerToGoalDist[k] = d
        }
      }
    }

    // Direct start → goal
    if (isVisible(start, goal, this.segments, this.bvh, this.mesh)) {
      const d = distance(start, goal)
      startAdj.push({ to: goalIdx, dist: d })
      goalAdj.push({ to: startIdx, dist: d })
    }

    // A* over static corner graph + dynamic start/goal edges
    const goalP = goal

    const heap: { node: number; f: number; g: number }[] = []
    const pushHeap = (node: number, g: number, f: number) => {
      heap.push({ node, f, g })
      let i = heap.length - 1
      while (i > 0) {
        const pi = (i - 1) >> 1
        if (heap[pi]!.f <= heap[i]!.f) break
        const tmp = heap[pi]!; heap[pi] = heap[i]!; heap[i] = tmp
        i = pi
      }
    }
    const popHeap = (): { node: number; f: number; g: number } => {
      const top = heap[0]!
      const last = heap.pop()!
      if (heap.length > 0) {
        heap[0] = last
        let i = 0
        while (true) {
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

    const gBest = new Float64Array(numNodes).fill(Infinity)
    const cameFrom = new Int32Array(numNodes).fill(-1)

    gBest[startIdx] = 0
    pushHeap(startIdx, 0, distance(start, goalP))

    let nodesExpanded = 0

    while (heap.length > 0) {
      const cur = popHeap()
      if (cur.g > gBest[cur.node]! + EPSILON) continue

      if (cur.node === goalIdx) {
        const path: Point[] = []
        let n = goalIdx
        while (n !== -1) {
          path.push(nodePoints[n]!)
          n = cameFrom[n]!
        }
        path.reverse()
        return {
          path,
          cost: cur.g,
          nodesExpanded,
          edgeCount: this.edgeCount,
          buildTimeMs: performance.now() - t0,
          edges: this.edges,
        }
      }

      nodesExpanded++

      const relax = (to: number, ng: number) => {
        if (ng < gBest[to]! - EPSILON) {
          gBest[to] = ng
          cameFrom[to] = cur.node
          pushHeap(to, ng, ng + distance(nodePoints[to]!, goalP))
        }
      }

      if (cur.node === startIdx) {
        for (const e of startAdj) relax(e.to, cur.g + e.dist)
      } else if (cur.node === goalIdx) {
        for (const e of goalAdj) relax(e.to, cur.g + e.dist)
      } else {
        // Corner node: static edges + dynamic backlinks to start/goal
        for (const e of this.adj[cur.node]!) relax(e.to, cur.g + e.dist)
        const toStart = cornerToStartDist[cur.node]!
        if (toStart >= 0) relax(startIdx, cur.g + toStart)
        const toGoal = cornerToGoalDist[cur.node]!
        if (toGoal >= 0) relax(goalIdx, cur.g + toGoal)
      }
    }

    return empty
  }
}

/**
 * Convenience function: builds a VisibilityGraph and immediately runs a search.
 * For repeated queries on the same mesh, prefer constructing VisibilityGraph
 * once and calling search() directly.
 */
export function visibilityGraphSearch(
  mesh: Mesh,
  start: Point,
  goal: Point,
): VisibilityGraphResult {
  return new VisibilityGraph(mesh).search(start, goal)
}

/**
 * Test if two points can see each other through the mesh.
 * Checks that no boundary segment blocks the line and that sampled midpoints are on the mesh.
 */
function isVisible(
  a: Point,
  b: Point,
  segments: Segment[],
  bvh: BVHNode | null,
  mesh: Mesh,
): boolean {
  // Sample 3 points along the segment to catch paths that graze through obstacles
  for (const t of [0.25, 0.5, 0.75]) {
    const sx = a.x + (b.x - a.x) * t
    const sy = a.y + (b.y - a.y) * t
    const loc = mesh.getPointLocation({ x: sx, y: sy })
    if (loc.type === PointLocationType.NOT_ON_MESH) return false
  }

  if (!bvh || segments.length === 0) return true

  const qMinX = Math.min(a.x, b.x)
  const qMinY = Math.min(a.y, b.y)
  const qMaxX = Math.max(a.x, b.x)
  const qMaxY = Math.max(a.y, b.y)
  const candidates: number[] = []
  queryAABB(bvh, qMinX, qMinY, qMaxX, qMaxY, segments, candidates)

  const abx = b.x - a.x
  const aby = b.y - a.y

  for (const idx of candidates) {
    const s = segments[idx]!
    const cdx = s.bx - s.ax
    const cdy = s.by - s.ay

    const denom = abx * cdy - aby * cdx
    if (Math.abs(denom) < EPSILON) continue

    const acx = s.ax - a.x
    const acy = s.ay - a.y
    const t = (acx * cdy - acy * cdx) / denom
    const u = (acx * aby - acy * abx) / denom

    const EPS = 1e-6
    if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
      return false
    }
  }

  return true
}
