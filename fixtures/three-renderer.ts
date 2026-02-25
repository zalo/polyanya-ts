import * as THREE from "three"
import { Line2 } from "three/examples/jsm/lines/Line2.js"
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/examples/jsm/renderers/CSS2DRenderer.js"
import type { Mesh, Point, SearchNode } from "../lib/index"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface Obstacle {
  id: number
  cx: number
  cy: number
  w: number
  h: number
}

export interface StepOverlayOpts {
  mesh: Mesh
  expandedPoly?: number
  openNodes: SearchNode[]
  pushedNodes?: SearchNode[]
  prunedNode?: SearchNode
  poppedNode?: SearchNode
  sw: number
}

export interface ThreeRenderer {
  dispose(): void
  setMesh(mesh: Mesh, bounds: Bounds): void
  setObstacles(
    obstacles: Obstacle[],
    selectedId: number | null,
    sw: number,
  ): void
  setPath(pathPts: Point[]): void
  setMarkers(start: Point, goal: Point): void
  setStepOverlays(opts: StepOverlayOpts): void
  clearStepOverlays(): void
  screenToMesh(clientX: number, clientY: number): Point | null
  hitTestMarker(
    clientX: number,
    clientY: number,
    start: Point,
    goal: Point,
    radiusWorld: number,
  ): "start" | "goal" | null
  hitTestObstacle(
    clientX: number,
    clientY: number,
    obstacles: Obstacle[],
  ): number | null
  render(): void
  readonly container: HTMLDivElement
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createThreeRenderer(): ThreeRenderer {
  // --- Container ---
  const container = document.createElement("div")
  container.style.width = "100%"
  container.style.height = "100%"
  container.style.position = "relative"

  // --- WebGL renderer ---
  const glRenderer = new THREE.WebGLRenderer({ antialias: true })
  glRenderer.setClearColor(0x16213e)
  glRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1))
  container.appendChild(glRenderer.domElement)
  glRenderer.domElement.style.position = "absolute"
  glRenderer.domElement.style.inset = "0"
  glRenderer.domElement.style.borderRadius = "8px"

  // --- CSS2D renderer (for labels) ---
  const cssRenderer = new CSS2DRenderer()
  cssRenderer.domElement.style.position = "absolute"
  cssRenderer.domElement.style.inset = "0"
  cssRenderer.domElement.style.pointerEvents = "none"
  cssRenderer.domElement.style.borderRadius = "8px"
  container.appendChild(cssRenderer.domElement)

  // --- Scene + camera ---
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)

  // --- Scene groups at different z-layers ---
  const staticGroup = new THREE.Group()
  staticGroup.position.z = 0
  const obstacleGroup = new THREE.Group()
  obstacleGroup.position.z = 0.1
  const stepOverlayGroup = new THREE.Group()
  stepOverlayGroup.position.z = 0.2
  const pathGroup = new THREE.Group()
  pathGroup.position.z = 0.3
  const markerGroup = new THREE.Group()
  markerGroup.position.z = 0.4
  scene.add(
    staticGroup,
    obstacleGroup,
    stepOverlayGroup,
    pathGroup,
    markerGroup,
  )

  // --- State ---
  let currentMesh: Mesh | null = null
  let currentBounds: Bounds | null = null
  let resolution = new THREE.Vector2(1, 1)

  // Track disposable geometries
  let staticGeometries: THREE.BufferGeometry[] = []
  let staticLines: (LineSegments2 | Line2)[] = []
  let obstacleGeometries: THREE.BufferGeometry[] = []
  let obstacleLines: (LineSegments2 | Line2)[] = []
  let stepGeometries: THREE.BufferGeometry[] = []
  let stepLines: (LineSegments2 | Line2)[] = []

  // Materials — reused across rebuilds
  const polyFillMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a3e,
    transparent: true,
    opacity: 0.6,
    depthTest: false,
  })
  const interiorEdgeMat = new LineMaterial({
    color: 0x4a4e69,
    transparent: true,
    opacity: 0.4,
    worldUnits: true,
    linewidth: 1,
  })
  const boundaryEdgeMat = new LineMaterial({
    color: 0xe94560,
    transparent: true,
    opacity: 0.8,
    worldUnits: true,
    linewidth: 1,
  })
  const pathMat = new LineMaterial({
    color: 0x06d6a0,
    worldUnits: true,
    linewidth: 1,
  })

  // Path line (reused)
  let pathLine: Line2 | null = null
  let pathGeom: LineGeometry | null = null

  // Marker objects
  let startBgMesh: THREE.Mesh | null = null
  let startFgMesh: THREE.Mesh | null = null
  let goalBgMesh: THREE.Mesh | null = null
  let goalFgMesh: THREE.Mesh | null = null
  let startLabelObj: CSS2DObject | null = null
  let goalLabelObj: CSS2DObject | null = null
  const markerBgMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
  })
  const startFgMat = new THREE.MeshBasicMaterial({
    color: 0x06d6a0,
    depthTest: false,
  })
  const goalFgMat = new THREE.MeshBasicMaterial({
    color: 0xf72585,
    depthTest: false,
  })

  // Step overlay materials
  const expandedPolyMat = new THREE.MeshBasicMaterial({
    color: 0x4361ee,
    transparent: true,
    opacity: 0.5,
    depthTest: false,
  })
  const openMat = new LineMaterial({
    color: 0xf8961e,
    transparent: true,
    opacity: 0.6,
    worldUnits: true,
    linewidth: 1,
  })
  const pushedMat = new LineMaterial({
    color: 0x2ec4b6,
    transparent: true,
    opacity: 0.9,
    worldUnits: true,
    linewidth: 1,
  })
  const prunedMat = new LineMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.5,
    worldUnits: true,
    linewidth: 1,
    dashed: true,
    dashScale: 1,
    dashSize: 1,
    gapSize: 0.67,
  })
  const poppedMat = new LineMaterial({
    color: 0xf72585,
    transparent: true,
    opacity: 0.9,
    worldUnits: true,
    linewidth: 1,
  })

  // Obstacle materials
  const obsFillMat = new THREE.MeshBasicMaterial({
    color: 0xe94560,
    transparent: true,
    opacity: 0.4,
    depthTest: false,
  })
  const obsSelectedFillMat = new THREE.MeshBasicMaterial({
    color: 0xf72585,
    transparent: true,
    opacity: 0.4,
    depthTest: false,
  })
  const obsStrokeMat = new LineMaterial({
    color: 0xe94560,
    worldUnits: true,
    linewidth: 1,
  })
  const obsSelectedStrokeMat = new LineMaterial({
    color: 0xf72585,
    worldUnits: true,
    linewidth: 1,
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function updateResolution(w: number, h: number) {
    resolution.set(w, h)
    for (const mat of [
      interiorEdgeMat,
      boundaryEdgeMat,
      pathMat,
      openMat,
      pushedMat,
      prunedMat,
      poppedMat,
      obsStrokeMat,
      obsSelectedStrokeMat,
    ]) {
      mat.resolution.set(w, h)
    }
  }

  function updateCamera(bounds: Bounds) {
    const cw = container.clientWidth || 1
    const ch = container.clientHeight || 1
    const meshW = bounds.maxX - bounds.minX
    const meshH = bounds.maxY - bounds.minY
    const pad = Math.max(meshW, meshH) * 0.06

    const paddedMinX = bounds.minX - pad
    const paddedMaxX = bounds.maxX + pad
    const paddedMinY = bounds.minY - pad
    const paddedMaxY = bounds.maxY + pad
    const paddedW = paddedMaxX - paddedMinX
    const paddedH = paddedMaxY - paddedMinY

    const meshAspect = paddedW / paddedH
    const viewAspect = cw / ch

    let left: number, right: number, bottom: number, top: number
    if (viewAspect > meshAspect) {
      // wider viewport — letterbox horizontally
      const visibleW = paddedH * viewAspect
      const cx = (paddedMinX + paddedMaxX) / 2
      left = cx - visibleW / 2
      right = cx + visibleW / 2
      bottom = paddedMinY
      top = paddedMaxY
    } else {
      // taller viewport — letterbox vertically
      const visibleH = paddedW / viewAspect
      const cy = (paddedMinY + paddedMaxY) / 2
      left = paddedMinX
      right = paddedMaxX
      bottom = cy - visibleH / 2
      top = cy + visibleH / 2
    }

    camera.left = left
    camera.right = right
    camera.bottom = bottom
    camera.top = top
    camera.updateProjectionMatrix()
  }

  /** Recompute all line widths so each line type is a fixed CSS-pixel size. */
  function updateLineWidths() {
    const cw = container.clientWidth || 1
    const visibleW = camera.right - camera.left
    if (visibleW <= 0) return
    const px = visibleW / cw // world-units per CSS pixel

    interiorEdgeMat.linewidth = px * 1.0
    boundaryEdgeMat.linewidth = px * 2.0
    pathMat.linewidth = px * 3.0
    openMat.linewidth = px * 2.0
    pushedMat.linewidth = px * 3.0
    prunedMat.linewidth = px * 3.0
    poppedMat.linewidth = px * 3.0
    obsStrokeMat.linewidth = px * 2.0
    obsSelectedStrokeMat.linewidth = px * 2.0
    prunedMat.dashSize = px * 6
    prunedMat.gapSize = px * 4
  }

  function disposeGroupContent(
    group: THREE.Group,
    geoms: THREE.BufferGeometry[],
    lines: (LineSegments2 | Line2)[],
  ) {
    for (const g of geoms) g.dispose()
    geoms.length = 0
    lines.length = 0
    while (group.children.length > 0) {
      group.remove(group.children[0]!)
    }
  }

  function makeSegments(
    positions: number[],
    material: LineMaterial,
  ): { seg: LineSegments2; geom: LineSegmentsGeometry } | null {
    if (positions.length === 0) return null
    const geom = new LineSegmentsGeometry()
    geom.setPositions(positions)
    const seg = new LineSegments2(geom, material)
    seg.computeLineDistances()
    return { seg, geom }
  }

  function makeLine2(
    positions: number[],
    material: LineMaterial,
  ): { line: Line2; geom: LineGeometry } | null {
    if (positions.length < 6) return null
    const geom = new LineGeometry()
    geom.setPositions(positions)
    const line = new Line2(geom, material)
    line.computeLineDistances()
    return { line, geom }
  }

  // ---------------------------------------------------------------------------
  // Resize observer
  // ---------------------------------------------------------------------------

  const ro = new ResizeObserver(() => {
    const w = container.clientWidth
    const h = container.clientHeight
    if (w === 0 || h === 0) return
    glRenderer.setSize(w, h)
    cssRenderer.setSize(w, h)
    updateResolution(w, h)
    if (currentBounds) {
      updateCamera(currentBounds)
      updateLineWidths()
    }
    render()
  })
  ro.observe(container)

  // ---------------------------------------------------------------------------
  // setMesh
  // ---------------------------------------------------------------------------

  function setMesh(mesh: Mesh, bounds: Bounds) {
    currentMesh = mesh
    currentBounds = bounds

    // Dispose previous static geometry
    disposeGroupContent(staticGroup, staticGeometries, staticLines)

    // --- Polygon fills (fan triangulation) ---
    const triPositions: number[] = []
    for (const poly of mesh.polygons) {
      if (!poly) continue
      const V = poly.vertices
      if (V.length < 3) continue
      const v0 = mesh.vertices[V[0]!]
      if (!v0) continue
      for (let i = 1; i < V.length - 1; i++) {
        const v1 = mesh.vertices[V[i]!]
        const v2 = mesh.vertices[V[i + 1]!]
        if (!v1 || !v2) continue
        triPositions.push(
          v0.p.x,
          v0.p.y,
          0,
          v1.p.x,
          v1.p.y,
          0,
          v2.p.x,
          v2.p.y,
          0,
        )
      }
    }
    if (triPositions.length > 0) {
      const geom = new THREE.BufferGeometry()
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(triPositions, 3),
      )
      const polyMesh = new THREE.Mesh(geom, polyFillMat)
      staticGroup.add(polyMesh)
      staticGeometries.push(geom)
    }

    // --- Edges ---
    const seen = new Set<string>()
    const interiorPos: number[] = []
    const boundaryPos: number[] = []
    for (const poly of mesh.polygons) {
      if (!poly) continue
      const V = poly.vertices,
        P = poly.polygons
      for (let i = 0; i < V.length; i++) {
        const a = V[i]!,
          b = V[(i + 1) % V.length]!
        const key = a < b ? `${a},${b}` : `${b},${a}`
        if (seen.has(key)) continue
        seen.add(key)
        const va = mesh.vertices[a],
          vb = mesh.vertices[b]
        if (!va || !vb) continue
        const arr = P[(i + 1) % V.length] === -1 ? boundaryPos : interiorPos
        arr.push(va.p.x, va.p.y, 0, vb.p.x, vb.p.y, 0)
      }
    }

    const interior = makeSegments(interiorPos, interiorEdgeMat)
    if (interior) {
      staticGroup.add(interior.seg)
      staticGeometries.push(interior.geom)
      staticLines.push(interior.seg)
    }
    const boundary = makeSegments(boundaryPos, boundaryEdgeMat)
    if (boundary) {
      staticGroup.add(boundary.seg)
      staticGeometries.push(boundary.geom)
      staticLines.push(boundary.seg)
    }

    // Update camera and line widths (must happen after camera is set)
    updateCamera(bounds)
    updateLineWidths()
  }

  // ---------------------------------------------------------------------------
  // setObstacles
  // ---------------------------------------------------------------------------

  function setObstacles(
    obstacles: Obstacle[],
    selectedId: number | null,
    _sw: number,
  ) {
    disposeGroupContent(obstacleGroup, obstacleGeometries, obstacleLines)

    if (obstacles.length === 0) return

    for (const o of obstacles) {
      const isSelected = o.id === selectedId
      const x0 = o.cx - o.w / 2,
        x1 = o.cx + o.w / 2
      const y0 = o.cy - o.h / 2,
        y1 = o.cy + o.h / 2

      // Fill quad (two triangles)
      const fillGeom = new THREE.BufferGeometry()
      fillGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0],
          3,
        ),
      )
      const fillMesh = new THREE.Mesh(
        fillGeom,
        isSelected ? obsSelectedFillMat : obsFillMat,
      )
      obstacleGroup.add(fillMesh)
      obstacleGeometries.push(fillGeom)

      // Outline
      const outline = makeSegments(
        [
          x0,
          y0,
          0,
          x1,
          y0,
          0,
          x1,
          y0,
          0,
          x1,
          y1,
          0,
          x1,
          y1,
          0,
          x0,
          y1,
          0,
          x0,
          y1,
          0,
          x0,
          y0,
          0,
        ],
        isSelected ? obsSelectedStrokeMat : obsStrokeMat,
      )
      if (outline) {
        obstacleGroup.add(outline.seg)
        obstacleGeometries.push(outline.geom)
        obstacleLines.push(outline.seg)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // setPath
  // ---------------------------------------------------------------------------

  function setPath(pathPts: Point[]) {
    // Dispose old path
    if (pathGeom) {
      pathGeom.dispose()
      pathGeom = null
    }
    if (pathLine) {
      pathGroup.remove(pathLine)
      pathLine = null
    }

    if (pathPts.length < 2) return

    const positions: number[] = []
    for (const p of pathPts) positions.push(p.x, p.y, 0)

    const result = makeLine2(positions, pathMat)
    if (result) {
      pathLine = result.line
      pathGeom = result.geom
      pathGroup.add(pathLine)
    }
  }

  // ---------------------------------------------------------------------------
  // setMarkers
  // ---------------------------------------------------------------------------

  function setMarkers(start: Point, goal: Point) {
    // Clear old markers
    while (markerGroup.children.length > 0) {
      const child = markerGroup.children[0]!
      if (child instanceof CSS2DObject) {
        child.element.remove()
      }
      markerGroup.remove(child)
    }
    startBgMesh = null
    startFgMesh = null
    goalBgMesh = null
    goalFgMesh = null
    startLabelObj = null
    goalLabelObj = null

    if (!currentBounds) return
    const meshExtent = Math.max(
      currentBounds.maxX - currentBounds.minX,
      currentBounds.maxY - currentBounds.minY,
    )
    const markerR = meshExtent * 0.015

    const bgGeom = new THREE.CircleGeometry(markerR, 32)
    const fgGeom = new THREE.CircleGeometry(markerR * 0.8, 32)

    // Start marker
    startBgMesh = new THREE.Mesh(bgGeom, markerBgMat)
    startBgMesh.position.set(start.x, start.y, 0)
    markerGroup.add(startBgMesh)

    startFgMesh = new THREE.Mesh(fgGeom, startFgMat)
    startFgMesh.position.set(start.x, start.y, 0.01)
    markerGroup.add(startFgMesh)

    // Goal marker
    goalBgMesh = new THREE.Mesh(bgGeom, markerBgMat)
    goalBgMesh.position.set(goal.x, goal.y, 0)
    markerGroup.add(goalBgMesh)

    goalFgMesh = new THREE.Mesh(fgGeom, goalFgMat)
    goalFgMesh.position.set(goal.x, goal.y, 0.01)
    markerGroup.add(goalFgMesh)

    // Labels
    const makeLabel = (text: string, color: string): CSS2DObject => {
      const div = document.createElement("div")
      div.textContent = text
      div.style.color = color
      div.style.fontSize = "13px"
      div.style.fontWeight = "700"
      div.style.fontFamily = "system-ui, -apple-system, sans-serif"
      div.style.pointerEvents = "none"
      div.style.userSelect = "none"
      div.style.textShadow = "0 0 4px rgba(0,0,0,0.8)"
      return new CSS2DObject(div)
    }

    startLabelObj = makeLabel("S", "#06d6a0")
    startLabelObj.position.set(start.x, start.y + markerR * 1.8, 0.02)
    markerGroup.add(startLabelObj)

    goalLabelObj = makeLabel("G", "#f72585")
    goalLabelObj.position.set(goal.x, goal.y + markerR * 1.8, 0.02)
    markerGroup.add(goalLabelObj)
  }

  // ---------------------------------------------------------------------------
  // setStepOverlays / clearStepOverlays
  // ---------------------------------------------------------------------------

  function clearStepOverlays() {
    disposeGroupContent(stepOverlayGroup, stepGeometries, stepLines)
  }

  function setStepOverlays(opts: StepOverlayOpts) {
    clearStepOverlays()
    const mesh = opts.mesh

    // Expanded polygon fill
    if (opts.expandedPoly != null) {
      const poly = mesh.polygons[opts.expandedPoly]
      if (poly) {
        const V = poly.vertices
        const v0 = mesh.vertices[V[0]!]
        if (v0 && V.length >= 3) {
          const positions: number[] = []
          for (let i = 1; i < V.length - 1; i++) {
            const v1 = mesh.vertices[V[i]!]
            const v2 = mesh.vertices[V[i + 1]!]
            if (!v1 || !v2) continue
            positions.push(
              v0.p.x,
              v0.p.y,
              0,
              v1.p.x,
              v1.p.y,
              0,
              v2.p.x,
              v2.p.y,
              0,
            )
          }
          if (positions.length > 0) {
            const geom = new THREE.BufferGeometry()
            geom.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(positions, 3),
            )
            const m = new THREE.Mesh(geom, expandedPolyMat)
            stepOverlayGroup.add(m)
            stepGeometries.push(geom)
          }
        }
      }
    }

    // Open interval lines
    if (opts.openNodes.length > 0) {
      const pos: number[] = []
      for (const n of opts.openNodes) {
        pos.push(n.left.x, n.left.y, 0, n.right.x, n.right.y, 0)
      }
      const result = makeSegments(pos, openMat)
      if (result) {
        stepOverlayGroup.add(result.seg)
        stepGeometries.push(result.geom)
        stepLines.push(result.seg)
      }
    }

    // Pushed intervals
    if (opts.pushedNodes && opts.pushedNodes.length > 0) {
      const pos: number[] = []
      for (const n of opts.pushedNodes) {
        pos.push(n.left.x, n.left.y, 0, n.right.x, n.right.y, 0)
      }
      const result = makeSegments(pos, pushedMat)
      if (result) {
        stepOverlayGroup.add(result.seg)
        stepGeometries.push(result.geom)
        stepLines.push(result.seg)
      }
    }

    // Pruned interval (dashed)
    if (opts.prunedNode) {
      const n = opts.prunedNode
      const result = makeSegments(
        [n.left.x, n.left.y, 0, n.right.x, n.right.y, 0],
        prunedMat,
      )
      if (result) {
        stepOverlayGroup.add(result.seg)
        stepGeometries.push(result.geom)
        stepLines.push(result.seg)
      }
    }

    // Popped interval
    if (opts.poppedNode) {
      const n = opts.poppedNode
      const result = makeSegments(
        [n.left.x, n.left.y, 0, n.right.x, n.right.y, 0],
        poppedMat,
      )
      if (result) {
        stepOverlayGroup.add(result.seg)
        stepGeometries.push(result.geom)
        stepLines.push(result.seg)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // screenToMesh
  // ---------------------------------------------------------------------------

  function screenToMesh(clientX: number, clientY: number): Point | null {
    const rect = glRenderer.domElement.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    const v = new THREE.Vector3(ndcX, ndcY, 0)
    v.unproject(camera)
    return { x: v.x, y: v.y }
  }

  // ---------------------------------------------------------------------------
  // Hit testing (pure math)
  // ---------------------------------------------------------------------------

  function hitTestMarker(
    clientX: number,
    clientY: number,
    start: Point,
    goal: Point,
    radiusWorld: number,
  ): "start" | "goal" | null {
    const p = screenToMesh(clientX, clientY)
    if (!p) return null
    const dxS = p.x - start.x,
      dyS = p.y - start.y
    const dxG = p.x - goal.x,
      dyG = p.y - goal.y
    const distS = dxS * dxS + dyS * dyS
    const distG = dxG * dxG + dyG * dyG
    const r2 = radiusWorld * radiusWorld
    // Prefer closer marker; start takes priority on tie
    if (distS <= r2 && distG <= r2) return distS <= distG ? "start" : "goal"
    if (distS <= r2) return "start"
    if (distG <= r2) return "goal"
    return null
  }

  function hitTestObstacle(
    clientX: number,
    clientY: number,
    obstacles: Obstacle[],
  ): number | null {
    const p = screenToMesh(clientX, clientY)
    if (!p) return null
    // Iterate in reverse (top-most first for visual z-order)
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i]!
      const x0 = o.cx - o.w / 2,
        x1 = o.cx + o.w / 2
      const y0 = o.cy - o.h / 2,
        y1 = o.cy + o.h / 2
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) return i
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------

  function render() {
    glRenderer.render(scene, camera)
    cssRenderer.render(scene, camera)
  }

  // ---------------------------------------------------------------------------
  // dispose
  // ---------------------------------------------------------------------------

  function dispose() {
    ro.disconnect()

    disposeGroupContent(staticGroup, staticGeometries, staticLines)
    disposeGroupContent(obstacleGroup, obstacleGeometries, obstacleLines)
    disposeGroupContent(stepOverlayGroup, stepGeometries, stepLines)

    if (pathGeom) pathGeom.dispose()
    if (pathLine) pathGroup.remove(pathLine)

    // Dispose materials
    polyFillMat.dispose()
    interiorEdgeMat.dispose()
    boundaryEdgeMat.dispose()
    pathMat.dispose()
    markerBgMat.dispose()
    startFgMat.dispose()
    goalFgMat.dispose()
    expandedPolyMat.dispose()
    openMat.dispose()
    pushedMat.dispose()
    prunedMat.dispose()
    poppedMat.dispose()
    obsFillMat.dispose()
    obsSelectedFillMat.dispose()
    obsStrokeMat.dispose()
    obsSelectedStrokeMat.dispose()

    glRenderer.dispose()

    // Remove DOM
    if (container.parentNode) container.parentNode.removeChild(container)
  }

  // ---------------------------------------------------------------------------
  // Return interface
  // ---------------------------------------------------------------------------

  return {
    dispose,
    setMesh,
    setObstacles,
    setPath,
    setMarkers,
    setStepOverlays,
    clearStepOverlays,
    screenToMesh,
    hitTestMarker,
    hitTestObstacle,
    render,
    container,
  }
}
