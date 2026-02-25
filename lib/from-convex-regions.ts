import type { Mesh } from "./mesh.ts"
import { buildMeshFromRegions } from "./mesh-builder.ts"
import type { Point } from "./types.ts"

/**
 * Build a Polyanya navigation mesh from find-convex-regions output.
 *
 * Usage:
 * ```ts
 * import { computeConvexRegions } from "find-convex-regions"
 * import { buildMeshFromConvexRegions, SearchInstance } from "polyanya"
 *
 * const result = computeConvexRegions({
 *   bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
 *   rects: [{ center: { x: 0, y: 0 }, width: 2, height: 2, ccwRotation: 0 }],
 *   clearance: 0.1,
 *   concavityTolerance: 0.5,
 * })
 *
 * const mesh = buildMeshFromConvexRegions(result.regions)
 * const search = new SearchInstance(mesh)
 * search.setStartGoal({ x: -5, y: 0 }, { x: 5, y: 0 })
 * search.search()
 * const path = search.getPathPoints()
 * ```
 */
export function buildMeshFromConvexRegions(regions: Point[][]): Mesh {
  return buildMeshFromRegions({ regions })
}
