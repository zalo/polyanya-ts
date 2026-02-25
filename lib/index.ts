// Core types
export {
  EPSILON,
  Orientation,
  PointLocationType,
  PolyContainmentType,
  StepEventType,
  SuccessorType,
  ZeroOnePos,
  type Point,
  type PointLocation,
  type PolyContainment,
  type Polygon,
  type SearchNode,
  type StepEvent,
  type Successor,
  type Vertex,
} from "./types.ts"

// Geometry utilities
export {
  add,
  cross,
  distance,
  distanceSq,
  getOrientation,
  getPointOnLine,
  isCollinear,
  lineIntersect,
  lineIntersectBoundCheck,
  lineIntersectTime,
  pointsEqual,
  reflectPoint,
  scale,
  sub,
} from "./geometry.ts"

// Mesh
export { Mesh } from "./mesh.ts"

// Expansion (successor generation)
export { getHValue, getSuccessors } from "./expansion.ts"

// Search
export { SearchInstance } from "./search.ts"

// Mesh builder
export { buildMeshFromRegions, type MeshBuilderInput } from "./mesh-builder.ts"

// CDT builder (obstacle → triangulation → regions)
export { cdtTriangulate, rectToPolygon } from "./cdt-builder.ts"

// Mesh merger (Polyanya meshmerger algorithm)
export { mergeMesh } from "./mesh-merger.ts"
