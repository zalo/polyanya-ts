// lib/types.ts
var EPSILON = 1e-8;
var PolyContainmentType = /* @__PURE__ */ ((PolyContainmentType2) => {
  PolyContainmentType2["OUTSIDE"] = "OUTSIDE";
  PolyContainmentType2["INSIDE"] = "INSIDE";
  PolyContainmentType2["ON_EDGE"] = "ON_EDGE";
  PolyContainmentType2["ON_VERTEX"] = "ON_VERTEX";
  return PolyContainmentType2;
})(PolyContainmentType || {});
var PointLocationType = /* @__PURE__ */ ((PointLocationType2) => {
  PointLocationType2["NOT_ON_MESH"] = "NOT_ON_MESH";
  PointLocationType2["IN_POLYGON"] = "IN_POLYGON";
  PointLocationType2["ON_MESH_BORDER"] = "ON_MESH_BORDER";
  PointLocationType2["ON_EDGE"] = "ON_EDGE";
  PointLocationType2["ON_CORNER_VERTEX_AMBIG"] = "ON_CORNER_VERTEX_AMBIG";
  PointLocationType2["ON_CORNER_VERTEX_UNAMBIG"] = "ON_CORNER_VERTEX_UNAMBIG";
  PointLocationType2["ON_NON_CORNER_VERTEX"] = "ON_NON_CORNER_VERTEX";
  return PointLocationType2;
})(PointLocationType || {});
var SuccessorType = /* @__PURE__ */ ((SuccessorType2) => {
  SuccessorType2["RIGHT_NON_OBSERVABLE"] = "RIGHT_NON_OBSERVABLE";
  SuccessorType2["OBSERVABLE"] = "OBSERVABLE";
  SuccessorType2["LEFT_NON_OBSERVABLE"] = "LEFT_NON_OBSERVABLE";
  return SuccessorType2;
})(SuccessorType || {});
var Orientation = /* @__PURE__ */ ((Orientation2) => {
  Orientation2["CCW"] = "CCW";
  Orientation2["COLLINEAR"] = "COLLINEAR";
  Orientation2["CW"] = "CW";
  return Orientation2;
})(Orientation || {});
var ZeroOnePos = /* @__PURE__ */ ((ZeroOnePos2) => {
  ZeroOnePos2["LT_ZERO"] = "LT_ZERO";
  ZeroOnePos2["EQ_ZERO"] = "EQ_ZERO";
  ZeroOnePos2["IN_RANGE"] = "IN_RANGE";
  ZeroOnePos2["EQ_ONE"] = "EQ_ONE";
  ZeroOnePos2["GT_ONE"] = "GT_ONE";
  return ZeroOnePos2;
})(ZeroOnePos || {});
var StepEventType = /* @__PURE__ */ ((StepEventType2) => {
  StepEventType2["INIT"] = "INIT";
  StepEventType2["NODE_POPPED"] = "NODE_POPPED";
  StepEventType2["NODE_EXPANDED"] = "NODE_EXPANDED";
  StepEventType2["NODE_PUSHED"] = "NODE_PUSHED";
  StepEventType2["NODE_PRUNED"] = "NODE_PRUNED";
  StepEventType2["GOAL_REACHED"] = "GOAL_REACHED";
  StepEventType2["SEARCH_EXHAUSTED"] = "SEARCH_EXHAUSTED";
  return StepEventType2;
})(StepEventType || {});

// lib/geometry.ts
function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
function distance(a, b) {
  return Math.sqrt(distanceSq(a, b));
}
function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}
function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}
function scale(p, s) {
  return { x: p.x * s, y: p.y * s };
}
function pointsEqual(a, b) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}
function getOrientation(a, b, c) {
  const val = cross(sub(b, a), sub(c, b));
  if (Math.abs(val) < EPSILON) return "COLLINEAR" /* COLLINEAR */;
  return val > 0 ? "CCW" /* CCW */ : "CW" /* CW */;
}
function isCollinear(a, b, c) {
  return Math.abs(cross(sub(b, a), sub(c, b))) < EPSILON;
}
function lineIntersect(a, b, c, d) {
  const ab = sub(b, a);
  const ca = sub(c, a);
  const da = sub(d, a);
  const dc = sub(d, c);
  const t = cross(ca, da) / cross(ab, dc);
  return add(a, scale(ab, t));
}
function lineIntersectTime(a, b, c, d) {
  const ba = sub(b, a);
  const dc = sub(d, c);
  let denom = cross(ba, dc);
  if (Math.abs(denom) < EPSILON) {
    return { abNum: 1, cdNum: 1, denom: 0 };
  }
  const ac = sub(c, a);
  const da = sub(d, a);
  const bc = sub(b, c);
  const abNum = cross(ac, da);
  const cdNum = cross(ac, bc);
  return { abNum, cdNum, denom };
}
function lineIntersectBoundCheck(num, denom) {
  if (Math.abs(num) < EPSILON) return "EQ_ZERO" /* EQ_ZERO */;
  if (Math.abs(num - denom) < EPSILON) return "EQ_ONE" /* EQ_ONE */;
  if (denom > 0) {
    if (num < 0) return "LT_ZERO" /* LT_ZERO */;
    if (num > denom) return "GT_ONE" /* GT_ONE */;
  } else {
    if (num > 0) return "LT_ZERO" /* LT_ZERO */;
    if (num < denom) return "GT_ONE" /* GT_ONE */;
  }
  return "IN_RANGE" /* IN_RANGE */;
}
function getPointOnLine(a, b, t) {
  return add(a, scale(sub(b, a), t));
}
function reflectPoint(p, l, r) {
  const denom = distanceSq(r, l);
  if (Math.abs(denom) < EPSILON) {
    return { x: 2 * l.x - p.x, y: 2 * l.y - p.y };
  }
  const rp = sub(r, p);
  const lp = sub(l, p);
  const numer = cross(rp, lp);
  const deltaRotated = { x: l.y - r.y, y: r.x - l.x };
  const factor = 2 * numer / denom;
  return add(p, scale(deltaRotated, factor));
}

