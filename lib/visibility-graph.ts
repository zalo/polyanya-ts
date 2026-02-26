import type { Point } from "./types.ts"
import type { Mesh } from "./mesh.ts"
import { EPSILON } from "./types.ts"
import { PointLocationType } from "./types.ts"
import { distance, sub, cross } from "./geometry.ts"
import { buildSegmentBVH, queryAABB, type Segment, type BVHNode } from "./bvh.ts"

export interface VisibilityGraphResult {
  path: Point[]
  cost: number
  nodesExpanded: number
  edgeCount: number
  buildTimeMs: number
  edges: { ax: number; ay: number; bx: number; by: number }[]
}

/**
 * Visibility graph pathfinding on a navigation mesh.
 * Builds a visibility graph from corner vertices, then runs A*.
 */
export function visibilityGraphSearch(
  mesh: Mesh,
  start: Point,
  goal: Point,
): VisibilityGraphResult {
  const empty: VisibilityGraphResult = {
    path: [],
    cost: -1,
    nodesExpanded: 0,
    edgeCount: 0,
    buildTimeMs: 0,
    edges: [],
  }

  const startLoc = mesh.getPointLocation(start)
  const goalLoc = mesh.getPointLocation(goal)
  if (startLoc.poly1 < 0 || goalLoc.poly1 < 0) return empty
  if (!mesh.sameIsland(startLoc.poly1, goalLoc.poly1)) return empty

  const buildT0 = performance.now()

  // 1. Extract boundary segments
  const segments: Segment[] = []
  const seen = new Set<string>()
  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices
    const P = poly.polygons
    const N = V.length
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N
      // Edge (V[i], V[j]) — adjacent polygon is P[(i+1)%N] = P[j]
      if (P[j] !== -1) continue // not a boundary edge
      const a = V[i]!
      const b = V[j]!
      const key = a < b ? `${a},${b}` : `${b},${a}`
      if (seen.has(key)) continue
      seen.add(key)
      const pa = mesh.vertices[a]!.p
      const pb = mesh.vertices[b]!.p
      segments.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y })
    }
  }

  // 2. Extract corner vertices
  const cornerIndices: number[] = []
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (mesh.vertices[i]!.isCorner) {
      cornerIndices.push(i)
    }
  }

  // 3. Build BVH
  const bvh = segments.length > 0 ? buildSegmentBVH(segments) : null

  // 4. Build graph nodes: corner vertices + start + goal
  // Node indices: 0..cornerIndices.length-1 = corners, then start, then goal
  const numCorners = cornerIndices.length
  const startIdx = numCorners
  const goalIdx = numCorners + 1
  const numNodes = numCorners + 2

  const nodePoints: Point[] = new Array(numNodes)
  for (let i = 0; i < numCorners; i++) {
    nodePoints[i] = mesh.vertices[cornerIndices[i]!]!.p
  }
  nodePoints[startIdx] = start
  nodePoints[goalIdx] = goal

  // 5. Build adjacency using nearest-K candidates to avoid O(n²) on large meshes
  const adj: { to: number; dist: number }[][] = new Array(numNodes)
  for (let i = 0; i < numNodes; i++) adj[i] = []

  let edgeCount = 0
  const visEdges: { ax: number; ay: number; bx: number; by: number }[] = []
  const addedEdge = new Set<string>()

  const K = 150

  for (let i = 0; i < numNodes; i++) {
    const pi = nodePoints[i]!

    // Compute distances to all other nodes
    const candidates: { j: number; dist: number }[] = []
    for (let j = 0; j < numNodes; j++) {
      if (j === i) continue
      const pj = nodePoints[j]!
      if (Math.abs(pi.x - pj.x) < EPSILON && Math.abs(pi.y - pj.y) < EPSILON) continue
      candidates.push({ j, dist: distance(pi, pj) })
    }

    // Sort by distance and take nearest K
    candidates.sort((a, b) => a.dist - b.dist)
    const limit = Math.min(candidates.length, K)

    // Always include start and goal in candidate sets
    const candidateSet = new Set<number>()
    for (let c = 0; c < limit; c++) candidateSet.add(candidates[c]!.j)
    if (i !== startIdx) candidateSet.add(startIdx)
    if (i !== goalIdx) candidateSet.add(goalIdx)

    for (const j of candidateSet) {
      // Avoid duplicate edge checks
      const edgeKey = i < j ? `${i},${j}` : `${j},${i}`
      if (addedEdge.has(edgeKey)) continue
      addedEdge.add(edgeKey)

      const pj = nodePoints[j]!
      if (isVisible(pi, pj, segments, bvh, mesh)) {
        const d = distance(pi, pj)
        adj[i]!.push({ to: j, dist: d })
        adj[j]!.push({ to: i, dist: d })
        visEdges.push({ ax: pi.x, ay: pi.y, bx: pj.x, by: pj.y })
        edgeCount++
      }
    }
  }

  const buildTimeMs = performance.now() - buildT0

  // 6. A* from startIdx to goalIdx
  const goalP = nodePoints[goalIdx]!

  // Min-heap
  interface HeapEntry {
    node: number
    f: number
    g: number
  }

  const heap: HeapEntry[] = []
  const pushHeap = (e: HeapEntry) => {
    heap.push(e)
    let i = heap.length - 1
    while (i > 0) {
      const pi = (i - 1) >> 1
      if (heap[pi]!.f <= heap[i]!.f) break
      const tmp = heap[pi]!
      heap[pi] = heap[i]!
      heap[i] = tmp
      i = pi
    }
  }
  const popHeap = (): HeapEntry => {
    const top = heap[0]!
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      let i = 0
      while (true) {
        let s = i
        const l = 2 * i + 1,
          r = 2 * i + 2
        if (l < heap.length && heap[l]!.f < heap[s]!.f) s = l
        if (r < heap.length && heap[r]!.f < heap[s]!.f) s = r
        if (s === i) break
        const tmp = heap[i]!
        heap[i] = heap[s]!
        heap[s] = tmp
        i = s
      }
    }
    return top
  }

  const gBest = new Float64Array(numNodes).fill(Infinity)
  const cameFrom = new Int32Array(numNodes).fill(-1)

  gBest[startIdx] = 0
  pushHeap({ node: startIdx, g: 0, f: distance(start, goalP) })

  let nodesExpanded = 0

  while (heap.length > 0) {
    const cur = popHeap()
    if (cur.g > gBest[cur.node]! + EPSILON) continue

    if (cur.node === goalIdx) {
      // Reconstruct path
      const path: Point[] = []
      let n = goalIdx
      while (n !== -1) {
        path.push(nodePoints[n]!)
        n = cameFrom[n]!
      }
      path.reverse()
      return { path, cost: cur.g, nodesExpanded, edgeCount, buildTimeMs, edges: visEdges }
    }

    nodesExpanded++
    for (const edge of adj[cur.node]!) {
      const ng = cur.g + edge.dist
      if (ng < gBest[edge.to]! - EPSILON) {
        gBest[edge.to] = ng
        cameFrom[edge.to] = cur.node
        pushHeap({ node: edge.to, g: ng, f: ng + distance(nodePoints[edge.to]!, goalP) })
      }
    }
  }

  return empty
}

/**
 * Test if two points can see each other through the mesh.
 * Checks that no boundary segment blocks the line and that the midpoint is on the mesh.
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

  // Query BVH for candidate segments
  const qMinX = Math.min(a.x, b.x)
  const qMinY = Math.min(a.y, b.y)
  const qMaxX = Math.max(a.x, b.x)
  const qMaxY = Math.max(a.y, b.y)
  const candidates: number[] = []
  queryAABB(bvh, qMinX, qMinY, qMaxX, qMaxY, segments, candidates)

  // Exact segment-segment intersection test
  const abx = b.x - a.x
  const aby = b.y - a.y

  for (const idx of candidates) {
    const s = segments[idx]!
    const cdx = s.bx - s.ax
    const cdy = s.by - s.ay

    const denom = abx * cdy - aby * cdx
    if (Math.abs(denom) < EPSILON) continue // parallel

    const acx = s.ax - a.x
    const acy = s.ay - a.y

    const t = (acx * cdy - acy * cdx) / denom
    const u = (acx * aby - acy * abx) / denom

    // Proper intersection: both t and u strictly in (0, 1)
    // We use a small margin to avoid false positives at shared endpoints
    const EPS = 1e-6
    if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) {
      return false
    }
  }

  return true
}
