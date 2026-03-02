# polyanya-ts

TypeScript implementation of Polyanya (any-angle pathfinding on navigation meshes) with visibility graph search and weighted regions.

## Project structure

- `lib/` — Core library (types, geometry, mesh, search, CDT, visibility graph, weighted edges)
- `tests/` — Bun test files
- `fixtures/` — Demo fixture (React/TSX)

## Testing

```bash
bun test                           # all tests
bun test tests/weighted-edges.test.ts  # weighted edge cost unit tests
bun test tests/weighted-regions.test.ts  # VG + Polyanya weighted region tests
```

## Weighted regions architecture

Weighted regions (soft traversal costs) are implemented in the **Visibility Graph**, not in Polyanya. Polyanya returns Euclidean cost (weights ignored). The VG computes exact weighted edge costs via segment-region intersection (`lib/weighted-edges.ts`).

### VG build variants for region vertex edges

The VG `_build()` method constructs corner-corner adjacency. Mesh corner edges use goalless Polyanya (fast, bidirectional). Region vertex edges have three known approaches with different tradeoffs:

#### Variant 1: Current — Direct Polyanya search (correct, O(R*C))
**Commit**: current HEAD
Region vertices use `isDirectlyVisible()` (direct Polyanya search) to every other corner. Produces correct edges but scales as O(R * C) where R = region vertices, C = total corners.
- Scalability concern: R=100, C=2000 -> 200K searches -> potentially seconds
- Best when R is small (< ~30 region vertices)

#### Variant 2: Hybrid — Goalless all + direct region-region only
**Commit**: `ddd22b5` era (before this refactor)
Runs goalless Polyanya from ALL corners (mesh + region), then direct search only between region vertex pairs. ~20% overhead over plain, but misses ~8% of region vertex edges (goalless from interior points is unreliable) and never creates mesh corner -> region vertex edges.
To revert: change `_build()` to loop goalless over `0..numCorners` instead of `0..numMeshCorners`, and only direct-search `numMeshCorners..numCorners` pairs.

#### Variant 3: Goalless only (fastest, incomplete)
Runs goalless from all corners, no direct searches. Fastest but misses ~40% of region vertex -> mesh corner edges and all region vertex -> region vertex edges. To revert: remove the direct search loop entirely.

#### Future optimization for large maps
For large R * C, consider:
- Spatial filtering: only check region vertex -> corners within a BVH-accelerated radius
- Batch visibility: run goalless from region vertices and fill gaps with targeted direct searches for nearby corners only
- Parallel construction: region vertex searches are independent and can be parallelized
