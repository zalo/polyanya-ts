import type { Point } from "./types.ts"

/**
 * Detect crossing constraint edges, insert intersection points,
 * and split the edges so cdt2d receives a valid (non-crossing) constraint set.
 *
 * Only checks edges from different rings — edges within the same ring
 * are sequential and never cross.
 *
 * Ported from find-convex-regions resolveConstraintCrossings.
 */
export function resolveConstraintCrossings(
  pts: [number, number][],
  constraintEdges: [number, number][],
  ringBoundaries: number[],
): {
  pts: [number, number][]
  constraintEdges: [number, number][]
  hadCrossings: boolean
} {
  // Determine which ring each edge belongs to
  const edgeRing: number[] = new Array(constraintEdges.length)
  for (let ei = 0; ei < constraintEdges.length; ei++) {
    for (let ri = ringBoundaries.length - 1; ri >= 0; ri--) {
      if (ei >= ringBoundaries[ri]!) {
        edgeRing[ei] = ri
        break
      }
    }
  }

  // Collect all intersection points per edge
  type Split = { t: number; idx: number }
  const edgeSplits = new Map<number, Split[]>()

  const outPts = pts.slice()

  for (let i = 0; i < constraintEdges.length; i++) {
    for (let j = i + 1; j < constraintEdges.length; j++) {
      if (edgeRing[i] === edgeRing[j]) continue

      const [a1, a2] = constraintEdges[i]!
      const [b1, b2] = constraintEdges[j]!
      const p1 = outPts[a1]!
      const p2 = outPts[a2]!
      const p3 = outPts[b1]!
      const p4 = outPts[b2]!

      const d1x = p2[0] - p1[0]
      const d1y = p2[1] - p1[1]
      const d2x = p4[0] - p3[0]
      const d2y = p4[1] - p3[1]
      const denom = d1x * d2y - d1y * d2x
      if (Math.abs(denom) < 1e-10) continue

      const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom
      const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom

      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
        const ix = p1[0] + t * d1x
        const iy = p1[1] + t * d1y
        const newIdx = outPts.length
        outPts.push([ix, iy])

        if (!edgeSplits.has(i)) edgeSplits.set(i, [])
        edgeSplits.get(i)!.push({ t, idx: newIdx })

        if (!edgeSplits.has(j)) edgeSplits.set(j, [])
        edgeSplits.get(j)!.push({ t: u, idx: newIdx })
      }
    }
  }

  if (edgeSplits.size === 0) {
    return { pts, constraintEdges, hadCrossings: false }
  }

  // Rebuild constraint edges, splitting any that have intersection points
  const outEdges: [number, number][] = []

  for (let ei = 0; ei < constraintEdges.length; ei++) {
    const splits = edgeSplits.get(ei)
    if (!splits || splits.length === 0) {
      outEdges.push(constraintEdges[ei]!)
      continue
    }

    // Sort by parameter t along the edge
    splits.sort((a, b) => a.t - b.t)

    const [startIdx, endIdx] = constraintEdges[ei]!
    let prev = startIdx
    for (const split of splits) {
      outEdges.push([prev, split.idx])
      prev = split.idx
    }
    outEdges.push([prev, endIdx])
  }

  return { pts: outPts, constraintEdges: outEdges, hadCrossings: true }
}
