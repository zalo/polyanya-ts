/** Floating point comparison epsilon */
declare const EPSILON = 1e-8;
/** A 2D point */
interface Point {
    x: number;
    y: number;
}
/** A mesh vertex with adjacency information */
interface Vertex {
    p: Point;
    /** Adjacent polygon indices (CCW order). -1 means obstacle/boundary. */
    polygons: number[];
    /** True if this vertex touches an obstacle or mesh boundary */
    isCorner: boolean;
    /** True if multiple non-traversable neighbors (ambiguous corner) */
    isAmbig: boolean;
}
/** A convex polygon in the navigation mesh */
interface Polygon {
    /** Vertex indices (CCW order) */
    vertices: number[];
    /** Adjacent polygon indices. polygons[i] is adjacent to edge (vertices[(i-1+N) mod N], vertices[i]). -1 = obstacle. */
    polygons: number[];
    /** True if only one traversable neighbor */
    isOneWay: boolean;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    /** Distance cost multiplier (default 1.0) */
    weight: number;
    /** Additive entry cost (default 0.0) */
    penalty: number;
}
/** A weighted region that the pathfinder prefers to avoid but can traverse */
interface WeightedRegion {
    polygon: Point[];
    weight: number;
    penalty: number;
}
/** Result of testing whether a polygon contains a point */
declare enum PolyContainmentType {
    OUTSIDE = "OUTSIDE",
    INSIDE = "INSIDE",
    ON_EDGE = "ON_EDGE",
    ON_VERTEX = "ON_VERTEX"
}
interface PolyContainment {
    type: PolyContainmentType;
    adjacentPoly: number;
    vertex1: number;
    vertex2: number;
}
/** How a point is located on the mesh */
declare enum PointLocationType {
    NOT_ON_MESH = "NOT_ON_MESH",
    IN_POLYGON = "IN_POLYGON",
    ON_MESH_BORDER = "ON_MESH_BORDER",
    ON_EDGE = "ON_EDGE",
    ON_CORNER_VERTEX_AMBIG = "ON_CORNER_VERTEX_AMBIG",
    ON_CORNER_VERTEX_UNAMBIG = "ON_CORNER_VERTEX_UNAMBIG",
    ON_NON_CORNER_VERTEX = "ON_NON_CORNER_VERTEX"
}
interface PointLocation {
    type: PointLocationType;
    poly1: number;
    poly2: number;
    vertex1: number;
    vertex2: number;
}
/** Successor interval types during expansion */
declare enum SuccessorType {
    RIGHT_NON_OBSERVABLE = "RIGHT_NON_OBSERVABLE",
    OBSERVABLE = "OBSERVABLE",
    LEFT_NON_OBSERVABLE = "LEFT_NON_OBSERVABLE"
}
/** A successor interval generated during node expansion */
interface Successor {
    type: SuccessorType;
    left: Point;
    right: Point;
    /** Index into polygon's vertex/polygon arrays for the left edge endpoint */
    polyLeftInd: number;
}
/** A search node in the Polyanya algorithm */
interface SearchNode {
    parent: SearchNode | null;
    /** Root vertex index. -1 means start point is the root. */
    root: number;
    /** Left endpoint of the interval (looking from root, right is on the right side) */
    left: Point;
    /** Right endpoint of the interval */
    right: Point;
    /** Left vertex index of the edge the interval lies on */
    leftVertex: number;
    /** Right vertex index of the edge the interval lies on */
    rightVertex: number;
    /** Index of the polygon to expand into next */
    nextPolygon: number;
    /** f = g + h (total estimated cost) */
    f: number;
    /** g = cost from start to this node's root */
    g: number;
}
/** Orientation of three points */
declare enum Orientation {
    CCW = "CCW",
    COLLINEAR = "COLLINEAR",
    CW = "CW"
}
/** Position of a line intersection parameter in [0, 1] */
declare enum ZeroOnePos {
    LT_ZERO = "LT_ZERO",
    EQ_ZERO = "EQ_ZERO",
    IN_RANGE = "IN_RANGE",
    EQ_ONE = "EQ_ONE",
    GT_ONE = "GT_ONE"
}
/** An event emitted during search stepping for visualization */
declare enum StepEventType {
    INIT = "INIT",
    NODE_POPPED = "NODE_POPPED",
    NODE_EXPANDED = "NODE_EXPANDED",
    NODE_PUSHED = "NODE_PUSHED",
    NODE_PRUNED = "NODE_PRUNED",
    GOAL_REACHED = "GOAL_REACHED",
    SEARCH_EXHAUSTED = "SEARCH_EXHAUSTED"
}
interface StepEvent {
    type: StepEventType;
    node?: SearchNode;
    successors?: Successor[];
    nodesInOpenList?: number;
    message?: string;
}