// lib/mesh.ts
var Mesh = class _Mesh {
  vertices = [];
  polygons = [];
  maxPolySides = 0;
  slabs = /* @__PURE__ */ new Map();
  sortedSlabKeys = [];
  islands = [];
  minX = 0;
  maxX = 0;
  minY = 0;
  maxY = 0;
  constructor() {
  }
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
  static fromString(input) {
    const mesh = new _Mesh();
    mesh.read(input);
    mesh.precalcPointLocation();
    return mesh;
  }
  /**
   * Build a Mesh directly from arrays of vertices and polygons.
   * Use this when constructing a mesh programmatically (e.g. from convex regions).
   */
  static fromData(vertices, polygons) {
    const mesh = new _Mesh();
    mesh.vertices = vertices;
    mesh.polygons = polygons;
    mesh.maxPolySides = 0;
    for (let i = 0; i < polygons.length; i++) {
      const p = polygons[i];
      if (p.vertices.length > mesh.maxPolySides) {
        mesh.maxPolySides = p.vertices.length;
      }
      if (i === 0) {
        mesh.minX = p.minX;
        mesh.minY = p.minY;
        mesh.maxX = p.maxX;
        mesh.maxY = p.maxY;
      } else {
        mesh.minX = Math.min(mesh.minX, p.minX);
        mesh.minY = Math.min(mesh.minY, p.minY);
        mesh.maxX = Math.max(mesh.maxX, p.maxX);
        mesh.maxY = Math.max(mesh.maxY, p.maxY);
      }
    }
    mesh.precalcPointLocation();
    return mesh;
  }
  read(input) {
    const tokens = input.trim().split(/\s+/);
    let idx = 0;
    const next = () => {
      const t = tokens[idx++];
      if (t === void 0) throw new Error("Unexpected end of mesh data");
      return t;
    };
    const header = next();
    if (header !== "mesh") throw new Error(`Invalid header: '${header}'`);
    const version = Number.parseInt(next());
    if (version !== 2) throw new Error(`Invalid version: ${version}`);
    const V = Number.parseInt(next());
    const P = Number.parseInt(next());
    if (V < 1) throw new Error(`Invalid vertex count: ${V}`);
    if (P < 1) throw new Error(`Invalid polygon count: ${P}`);
    this.vertices = new Array(V);
    this.polygons = new Array(P);
    for (let i = 0; i < V; i++) {
      const x = Number.parseFloat(next());
      const y = Number.parseFloat(next());
      const numNeighbors = Number.parseInt(next());
      if (numNeighbors < 2)
        throw new Error(`Invalid neighbor count at vertex ${i}: ${numNeighbors}`);
      const polys = new Array(numNeighbors);
      let isCorner = false;
      let isAmbig = false;
      for (let j = 0; j < numNeighbors; j++) {
        const polyIndex = Number.parseInt(next());
        if (polyIndex >= P)
          throw new Error(`Invalid polygon index ${polyIndex} at vertex ${i}`);
        polys[j] = polyIndex;
        if (polyIndex === -1) {
          if (isCorner) {
            isAmbig = true;
          } else {
            isCorner = true;
          }
        }
      }
      this.vertices[i] = { p: { x, y }, polygons: polys, originalPolygons: [...polys], isCorner, isAmbig };
    }
    this.maxPolySides = 0;
    for (let i = 0; i < P; i++) {
      const n = Number.parseInt(next());
      if (n < 3) throw new Error(`Invalid vertex count in polygon ${i}: ${n}`);
      if (n > this.maxPolySides) this.maxPolySides = n;
      const verts = new Array(n);
      let pMinX = 0;
      let pMinY = 0;
      let pMaxX = 0;
      let pMaxY = 0;
      for (let j = 0; j < n; j++) {
        const vi = Number.parseInt(next());
        if (vi >= V)
          throw new Error(`Invalid vertex index ${vi} in polygon ${i}`);
        verts[j] = vi;
        const vp = this.vertices[vi].p;
        if (j === 0) {
          pMinX = vp.x;
          pMinY = vp.y;
          pMaxX = vp.x;
          pMaxY = vp.y;
        } else {
          pMinX = Math.min(pMinX, vp.x);
          pMinY = Math.min(pMinY, vp.y);
          pMaxX = Math.max(pMaxX, vp.x);
          pMaxY = Math.max(pMaxY, vp.y);
        }
      }
      if (i === 0) {
        this.minX = pMinX;
        this.minY = pMinY;
        this.maxX = pMaxX;
        this.maxY = pMaxY;
      } else {
        this.minX = Math.min(this.minX, pMinX);
        this.minY = Math.min(this.minY, pMinY);
        this.maxX = Math.max(this.maxX, pMaxX);
        this.maxY = Math.max(this.maxY, pMaxY);
      }
      const adjPolys = new Array(n);
      let foundTrav = false;
      let isOneWay = true;
      for (let j = 0; j < n; j++) {
        const pi = Number.parseInt(next());
        if (pi >= P)
          throw new Error(`Invalid polygon index ${pi} in polygon ${i}`);
        adjPolys[j] = pi;
        if (pi !== -1) {
          if (foundTrav) {
            isOneWay = false;
          } else {
            foundTrav = true;
          }
        }
      }
      this.polygons[i] = {
        vertices: verts,
        polygons: adjPolys,
        isOneWay,
        minX: pMinX,
        maxX: pMaxX,
        minY: pMinY,
        maxY: pMaxY,
        weight: 1,
        penalty: 0,
        blocked: false,
        obstacleIndex: -1
      };
    }
  }
  /** Build slab-based spatial index for fast point location */
  precalcPointLocation() {
    this.slabs.clear();
    for (const v of this.vertices) {
      if (!this.slabs.has(v.p.x)) {
        this.slabs.set(v.p.x, []);
      }
    }
    for (let i = 0; i < this.polygons.length; i++) {
      const p = this.polygons[i];
      for (const [key, arr] of this.slabs) {
        if (key >= p.minX && key < p.maxX + EPSILON) {
          arr.push(i);
        }
      }
    }
    for (const [, arr] of this.slabs) {
      arr.sort((a, b) => {
        const ap = this.polygons[a];
        const bp = this.polygons[b];
        const as = ap.minY + ap.maxY;
        const bs = bp.minY + bp.maxY;
        if (as === bs) {
          return bp.maxY - bp.minY - (ap.maxY - ap.minY);
        }
        return as - bs;
      });
    }
    this.sortedSlabKeys = Array.from(this.slabs.keys()).sort((a, b) => a - b);
    this.computeIslands();
  }
  /** BFS flood-fill to assign connected component IDs to each polygon */
  computeIslands() {
    const n = this.polygons.length;
    this.islands = new Array(n).fill(-1);
    let islandId = 0;
    for (let start = 0; start < n; start++) {
      if (this.islands[start] !== -1) continue;
      const queue = [start];
      this.islands[start] = islandId;
      let head = 0;
      while (head < queue.length) {
        const polyIdx = queue[head++];
        const adj = this.polygons[polyIdx].polygons;
        for (let j = 0; j < adj.length; j++) {
          const neighbor = adj[j];
          if (neighbor !== -1 && this.islands[neighbor] === -1) {
            this.islands[neighbor] = islandId;
            queue.push(neighbor);
          }
        }
      }
      islandId++;
    }
  }
  /** Check if two polygons are on the same connected island */
  sameIsland(polyA, polyB) {
    if (polyA < 0 || polyB < 0) return false;
    return this.islands[polyA] === this.islands[polyB];
  }
  /** Test if a polygon contains a point */
  polyContainsPoint(polyIndex, p) {
    const poly = this.polygons[polyIndex];
    const outside = {
      type: "OUTSIDE" /* OUTSIDE */,
      adjacentPoly: -1,
      vertex1: -1,
      vertex2: -1
    };
    if (p.x < poly.minX - EPSILON || p.x > poly.maxX + EPSILON || p.y < poly.minY - EPSILON || p.y > poly.maxY + EPSILON) {
      return outside;
    }
    const ZERO = { x: 0, y: 0 };
    const lastVertexIdx = poly.vertices[poly.vertices.length - 1];
    let last = {
      x: this.vertices[lastVertexIdx].p.x - p.x,
      y: this.vertices[lastVertexIdx].p.y - p.y
    };
    if (pointsEqual(last, ZERO)) {
      return {
        type: "ON_VERTEX" /* ON_VERTEX */,
        adjacentPoly: -1,
        vertex1: lastVertexIdx,
        vertex2: -1
      };
    }
    let lastIndex = lastVertexIdx;
    for (let i = 0; i < poly.vertices.length; i++) {
      const pointIndex = poly.vertices[i];
      const cur = {
        x: this.vertices[pointIndex].p.x - p.x,
        y: this.vertices[pointIndex].p.y - p.y
      };
      if (pointsEqual(cur, ZERO)) {
        return {
          type: "ON_VERTEX" /* ON_VERTEX */,
          adjacentPoly: -1,
          vertex1: pointIndex,
          vertex2: -1
        };
      }
      const curA = last.x * cur.y - last.y * cur.x;
      if (Math.abs(curA) < EPSILON) {
        if (cur.x) {
          if (!(cur.x > 0 !== last.x > 0)) {
            last = cur;
            lastIndex = pointIndex;
            continue;
          }
        } else {
          if (!(cur.y > 0 !== last.y > 0)) {
            last = cur;
            lastIndex = pointIndex;
            continue;
          }
        }
        return {
          type: "ON_EDGE" /* ON_EDGE */,
          adjacentPoly: poly.polygons[i],
          vertex1: pointIndex,
          vertex2: lastIndex
        };
      }
      if (curA < 0) {
        return outside;
      }
      last = cur;
      lastIndex = pointIndex;
    }
    return {
      type: "INSIDE" /* INSIDE */,
      adjacentPoly: -1,
      vertex1: -1,
      vertex2: -1
    };
  }
  /** Find where a point is located on the mesh */
  getPointLocation(p) {
    const notOnMesh = {
      type: "NOT_ON_MESH" /* NOT_ON_MESH */,
      poly1: -1,
      poly2: -1,
      vertex1: -1,
      vertex2: -1
    };
    if (p.x < this.minX - EPSILON || p.x > this.maxX + EPSILON || p.y < this.minY - EPSILON || p.y > this.maxY + EPSILON) {
      return notOnMesh;
    }
    const target = p.x + EPSILON;
    const keys = this.sortedSlabKeys;
    let lo = 0;
    let hi = keys.length - 1;
    let slabIdx = -1;
    while (lo <= hi) {
      const mid = lo + hi >>> 1;
      if (keys[mid] <= target) {
        slabIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (slabIdx === -1) return notOnMesh;
    const slabKey = keys[slabIdx];
    const polys = this.slabs.get(slabKey);
    let closeIndex = 0;
    for (let i2 = 0; i2 < polys.length; i2++) {
      const poly = this.polygons[polys[i2]];
      if (poly.minY + poly.maxY >= p.y * 2) {
        closeIndex = i2;
        break;
      }
      closeIndex = i2;
    }
    const ps = polys.length;
    let i = closeIndex;
    let nextDelta = 1;
    let walkDelta = 0;
    while (i >= 0 && i < ps) {
      const polygon = polys[i];
      const result = this.polyContainsPoint(polygon, p);
      switch (result.type) {
        case "OUTSIDE" /* OUTSIDE */:
          break;
        case "INSIDE" /* INSIDE */:
          return {
            type: "IN_POLYGON" /* IN_POLYGON */,
            poly1: polygon,
            poly2: -1,
            vertex1: -1,
            vertex2: -1
          };
        case "ON_EDGE" /* ON_EDGE */:
          return {
            type: result.adjacentPoly === -1 ? "ON_MESH_BORDER" /* ON_MESH_BORDER */ : "ON_EDGE" /* ON_EDGE */,
            poly1: polygon,
            poly2: result.adjacentPoly,
            vertex1: result.vertex1,
            vertex2: result.vertex2
          };
        case "ON_VERTEX" /* ON_VERTEX */: {
          const v = this.vertices[result.vertex1];
          if (v.isCorner) {
            if (v.isAmbig) {
              return {
                type: "ON_CORNER_VERTEX_AMBIG" /* ON_CORNER_VERTEX_AMBIG */,
                poly1: -1,
                poly2: -1,
                vertex1: result.vertex1,
                vertex2: -1
              };
            }
            return {
              type: "ON_CORNER_VERTEX_UNAMBIG" /* ON_CORNER_VERTEX_UNAMBIG */,
              poly1: polygon,
              poly2: -1,
              vertex1: result.vertex1,
              vertex2: -1
            };
          }
          return {
            type: "ON_NON_CORNER_VERTEX" /* ON_NON_CORNER_VERTEX */,
            poly1: polygon,
            poly2: -1,
            vertex1: result.vertex1,
            vertex2: -1
          };
        }
      }
      if (walkDelta === 0) {
        const nextI = i + nextDelta * (2 * (nextDelta & 1) - 1);
        if (nextI < 0) {
          walkDelta = 1;
        } else if (nextI >= ps) {
          walkDelta = -1;
        } else {
          i = nextI;
          nextDelta++;
        }
      }
      if (walkDelta !== 0) {
        i += walkDelta;
      }
    }
    return notOnMesh;
  }
  /**
   * Set a polygon's blocked state. When blocked, the search treats it as
   * non-traversable (like a -1 adjacency) but the polygon stays in the mesh
   * so it can be unblocked later without rebuilding the CDT.
   */
  setPolygonBlocked(polyIndex, blocked) {
    if (polyIndex < 0 || polyIndex >= this.polygons.length) return;
    this.polygons[polyIndex].blocked = blocked;
  }
  /**
   * Block or unblock all polygons with a given obstacleIndex.
   * Use this to toggle obstacle occupancy per-connection:
   *   mesh.setObstacleBlocked(obstIdx, false)  // unblock for own connection
   *   // ... pathfind ...
   *   mesh.setObstacleBlocked(obstIdx, true)   // re-block
   */
  setObstacleBlocked(obstacleIdx, blocked) {
    for (let i = 0; i < this.polygons.length; i++) {
      if (this.polygons[i].obstacleIndex === obstacleIdx) {
        this.polygons[i].blocked = blocked;
      }
    }
    this.rebuildVertexAdjacency();
  }
  /** Rebuild all vertex polygon lists and corner flags based on current
   *  polygon blocked states. Called after setObstacleBlocked. */
  rebuildVertexAdjacency() {
    for (const v of this.vertices) {
      for (let i = 0; i < v.originalPolygons.length; i++) {
        const pi = v.originalPolygons[i];
        v.polygons[i] = pi >= 0 && this.polygons[pi]?.blocked ? -1 : pi;
      }
      let isCorner = false;
      let isAmbig = false;
      for (const pi of v.polygons) {
        if (pi === -1) {
          if (isCorner) isAmbig = true;
          else isCorner = true;
        }
      }
      v.isCorner = isCorner;
      v.isAmbig = isAmbig;
    }
    this.precalcPointLocation();
  }
  /**
   * Get all unique obstacle indices present in the mesh.
   * Returns indices of obstacles whose polygons are in the mesh
   * (obstacleIndex >= 0). Useful for discovering which obstacles
   * can be toggled.
   */
  getObstacleIndices() {
    const set = /* @__PURE__ */ new Set();
    for (const p of this.polygons) {
      if (p.obstacleIndex >= 0) set.add(p.obstacleIndex);
    }
    return Array.from(set).sort((a, b) => a - b);
  }
  /** Brute-force point location (for testing/validation) */
  getPointLocationNaive(p) {
    const notOnMesh = {
      type: "NOT_ON_MESH" /* NOT_ON_MESH */,
      poly1: -1,
      poly2: -1,
      vertex1: -1,
      vertex2: -1
    };
    for (let polygon = 0; polygon < this.polygons.length; polygon++) {
      const result = this.polyContainsPoint(polygon, p);
      switch (result.type) {
        case "OUTSIDE" /* OUTSIDE */:
          break;
        case "INSIDE" /* INSIDE */:
          return {
            type: "IN_POLYGON" /* IN_POLYGON */,
            poly1: polygon,
            poly2: -1,
            vertex1: -1,
            vertex2: -1
          };
        case "ON_EDGE" /* ON_EDGE */:
          return {
            type: result.adjacentPoly === -1 ? "ON_MESH_BORDER" /* ON_MESH_BORDER */ : "ON_EDGE" /* ON_EDGE */,
            poly1: polygon,
            poly2: result.adjacentPoly,
            vertex1: result.vertex1,
            vertex2: result.vertex2
          };
        case "ON_VERTEX" /* ON_VERTEX */: {
          const v = this.vertices[result.vertex1];
          if (v.isCorner) {
            if (v.isAmbig) {
              return {
                type: "ON_CORNER_VERTEX_AMBIG" /* ON_CORNER_VERTEX_AMBIG */,
                poly1: -1,
                poly2: -1,
                vertex1: result.vertex1,
                vertex2: -1
              };
            }
            return {
              type: "ON_CORNER_VERTEX_UNAMBIG" /* ON_CORNER_VERTEX_UNAMBIG */,
              poly1: polygon,
              poly2: -1,
              vertex1: result.vertex1,
              vertex2: -1
            };
          }
          return {
            type: "ON_NON_CORNER_VERTEX" /* ON_NON_CORNER_VERTEX */,
            poly1: polygon,
            poly2: -1,
            vertex1: result.vertex1,
            vertex2: -1
          };
        }
      }
    }
    return notOnMesh;
  }
};

// lib/expansion.ts
function getHValue(root, goal, l, r) {
  if (pointsEqual(root, l) || pointsEqual(root, r)) {
    return distance(root, goal);
  }
  const lr = sub(r, l);
  const lroot = sub(root, l);
  let lgoal = sub(goal, l);
  let currentGoal = goal;
  if (cross(lroot, lr) > 0 === cross(lgoal, lr) > 0) {
    currentGoal = reflectPoint(goal, l, r);
    lgoal = sub(currentGoal, l);
  }
  const denom = cross(sub(currentGoal, root), lr);
  if (Math.abs(denom) < EPSILON) {
    const rootL = distanceSq(root, l);
    const rootR = distanceSq(root, r);
    if (rootL < rootR) {
      return Math.sqrt(rootL) + distance(l, currentGoal);
    }
    return Math.sqrt(rootR) + distance(r, currentGoal);
  }
  const lrNum = cross(lgoal, lroot);
  const lrPos = lineIntersectBoundCheck(lrNum, denom);
  switch (lrPos) {
    case "LT_ZERO" /* LT_ZERO */:
      return distance(root, l) + distance(l, currentGoal);
    case "EQ_ZERO" /* EQ_ZERO */:
    case "IN_RANGE" /* IN_RANGE */:
    case "EQ_ONE" /* EQ_ONE */:
      return distance(root, currentGoal);
    case "GT_ONE" /* GT_ONE */:
      return distance(root, r) + distance(r, currentGoal);
  }
}
function binarySearch(arr, N, objects, lower, upper, pred, isUpperBound) {
  const normalise = (index) => index >= N ? index - N : index;
  if (lower === upper) return lower;
  let bestSoFar = -1;
  let lo = lower;
  let hi = upper;
  while (lo <= hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const obj = objects[arr[normalise(mid)]];
    if (!obj) {
      lo = mid + 1;
      continue;
    }
    const matchesPred = pred(obj);
    if (matchesPred) {
      bestSoFar = mid;
    }
    if (matchesPred === isUpperBound) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return bestSoFar;
}
function getSuccessors(node, start, mesh) {
  const polygon = mesh.polygons[node.nextPolygon];
  const V = polygon.vertices;
  const N = V.length;
  const root = node.root === -1 ? start : mesh.vertices[node.root].p;
  const successors = [];
  const normalise = (index) => index >= N ? index - N : index;
  const rootL = sub(node.left, root);
  const rootR = sub(node.right, root);
  const rootEqL = Math.abs(rootL.x) < EPSILON && Math.abs(rootL.y) < EPSILON;
  const rootEqR = Math.abs(rootR.x) < EPSILON && Math.abs(rootR.y) < EPSILON;
  if (rootEqL || rootEqR || isCollinear(root, node.right, node.left)) {
    let succType;
    if (rootEqL || !rootEqR && (Math.abs(rootL.x - rootR.x) < EPSILON ? Math.abs(rootL.y) < Math.abs(rootR.y) : Math.abs(rootL.x) < Math.abs(rootR.x))) {
      if (!mesh.vertices[node.leftVertex].isCorner) return [];
      succType = "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */;
    } else {
      if (!mesh.vertices[node.rightVertex].isCorner) return [];
      succType = "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */;
    }
    let lastVertex = V[V.length - 1];
    for (let i = 0; i < N; i++) {
      const thisVertex = V[i];
      if (thisVertex === node.rightVertex) {
        lastVertex = thisVertex;
        continue;
      }
      successors.push({
        type: succType,
        left: mesh.vertices[thisVertex].p,
        right: mesh.vertices[lastVertex].p,
        polyLeftInd: i
      });
      lastVertex = thisVertex;
    }
    return successors;
  }
  if (N === 3) {
    return getTriangleSuccessors(node, root, mesh, V);
  }
  try {
    return getGeneralSuccessors(node, root, mesh, V, N);
  } catch {
    return [];
  }
}
function getTriangleSuccessors(node, root, mesh, V) {
  const successors = [];
  let p1;
  let p2;
  let t2;
  const t1 = mesh.vertices[node.rightVertex].p;
  if (V[0] === node.rightVertex) {
    p1 = 1;
    p2 = 2;
    t2 = mesh.vertices[V[1]].p;
  } else if (V[0] === node.leftVertex) {
    p1 = 2;
    p2 = 0;
    t2 = mesh.vertices[V[2]].p;
  } else {
    p1 = 0;
    p2 = 1;
    t2 = mesh.vertices[V[0]].p;
  }
  const t3 = mesh.vertices[node.leftVertex].p;
  const L = node.left;
  const R = node.right;
  const orient = getOrientation(root, L, t2);
  if (orient === "CCW" /* CCW */) {
    const LI2 = lineIntersect(t1, t2, root, L);
    const RI2 = pointsEqual(R, t1) ? t1 : lineIntersect(t1, t2, root, R);
    successors.push({
      type: "OBSERVABLE" /* OBSERVABLE */,
      left: LI2,
      right: RI2,
      polyLeftInd: p1
    });
    if (mesh.vertices[node.leftVertex].isCorner && pointsEqual(L, t3)) {
      successors.push({
        type: "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */,
        left: t2,
        right: LI2,
        polyLeftInd: p1
      });
      successors.push({
        type: "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */,
        left: t3,
        right: t2,
        polyLeftInd: p2
      });
    }
    return successors;
  }
  if (orient === "COLLINEAR" /* COLLINEAR */) {
    const RI2 = pointsEqual(R, t1) ? t1 : lineIntersect(t1, t2, root, R);
    successors.push({
      type: "OBSERVABLE" /* OBSERVABLE */,
      left: t2,
      right: RI2,
      polyLeftInd: p1
    });
    if (mesh.vertices[node.leftVertex].isCorner && pointsEqual(L, t3)) {
      successors.push({
        type: "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */,
        left: t3,
        right: t2,
        polyLeftInd: p2
      });
    }
    return successors;
  }
  const LI = pointsEqual(L, t3) ? t3 : lineIntersect(t2, t3, root, L);
  const orientR = getOrientation(root, R, t2);
  if (orientR === "CW" /* CW */) {
    const RI2 = lineIntersect(t2, t3, root, R);
    if (mesh.vertices[node.rightVertex].isCorner && pointsEqual(R, t1)) {
      successors.push({
        type: "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */,
        left: t2,
        right: t1,
        polyLeftInd: p1
      });
      successors.push({
        type: "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */,
        left: RI2,
        right: t2,
        polyLeftInd: p2
      });
      successors.push({
        type: "OBSERVABLE" /* OBSERVABLE */,
        left: LI,
        right: RI2,
        polyLeftInd: p2
      });
      return successors;
    }
    successors.push({
      type: "OBSERVABLE" /* OBSERVABLE */,
      left: LI,
      right: RI2,
      polyLeftInd: p2
    });
    return successors;
  }
  if (orientR === "COLLINEAR" /* COLLINEAR */) {
    if (mesh.vertices[node.rightVertex].isCorner && pointsEqual(R, t1)) {
      successors.push({
        type: "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */,
        left: t2,
        right: t1,
        polyLeftInd: p1
      });
      successors.push({
        type: "OBSERVABLE" /* OBSERVABLE */,
        left: LI,
        right: t2,
        polyLeftInd: p2
      });
      return successors;
    }
    successors.push({
      type: "OBSERVABLE" /* OBSERVABLE */,
      left: LI,
      right: t2,
      polyLeftInd: p2
    });
    return successors;
  }
  const RI = pointsEqual(R, t1) ? t1 : lineIntersect(t1, t2, root, R);
  successors.push({
    type: "OBSERVABLE" /* OBSERVABLE */,
    left: t2,
    right: RI,
    polyLeftInd: p1
  });
  successors.push({
    type: "OBSERVABLE" /* OBSERVABLE */,
    left: LI,
    right: t2,
    polyLeftInd: p2
  });
  return successors;
}
function getGeneralSuccessors(node, root, mesh, V, N) {
  const successors = [];
  const normalise = (index) => {
    let i = index % N;
    if (i < 0) i += N;
    return i;
  };
  const index2point = (index) => {
    const vi = V[index];
    if (vi === void 0) {
      throw new Error(
        `index2point: V[${index}] is undefined (N=${N}, V.length=${V.length})`
      );
    }
    return mesh.vertices[vi].p;
  };
  let rightInd = 0;
  while (rightInd < N && V[rightInd] !== node.rightVertex) {
    rightInd++;
  }
  if (rightInd >= N) {
    return [];
  }
  const leftInd = N + rightInd - 1;
  const rightVertexObj = mesh.vertices[node.rightVertex];
  const leftVertexObj = mesh.vertices[V[normalise(leftInd)]];
  const rightP = rightVertexObj.p;
  const leftP = leftVertexObj.p;
  const rightLiesVertex = pointsEqual(rightP, node.right);
  const leftLiesVertex = pointsEqual(leftP, node.left);
  const rootRight = sub(node.right, root);
  const A = (() => {
    if (rightLiesVertex) {
      const nextP = index2point(normalise(rightInd + 1));
      if (cross(rootRight, sub(nextP, node.right)) > -EPSILON) {
        return rightInd + 1;
      }
    }
    return binarySearch(
      V,
      N,
      mesh.vertices,
      rightInd + 1,
      leftInd,
      (v) => cross(rootRight, sub(v.p, node.right)) > EPSILON,
      false
    );
  })();
  const normA = normalise(A);
  const normAm1 = normalise(A - 1);
  const Ap = index2point(normA);
  const Am1p = index2point(normAm1);
  const rightIntersect = rightLiesVertex && A === rightInd + 1 ? node.right : lineIntersect(Ap, Am1p, root, node.right);
  const rootLeft = sub(node.left, root);
  const B = (() => {
    if (leftLiesVertex) {
      const prevP = index2point(normalise(leftInd - 1));
      if (cross(rootLeft, sub(prevP, node.left)) < EPSILON) {
        return leftInd - 1;
      }
    }
    return binarySearch(
      V,
      N,
      mesh.vertices,
      A - 1,
      leftInd - 1,
      (v) => cross(rootLeft, sub(v.p, node.left)) < -EPSILON,
      true
    );
  })();
  const normB = normalise(B);
  const normBp1 = normalise(B + 1);
  const Bp = index2point(normB);
  const Bp1p = index2point(normBp1);
  const leftIntersect = leftLiesVertex && B === leftInd - 1 ? node.left : lineIntersect(Bp, Bp1p, root, node.left);
  if (rightLiesVertex && rightVertexObj.isCorner) {
    let lastI = rightInd;
    let curI = normalise(rightInd + 1);
    while (lastI !== normAm1) {
      successors.push({
        type: "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */,
        left: index2point(curI),
        right: index2point(lastI),
        polyLeftInd: curI
      });
      lastI = curI;
      curI = curI + 1 >= N ? 0 : curI + 1;
    }
    if (!pointsEqual(rightIntersect, Am1p)) {
      successors.push({
        type: "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */,
        left: rightIntersect,
        right: Am1p,
        polyLeftInd: normA
      });
    }
  }
  if (A === B + 2) {
  } else if (A === B + 1) {
    successors.push({
      type: "OBSERVABLE" /* OBSERVABLE */,
      left: leftIntersect,
      right: rightIntersect,
      polyLeftInd: normA
    });
  } else {
    successors.push({
      type: "OBSERVABLE" /* OBSERVABLE */,
      left: Ap,
      right: rightIntersect,
      polyLeftInd: normA
    });
    let lastI = normA;
    let curI = normalise(A + 1);
    while (lastI !== normB) {
      successors.push({
        type: "OBSERVABLE" /* OBSERVABLE */,
        left: index2point(curI),
        right: index2point(lastI),
        polyLeftInd: curI
      });
      lastI = curI;
      curI = curI + 1 >= N ? 0 : curI + 1;
    }
    successors.push({
      type: "OBSERVABLE" /* OBSERVABLE */,
      left: leftIntersect,
      right: Bp,
      polyLeftInd: normBp1
    });
  }
  if (leftLiesVertex && leftVertexObj.isCorner) {
    if (!pointsEqual(leftIntersect, Bp1p)) {
      successors.push({
        type: "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */,
        left: Bp1p,
        right: leftIntersect,
        polyLeftInd: normBp1
      });
    }
    let lastI = normBp1;
    let curI = normalise(B + 2);
    const normLeftInd = normalise(leftInd);
    while (lastI !== normLeftInd) {
      successors.push({
        type: "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */,
        left: index2point(curI),
        right: index2point(lastI),
        polyLeftInd: curI
      });
      lastI = curI;
      curI = curI + 1 >= N ? 0 : curI + 1;
    }
  }
  return successors;
}

// lib/search.ts
var MinHeap = class {
  data = [];
  get size() {
    return this.data.length;
  }
  push(node) {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }
  pop() {
    if (this.data.length === 0) return void 0;
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }
  peek() {
    return this.data[0];
  }
  clear() {
    this.data = [];
  }
  toArray() {
    return [...this.data];
  }
  bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.compare(i, parent) < 0) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }
  sinkDown(i) {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.compare(left, smallest) < 0) smallest = left;
      if (right < n && this.compare(right, smallest) < 0) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }
  compare(i, j) {
    const a = this.data[i];
    const b = this.data[j];
    if (a.f === b.f) {
      return b.g - a.g;
    }
    return a.f - b.f;
  }
  swap(i, j) {
    const tmp = this.data[i];
    this.data[i] = this.data[j];
    this.data[j] = tmp;
  }
};
var SearchInstance = class {
  mesh;
  start = { x: 0, y: 0 };
  goal = { x: 0, y: 0 };
  finalNode = null;
  startPolygon = -1;
  endPolygon = -1;
  openList = new MinHeap();
  rootGValues = [];
  rootSearchIds = [];
  searchId = 0;
  // Statistics
  nodesGenerated = 0;
  nodesPushed = 0;
  nodesPopped = 0;
  nodesPrunedPostPop = 0;
  successorCalls = 0;
  verbose = false;
  goalless = false;
  // Step-through support
  stepEvents = [];
  stepMode = false;
  constructor(mesh) {
    this.mesh = mesh;
    this.rootGValues = new Array(mesh.vertices.length).fill(0);
    this.rootSearchIds = new Array(mesh.vertices.length).fill(0);
  }
  /** Set start and goal points for the next search */
  setStartGoal(start, goal) {
    this.start = start;
    this.goal = goal;
    this.finalNode = null;
  }
  resolvePointLocation(p) {
    let out = this.mesh.getPointLocation(p);
    if (out.type === "ON_CORNER_VERTEX_AMBIG" /* ON_CORNER_VERTEX_AMBIG */) {
      const corrected = { x: p.x + EPSILON * 10, y: p.y + EPSILON * 10 };
      const correctedLoc = this.mesh.getPointLocation(corrected);
      switch (correctedLoc.type) {
        case "IN_POLYGON" /* IN_POLYGON */:
        case "ON_MESH_BORDER" /* ON_MESH_BORDER */:
        case "ON_EDGE" /* ON_EDGE */:
          out = { ...out, poly1: correctedLoc.poly1 };
          break;
        default:
          break;
      }
    }
    return out;
  }
  setEndPolygon() {
    this.endPolygon = this.resolvePointLocation(this.goal).poly1;
  }
  /** Convert successors to search nodes with root-level pruning */
  succToNode(parent, successors) {
    const polygon = this.mesh.polygons[parent.nextPolygon];
    const V = polygon.vertices;
    const P = polygon.polygons;
    let rightG = -1;
    let leftG = -1;
    const nodes = [];
    for (const succ of successors) {
      const nextPolygon = P[succ.polyLeftInd];
      if (nextPolygon === -1 || nextPolygon >= 0 && this.mesh.polygons[nextPolygon].blocked) {
        if (this.goalless && (succ.type === "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */ || succ.type === "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */)) {
          const pRoot = parent.root === -1 ? this.start : this.mesh.vertices[parent.root].p;
          const recordCorner = (vertIdx, g) => {
            if (vertIdx === -1) return;
            if (this.rootSearchIds[vertIdx] !== this.searchId) {
              this.rootSearchIds[vertIdx] = this.searchId;
              this.rootGValues[vertIdx] = g;
            } else if (this.rootGValues[vertIdx] + EPSILON >= g) {
              this.rootGValues[vertIdx] = g;
            }
          };
          if (succ.type === "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */) {
            if (rightG === -1) rightG = parent.g + distance(pRoot, parent.right);
            recordCorner(parent.rightVertex, rightG);
          } else {
            if (leftG === -1) leftG = parent.g + distance(pRoot, parent.left);
            recordCorner(parent.leftVertex, leftG);
          }
        }
        continue;
      }
      if (!this.goalless && this.mesh.polygons[nextPolygon].isOneWay && nextPolygon !== this.endPolygon) {
        continue;
      }
      const leftVertex = V[succ.polyLeftInd];
      const rightVertex = succ.polyLeftInd > 0 ? V[succ.polyLeftInd - 1] : V[V.length - 1];
      const parentRoot = parent.root === -1 ? this.start : this.mesh.vertices[parent.root].p;
      const pushNode = (root, g) => {
        if (root !== -1) {
          if (this.rootSearchIds[root] !== this.searchId) {
            this.rootSearchIds[root] = this.searchId;
            this.rootGValues[root] = g;
          } else {
            if (this.rootGValues[root] + EPSILON < g) {
              return;
            }
            this.rootGValues[root] = g;
          }
        }
        nodes.push({
          parent: null,
          root,
          left: succ.left,
          right: succ.right,
          leftVertex,
          rightVertex,
          nextPolygon,
          f: g,
          g
        });
      };
      switch (succ.type) {
        case "RIGHT_NON_OBSERVABLE" /* RIGHT_NON_OBSERVABLE */:
          if (rightG === -1) {
            rightG = parent.g + distance(parentRoot, parent.right);
          }
          pushNode(parent.rightVertex, rightG);
          break;
        case "OBSERVABLE" /* OBSERVABLE */:
          pushNode(parent.root, parent.g);
          break;
        case "LEFT_NON_OBSERVABLE" /* LEFT_NON_OBSERVABLE */:
          if (leftG === -1) {
            leftG = parent.g + distance(parentRoot, parent.left);
          }
          pushNode(parent.leftVertex, leftG);
          break;
      }
    }
    return nodes;
  }
  /** Generate initial search nodes from the start point */
  genInitialNodes() {
    const pl = this.resolvePointLocation(this.start);
    const h = distance(this.start, this.goal);
    const makeLazy = (nextPoly, leftV, rightV) => ({
      parent: null,
      root: -1,
      left: this.start,
      right: this.start,
      leftVertex: leftV,
      rightVertex: rightV,
      nextPolygon: nextPoly,
      f: h,
      g: 0
    });
    const pushLazy = (lazy) => {
      const poly = lazy.nextPolygon;
      if (poly === -1) return;
      if (poly === this.endPolygon) {
        this.finalNode = lazy;
        return;
      }
      const vertices = this.mesh.polygons[poly].vertices;
      const tempSuccessors = [];
      let lastVertex = vertices[vertices.length - 1];
      for (let i = 0; i < vertices.length; i++) {
        const vertex = vertices[i];
        if (vertex === lazy.rightVertex || lastVertex === lazy.leftVertex) {
          lastVertex = vertex;
          continue;
        }
        tempSuccessors.push({
          type: "OBSERVABLE" /* OBSERVABLE */,
          left: this.mesh.vertices[vertex].p,
          right: this.mesh.vertices[lastVertex].p,
          polyLeftInd: i
        });
        lastVertex = vertex;
      }
      const nodes = this.succToNode(lazy, tempSuccessors);
      for (const n of nodes) {
        const nRoot = n.root === -1 ? this.start : this.mesh.vertices[n.root].p;
        if (!this.goalless) n.f += getHValue(nRoot, this.goal, n.left, n.right);
        n.parent = lazy;
        if (this.stepMode) {
          this.stepEvents.push({
            type: "NODE_PUSHED" /* NODE_PUSHED */,
            node: { ...n },
            nodesInOpenList: this.openList.size + 1
          });
        }
        this.openList.push(n);
      }
      this.nodesGenerated += nodes.length;
      this.nodesPushed += nodes.length;
    };
    switch (pl.type) {
      case "NOT_ON_MESH" /* NOT_ON_MESH */:
        break;
      case "ON_CORNER_VERTEX_AMBIG" /* ON_CORNER_VERTEX_AMBIG */: {
        if (this.goalless && pl.vertex1 !== -1) {
          for (const poly of this.mesh.vertices[pl.vertex1].polygons) {
            const lazy = makeLazy(poly, pl.vertex1, pl.vertex1);
            pushLazy(lazy);
            this.nodesGenerated++;
          }
        } else if (pl.poly1 !== -1) {
          const lazy = makeLazy(pl.poly1, -1, -1);
          pushLazy(lazy);
          this.nodesGenerated++;
        }
        break;
      }
      case "ON_CORNER_VERTEX_UNAMBIG" /* ON_CORNER_VERTEX_UNAMBIG */: {
        if (this.goalless) {
          for (const poly of this.mesh.vertices[pl.vertex1].polygons) {
            const lazy = makeLazy(poly, pl.vertex1, pl.vertex1);
            pushLazy(lazy);
            this.nodesGenerated++;
          }
        } else {
          const lazy = makeLazy(pl.poly1, -1, -1);
          pushLazy(lazy);
          this.nodesGenerated++;
        }
        break;
      }
      case "IN_POLYGON" /* IN_POLYGON */:
      case "ON_MESH_BORDER" /* ON_MESH_BORDER */: {
        const lazy = makeLazy(pl.poly1, -1, -1);
        pushLazy(lazy);
        this.nodesGenerated++;
        break;
      }
      case "ON_EDGE" /* ON_EDGE */: {
        const lazy1 = makeLazy(pl.poly2, pl.vertex1, pl.vertex2);
        const lazy2 = makeLazy(pl.poly1, pl.vertex2, pl.vertex1);
        pushLazy(lazy1);
        this.nodesGenerated++;
        if (this.finalNode) return;
        pushLazy(lazy2);
        this.nodesGenerated++;
        break;
      }
      case "ON_NON_CORNER_VERTEX" /* ON_NON_CORNER_VERTEX */: {
        for (const poly of this.mesh.vertices[pl.vertex1].polygons) {
          const lazy = makeLazy(poly, pl.vertex1, pl.vertex1);
          pushLazy(lazy);
          this.nodesGenerated++;
          if (this.finalNode) return;
        }
        break;
      }
    }
  }
  initSearch() {
    this.searchId++;
    this.openList.clear();
    this.finalNode = null;
    this.nodesGenerated = 0;
    this.nodesPushed = 0;
    this.nodesPopped = 0;
    this.nodesPrunedPostPop = 0;
    this.successorCalls = 0;
    this.stepEvents = [];
    this.setEndPolygon();
    this.startPolygon = this.resolvePointLocation(this.start).poly1;
    if (!this.mesh.sameIsland(this.startPolygon, this.endPolygon)) return;
    this.genInitialNodes();
  }
  /** Maximum search time in milliseconds (0 = unlimited) */
  timeLimitMs = 3e3;
  /**
   * Run the full Polyanya search.
   * Returns true if a path was found, false otherwise.
   */
  search() {
    this.stepMode = false;
    this.initSearch();
    if (this.endPolygon === -1) return false;
    if (this.finalNode !== null) return true;
    return this.runSearchLoop();
  }
  /**
   * Start a stepping search. Call `step()` repeatedly to advance.
   * Returns the initial step events.
   */
  searchInit() {
    this.stepMode = true;
    this.initSearch();
    const events = [
      {
        type: "INIT" /* INIT */,
        nodesInOpenList: this.openList.size,
        message: `Initialized search from (${this.start.x}, ${this.start.y}) to (${this.goal.x}, ${this.goal.y}). End polygon: ${this.endPolygon}`
      }
    ];
    if (this.endPolygon === -1) {
      events.push({
        type: "SEARCH_EXHAUSTED" /* SEARCH_EXHAUSTED */,
        message: "Goal is not on the mesh"
      });
    } else if (!this.mesh.sameIsland(this.startPolygon, this.endPolygon)) {
      events.push({
        type: "SEARCH_EXHAUSTED" /* SEARCH_EXHAUSTED */,
        message: "Start and goal are on different islands"
      });
    } else if (this.finalNode !== null) {
      events.push({
        type: "GOAL_REACHED" /* GOAL_REACHED */,
        node: { ...this.finalNode },
        message: "Trivial path: start can see goal directly"
      });
    }
    events.push(...this.stepEvents);
    this.stepEvents = [];
    return events;
  }
  /**
   * Execute one step of the search algorithm.
   * Returns an array of events that occurred during this step.
   */
  step() {
    this.stepMode = true;
    this.stepEvents = [];
    if (this.finalNode !== null) {
      return [
        {
          type: "GOAL_REACHED" /* GOAL_REACHED */,
          node: { ...this.finalNode },
          message: "Path already found"
        }
      ];
    }
    if (this.openList.size === 0) {
      return [
        {
          type: "SEARCH_EXHAUSTED" /* SEARCH_EXHAUSTED */,
          message: "Open list is empty \u2014 no path exists"
        }
      ];
    }
    const node = this.openList.pop();
    this.nodesPopped++;
    this.stepEvents.push({
      type: "NODE_POPPED" /* NODE_POPPED */,
      node: { ...node },
      nodesInOpenList: this.openList.size,
      message: `Popped node: root=${node.root}, f=${node.f.toFixed(4)}, g=${node.g.toFixed(4)}, poly=${node.nextPolygon}`
    });
    if (node.nextPolygon === this.endPolygon) {
      const finalNode = this.createFinalNode(node);
      this.finalNode = finalNode;
      this.nodesGenerated++;
      this.stepEvents.push({
        type: "GOAL_REACHED" /* GOAL_REACHED */,
        node: { ...finalNode },
        message: "Goal polygon reached!"
      });
      return this.stepEvents;
    }
    if (node.root !== -1) {
      if (this.rootSearchIds[node.root] === this.searchId) {
        if (this.rootGValues[node.root] + EPSILON < node.g) {
          this.nodesPrunedPostPop++;
          this.stepEvents.push({
            type: "NODE_PRUNED" /* NODE_PRUNED */,
            node: { ...node },
            message: `Pruned: root ${node.root} already reached with better g (${this.rootGValues[node.root].toFixed(4)} < ${node.g.toFixed(4)})`
          });
          return this.stepEvents;
        }
      }
    }
    this.expandAndPush(node);
    return this.stepEvents;
  }
  /** Check if the search is complete (either found or exhausted) */
  isSearchComplete() {
    return this.finalNode !== null || this.openList.size === 0;
  }
  /** Get all nodes currently in the open list (for visualization) */
  getOpenListNodes() {
    return this.openList.toArray();
  }
  createFinalNode(node) {
    const root = node.root === -1 ? this.start : this.mesh.vertices[node.root].p;
    const rootGoal = sub(this.goal, root);
    let finalRoot;
    if (cross(rootGoal, sub(node.left, root)) < -EPSILON) {
      finalRoot = node.leftVertex;
    } else if (cross(sub(node.right, root), rootGoal) < -EPSILON) {
      finalRoot = node.rightVertex;
    } else {
      finalRoot = node.root;
    }
    let finalCost;
    if (finalRoot === node.root) {
      finalCost = node.g + distance(root, this.goal);
    } else {
      const corner = this.mesh.vertices[finalRoot].p;
      finalCost = node.g + distance(root, corner) + distance(corner, this.goal);
    }
    return {
      parent: node,
      root: finalRoot,
      left: this.goal,
      right: this.goal,
      leftVertex: -1,
      rightVertex: -1,
      nextPolygon: this.endPolygon,
      f: finalCost,
      g: finalCost
    };
  }
  expandAndPush(node) {
    let numNodes = 1;
    let currentNodes = [{ ...node }];
    let currentParent = node;
    let collapseLimit = this.mesh.polygons.length + 2;
    do {
      const curNode = currentNodes[0];
      if (curNode.nextPolygon === this.endPolygon) break;
      if (this.goalless && curNode.root !== -1) break;
      const succs = getSuccessors(curNode, this.start, this.mesh);
      this.successorCalls++;
      if (this.stepMode) {
        this.stepEvents.push({
          type: "NODE_EXPANDED" /* NODE_EXPANDED */,
          node: { ...curNode },
          successors: [...succs],
          message: `Expanded in polygon ${curNode.nextPolygon}: ${succs.length} successor(s)`
        });
      }
      currentNodes = this.succToNode(curNode, succs);
      numNodes = currentNodes.length;
      if (numNodes === 1) {
        if (curNode.g !== currentNodes[0].g) {
          currentNodes[0].parent = currentParent;
          currentParent = { ...currentNodes[0] };
          this.nodesGenerated++;
        }
      }
      collapseLimit--;
      if (collapseLimit <= 0) break;
    } while (numNodes === 1);
    for (let i = 0; i < numNodes; i++) {
      const curNode = currentNodes[i];
      if (this.goalless && curNode.root !== -1) continue;
      const n = { ...curNode };
      if (curNode.parent) {
      } else {
        n.parent = currentParent;
      }
      const nRoot = n.root === -1 ? this.start : this.mesh.vertices[n.root].p;
      if (!this.goalless) n.f += getHValue(nRoot, this.goal, n.left, n.right);
      if (this.stepMode) {
        this.stepEvents.push({
          type: "NODE_PUSHED" /* NODE_PUSHED */,
          node: { ...n },
          nodesInOpenList: this.openList.size + 1
        });
      }
      this.openList.push(n);
    }
    this.nodesGenerated += numNodes;
    this.nodesPushed += numNodes;
  }
  runSearchLoop() {
    const deadline = this.timeLimitMs > 0 ? performance.now() + this.timeLimitMs : Infinity;
    while (this.openList.size > 0) {
      if (this.nodesPopped % 1e3 === 0 && performance.now() > deadline) {
        return false;
      }
      const node = this.openList.pop();
      this.nodesPopped++;
      if (node.nextPolygon === this.endPolygon) {
        this.finalNode = this.createFinalNode(node);
        this.nodesGenerated++;
        return true;
      }
      if (node.root !== -1) {
        if (this.rootSearchIds[node.root] === this.searchId) {
          if (this.rootGValues[node.root] + EPSILON < node.g) {
            this.nodesPrunedPostPop++;
            continue;
          }
        }
      }
      this.expandAndPush(node);
    }
    return false;
  }
  /** Get the path cost, or -1 if no path found */
  getCost() {
    if (this.finalNode === null) return -1;
    return this.finalNode.f;
  }
  /** Get the path as an array of waypoints from start to goal */
  getPathPoints() {
    if (this.finalNode === null) return [];
    const out = [this.goal];
    let curNode = this.finalNode;
    while (curNode !== null) {
      const rootPoint = curNode.root === -1 ? this.start : this.mesh.vertices[curNode.root].p;
      if (!pointsEqual(rootPoint, out[out.length - 1])) {
        out.push(rootPoint);
      }
      curNode = curNode.parent;
    }
    out.reverse();
    return out;
  }
  /**
   * Run a goalless Polyanya expansion from `from`.
   * Returns a map from vertex index → straight-line distance for every
   * corner vertex that is directly visible (no detour) from `from`.
   *
   * A corner v is directly visible iff g(v) ≈ distance(from, v): the
   * Polyanya g-value equals the Euclidean distance when no intermediate
   * turning point is needed.
   */
  computeVisibleCornersFromPoint(from) {
    const savedStart = this.start;
    const savedGoal = this.goal;
    const savedEndPolygon = this.endPolygon;
    this.start = from;
    this.goal = from;
    this.endPolygon = -2;
    this.goalless = true;
    this.searchId++;
    this.openList.clear();
    this.finalNode = null;
    this.nodesGenerated = 0;
    this.nodesPushed = 0;
    this.nodesPopped = 0;
    this.nodesPrunedPostPop = 0;
    this.successorCalls = 0;
    this.stepEvents = [];
    this.startPolygon = this.resolvePointLocation(from).poly1;
    if (this.startPolygon >= 0) {
      this.genInitialNodes();
      while (this.openList.size > 0) {
        const node = this.openList.pop();
        this.nodesPopped++;
        if (node.root !== -1 && this.rootSearchIds[node.root] === this.searchId && this.rootGValues[node.root] + EPSILON < node.g) {
          this.nodesPrunedPostPop++;
          continue;
        }
        this.expandAndPush(node);
      }
    }
    this.start = savedStart;
    this.goal = savedGoal;
    this.endPolygon = savedEndPolygon;
    this.goalless = false;
    const result = /* @__PURE__ */ new Map();
    for (let i = 0; i < this.mesh.vertices.length; i++) {
      if (this.rootSearchIds[i] !== this.searchId) continue;
      const v = this.mesh.vertices[i];
      if (!v.isCorner) continue;
      const g = this.rootGValues[i];
      const d = distance(from, v.p);
      if (g > d + 1e-4) continue;
      result.set(i, d);
    }
    const pl = this.resolvePointLocation(from);
    if (pl.vertex1 >= 0) {
      for (const polyIdx of this.mesh.vertices[pl.vertex1].polygons) {
        if (polyIdx < 0) continue;
        for (const vIdx of this.mesh.polygons[polyIdx].vertices) {
          if (vIdx === pl.vertex1) continue;
          const v = this.mesh.vertices[vIdx];
          if (!v.isCorner) continue;
          const d = distance(from, v.p);
          if (!result.has(vIdx) || result.get(vIdx) > d) {
            result.set(vIdx, d);
          }
        }
      }
    }
    return result;
  }
  /**
   * Get the full search tree (all nodes from final back to start).
   * Useful for visualization.
   */
  getSearchTree() {
    if (this.finalNode === null) return [];
    const tree = [];
    let curNode = this.finalNode;
    while (curNode !== null) {
      tree.push(curNode);
      curNode = curNode.parent;
    }
    return tree;
  }
};

