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
  setVisibilityEdges(edges: { ax: number; ay: number; bx: number; by: number }[]): void
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
// Helpers
// ---------------------------------------------------------------------------

/** Recursively dispose all geometries in a group, then remove all children. */
function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof LineSegments2 || child instanceof Line2) {
      child.geometry.dispose()
    }
    if (child instanceof CSS2DObject) {
      child.element.remove()
    }
  }
  group.clear()
}

function makeSegments(
  positions: number[],
  material: LineMaterial,
): LineSegments2 | null {
  if (positions.length === 0) return null
  const geom = new LineSegmentsGeometry()
  geom.setPositions(positions)
  const seg = new LineSegments2(geom, material)
  seg.computeLineDistances()
  return seg
}

function makeLine2(
  positions: number[],
  material: LineMaterial,
): Line2 | null {
  if (positions.length < 6) return null
  const geom = new LineGeometry()
  geom.setPositions(positions)
  const line = new Line2(geom, material)
  line.computeLineDistances()
  return line
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

  // Force all CSS2DRenderer wrapper divs to be non-interactive
  const cssStyle = document.createElement("style")
  cssRenderer.domElement.setAttribute("data-css2d", "")
  cssStyle.textContent = "[data-css2d], [data-css2d] * { pointer-events: none !important; }"
  container.appendChild(cssStyle)

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
  scene.add(staticGroup, obstacleGroup, stepOverlayGroup, pathGroup, markerGroup)

  // --- State ---
  let currentBounds: Bounds | null = null
  const resolution = new THREE.Vector2(1, 1)

  // --- Materials (all with depthTest: false, depthWrite: false for 2D ortho) ---
  //const noDepth = { depthTest: false, depthWrite: false } as const
  //const lineNoDepth = { ...noDepth } as const

  const polyFillMat = new THREE.MeshBasicMaterial({
    color: 0x1a1a3e,
    transparent: true,
    opacity: 0.6,
    //...noDepth,
  })
  const interiorEdgeMat = new LineMaterial({
    color: 0x4a4e69,
    transparent: true,
    opacity: 0.4,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })
  const boundaryEdgeMat = new LineMaterial({
    color: 0xe94560,
    transparent: false,
    opacity: 1.0,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })
  const pathMat = new LineMaterial({
    color: 0x06d6a0,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })

  const markerBgMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  const startFgMat = new THREE.MeshBasicMaterial({ color: 0x06d6a0 })
  const goalFgMat = new THREE.MeshBasicMaterial({ color: 0xf72585 })

  const expandedPolyMat = new THREE.MeshBasicMaterial({
    color: 0x4361ee,
    transparent: true,
    opacity: 0.5,
    //...noDepth,
  })
  const openMat = new LineMaterial({
    color: 0xf8961e,
    transparent: true,
    opacity: 0.6,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })
  const pushedMat = new LineMaterial({
    color: 0x2ec4b6,
    transparent: true,
    opacity: 0.9,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })
  const prunedMat = new LineMaterial({
    color: 0x888888,
    transparent: true,
    opacity: 0.5,
    worldUnits: false,
    linewidth: 1,
    dashed: true,
    dashScale: 1,
    dashSize: 1,
    gapSize: 0.67,
    //...lineNoDepth,
  })
  const poppedMat = new LineMaterial({
    color: 0xf72585,
    transparent: true,
    opacity: 0.9,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })

  const obsFillMat = new THREE.MeshBasicMaterial({
    color: 0xe94560,
    transparent: true,
    opacity: 0.4,
    //...noDepth,
  })
  const obsSelectedFillMat = new THREE.MeshBasicMaterial({
    color: 0xf72585,
    transparent: true,
    opacity: 0.4,
    //...noDepth,
  })
  const obsStrokeMat = new LineMaterial({
    color: 0xe94560,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })
  const obsSelectedStrokeMat = new LineMaterial({
    color: 0xf72585,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })

  const visEdgeMat = new LineMaterial({
    color: 0x8888cc,
    transparent: true,
    opacity: 0.3,
    worldUnits: false,
    linewidth: 1,
    //...lineNoDepth,
  })

  // All LineMaterials that need resolution updates
  const allLineMats = [
    interiorEdgeMat,
    boundaryEdgeMat,
    pathMat,
    openMat,
    pushedMat,
    prunedMat,
    poppedMat,
    obsStrokeMat,
    obsSelectedStrokeMat,
    visEdgeMat,
  ]

  // All materials for disposal
  const allMaterials: THREE.Material[] = [
    polyFillMat,
    ...allLineMats,
    markerBgMat,
    startFgMat,
    goalFgMat,
    expandedPolyMat,
    obsFillMat,
    obsSelectedFillMat,
  ]

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function updateResolution(w: number, h: number) {
    resolution.set(w, h)
    for (const mat of allLineMats) mat.resolution.set(w, h)
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
      const visibleW = paddedH * viewAspect
      const cx = (paddedMinX + paddedMaxX) / 2
      left = cx - visibleW / 2
      right = cx + visibleW / 2
      bottom = paddedMinY
      top = paddedMaxY
    } else {
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

  function updateLineWidths() {
    interiorEdgeMat.linewidth = 1.5
    boundaryEdgeMat.linewidth = 3.0
    pathMat.linewidth = 3.0
    openMat.linewidth = 2.0
    pushedMat.linewidth = 3.0
    prunedMat.linewidth = 3.0
    poppedMat.linewidth = 3.0
    obsStrokeMat.linewidth = 3.0
    obsSelectedStrokeMat.linewidth =  3.0
    visEdgeMat.linewidth = 1.0
    prunedMat.dashSize = 6
    prunedMat.gapSize = 4
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
    currentBounds = bounds
    disposeGroup(staticGroup)

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
          v0.p.x, v0.p.y, 0,
          v1.p.x, v1.p.y, 0,
          v2.p.x, v2.p.y, 0,
        )
      }
    }
    if (triPositions.length > 0) {
      const geom = new THREE.BufferGeometry()
      geom.setAttribute("position", new THREE.Float32BufferAttribute(triPositions, 3))
      //staticGroup.add(new THREE.Mesh(geom, polyFillMat))
    }

    // --- Edges ---
    const seen = new Set<string>()
    const interiorPos: number[] = []
    const boundaryPos: number[] = []
    for (const poly of mesh.polygons) {
      if (!poly) continue
      const V = poly.vertices
      const P = poly.polygons
      for (let i = 0; i < V.length; i++) {
        const a = V[i]!
        const b = V[(i + 1) % V.length]!
        const key = a < b ? `${a},${b}` : `${b},${a}`
        if (seen.has(key)) continue
        seen.add(key)
        const va = mesh.vertices[a]
        const vb = mesh.vertices[b]
        if (!va || !vb) continue
        // Edge (V[i], V[i+1]): adjacent polygon is P[(i+1) % N]
        const arr = P[(i + 1) % V.length] === -1 ? boundaryPos : interiorPos
        arr.push(va.p.x, va.p.y, 0, vb.p.x, vb.p.y, 0)
      }
    }

    // Offset to prevent z-fighting with obstacles
    const interior = makeSegments(interiorPos, interiorEdgeMat)
    if (interior) { interior.position.z = -1.0; staticGroup.add(interior) }
    const boundary = makeSegments(boundaryPos, boundaryEdgeMat)
    if (boundary) { boundary.position.z = -0.5; staticGroup.add(boundary) }

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
    disposeGroup(obstacleGroup)
    if (obstacles.length === 0) return

    for (const o of obstacles) {
      const isSelected = o.id === selectedId
      const x0 = o.cx - o.w / 2
      const x1 = o.cx + o.w / 2
      const y0 = o.cy - o.h / 2
      const y1 = o.cy + o.h / 2

      // Fill quad
      const fillGeom = new THREE.BufferGeometry()
      fillGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0],
          3,
        ),
      )
      obstacleGroup.add(
        new THREE.Mesh(fillGeom, isSelected ? obsSelectedFillMat : obsFillMat),
      )

      // Outline
      const outline = makeSegments(
        [
          x0, y0, 0, x1, y0, 0,
          x1, y0, 0, x1, y1, 0,
          x1, y1, 0, x0, y1, 0,
          x0, y1, 0, x0, y0, 0,
        ],
        isSelected ? obsSelectedStrokeMat : obsStrokeMat,
      )
      if (outline) obstacleGroup.add(outline)
    }
  }

  // ---------------------------------------------------------------------------
  // setPath
  // ---------------------------------------------------------------------------

  function setPath(pathPts: Point[]) {
    disposeGroup(pathGroup)
    if (pathPts.length < 2) return

    const positions: number[] = []
    for (const p of pathPts) positions.push(p.x, p.y, 0)

    const line = makeLine2(positions, pathMat)
    if (line) pathGroup.add(line)
  }

  // ---------------------------------------------------------------------------
  // setVisibilityEdges
  // ---------------------------------------------------------------------------

  function setVisibilityEdges(
    edges: { ax: number; ay: number; bx: number; by: number }[],
  ) {
    // Visibility edges are added to staticGroup so setMesh clears them automatically
    if (edges.length === 0) return
    const positions: number[] = []
    for (const e of edges) {
      positions.push(e.ax, e.ay, 0, e.bx, e.by, 0)
    }
    const seg = makeSegments(positions, visEdgeMat)
    if (seg) staticGroup.add(seg)
  }

  // ---------------------------------------------------------------------------
  // setMarkers
  // ---------------------------------------------------------------------------

  function setMarkers(start: Point, goal: Point) {
    disposeGroup(markerGroup)
    if (!currentBounds) return

    const meshExtent = Math.max(
      currentBounds.maxX - currentBounds.minX,
      currentBounds.maxY - currentBounds.minY,
    )
    const markerR = meshExtent * 0.015

    const bgGeom = new THREE.CircleGeometry(markerR, 32)
    const fgGeom = new THREE.CircleGeometry(markerR * 0.8, 32)

    // Start marker
    const sBg = new THREE.Mesh(bgGeom, markerBgMat)
    sBg.position.set(start.x, start.y, 0)
    markerGroup.add(sBg)

    const sFg = new THREE.Mesh(fgGeom.clone(), startFgMat)
    sFg.position.set(start.x, start.y, 0.01)
    markerGroup.add(sFg)

    // Goal marker
    const gBg = new THREE.Mesh(bgGeom.clone(), markerBgMat)
    gBg.position.set(goal.x, goal.y, 0)
    markerGroup.add(gBg)

    const gFg = new THREE.Mesh(fgGeom.clone(), goalFgMat)
    gFg.position.set(goal.x, goal.y, 0.01)
    markerGroup.add(gFg)

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

    const sLabel = makeLabel("S", "#06d6a0")
    sLabel.position.set(start.x, start.y + markerR * 1.8, 0.02)
    markerGroup.add(sLabel)

    const gLabel = makeLabel("G", "#f72585")
    gLabel.position.set(goal.x, goal.y + markerR * 1.8, 0.02)
    markerGroup.add(gLabel)
  }

  // ---------------------------------------------------------------------------
  // setStepOverlays / clearStepOverlays
  // ---------------------------------------------------------------------------

  function clearStepOverlays() {
    disposeGroup(stepOverlayGroup)
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
              v0.p.x, v0.p.y, 0,
              v1.p.x, v1.p.y, 0,
              v2.p.x, v2.p.y, 0,
            )
          }
          if (positions.length > 0) {
            const geom = new THREE.BufferGeometry()
            geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
            stepOverlayGroup.add(new THREE.Mesh(geom, expandedPolyMat))
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
      const seg = makeSegments(pos, openMat)
      if (seg) stepOverlayGroup.add(seg)
    }

    // Pushed intervals
    if (opts.pushedNodes && opts.pushedNodes.length > 0) {
      const pos: number[] = []
      for (const n of opts.pushedNodes) {
        pos.push(n.left.x, n.left.y, 0, n.right.x, n.right.y, 0)
      }
      const seg = makeSegments(pos, pushedMat)
      if (seg) stepOverlayGroup.add(seg)
    }

    // Pruned interval (dashed)
    if (opts.prunedNode) {
      const n = opts.prunedNode
      const seg = makeSegments(
        [n.left.x, n.left.y, 0, n.right.x, n.right.y, 0],
        prunedMat,
      )
      if (seg) stepOverlayGroup.add(seg)
    }

    // Popped interval
    if (opts.poppedNode) {
      const n = opts.poppedNode
      const seg = makeSegments(
        [n.left.x, n.left.y, 0, n.right.x, n.right.y, 0],
        poppedMat,
      )
      if (seg) stepOverlayGroup.add(seg)
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
  // Hit testing
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
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i]!
      const x0 = o.cx - o.w / 2
      const x1 = o.cx + o.w / 2
      const y0 = o.cy - o.h / 2
      const y1 = o.cy + o.h / 2
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
    disposeGroup(staticGroup)
    disposeGroup(obstacleGroup)
    disposeGroup(stepOverlayGroup)
    disposeGroup(pathGroup)
    disposeGroup(markerGroup)
    for (const mat of allMaterials) mat.dispose()
    glRenderer.dispose()
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
    setVisibilityEdges,
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