/** Euclidean distance squared between two points */
declare function distanceSq(a: Point, b: Point): number;
/** Euclidean distance between two points */
declare function distance(a: Point, b: Point): number;
/** 2D cross product (z-component): (b-a) x (c-b) */
declare function cross(a: Point, b: Point): number;
/** Subtract two points */
declare function sub(a: Point, b: Point): Point;
/** Add two points */
declare function add(a: Point, b: Point): Point;
/** Scale a point by a scalar */
declare function scale(p: Point, s: number): Point;
/** Check if two points are approximately equal */
declare function pointsEqual(a: Point, b: Point): boolean;
/** Get orientation of three points: CCW, COLLINEAR, or CW */
declare function getOrientation(a: Point, b: Point, c: Point): Orientation;
/** Check if three points are collinear */
declare function isCollinear(a: Point, b: Point, c: Point): boolean;
/**
 * Line intersection between segments ab and cd.
 * Returns the intersection point using parameterization on ab.
 * ASSUMES NO COLLINEARITY.
 */
declare function lineIntersect(a: Point, b: Point, c: Point, d: Point): Point;
/**
 * Compute parameterized intersection times for lines ab and cd.
 * Returns { abNum, cdNum, denom } such that:
 *   ab(abNum/denom) = cd(cdNum/denom)
 */
declare function lineIntersectTime(a: Point, b: Point, c: Point, d: Point): {
    abNum: number;
    cdNum: number;
    denom: number;
};
/**
 * Check where num/denom falls in [0, 1].
 */
declare function lineIntersectBoundCheck(num: number, denom: number): ZeroOnePos;
/** Get a point on line ab at parameter t: a + (b-a)*t */
declare function getPointOnLine(a: Point, b: Point, t: number): Point;
/** Reflect a point across the line lr */
declare function reflectPoint(p: Point, l: Point, r: Point): Point;

/**
 * Navigation mesh for Polyanya pathfinding.
 * Contains vertices and convex polygons with adjacency information.
 */
declare class Mesh {
    vertices: Vertex[];
    polygons: Polygon[];
    maxPolySides: number;
    private slabs;
    private sortedSlabKeys;
    private islands;
    private minX;
    private maxX;
    private minY;
    private maxY;
    constructor();
    /**
     * Parse a .mesh file (version 2 format).
     *
     * Format:
     * ```
     * mesh
     * 2
     * V P
     * (for each vertex): x y numNeighbors poly0 poly1 ...
     * (for each polygon): numVertices v0 v1 ... adjPoly0 adjPoly1 ...
     * ```
     */
    static fromString(input: string): Mesh;
    /**
     * Build a Mesh directly from arrays of vertices and polygons.
     * Use this when constructing a mesh programmatically (e.g. from convex regions).
     */
    static fromData(vertices: Vertex[], polygons: Polygon[]): Mesh;
    private read;
    /** Build slab-based spatial index for fast point location */
    private precalcPointLocation;
    /** BFS flood-fill to assign connected component IDs to each polygon */
    private computeIslands;
    /** Check if two polygons are on the same connected island */
    sameIsland(polyA: number, polyB: number): boolean;
    /** Test if a polygon contains a point */
    polyContainsPoint(polyIndex: number, p: Point): PolyContainment;
    /** Find where a point is located on the mesh */
    getPointLocation(p: Point): PointLocation;
    /** Brute-force point location (for testing/validation) */
    getPointLocationNaive(p: Point): PointLocation;
}