// lib/mesh-builder.ts
function buildMeshFromRegions(input) {
  const { regions } = input;
  const SNAP_DIGITS = 4;
  const vertexMap = /* @__PURE__ */ new Map();
  const vertices = [];
  const getVertexIndex = (p) => {
    const sx = p.x.toFixed(SNAP_DIGITS);
    const sy = p.y.toFixed(SNAP_DIGITS);
    const key = `${sx},${sy}`;
    const existing = vertexMap.get(key);
    if (existing !== void 0) return existing;
    const idx = vertices.length;
    vertices.push({ x: p.x, y: p.y });
    vertexMap.set(key, idx);
    return idx;
  };
  const regionIndices = regions.map(
    (region) => region.map((p) => getVertexIndex(p))
  );
  const edgeToPolys = /* @__PURE__ */ new Map();
  const edgeKey = (a, b) => {
    return a < b ? `${a},${b}` : `${b},${a}`;
  };
  for (let pi = 0; pi < regionIndices.length; pi++) {
    const verts = regionIndices[pi];
    for (let j = 0; j < verts.length; j++) {
      const a = verts[j];
      const b = verts[(j + 1) % verts.length];
      const key = edgeKey(a, b);
      if (!edgeToPolys.has(key)) {
        edgeToPolys.set(key, []);
      }
      edgeToPolys.get(key).push(pi);
    }
  }
  const polygons = regionIndices.map((verts, pi) => {
    const adjPolys = new Array(verts.length);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j < verts.length; j++) {
      const a = verts[j];
      const b = verts[(j + 1) % verts.length];
      const key = edgeKey(a, b);
      const neighbors = edgeToPolys.get(key);
      const adjIdx = (j + 1) % verts.length;
      adjPolys[adjIdx] = neighbors.length === 2 ? neighbors[0] === pi ? neighbors[1] : neighbors[0] : -1;
      const vp = vertices[a];
      minX = Math.min(minX, vp.x);
      maxX = Math.max(maxX, vp.x);
      minY = Math.min(minY, vp.y);
      maxY = Math.max(maxY, vp.y);
    }
    let foundTrav = false;
    let isOneWay = true;
    for (const adj of adjPolys) {
      if (adj !== -1) {
        if (foundTrav) isOneWay = false;
        else foundTrav = true;
      }
    }
    const rw = input.regionWeights?.[pi];
    return {
      vertices: verts,
      polygons: adjPolys,
      isOneWay,
      minX,
      maxX,
      minY,
      maxY,
      weight: rw?.weight ?? 1,
      penalty: rw?.penalty ?? 0,
      blocked: (input.regionObstacleIndices?.[pi] ?? -1) >= 0,
      obstacleIndex: input.regionObstacleIndices?.[pi] ?? -1
    };
  });
  const vertexPolygons = new Array(vertices.length).fill(null).map(() => []);
  for (let pi = 0; pi < polygons.length; pi++) {
    for (const vi of polygons[pi].vertices) {
      vertexPolygons[vi].push(pi);
    }
  }
  const meshVertices = vertices.map((v, vi) => {
    const polys = vertexPolygons[vi];
    polys.sort((a, b) => {
      const polyA = polygons[a];
      const polyB = polygons[b];
      const centerA = polygonCenter(polyA, vertices);
      const centerB = polygonCenter(polyB, vertices);
      const angleA = Math.atan2(centerA.y - v.y, centerA.x - v.x);
      const angleB = Math.atan2(centerB.y - v.y, centerB.x - v.x);
      return angleA - angleB;
    });
    let isCorner = false;
    let isAmbig = false;
    for (let pi of polys) {
      const poly = polygons[pi];
      const idx = poly.vertices.indexOf(vi);
      if (idx === -1) continue;
      const prevEdgeAdj = poly.polygons[(idx + poly.vertices.length - 1) % poly.vertices.length];
      const nextEdgeAdj = poly.polygons[idx];
      const prevIsBoundary = prevEdgeAdj === -1 || prevEdgeAdj >= 0 && polygons[prevEdgeAdj].blocked;
      const nextIsBoundary = nextEdgeAdj === -1 || nextEdgeAdj >= 0 && polygons[nextEdgeAdj].blocked;
      if (prevIsBoundary || nextIsBoundary) {
        if (isCorner) isAmbig = true;
        else isCorner = true;
      }
    }
    const originalPolys = [...polys];
    const effectivePolys = polys.map(
      (pi) => polygons[pi].blocked ? -1 : pi
    );
    return {
      p: { x: v.x, y: v.y },
      polygons: effectivePolys,
      originalPolygons: originalPolys,
      isCorner,
      isAmbig
    };
  });
  return Mesh.fromData(meshVertices, polygons);
}
function polygonCenter(poly, vertices) {
  let cx = 0;
  let cy = 0;
  for (const vi of poly.vertices) {
    cx += vertices[vi].x;
    cy += vertices[vi].y;
  }
  return { x: cx / poly.vertices.length, y: cy / poly.vertices.length };
}

// lib/cdt-builder.ts
import cdt2d from "cdt2d";

// lib/resolve-constraint-crossings.ts
function resolveConstraintCrossings(pts, constraintEdges, ringBoundaries) {
  const edgeRing = new Array(constraintEdges.length);
  for (let ei = 0; ei < constraintEdges.length; ei++) {
    for (let ri = ringBoundaries.length - 1; ri >= 0; ri--) {
      if (ei >= ringBoundaries[ri]) {
        edgeRing[ei] = ri;
        break;
      }
    }
  }
  const edgeSplits = /* @__PURE__ */ new Map();
  const outPts = pts.slice();
  for (let i = 0; i < constraintEdges.length; i++) {
    for (let j = i + 1; j < constraintEdges.length; j++) {
      if (edgeRing[i] === edgeRing[j]) continue;
      const [a1, a2] = constraintEdges[i];
      const [b1, b2] = constraintEdges[j];
      const p1 = outPts[a1];
      const p2 = outPts[a2];
      const p3 = outPts[b1];
      const p4 = outPts[b2];
      const d1x = p2[0] - p1[0];
      const d1y = p2[1] - p1[1];
      const d2x = p4[0] - p3[0];
      const d2y = p4[1] - p3[1];
      const denom = d1x * d2y - d1y * d2x;
      if (Math.abs(denom) < 1e-10) {
        const len1sq = d1x * d1x + d1y * d1y;
        if (len1sq < 1e-20) continue;
        const len2sq = d2x * d2x + d2y * d2y;
        if (len2sq < 1e-20) continue;
        const perpDist = Math.abs((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / Math.sqrt(len1sq);
        if (perpDist > 1e-6) continue;
        const t3 = ((p3[0] - p1[0]) * d1x + (p3[1] - p1[1]) * d1y) / len1sq;
        const t4 = ((p4[0] - p1[0]) * d1x + (p4[1] - p1[1]) * d1y) / len1sq;
        const u1 = ((p1[0] - p3[0]) * d2x + (p1[1] - p3[1]) * d2y) / len2sq;
        const u2 = ((p2[0] - p3[0]) * d2x + (p2[1] - p3[1]) * d2y) / len2sq;
        const EPS = 1e-6;
        if (t3 > EPS && t3 < 1 - EPS) {
          if (!edgeSplits.has(i)) edgeSplits.set(i, []);
          edgeSplits.get(i).push({ t: t3, idx: b1 });
        }
        if (t4 > EPS && t4 < 1 - EPS) {
          if (!edgeSplits.has(i)) edgeSplits.set(i, []);
          edgeSplits.get(i).push({ t: t4, idx: b2 });
        }
        if (u1 > EPS && u1 < 1 - EPS) {
          if (!edgeSplits.has(j)) edgeSplits.set(j, []);
          edgeSplits.get(j).push({ t: u1, idx: a1 });
        }
        if (u2 > EPS && u2 < 1 - EPS) {
          if (!edgeSplits.has(j)) edgeSplits.set(j, []);
          edgeSplits.get(j).push({ t: u2, idx: a2 });
        }
        continue;
      }
      const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
      const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
        const ix = p1[0] + t * d1x;
        const iy = p1[1] + t * d1y;
        const newIdx = outPts.length;
        outPts.push([ix, iy]);
        if (!edgeSplits.has(i)) edgeSplits.set(i, []);
        edgeSplits.get(i).push({ t, idx: newIdx });
        if (!edgeSplits.has(j)) edgeSplits.set(j, []);
        edgeSplits.get(j).push({ t: u, idx: newIdx });
      }
    }
  }
  if (edgeSplits.size === 0) {
    return { pts, constraintEdges, hadCrossings: false };
  }
  const outEdges = [];
  for (let ei = 0; ei < constraintEdges.length; ei++) {
    const splits = edgeSplits.get(ei);
    if (!splits || splits.length === 0) {
      outEdges.push(constraintEdges[ei]);
      continue;
    }
    splits.sort((a, b) => a.t - b.t);
    const [startIdx, endIdx] = constraintEdges[ei];
    let prev = startIdx;
    for (const split of splits) {
      outEdges.push([prev, split.idx]);
      prev = split.idx;
    }
    outEdges.push([prev, endIdx]);
  }
  return { pts: outPts, constraintEdges: outEdges, hadCrossings: true };
}

// lib/cdt-builder.ts
function cdtTriangulate(input) {
  const { bounds, obstacles, weightedRegions } = input;
  const { minX, maxX, minY, maxY } = bounds;
  const pts = [];
  const edges = [];
  const ringBoundaries = [];
  ringBoundaries.push(edges.length);
  const edgeSamples = 10;
  const boundsStart = pts.length;
  pts.push([minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]);
  for (let i = 1; i < edgeSamples; i++) {
    const t = i / edgeSamples;
    pts.push([minX + t * (maxX - minX), minY]);
    pts.push([maxX, minY + t * (maxY - minY)]);
    pts.push([maxX - t * (maxX - minX), maxY]);
    pts.push([minX, maxY - t * (maxY - minY)]);
  }
  const boundsEnd = pts.length;
  const boundsEdgePoints = [[], [], [], []];
  boundsEdgePoints[0].push(boundsStart);
  boundsEdgePoints[1].push(boundsStart + 1);
  boundsEdgePoints[2].push(boundsStart + 2);
  boundsEdgePoints[3].push(boundsStart + 3);
  for (let i = 1; i < edgeSamples; i++) {
    const base = boundsStart + 4 + (i - 1) * 4;
    boundsEdgePoints[0].push(base);
    boundsEdgePoints[1].push(base + 1);
    boundsEdgePoints[2].push(base + 2);
    boundsEdgePoints[3].push(base + 3);
  }
  boundsEdgePoints[0].push(boundsStart + 1);
  boundsEdgePoints[1].push(boundsStart + 2);
  boundsEdgePoints[2].push(boundsStart + 3);
  boundsEdgePoints[3].push(boundsStart);
  for (const side of boundsEdgePoints) {
    for (let i = 0; i < side.length - 1; i++) {
      edges.push([side[i], side[i + 1]]);
    }
  }
  const resolvedObstacles = [];
  for (const obstacle of obstacles) {
    if (obstacle.length < 3) continue;
    const deduped = [];
    for (let i = 0; i < obstacle.length; i++) {
      const p = obstacle[i];
      const prev = deduped.length > 0 ? deduped[deduped.length - 1] : null;
      if (!prev || Math.abs(p.x - prev.x) > 1e-9 || Math.abs(p.y - prev.y) > 1e-9) {
        deduped.push(p);
      }
    }
    if (deduped.length > 1) {
      const first = deduped[0];
      const last = deduped[deduped.length - 1];
      if (Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) {
        deduped.pop();
      }
    }
    if (deduped.length < 3) continue;
    ringBoundaries.push(edges.length);
    const ringStart = pts.length;
    const resolvedObs = [];
    for (let i = 0; i < deduped.length; i++) {
      const p = deduped[i];
      pts.push([p.x, p.y]);
      resolvedObs.push(p);
    }
    resolvedObstacles.push(resolvedObs);
    for (let i = 0; i < deduped.length; i++) {
      edges.push([ringStart + i, ringStart + (i + 1) % deduped.length]);
    }
  }
  const wrPolygons = mergeWeightedRegions(
    (weightedRegions ?? []).filter((wr) => wr.weight !== 1 || wr.penalty !== 0)
  );
  for (const wr of wrPolygons) {
    if (wr.polygon.length < 3) continue;
    for (let i = 0; i < wr.polygon.length; i++) {
      const p = wr.polygon[i];
      pts.push([p.x, p.y]);
    }
  }
  const resolved = resolveConstraintCrossings(pts, edges, ringBoundaries);
  const rPts = resolved.pts;
  let allTriangles;
  let freeTriangles;
  try {
    allTriangles = cdt2d(rPts, resolved.constraintEdges, { interior: true, exterior: true });
    freeTriangles = cdt2d(rPts, resolved.constraintEdges, { interior: true, exterior: false });
  } catch {
    const jitteredPts = rPts.map((p, i) => {
      if (i < boundsEnd) return p;
      return [
        p[0] + (Math.random() - 0.5) * 1e-5,
        p[1] + (Math.random() - 0.5) * 1e-5
      ];
    });
    try {
      allTriangles = cdt2d(jitteredPts, resolved.constraintEdges, { interior: true, exterior: true });
      freeTriangles = cdt2d(jitteredPts, resolved.constraintEdges, { interior: true, exterior: false });
      for (let i = 0; i < jitteredPts.length; i++) {
        resolved.pts[i] = jitteredPts[i];
      }
    } catch {
      return { regions: [], regionWeights: [], regionObstacleIndices: [] };
    }
  }
  const freeSet = /* @__PURE__ */ new Set();
  for (const [a, b, c] of freeTriangles) {
    const sorted = [a, b, c].sort((x, y) => x - y);
    freeSet.add(`${sorted[0]},${sorted[1]},${sorted[2]}`);
  }
  const regions = [];
  const regionWeights = [];
  const regionObstacleIndices = [];
  const EPS_BOUNDS = 1e-4;
  for (let ti = 0; ti < allTriangles.length; ti++) {
    const [a, b, c] = allTriangles[ti];
    const pa = { x: rPts[a][0], y: rPts[a][1] };
    const pb = { x: rPts[b][0], y: rPts[b][1] };
    const pc = { x: rPts[c][0], y: rPts[c][1] };
    const cx = (pa.x + pb.x + pc.x) / 3;
    const cy = (pa.y + pb.y + pc.y) / 3;
    if (cx < minX - EPS_BOUNDS || cx > maxX + EPS_BOUNDS || cy < minY - EPS_BOUNDS || cy > maxY + EPS_BOUNDS) continue;
    const cross2 = (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x);
    regions.push(cross2 >= 0 ? [pa, pb, pc] : [pa, pc, pb]);
    const sorted = [a, b, c].sort((x, y) => x - y);
    const key = `${sorted[0]},${sorted[1]},${sorted[2]}`;
    const cdtSaysFree = freeSet.has(key);
    let obstIdx = getObstacleIndex(cx, cy, resolvedObstacles);
    if (cdtSaysFree && obstIdx === -1) {
      obstIdx = -1;
    } else if (obstIdx === -1 && !cdtSaysFree) {
      const INSET = 0.3;
      const samples = [
        {
          x: (pa.x + pb.x) / 2 * (1 - INSET) + cx * INSET,
          y: (pa.y + pb.y) / 2 * (1 - INSET) + cy * INSET
        },
        {
          x: (pb.x + pc.x) / 2 * (1 - INSET) + cx * INSET,
          y: (pb.y + pc.y) / 2 * (1 - INSET) + cy * INSET
        },
        {
          x: (pc.x + pa.x) / 2 * (1 - INSET) + cx * INSET,
          y: (pc.y + pa.y) / 2 * (1 - INSET) + cy * INSET
        }
      ];
      for (const sp of samples) {
        obstIdx = getObstacleIndex(sp.x, sp.y, resolvedObstacles);
        if (obstIdx >= 0) break;
      }
      if (obstIdx === -1) obstIdx = 0;
    }
    regionObstacleIndices.push(obstIdx);
    let rw = { weight: 1, penalty: 0 };
    if (obstIdx === -1) {
      for (const wr of wrPolygons) {
        if (pointInPolygon(cx, cy, wr.polygon)) {
          rw = { weight: wr.weight, penalty: wr.penalty };
          break;
        }
      }
    }
    regionWeights.push(rw);
  }
  return { regions, regionWeights, regionObstacleIndices };
}
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (pi.y > py !== pj.y > py && px < (pj.x - pi.x) * (py - pi.y) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}
function getObstacleIndex(px, py, obstacles) {
  for (let i = 0; i < obstacles.length; i++) {
    if (pointInPolygon(px, py, obstacles[i])) return i;
  }
  return -1;
}
function mergeWeightedRegions(regions) {
  if (regions.length <= 1) return regions;
  const groups = /* @__PURE__ */ new Map();
  for (const wr of regions) {
    const key = `${wr.weight}:${wr.penalty}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
    for (const p of wr.polygon) {
      if (p.x < rMinX) rMinX = p.x;
      if (p.y < rMinY) rMinY = p.y;
      if (p.x > rMaxX) rMaxX = p.x;
      if (p.y > rMaxY) rMaxY = p.y;
    }
    group.push({ minX: rMinX, minY: rMinY, maxX: rMaxX, maxY: rMaxY, weight: wr.weight, penalty: wr.penalty });
  }
  const result = [];
  for (const [, rects] of groups) {
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          if (a.maxX + 1e-6 >= b.minX && b.maxX + 1e-6 >= a.minX && a.maxY + 1e-6 >= b.minY && b.maxY + 1e-6 >= a.minY) {
            a.minX = Math.min(a.minX, b.minX);
            a.minY = Math.min(a.minY, b.minY);
            a.maxX = Math.max(a.maxX, b.maxX);
            a.maxY = Math.max(a.maxY, b.maxY);
            rects.splice(j, 1);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }
    for (const r of rects) {
      result.push({
        polygon: [
          { x: r.minX, y: r.minY },
          { x: r.maxX, y: r.minY },
          { x: r.maxX, y: r.maxY },
          { x: r.minX, y: r.maxY }
        ],
        weight: r.weight,
        penalty: r.penalty
      });
    }
  }
  return result;
}
function rectToPolygon(cx, cy, w, h, clearance) {
  const hw = w / 2 + clearance;
  const hh = h / 2 + clearance;
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh }
  ];
}

// lib/mesh-merger.ts
function mergeMesh(mesh) {
  const n = mesh.polygons.length;
  const verts = new Array(n);
  const nb = new Array(n);
  const dead = new Array(n).fill(false);
  const area = new Array(n);
  const weights = new Array(n);
  const penalties = new Array(n);
  const polyBlocked = new Array(n);
  const polyObstIdx = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = mesh.polygons[i];
    verts[i] = p.vertices.slice();
    nb[i] = p.polygons.slice();
    area[i] = polyArea(p.vertices, mesh);
    weights[i] = p.weight;
    penalties[i] = p.penalty;
    polyBlocked[i] = p.blocked;
    polyObstIdx[i] = p.obstacleIndex;
  }
  const ufParent = new Array(n);
  const ufRank = new Array(n).fill(0);
  for (let i = 0; i < n; i++) ufParent[i] = i;
  function find(x) {
    while (ufParent[x] !== x) {
      ufParent[x] = ufParent[ufParent[x]];
      x = ufParent[x];
    }
    return x;
  }
  function union(a, b) {
    a = find(a);
    b = find(b);
    if (a === b) return;
    if (ufRank[a] < ufRank[b]) {
      const t = a;
      a = b;
      b = t;
    }
    ufParent[b] = a;
    if (ufRank[a] === ufRank[b]) ufRank[a]++;
  }
  function unionForce(alive, deadIdx) {
    alive = find(alive);
    deadIdx = find(deadIdx);
    if (alive === deadIdx) return;
    ufParent[deadIdx] = alive;
    if (ufRank[alive] <= ufRank[deadIdx]) ufRank[alive] = ufRank[deadIdx] + 1;
  }
  function resolve(idx) {
    return idx === -1 ? -1 : find(idx);
  }
  function resolveAll(idx) {
    const a = nb[idx];
    for (let j = 0; j < a.length; j++) {
      if (a[j] !== -1) a[j] = resolve(a[j]);
    }
  }
  function findBoundary(xIdx, edgeK, yIdx) {
    const xN = nb[xIdx];
    const L = xN.length;
    let firstK = edgeK;
    while (true) {
      const prev = (firstK - 1 + L) % L;
      if (prev === edgeK) break;
      if (resolve(xN[prev]) !== yIdx) break;
      firstK = prev;
    }
    let lastK = edgeK;
    while (true) {
      const next = (lastK + 1) % L;
      if (next === firstK) break;
      if (resolve(xN[next]) !== yIdx) break;
      lastK = next;
    }
    return { firstK, lastK };
  }
  function canMerge(xIdx, edgeK) {
    const xV = verts[xIdx];
    const xN = nb[xIdx];
    const yRaw = xN[edgeK];
    if (yRaw === -1) return false;
    const yIdx = resolve(yRaw);
    if (yIdx === -1 || yIdx === xIdx || dead[yIdx]) return false;
    if (weights[xIdx] !== weights[yIdx] || penalties[xIdx] !== penalties[yIdx]) return false;
    if (polyObstIdx[xIdx] !== polyObstIdx[yIdx]) return false;
    const yV = verts[yIdx];
    const N = xV.length;
    const M = yV.length;
    const { firstK, lastK } = findBoundary(xIdx, edgeK, yIdx);
    const A = xV[(firstK - 1 + N) % N];
    const B = xV[lastK];
    let mA = -1;
    for (let i = 0; i < M; i++) {
      if (yV[i] === A) {
        mA = i;
        break;
      }
    }
    if (mA === -1) return false;
    const sharedEdges = (lastK - firstK + N) % N + 1;
    const mB = (mA - sharedEdges + M) % M;
    if (yV[mB] !== B) return false;
    const prevX = mesh.vertices[xV[(firstK - 2 + N) % N]].p;
    const pA = mesh.vertices[A].p;
    const nextY = mesh.vertices[yV[(mA + 1) % M]].p;
    if (cross(sub(pA, prevX), sub(nextY, pA)) < -1e-8) return false;
    const prevY = mesh.vertices[yV[(mB - 1 + M) % M]].p;
    const pB = mesh.vertices[B].p;
    const nextX = mesh.vertices[xV[(lastK + 1) % N]].p;
    if (cross(sub(pB, prevY), sub(nextX, pB)) < -1e-8) return false;
    return true;
  }
  function doMerge(xIdx, edgeK, yIdx) {
    const xV = verts[xIdx];
    const xN = nb[xIdx];
    const yV = verts[yIdx];
    const yN = nb[yIdx];
    const N = xV.length;
    const M = yV.length;
    const { firstK, lastK } = findBoundary(xIdx, edgeK, yIdx);
    const sharedEdges = (lastK - firstK + N) % N + 1;
    const A = xV[(firstK - 1 + N) % N];
    const B = xV[lastK];
    let mA = -1;
    for (let i = 0; i < M; i++) {
      if (yV[i] === A) {
        mA = i;
        break;
      }
    }
    const mB = (mA - sharedEdges + M) % M;
    const newVerts = [];
    const newNb = [];
    newVerts.push(A);
    newNb.push(xN[(firstK - 1 + N) % N]);
    const yNonShared = M - sharedEdges - 1;
    for (let j = 1; j <= yNonShared; j++) {
      const yi = (mA + j) % M;
      newVerts.push(yV[yi]);
      newNb.push(yN[yi]);
    }
    newVerts.push(B);
    newNb.push(yN[mB]);
    const xNonShared = N - sharedEdges - 1;
    for (let j = 1; j <= xNonShared; j++) {
      const xi = (lastK + j) % N;
      newVerts.push(xV[xi]);
      newNb.push(xN[xi]);
    }
    verts[xIdx] = newVerts;
    nb[xIdx] = newNb;
    dead[yIdx] = true;
    unionForce(xIdx, yIdx);
    resolveAll(xIdx);
    area[xIdx] = polyArea(newVerts, mesh);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (dead[i]) continue;
      resolveAll(i);
      const nn = nb[i];
      let travCount = 0, travEdge = -1;
      for (let k = 0; k < nn.length; k++) {
        if (nn[k] !== -1 && nn[k] !== i) {
          travCount++;
          travEdge = k;
        }
      }
      if (travCount === 1 && travEdge !== -1 && canMerge(i, travEdge)) {
        doMerge(i, travEdge, resolve(nn[travEdge]));
        changed = true;
      }
    }
  }
  const bestArea = new Array(n).fill(-1);
  function computeBest(idx) {
    if (dead[idx]) return { area: -1, edge: -1 };
    resolveAll(idx);
    const nn = nb[idx];
    let best = -1, bestEdge = -1;
    const seen = /* @__PURE__ */ new Set();
    for (let k = 0; k < nn.length; k++) {
      const r = nn[k];
      if (r === -1 || r === idx || seen.has(r)) continue;
      seen.add(r);
      if (!canMerge(idx, k)) continue;
      const combined = area[idx] + area[r];
      if (combined > best) {
        best = combined;
        bestEdge = k;
      }
    }
    return { area: best, edge: bestEdge };
  }
  const heap = [];
  function heapPush(e) {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = i - 1 >> 1;
      if (heap[p].area >= heap[i].area) break;
      const t = heap[p];
      heap[p] = heap[i];
      heap[i] = t;
      i = p;
    }
  }
  function heapPop() {
    if (heap.length === 0) return void 0;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let big = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && heap[l].area > heap[big].area) big = l;
        if (r < heap.length && heap[r].area > heap[big].area) big = r;
        if (big === i) break;
        const t = heap[i];
        heap[i] = heap[big];
        heap[big] = t;
        i = big;
      }
    }
    return top;
  }
  for (let i = 0; i < n; i++) {
    if (dead[i]) continue;
    const { area: a } = computeBest(i);
    bestArea[i] = a;
    if (a > 0) heapPush({ area: a, polyIndex: i });
  }
  while (heap.length > 0) {
    const entry = heapPop();
    const idx = find(entry.polyIndex);
    if (dead[idx] || entry.area !== bestArea[idx]) continue;
    const { area: a, edge } = computeBest(idx);
    if (a <= 0 || edge === -1) {
      bestArea[idx] = -1;
      continue;
    }
    if (Math.abs(a - entry.area) > 1e-10) {
      bestArea[idx] = a;
      heapPush({ area: a, polyIndex: idx });
      continue;
    }
    const yIdx = resolve(nb[idx][edge]);
    if (yIdx === -1 || dead[yIdx]) {
      bestArea[idx] = -1;
      continue;
    }
    doMerge(idx, edge, yIdx);
    const { area: newA } = computeBest(idx);
    bestArea[idx] = newA;
    if (newA > 0) heapPush({ area: newA, polyIndex: idx });
    const seen = /* @__PURE__ */ new Set();
    for (let k = 0; k < nb[idx].length; k++) {
      const nIdx = resolve(nb[idx][k]);
      if (nIdx === -1 || nIdx === idx || dead[nIdx] || seen.has(nIdx)) continue;
      seen.add(nIdx);
      const { area: na } = computeBest(nIdx);
      bestArea[nIdx] = na;
      if (na > 0) heapPush({ area: na, polyIndex: nIdx });
    }
  }
  for (let i = 0; i < n; i++) {
    if (dead[i]) continue;
    const a = nb[i];
    for (let j = 0; j < a.length; j++) {
      if (a[j] !== -1) {
        const r = find(a[j]);
        a[j] = dead[r] ? -1 : r;
      }
    }
  }
  return rebuildMesh(mesh, verts, nb, dead, weights, penalties, polyBlocked, polyObstIdx);
}
function polyArea(vertexIndices, mesh) {
  let a = 0;
  const len = vertexIndices.length;
  for (let i = 0; i < len; i++) {
    const p = mesh.vertices[vertexIndices[i]].p;
    const q = mesh.vertices[vertexIndices[(i + 1) % len]].p;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
function rebuildMesh(original, verts, neighbors, dead, weights, penalties, blockedArr, obstIdxArr) {
  const aliveIndices = [];
  const oldToNew = new Array(verts.length).fill(-1);
  for (let i = 0; i < verts.length; i++) {
    if (!dead[i]) {
      oldToNew[i] = aliveIndices.length;
      aliveIndices.push(i);
    }
  }
  const usedVerts = /* @__PURE__ */ new Set();
  for (const oldIdx of aliveIndices) {
    for (const vi of verts[oldIdx]) usedVerts.add(vi);
  }
  const sortedUsedVerts = Array.from(usedVerts).sort((a, b) => a - b);
  const vertOldToNew = /* @__PURE__ */ new Map();
  for (let i = 0; i < sortedUsedVerts.length; i++) {
    vertOldToNew.set(sortedUsedVerts[i], i);
  }
  const polygons = aliveIndices.map((oldIdx) => {
    const polyVerts = verts[oldIdx].map((vi) => vertOldToNew.get(vi));
    const polyNeigh = neighbors[oldIdx].map(
      (ni) => ni === -1 ? -1 : oldToNew[ni] ?? -1
    );
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const vi of verts[oldIdx]) {
      const p = original.vertices[vi].p;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    let foundTrav = false, isOneWay = true;
    for (const adj of polyNeigh) {
      if (adj !== -1) {
        if (foundTrav) isOneWay = false;
        else foundTrav = true;
      }
    }
    return { vertices: polyVerts, polygons: polyNeigh, isOneWay, minX, maxX, minY, maxY, weight: weights[oldIdx], penalty: penalties[oldIdx], blocked: blockedArr[oldIdx], obstacleIndex: obstIdxArr[oldIdx] };
  });
  const vertexPolygons = new Array(sortedUsedVerts.length).fill(null).map(() => []);
  for (let pi = 0; pi < polygons.length; pi++) {
    for (const vi of polygons[pi].vertices) vertexPolygons[vi].push(pi);
  }
  const vertices = sortedUsedVerts.map((oldVi, newVi) => {
    const v = original.vertices[oldVi];
    const polys = vertexPolygons[newVi];
    polys.sort((a, b) => {
      const cA = polyCenter(polygons[a], sortedUsedVerts, original);
      const cB = polyCenter(polygons[b], sortedUsedVerts, original);
      return Math.atan2(cA.y - v.p.y, cA.x - v.p.x) - Math.atan2(cB.y - v.p.y, cB.x - v.p.x);
    });
    let isCorner = false, isAmbig = false;
    for (const pi of polys) {
      const poly = polygons[pi];
      const idx = poly.vertices.indexOf(newVi);
      if (idx === -1) continue;
      const N = poly.vertices.length;
      const enterAdj = poly.polygons[idx];
      const leaveAdj = poly.polygons[(idx + 1) % N];
      const enterBlocked = enterAdj === -1 || enterAdj >= 0 && polygons[enterAdj].blocked;
      const leaveBlocked = leaveAdj === -1 || leaveAdj >= 0 && polygons[leaveAdj].blocked;
      if (enterBlocked || leaveBlocked) {
        if (isCorner) isAmbig = true;
        else isCorner = true;
      }
    }
    const originalPolys = [...polys];
    const effectivePolys = polys.map((pi) => polygons[pi].blocked ? -1 : pi);
    return { p: { x: v.p.x, y: v.p.y }, polygons: effectivePolys, originalPolygons: originalPolys, isCorner, isAmbig };
  });
  return Mesh.fromData(vertices, polygons);
}
function polyCenter(poly, sortedUsedVerts, original) {
  let cx = 0, cy = 0;
  for (const vi of poly.vertices) {
    const p = original.vertices[sortedUsedVerts[vi]].p;
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / poly.vertices.length, y: cy / poly.vertices.length };
}

// lib/graph-search.ts
function centroid(mesh, polyIndex) {
  const verts = mesh.polygons[polyIndex].vertices;
  let cx = 0, cy = 0;
  for (const vi of verts) {
    const p = mesh.vertices[vi].p;
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / verts.length, y: cy / verts.length };
}
function graphSearch(mesh, start, goal) {
  const empty = { path: [], cost: -1, nodesExpanded: 0 };
  const startLoc = mesh.getPointLocation(start);
  const goalLoc = mesh.getPointLocation(goal);
  if (startLoc.poly1 < 0 || goalLoc.poly1 < 0) return empty;
  if (!mesh.sameIsland(startLoc.poly1, goalLoc.poly1)) return empty;
  const startPoly = startLoc.poly1;
  const goalPoly = goalLoc.poly1;
  if (startPoly === goalPoly) {
    const d = distance(start, goal);
    return { path: [start, goal], cost: d, nodesExpanded: 0 };
  }
  const centroids = new Array(mesh.polygons.length);
  for (let i = 0; i < mesh.polygons.length; i++) {
    centroids[i] = centroid(mesh, i);
  }
  const goalCentroid = centroids[goalPoly];
  const heap = [];
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const pi = i - 1 >> 1;
      if (heap[pi].f <= heap[i].f) break;
      const tmp = heap[pi];
      heap[pi] = heap[i];
      heap[i] = tmp;
      i = pi;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let s = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && heap[l].f < heap[s].f) s = l;
        if (r < heap.length && heap[r].f < heap[s].f) s = r;
        if (s === i) break;
        const tmp = heap[i];
        heap[i] = heap[s];
        heap[s] = tmp;
        i = s;
      }
    }
    return top;
  };
  const gBest = new Float64Array(mesh.polygons.length).fill(Infinity);
  const cameFrom = new Int32Array(mesh.polygons.length).fill(-1);
  const startG = distance(start, centroids[startPoly]);
  gBest[startPoly] = startG;
  push({
    poly: startPoly,
    g: startG,
    f: startG + distance(centroids[startPoly], goalCentroid)
  });
  let nodesExpanded = 0;
  while (heap.length > 0) {
    const cur = pop();
    if (cur.g > gBest[cur.poly]) continue;
    if (cur.poly === goalPoly) {
      const polyPath = [goalPoly];
      let p = goalPoly;
      while (cameFrom[p] !== -1) {
        p = cameFrom[p];
        polyPath.push(p);
      }
      polyPath.reverse();
      const path = [start];
      for (const pi of polyPath) {
        path.push(centroids[pi]);
      }
      path.push(goal);
      const totalCost = cur.g + distance(centroids[goalPoly], goal);
      return { path, cost: totalCost, nodesExpanded };
    }
    nodesExpanded++;
    const poly = mesh.polygons[cur.poly];
    const seen = /* @__PURE__ */ new Set();
    for (const adj of poly.polygons) {
      if (adj === -1 || seen.has(adj)) continue;
      seen.add(adj);
      const adjPoly = mesh.polygons[adj];
      const ng = cur.g + distance(centroids[cur.poly], centroids[adj]) * adjPoly.weight + adjPoly.penalty;
      if (ng < gBest[adj]) {
        gBest[adj] = ng;
        cameFrom[adj] = cur.poly;
        push({ poly: adj, g: ng, f: ng + distance(centroids[adj], goalCentroid) });
      }
    }
  }
  return empty;
}

// lib/bvh.ts
var MAX_LEAF_SIZE = 8;
function buildSegmentBVH(segments) {
  const indices = new Array(segments.length);
  for (let i = 0; i < segments.length; i++) indices[i] = i;
  return buildNode(segments, indices, 0, segments.length);
}
function buildNode(segments, indices, start, end) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = start; i < end; i++) {
    const s = segments[indices[i]];
    minX = Math.min(minX, s.ax, s.bx);
    minY = Math.min(minY, s.ay, s.by);
    maxX = Math.max(maxX, s.ax, s.bx);
    maxY = Math.max(maxY, s.ay, s.by);
  }
  const count = end - start;
  if (count <= MAX_LEAF_SIZE) {
    const segs = new Array(count);
    for (let i = 0; i < count; i++) segs[i] = indices[start + i];
    return { minX, minY, maxX, maxY, segments: segs };
  }
  const splitX = maxX - minX >= maxY - minY;
  const mid = start + end >> 1;
  nthElement(segments, indices, start, end, mid, splitX);
  return {
    minX,
    minY,
    maxX,
    maxY,
    left: buildNode(segments, indices, start, mid),
    right: buildNode(segments, indices, mid, end)
  };
}
function nthElement(segments, indices, lo, hi, nth, splitX) {
  while (hi - lo > 1) {
    const mid = lo + hi - 1 >> 1;
    const a = midpoint(segments, indices, lo, splitX);
    const b = midpoint(segments, indices, mid, splitX);
    const c = midpoint(segments, indices, hi - 1, splitX);
    let pivotIdx;
    if (a <= b && b <= c || c <= b && b <= a) pivotIdx = mid;
    else if (b <= a && a <= c || c <= a && a <= b) pivotIdx = lo;
    else pivotIdx = hi - 1;
    swap(indices, pivotIdx, hi - 1);
    const pivotVal = midpoint(segments, indices, hi - 1, splitX);
    let store = lo;
    for (let i = lo; i < hi - 1; i++) {
      if (midpoint(segments, indices, i, splitX) < pivotVal) {
        swap(indices, i, store);
        store++;
      }
    }
    swap(indices, store, hi - 1);
    if (store === nth) return;
    if (nth < store) hi = store;
    else lo = store + 1;
  }
}
function midpoint(segments, indices, i, splitX) {
  const s = segments[indices[i]];
  return splitX ? (s.ax + s.bx) * 0.5 : (s.ay + s.by) * 0.5;
}
function swap(arr, i, j) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}
function queryAABB(node, qMinX, qMinY, qMaxX, qMaxY, segments, out) {
  if (qMaxX < node.minX || qMinX > node.maxX || qMaxY < node.minY || qMinY > node.maxY) {
    return;
  }
  if (node.segments) {
    for (const idx of node.segments) {
      const s = segments[idx];
      const sMinX = Math.min(s.ax, s.bx);
      const sMaxX = Math.max(s.ax, s.bx);
      const sMinY = Math.min(s.ay, s.by);
      const sMaxY = Math.max(s.ay, s.by);
      if (qMaxX >= sMinX && qMinX <= sMaxX && qMaxY >= sMinY && qMinY <= sMaxY) {
        out.push(idx);
      }
    }
    return;
  }
  if (node.left) queryAABB(node.left, qMinX, qMinY, qMaxX, qMaxY, segments, out);
  if (node.right) queryAABB(node.right, qMinX, qMinY, qMaxX, qMaxY, segments, out);
}

// lib/weighted-edges.ts
function buildWeightedEdgeContext(regions) {
  const segments = [];
  const segmentRegionIdx = [];
  for (let i = 0; i < regions.length; i++) {
    const poly = regions[i].polygon;
    const N = poly.length;
    for (let j = 0; j < N; j++) {
      const a = poly[j];
      const b = poly[(j + 1) % N];
      segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      segmentRegionIdx.push(i);
    }
  }
  const bvh = buildSegmentBVH(segments);
  return { segments, segmentRegionIdx, bvh, regions };
}
function pointInConvexPolygon(p, polygon) {
  const N = polygon.length;
  for (let i = 0; i < N; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % N];
    const cross2 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross2 < -EPSILON) return false;
  }
  return true;
}
function computeWeightedEdgeCost(a, b, ctx) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const totalLen = Math.sqrt(dx * dx + dy * dy);
  if (totalLen < EPSILON) return 0;
  const qMinX = Math.min(a.x, b.x) - EPSILON;
  const qMinY = Math.min(a.y, b.y) - EPSILON;
  const qMaxX = Math.max(a.x, b.x) + EPSILON;
  const qMaxY = Math.max(a.y, b.y) + EPSILON;
  const candidates = [];
  queryAABB(ctx.bvh, qMinX, qMinY, qMaxX, qMaxY, ctx.segments, candidates);
  const tValues = [0, 1];
  for (const segIdx of candidates) {
    const seg = ctx.segments[segIdx];
    const c = { x: seg.ax, y: seg.ay };
    const d = { x: seg.bx, y: seg.by };
    const { abNum, cdNum, denom } = lineIntersectTime(a, b, c, d);
    if (Math.abs(denom) < EPSILON) continue;
    const tAB = abNum / denom;
    const tCD = cdNum / denom;
    if (tAB > EPSILON && tAB < 1 - EPSILON && tCD > -EPSILON && tCD < 1 + EPSILON) {
      tValues.push(tAB);
    }
  }
  tValues.sort((x, y) => x - y);
  const unique = [tValues[0]];
  for (let i = 1; i < tValues.length; i++) {
    if (tValues[i] - unique[unique.length - 1] > EPSILON) {
      unique.push(tValues[i]);
    }
  }
  let cost = 0;
  let prevRegion = -1;
  for (let i = 0; i < unique.length - 1; i++) {
    const t0 = unique[i];
    const t1 = unique[i + 1];
    const segLen = (t1 - t0) * totalLen;
    const tMid = (t0 + t1) / 2;
    const mid = {
      x: a.x + dx * tMid,
      y: a.y + dy * tMid
    };
    let regionIdx = -1;
    for (let r = 0; r < ctx.regions.length; r++) {
      if (pointInConvexPolygon(mid, ctx.regions[r].polygon)) {
        regionIdx = r;
        break;
      }
    }
    if (regionIdx >= 0) {
      const region = ctx.regions[regionIdx];
      cost += segLen * region.weight;
      if (regionIdx !== prevRegion) {
        cost += region.penalty;
      }
    } else {
      cost += segLen;
    }
    prevRegion = regionIdx;
  }
  return cost;
}

// lib/visibility-graph.ts
var VisibilityGraph = class {
  mesh;
  /** Reused search instance for visibility queries */
  si;
  /** Mesh vertex indices for mesh corner nodes */
  cornerIndices;
  /** All graph node points (mesh corners + region vertices) */
  cornerPoints;
  /** How many nodes are mesh corners (the rest are region vertices) */
  numMeshCorners;
  /** Maps mesh vertex index → index in cornerIndices/cornerPoints */
  vertexToCorner;
  /** Static corner-corner adjacency — null until first search() call */
  adj = null;
  weightedRegions;
  weightedCtx = null;
  /** Time taken to build the static adjacency graph (ms). 0 until first search(). */
  buildTimeMs = 0;
  /** Number of static corner-corner edges. 0 until first search(). */
  edgeCount = 0;
  /** Static corner-corner edges for visualization. Empty until first search(). */
  edges = [];
  constructor(mesh, options) {
    let convexityThreshold = 0.02;
    let weightedRegions = null;
    if (typeof options === "number") {
      convexityThreshold = options;
    } else if (options) {
      if (options.convexityThreshold !== void 0)
        convexityThreshold = options.convexityThreshold;
      if (options.weightedRegions && options.weightedRegions.length > 0)
        weightedRegions = options.weightedRegions;
    }
    this.mesh = mesh;
    this.si = new SearchInstance(mesh);
    this.weightedRegions = weightedRegions;
    const boundaryNext = /* @__PURE__ */ new Map();
    const boundaryPrev = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set();
    for (const poly of mesh.polygons) {
      if (!poly) continue;
      const V = poly.vertices;
      const P = poly.polygons;
      const N = V.length;
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        if (P[j] !== -1) continue;
        const a = V[i];
        const b = V[j];
        const key = a < b ? `${a},${b}` : `${b},${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        boundaryNext.set(a, b);
        boundaryPrev.set(b, a);
      }
    }
    const cornerIndices = [];
    for (let i = 0; i < mesh.vertices.length; i++) {
      const v = mesh.vertices[i];
      if (!v.isCorner) continue;
      if (v.isAmbig) {
        cornerIndices.push(i);
        continue;
      }
      const prevIdx = boundaryPrev.get(i);
      const nextIdx = boundaryNext.get(i);
      if (prevIdx === void 0 || nextIdx === void 0) {
        cornerIndices.push(i);
        continue;
      }
      const A = mesh.vertices[prevIdx].p;
      const VP = v.p;
      const B = mesh.vertices[nextIdx].p;
      const dx1 = VP.x - A.x, dy1 = VP.y - A.y;
      const dx2 = B.x - VP.x, dy2 = B.y - VP.y;
      const len1Sq = dx1 * dx1 + dy1 * dy1;
      const len2Sq = dx2 * dx2 + dy2 * dy2;
      if (len1Sq < EPSILON || len2Sq < EPSILON) {
        cornerIndices.push(i);
        continue;
      }
      const normalizedCross = (dx1 * dy2 - dy1 * dx2) / Math.sqrt(len1Sq * len2Sq);
      if (normalizedCross < -convexityThreshold) {
        cornerIndices.push(i);
      }
    }
    this.cornerIndices = cornerIndices;
    const numMeshCorners = cornerIndices.length;
    this.numMeshCorners = numMeshCorners;
    const cornerPoints = new Array(numMeshCorners);
    const vertexToCorner = /* @__PURE__ */ new Map();
    for (let k = 0; k < numMeshCorners; k++) {
      cornerPoints[k] = mesh.vertices[cornerIndices[k]].p;
      vertexToCorner.set(cornerIndices[k], k);
    }
    if (weightedRegions) {
      for (const wr of weightedRegions) {
        for (const v of wr.polygon) {
          const loc = mesh.getPointLocation(v);
          if (loc.poly1 < 0) continue;
          let isDuplicate = false;
          for (let k = 0; k < cornerPoints.length; k++) {
            if (pointsEqual(v, cornerPoints[k])) {
              isDuplicate = true;
              break;
            }
          }
          if (!isDuplicate) {
            cornerPoints.push(v);
          }
        }
      }
    }
    this.cornerPoints = cornerPoints;
    this.vertexToCorner = vertexToCorner;
  }
  /** Compute edge cost: weighted if context exists, otherwise Euclidean */
  edgeCost(a, b) {
    return this.weightedCtx ? computeWeightedEdgeCost(a, b, this.weightedCtx) : distance(a, b);
  }
  /** Check direct visibility between two points via Polyanya search */
  isDirectlyVisible(a, b) {
    this.si.setStartGoal(a, b);
    if (!this.si.search()) return false;
    return this.si.getPathPoints().length === 2;
  }
  /**
   * Build the static corner-corner adjacency graph.
   * Called lazily on the first search() invocation.
   */
  _build() {
    if (this.adj !== null) return;
    const t0 = performance.now();
    const { cornerPoints, vertexToCorner, numMeshCorners } = this;
    const numCorners = cornerPoints.length;
    if (this.weightedRegions) {
      this.weightedCtx = buildWeightedEdgeContext(this.weightedRegions);
    }
    const adj = new Array(numCorners);
    for (let k = 0; k < numCorners; k++) adj[k] = [];
    let edgeCount = 0;
    const visEdges = [];
    const addedEdge = /* @__PURE__ */ new Set();
    const addEdge = (k, j, cost) => {
      const lo = Math.min(k, j);
      const hi = Math.max(k, j);
      const key = `${lo},${hi}`;
      if (addedEdge.has(key)) return;
      addedEdge.add(key);
      adj[k].push({ to: j, dist: cost });
      adj[j].push({ to: k, dist: cost });
      visEdges.push({
        ax: cornerPoints[k].x,
        ay: cornerPoints[k].y,
        bx: cornerPoints[j].x,
        by: cornerPoints[j].y
      });
      edgeCount++;
    };
    for (let k = 0; k < numMeshCorners; k++) {
      const visible = this.si.computeVisibleCornersFromPoint(cornerPoints[k]);
      for (const [vertexIdx] of visible) {
        const j = vertexToCorner.get(vertexIdx);
        if (j === void 0 || j === k) continue;
        const cost = this.edgeCost(cornerPoints[k], cornerPoints[j]);
        addEdge(k, j, cost);
      }
    }
    for (let k = numMeshCorners; k < numCorners; k++) {
      for (let j = 0; j < numCorners; j++) {
        if (j === k) continue;
        const lo = Math.min(k, j);
        const hi = Math.max(k, j);
        if (addedEdge.has(`${lo},${hi}`)) continue;
        if (this.isDirectlyVisible(cornerPoints[k], cornerPoints[j])) {
          const cost = this.edgeCost(cornerPoints[k], cornerPoints[j]);
          addEdge(k, j, cost);
        }
      }
    }
    this.adj = adj;
    this.edgeCount = edgeCount;
    this.edges = visEdges;
    this.buildTimeMs = performance.now() - t0;
  }
  /**
   * Find the shortest path from start to goal using the precomputed graph.
   * Connects start and goal to all visible corners via Polyanya expansion,
   * checks direct start→goal visibility, then runs A*.
   */
  search(start, goal) {
    this._build();
    const t0 = performance.now();
    const empty = {
      path: [],
      cost: -1,
      nodesExpanded: 0,
      edgeCount: this.edgeCount,
      buildTimeMs: 0,
      edges: this.edges
    };
    const startLoc = this.mesh.getPointLocation(start);
    const goalLoc = this.mesh.getPointLocation(goal);
    if (startLoc.poly1 < 0 || goalLoc.poly1 < 0) return empty;
    if (!this.mesh.sameIsland(startLoc.poly1, goalLoc.poly1)) return empty;
    const numCorners = this.cornerPoints.length;
    const startIdx = numCorners;
    const goalIdx = numCorners + 1;
    const numNodes = numCorners + 2;
    const nodePoints = new Array(numNodes);
    for (let k = 0; k < numCorners; k++) nodePoints[k] = this.cornerPoints[k];
    nodePoints[startIdx] = start;
    nodePoints[goalIdx] = goal;
    const startVisibleMap = this.si.computeVisibleCornersFromPoint(start);
    const goalVisibleMap = this.si.computeVisibleCornersFromPoint(goal);
    const cornerToStartDist = new Float64Array(numCorners).fill(-1);
    const cornerToGoalDist = new Float64Array(numCorners).fill(-1);
    const startAdj = [];
    const goalAdj = [];
    for (const [vertexIdx] of startVisibleMap) {
      const k = this.vertexToCorner.get(vertexIdx);
      if (k === void 0) continue;
      const cost = this.edgeCost(start, this.cornerPoints[k]);
      startAdj.push({ to: k, dist: cost });
      cornerToStartDist[k] = cost;
    }
    for (const [vertexIdx] of goalVisibleMap) {
      const k = this.vertexToCorner.get(vertexIdx);
      if (k === void 0) continue;
      const cost = this.edgeCost(goal, this.cornerPoints[k]);
      goalAdj.push({ to: k, dist: cost });
      cornerToGoalDist[k] = cost;
    }
    for (let k = this.numMeshCorners; k < numCorners; k++) {
      if (this.isDirectlyVisible(start, this.cornerPoints[k])) {
        const cost = this.edgeCost(start, this.cornerPoints[k]);
        startAdj.push({ to: k, dist: cost });
        cornerToStartDist[k] = cost;
      }
      if (this.isDirectlyVisible(goal, this.cornerPoints[k])) {
        const cost = this.edgeCost(goal, this.cornerPoints[k]);
        goalAdj.push({ to: k, dist: cost });
        cornerToGoalDist[k] = cost;
      }
    }
    this.si.setStartGoal(start, goal);
    if (this.si.search()) {
      const pathPts = this.si.getPathPoints();
      if (pathPts.length === 2) {
        const directCost = this.edgeCost(start, goal);
        startAdj.push({ to: goalIdx, dist: directCost });
        goalAdj.push({ to: startIdx, dist: directCost });
      }
    }
    const goalP = goal;
    const heap = [];
    const pushHeap = (node, g, f) => {
      heap.push({ node, f, g });
      let i = heap.length - 1;
      while (i > 0) {
        const pi = i - 1 >> 1;
        if (heap[pi].f <= heap[i].f) break;
        const tmp = heap[pi];
        heap[pi] = heap[i];
        heap[i] = tmp;
        i = pi;
      }
    };
    const popHeap = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        while (true) {
          let s = i;
          const l = 2 * i + 1, r = 2 * i + 2;
          if (l < heap.length && heap[l].f < heap[s].f) s = l;
          if (r < heap.length && heap[r].f < heap[s].f) s = r;
          if (s === i) break;
          const tmp = heap[i];
          heap[i] = heap[s];
          heap[s] = tmp;
          i = s;
        }
      }
      return top;
    };
    const gBest = new Float64Array(numNodes).fill(Infinity);
    const cameFrom = new Int32Array(numNodes).fill(-1);
    gBest[startIdx] = 0;
    pushHeap(startIdx, 0, distance(start, goalP));
    let nodesExpanded = 0;
    while (heap.length > 0) {
      const cur = popHeap();
      if (cur.g > gBest[cur.node] + EPSILON) continue;
      if (cur.node === goalIdx) {
        const path = [];
        let n = goalIdx;
        while (n !== -1) {
          path.push(nodePoints[n]);
          n = cameFrom[n];
        }
        path.reverse();
        return {
          path,
          cost: cur.g,
          nodesExpanded,
          edgeCount: this.edgeCount,
          buildTimeMs: performance.now() - t0,
          edges: this.edges
        };
      }
      nodesExpanded++;
      const relax = (to, ng) => {
        if (ng < gBest[to] - EPSILON) {
          gBest[to] = ng;
          cameFrom[to] = cur.node;
          pushHeap(to, ng, ng + distance(nodePoints[to], goalP));
        }
      };
      if (cur.node === startIdx) {
        for (const e of startAdj) relax(e.to, cur.g + e.dist);
      } else if (cur.node === goalIdx) {
        for (const e of goalAdj) relax(e.to, cur.g + e.dist);
      } else {
        for (const e of this.adj[cur.node]) relax(e.to, cur.g + e.dist);
        const toStart = cornerToStartDist[cur.node];
        if (toStart >= 0) relax(startIdx, cur.g + toStart);
        const toGoal = cornerToGoalDist[cur.node];
        if (toGoal >= 0) relax(goalIdx, cur.g + toGoal);
      }
    }
    return empty;
  }
};
function visibilityGraphSearch(mesh, start, goal) {
  return new VisibilityGraph(mesh).search(start, goal);
}