/**
 * Compute the heuristic value for a search node.
 * Uses line intersection + reflection for an admissible estimate.
 */
declare function getHValue(root: Point, goal: Point, l: Point, r: Point): number;
/**
 * Generate successors for a search node within a polygon.
 * This is the core of the Polyanya algorithm.
 *
 * Returns an array of Successor objects representing visible and non-observable
 * intervals on the polygon edges.
 */
declare function getSuccessors(node: SearchNode, start: Point, mesh: Mesh): Successor[];

/**
 * Polyanya search instance.
 * Performs compromise-free any-angle pathfinding on a navigation mesh.
 */
declare class SearchInstance {
    mesh: Mesh;
    start: Point;
    goal: Point;
    finalNode: SearchNode | null;
    private startPolygon;
    private endPolygon;
    private openList;
    private rootGValues;
    private rootSearchIds;
    private searchId;
    nodesGenerated: number;
    nodesPushed: number;
    nodesPopped: number;
    nodesPrunedPostPop: number;
    successorCalls: number;
    verbose: boolean;
    private goalless;
    private stepEvents;
    private stepMode;
    constructor(mesh: Mesh);
    /** Set start and goal points for the next search */
    setStartGoal(start: Point, goal: Point): void;
    private resolvePointLocation;
    private setEndPolygon;
    /** Convert successors to search nodes with root-level pruning */
    private succToNode;
    /** Generate initial search nodes from the start point */
    private genInitialNodes;
    private initSearch;
    /** Maximum search time in milliseconds (0 = unlimited) */
    timeLimitMs: number;
    /**
     * Run the full Polyanya search.
     * Returns true if a path was found, false otherwise.
     */
    search(): boolean;
    /**
     * Start a stepping search. Call `step()` repeatedly to advance.
     * Returns the initial step events.
     */
    searchInit(): StepEvent[];
    /**
     * Execute one step of the search algorithm.
     * Returns an array of events that occurred during this step.
     */
    step(): StepEvent[];
    /** Check if the search is complete (either found or exhausted) */
    isSearchComplete(): boolean;
    /** Get all nodes currently in the open list (for visualization) */
    getOpenListNodes(): SearchNode[];
    private createFinalNode;
    private expandAndPush;
    private runSearchLoop;
    /** Get the path cost, or -1 if no path found */
    getCost(): number;
    /** Get the path as an array of waypoints from start to goal */
    getPathPoints(): Point[];
    /**
     * Run a goalless Polyanya expansion from `from`.
     * Returns a map from vertex index → straight-line distance for every
     * corner vertex that is directly visible (no detour) from `from`.
     *
     * A corner v is directly visible iff g(v) ≈ distance(from, v): the
     * Polyanya g-value equals the Euclidean distance when no intermediate
     * turning point is needed.
     */
    computeVisibleCornersFromPoint(from: Point): Map<number, number>;
    /**
     * Get the full search tree (all nodes from final back to start).
     * Useful for visualization.
     */
    getSearchTree(): SearchNode[];
}

/**
 * Input for building a navigation mesh from convex regions.
 * Regions are convex polygons (arrays of points in CCW order)
 * that share edges to form a navigation mesh.
 */
interface MeshBuilderInput {
    regions: Point[][];
    regionWeights?: {
        weight: number;
        penalty: number;
    }[];
}
/**
 * Build a Polyanya navigation mesh from an array of convex regions.
 *
 * The regions should be convex polygons sharing edges. Two regions that
 * share an edge will be considered adjacent (traversable between).
 *
 * Use `cdtTriangulate()` to decompose a 2D space with obstacles into
 * triangle regions suitable for this function.
 */
declare function buildMeshFromRegions(input: MeshBuilderInput): Mesh;

/**
 * Result of CDT triangulation including per-region weight data.
 */