// lib/merge-polygons.ts
import {
  BooleanOperations,
  Polygon as FlattenPolygon,
  point
} from "@flatten-js/core";
function ringToFlattenPoly(ring) {
  return new FlattenPolygon(ring.map((p) => point(p.x, p.y)));
}
function extractFaces(poly) {
  const result = [];
  for (const face of poly.faces) {
    const ring = [];
    for (const v of face.vertices) {
      ring.push({ x: v.x, y: v.y });
    }
    if (ring.length >= 3) {
      result.push(ring);
    }
  }
  return result;
}
function mergeAllPolygons(polygons) {
  if (polygons.length <= 1) return polygons;
  try {
    let polys = polygons.map(ringToFlattenPoly);
    for (let pass = 0; pass < 2; pass++) {
      const merged = [];
      const used = /* @__PURE__ */ new Set();
      for (let i = 0; i < polys.length; i++) {
        if (used.has(i)) continue;
        let current = polys[i];
        for (let j = i + 1; j < polys.length; j++) {
          if (used.has(j)) continue;
          const boxA = current.box;
          const boxB = polys[j].box;
          if (boxA.xmin > boxB.xmax + 1e-6 || boxA.xmax < boxB.xmin - 1e-6 || boxA.ymin > boxB.ymax + 1e-6 || boxA.ymax < boxB.ymin - 1e-6) {
            continue;
          }
          try {
            const unified = BooleanOperations.unify(current, polys[j]);
            if (unified.faces.size > 0) {
              current = unified;
              used.add(j);
            }
          } catch {
          }
        }
        merged.push(current);
        used.add(i);
      }
      polys = merged;
    }
    const result = [];
    for (const poly of polys) {
      const faces = extractFaces(poly);
      result.push(...faces);
    }
    return result.length > 0 ? result : polygons;
  } catch {
    return polygons;
  }
}
export {
  EPSILON,
  Mesh,
  Orientation,
  PointLocationType,
  PolyContainmentType,
  SearchInstance,
  StepEventType,
  SuccessorType,
  VisibilityGraph,
  ZeroOnePos,
  add,
  buildMeshFromRegions,
  buildWeightedEdgeContext,
  cdtTriangulate,
  computeWeightedEdgeCost,
  cross,
  distance,
  distanceSq,
  getHValue,
  getOrientation,
  getPointOnLine,
  getSuccessors,
  graphSearch,
  isCollinear,
  lineIntersect,
  lineIntersectBoundCheck,
  lineIntersectTime,
  mergeAllPolygons,
  mergeMesh,
  pointInConvexPolygon,
  pointsEqual,
  rectToPolygon,
  reflectPoint,
  resolveConstraintCrossings,
  scale,
  sub,
  visibilityGraphSearch
};