interface CdtResult {
    regions: Point[][];
    regionWeights: {
        weight: number;
        penalty: number;
    }[];
}
/**
 * CDT-triangulate the free space inside `bounds` around obstacle polygons.
 *
 * Each obstacle is a closed polygon (array of Point). The function generates
 * boundary sample points, builds constraint edges, runs constrained Delaunay
 * triangulation via cdt2d, and filters out triangles whose centroid falls
 * inside an obstacle. Returns CdtResult with regions and per-region weights.
 *
 * For rectangular obstacles with clearance, expand the rects into polygons
 * before calling this function.
 */
declare function cdtTriangulate(input: {
    bounds: {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    };
    obstacles: Point[][];
    weightedRegions?: WeightedRegion[];
}): CdtResult;
/**
 * Expand a rectangle (center, width, height) with clearance into a polygon.
 */
declare function rectToPolygon(cx: number, cy: number, w: number, h: number, clearance: number): Point[];

/**
 * Detect crossing constraint edges, insert intersection points,
 * and split the edges so cdt2d receives a valid (non-crossing) constraint set.
 *
 * Only checks edges from different rings — edges within the same ring
 * are sequential and never cross.
 *
 * Ported from find-convex-regions resolveConstraintCrossings.
 */
declare function resolveConstraintCrossings(pts: [number, number][], constraintEdges: [number, number][], ringBoundaries: number[]): {
    pts: [number, number][];
    constraintEdges: [number, number][];
    hadCrossings: boolean;
};

/**
 * Merge adjacent convex polygons in a navigation mesh using the Polyanya
 * meshmerger algorithm (dead-end elimination + max-area priority queue).
 *
 * Produces strictly convex, larger polygons that reduce search node expansions.
 * Does not mutate the input mesh.
 */
declare function mergeMesh(mesh: Mesh): Mesh;

interface GraphSearchResult {
    path: Point[];
    cost: number;
    nodesExpanded: number;
}
/**
 * A* search on the polygon dual connectivity graph.
 * Each polygon is a node; edges connect adjacent polygons.
 * Distances are measured between polygon centroids.
 */
declare function graphSearch(mesh: Mesh, start: Point, goal: Point): GraphSearchResult;

interface VisibilityGraphOptions {
    convexityThreshold?: number;
    weightedRegions?: WeightedRegion[];
}
interface VisibilityGraphResult {
    path: Point[];
    cost: number;
    nodesExpanded: number;
    edgeCount: number;
    /** Time for this search query in ms (graph construction is precomputed) */
    buildTimeMs: number;
    edges: {
        ax: number;
        ay: number;
        bx: number;
        by: number;
    }[];
}
/**
 * Visibility graph for a navigation mesh.
 *
 * Construction is cheap — only convex (reflex) corners are extracted.
 * The expensive corner-corner adjacency is built lazily on the first search()
 * call so that switching to this algorithm incurs no upfront cost.
 *
 * Only convex (reflex) corners are included — vertices where the obstacle
 * subtends < 180°, i.e. where a shortest path might wrap around.
 * Near-flat corners are filtered by `convexityThreshold` (minimum |sin| of
 * the CW turn angle; default 0.02 ≈ 1.1°).
 *
 * When weighted regions are provided, region polygon vertices become
 * additional graph nodes (potential turning points around/through regions),
 * and edge costs are computed via segment-region intersection.
 *
 * Corner-corner adjacency is computed using goalless Polyanya expansion,
 * which uses mesh topology directly (no BVH, no K-nearest cutoff).
 */
declare class VisibilityGraph {
    private readonly mesh;
    /** Reused search instance for visibility queries */
    private readonly si;
    /** Mesh vertex indices for mesh corner nodes */
    private readonly cornerIndices;
    /** All graph node points (mesh corners + region vertices) */
    private readonly cornerPoints;
    /** How many nodes are mesh corners (the rest are region vertices) */
    private readonly numMeshCorners;
    /** Maps mesh vertex index → index in cornerIndices/cornerPoints */
    private readonly vertexToCorner;
    /** Static corner-corner adjacency — null until first search() call */
    private adj;
    private readonly weightedRegions;
    private weightedCtx;
    /** Time taken to build the static adjacency graph (ms). 0 until first search(). */
    buildTimeMs: number;
    /** Number of static corner-corner edges. 0 until first search(). */
    edgeCount: number;
    /** Static corner-corner edges for visualization. Empty until first search(). */
    edges: {
        ax: number;
        ay: number;
        bx: number;
        by: number;
    }[];
    constructor(mesh: Mesh, options?: number | VisibilityGraphOptions);
    /** Compute edge cost: weighted if context exists, otherwise Euclidean */
    private edgeCost;
    /** Check direct visibility between two points via Polyanya search */
    private isDirectlyVisible;
    /**
     * Build the static corner-corner adjacency graph.
     * Called lazily on the first search() invocation.
     */
    private _build;
    /**
     * Find the shortest path from start to goal using the precomputed graph.
     * Connects start and goal to all visible corners via Polyanya expansion,
     * checks direct start→goal visibility, then runs A*.
     */
    search(start: Point, goal: Point): VisibilityGraphResult;
}
/**
 * Convenience function: builds a VisibilityGraph and immediately runs a search.
 * For repeated queries on the same mesh, prefer constructing VisibilityGraph
 * once and calling search() directly.
 */
declare function visibilityGraphSearch(mesh: Mesh, start: Point, goal: Point): VisibilityGraphResult;

/**
 * Merge all overlapping polygons (arbitrary shapes) into non-overlapping
 * union polygons using flatten-js boolean operations.
 *
 * Takes an array of closed rings (Point[][]) and merges any that overlap.
 * Returns an array of merged rings. Falls back to original polygons on error.
 */
declare function mergeAllPolygons(polygons: Point[][]): Point[][];

/** A segment defined by two endpoints */
interface Segment {
    ax: number;
    ay: number;
    bx: number;
    by: number;
}
/** BVH node — leaf nodes store segment indices, internal nodes store children */
interface BVHNode {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    left?: BVHNode;
    right?: BVHNode;
    /** Segment indices (only on leaf nodes) */
    segments?: number[];
}

/** Precomputed structure for BVH-accelerated weighted edge cost queries */
interface WeightedEdgeContext {
    segments: Segment[];
    segmentRegionIdx: number[];
    bvh: BVHNode;
    regions: WeightedRegion[];
}
/**
 * Build a WeightedEdgeContext from weighted regions.
 * Flattens all region boundary edges into segments and builds a BVH.
 */
declare function buildWeightedEdgeContext(regions: WeightedRegion[]): WeightedEdgeContext;
/**
 * Test if a point is inside a convex polygon (CCW winding).
 * Uses half-plane test: point must be on the left side of every edge.
 */
declare function pointInConvexPolygon(p: Point, polygon: Point[]): boolean;
/**
 * Compute the weighted traversal cost of a line segment a→b.
 * Intersects the segment with all weighted region boundaries,
 * splits into sub-segments, and weights each by the region it falls in.
 */
declare function computeWeightedEdgeCost(a: Point, b: Point, ctx: WeightedEdgeContext): number;

export { type CdtResult, EPSILON, type GraphSearchResult, Mesh, type MeshBuilderInput, Orientation, type Point, type PointLocation, PointLocationType, type PolyContainment, PolyContainmentType, type Polygon, SearchInstance, type SearchNode, type StepEvent, StepEventType, type Successor, SuccessorType, type Vertex, VisibilityGraph, type VisibilityGraphOptions, type VisibilityGraphResult, type WeightedEdgeContext, type WeightedRegion, ZeroOnePos, add, buildMeshFromRegions, buildWeightedEdgeContext, cdtTriangulate, computeWeightedEdgeCost, cross, distance, distanceSq, getHValue, getOrientation, getPointOnLine, getSuccessors, graphSearch, isCollinear, lineIntersect, lineIntersectBoundCheck, lineIntersectTime, mergeAllPolygons, mergeMesh, pointInConvexPolygon, pointsEqual, rectToPolygon, reflectPoint, resolveConstraintCrossings, scale, sub, visibilityGraphSearch };
