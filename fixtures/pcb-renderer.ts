import * as THREE from "three"
import { Line2 } from "three/examples/jsm/lines/Line2.js"
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js"
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js"
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js"
import type { Mesh, Point } from "../lib/index"
import type { TraceRoute } from "../lib/rubberband"

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
  x1: number
  y1: number
  x2: number
  y2: number
}

interface TraceState {
  id: number
  start: Point
  end: Point
}

export interface PcbUpdateOpts {
  mesh?: Mesh
  bounds: Bounds
  obstacles: Obstacle[]
  traces: TraceState[]
  routes: TraceRoute[]
  selectedTrace: number | null
  selectedObs: number | null
  showTriangulation: boolean
  showInitialPaths: boolean
  showCorridors: boolean
  showRubberbandPaths: boolean
}

export interface PcbRenderer {
  dispose(): void
  update(opts: PcbUpdateOpts): void
  screenToWorld(clientX: number, clientY: number): Point | null
  render(): void
  readonly container: HTMLDivElement
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof LineSegments2 || child instanceof Line2) {
      child.geometry.dispose()
    }
  }
  group.clear()
}

function makeSegments(positions: number[], material: LineMaterial): LineSegments2 | null {
  if (positions.length === 0) return null
  const geom = new LineSegmentsGeometry()
  geom.setPositions(positions)
  const seg = new LineSegments2(geom, material)
  seg.computeLineDistances()
  return seg
}

function makeLine2(positions: number[], material: LineMaterial): Line2 | null {
  if (positions.length < 6) return null
  const geom = new LineGeometry()
  geom.setPositions(positions)
  const line = new Line2(geom, material)
  line.computeLineDistances()
  return line
}

// Trace colors — cycle through these for multiple traces
const TRACE_COLORS = [0x06d6a0, 0x4cc9f0, 0xf8961e, 0xf72585, 0x7209b7, 0x3a86ff]

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPcbRenderer(): PcbRenderer {
  const container = document.createElement("div")
  container.style.width = "100%"
  container.style.height = "100%"
  container.style.position = "relative"

  const glRenderer = new THREE.WebGLRenderer({ antialias: true })
  glRenderer.setClearColor(0x0d1117)
  glRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1))
  container.appendChild(glRenderer.domElement)
  glRenderer.domElement.style.position = "absolute"
  glRenderer.domElement.style.inset = "0"
  glRenderer.domElement.style.borderRadius = "8px"

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)

  // Scene groups at different z layers
  const triangulationGroup = new THREE.Group()
  triangulationGroup.position.z = 0
  const corridorGroup = new THREE.Group()
  corridorGroup.position.z = 0.1
  const obstacleGroup = new THREE.Group()
  obstacleGroup.position.z = 0.2
  const initialPathGroup = new THREE.Group()
  initialPathGroup.position.z = 0.3
  const rubberbandGroup = new THREE.Group()
  rubberbandGroup.position.z = 0.4
  const markerGroup = new THREE.Group()
  markerGroup.position.z = 0.5
  scene.add(triangulationGroup, corridorGroup, obstacleGroup, initialPathGroup, rubberbandGroup, markerGroup)

  const resolution = new THREE.Vector2(1, 1)

  // Materials
  const interiorEdgeMat = new LineMaterial({
    color: 0x4a4e69,
    transparent: true,
    opacity: 0.3,
    worldUnits: false,
    linewidth: 1,
  })
  const boundaryEdgeMat = new LineMaterial({
    color: 0xe94560,
    transparent: false,
    opacity: 1.0,
    worldUnits: false,
    linewidth: 1,
  })
  const obsFillMat = new THREE.MeshBasicMaterial({
    color: 0xe94560,
    transparent: true,
    opacity: 0.3,
  })
  const obsSelectedFillMat = new THREE.MeshBasicMaterial({
    color: 0xf72585,
    transparent: true,
    opacity: 0.4,
  })
  const corridorFillMat = new THREE.MeshBasicMaterial({
    color: 0x4361ee,
    transparent: true,
    opacity: 0.15,
  })
  const startMarkerMat = new THREE.MeshBasicMaterial({ color: 0x06d6a0 })
  const endMarkerMat = new THREE.MeshBasicMaterial({ color: 0xf72585 })
  const selectedMarkerMat = new THREE.MeshBasicMaterial({ color: 0xffffff })

  const allLineMats = [interiorEdgeMat, boundaryEdgeMat]
  // Per-trace line materials created dynamically
  const traceLineMats: LineMaterial[] = []

  let currentBounds: Bounds | null = null

  // Resize observer
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    glRenderer.setSize(w, h)
    resolution.set(w, h)
    for (const m of allLineMats) m.resolution.set(w, h)
    for (const m of traceLineMats) m.resolution.set(w, h)
    if (currentBounds) updateCamera(currentBounds)
    doRender()
  })
  resizeObserver.observe(container)

  function updateCamera(bounds: Bounds) {
    currentBounds = bounds
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

    if (viewAspect > meshAspect) {
      const visibleW = paddedH * viewAspect
      const cx = (paddedMinX + paddedMaxX) / 2
      camera.left = cx - visibleW / 2
      camera.right = cx + visibleW / 2
      camera.bottom = paddedMinY
      camera.top = paddedMaxY
    } else {
      const visibleH = paddedW / viewAspect
      const cy = (paddedMinY + paddedMaxY) / 2
      camera.left = paddedMinX
      camera.right = paddedMaxX
      camera.bottom = cy - visibleH / 2
      camera.top = cy + visibleH / 2
    }
    camera.updateProjectionMatrix()
    glRenderer.setSize(cw, ch)
    resolution.set(cw, ch)
  }

  function screenToWorld(clientX: number, clientY: number): Point | null {
    const rect = glRenderer.domElement.getBoundingClientRect()
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
    const v = new THREE.Vector3(ndcX, ndcY, 0).unproject(camera)
    return { x: v.x, y: v.y }
  }

  function getTraceColor(index: number): number {
    return TRACE_COLORS[index % TRACE_COLORS.length]!
  }

  function getOrCreateTraceMat(index: number, opacity: number, linewidth: number, dashed = false): LineMaterial {
    const mat = new LineMaterial({
      color: getTraceColor(index),
      transparent: opacity < 1,
      opacity,
      worldUnits: false,
      linewidth,
      dashed,
      dashScale: dashed ? 2 : 1,
      dashSize: dashed ? 3 : 1,
      gapSize: dashed ? 2 : 0,
    })
    mat.resolution.copy(resolution)
    traceLineMats.push(mat)
    return mat
  }

  function buildTriangulation(mesh: Mesh, bounds: Bounds) {
    disposeGroup(triangulationGroup)
    updateCamera(bounds)

    const interiorPositions: number[] = []
    const boundaryPositions: number[] = []
    const edgeSet = new Set<string>()

    for (const poly of mesh.polygons) {
      if (!poly) continue
      const V = poly.vertices
      for (let i = 0; i < V.length; i++) {
        const a = V[i]!
        const b = V[(i + 1) % V.length]!
        const key = a < b ? `${a},${b}` : `${b},${a}`
        if (edgeSet.has(key)) continue
        edgeSet.add(key)

        const va = mesh.vertices[a]!.p
        const vb = mesh.vertices[b]!.p
        const adjPoly = poly.polygons[(i + 1) % V.length]

        const positions = adjPoly === -1 ? boundaryPositions : interiorPositions
        positions.push(va.x, va.y, -1, vb.x, vb.y, -1)
      }
    }

    const interiorSeg = makeSegments(interiorPositions, interiorEdgeMat)
    if (interiorSeg) triangulationGroup.add(interiorSeg)

    const boundarySeg = makeSegments(boundaryPositions, boundaryEdgeMat)
    if (boundarySeg) triangulationGroup.add(boundarySeg)
  }

  function buildObstacles(obstacles: Obstacle[], selectedId: number | null) {
    disposeGroup(obstacleGroup)

    for (const obs of obstacles) {
      const x1 = Math.min(obs.x1, obs.x2)
      const y1 = Math.min(obs.y1, obs.y2)
      const x2 = Math.max(obs.x1, obs.x2)
      const y2 = Math.max(obs.y1, obs.y2)
      const w = x2 - x1
      const h = y2 - y1
      if (w < 0.1 || h < 0.1) continue

      const mat = obs.id === selectedId ? obsSelectedFillMat : obsFillMat
      const geom = new THREE.PlaneGeometry(w, h)
      const m = new THREE.Mesh(geom, mat)
      m.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0)
      obstacleGroup.add(m)
    }
  }

  function buildCorridors(mesh: Mesh, routes: TraceRoute[]) {
    disposeGroup(corridorGroup)

    for (const route of routes) {
      if (route.corridor.length === 0) continue

      const positions: number[] = []
      const indices: number[] = []
      let vIdx = 0

      for (const polyIdx of route.corridor) {
        const poly = mesh.polygons[polyIdx]
        if (!poly) continue

        const verts = poly.vertices
        if (verts.length < 3) continue

        // Fan triangulation from first vertex
        const v0 = mesh.vertices[verts[0]!]!.p
        for (let i = 1; i < verts.length - 1; i++) {
          const v1 = mesh.vertices[verts[i]!]!.p
          const v2 = mesh.vertices[verts[i + 1]!]!.p
          positions.push(v0.x, v0.y, 0, v1.x, v1.y, 0, v2.x, v2.y, 0)
          indices.push(vIdx, vIdx + 1, vIdx + 2)
          vIdx += 3
        }
      }

      if (positions.length > 0) {
        const geom = new THREE.BufferGeometry()
        geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
        geom.setIndex(indices)
        const m = new THREE.Mesh(geom, corridorFillMat)
        corridorGroup.add(m)
      }
    }
  }

  function buildPaths(
    traces: TraceState[],
    routes: TraceRoute[],
    selectedTrace: number | null,
    showInitial: boolean,
    showRubberband: boolean,
  ) {
    disposeGroup(initialPathGroup)
    disposeGroup(rubberbandGroup)

    // Clean up old per-trace materials
    for (const m of traceLineMats) m.dispose()
    traceLineMats.length = 0

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]!
      const isSelected = route.trace.id === selectedTrace

      // Initial path (dashed)
      if (showInitial && route.initialPath.length >= 2) {
        const mat = getOrCreateTraceMat(i, isSelected ? 0.8 : 0.4, isSelected ? 2 : 1, true)
        const positions: number[] = []
        for (const p of route.initialPath) positions.push(p.x, p.y, 0)
        const line = makeLine2(positions, mat)
        if (line) initialPathGroup.add(line)
      }

      // Rubberband path (solid)
      if (showRubberband && route.rubberbandPath.length >= 2) {
        const mat = getOrCreateTraceMat(i, 1.0, isSelected ? 3 : 2)
        const positions: number[] = []
        for (const p of route.rubberbandPath) positions.push(p.x, p.y, 0)
        const line = makeLine2(positions, mat)
        if (line) rubberbandGroup.add(line)
      }
    }
  }

  function buildMarkers(traces: TraceState[], selectedTrace: number | null) {
    disposeGroup(markerGroup)

    const extent = currentBounds
      ? Math.max(currentBounds.maxX - currentBounds.minX, currentBounds.maxY - currentBounds.minY)
      : 100
    const r = extent * 0.012

    for (let i = 0; i < traces.length; i++) {
      const t = traces[i]!
      const isSelected = t.id === selectedTrace

      // Start marker (circle)
      const startGeom = new THREE.CircleGeometry(isSelected ? r * 1.3 : r, 16)
      const startM = new THREE.Mesh(startGeom, isSelected ? selectedMarkerMat : startMarkerMat)
      startM.position.set(t.start.x, t.start.y, 0)
      markerGroup.add(startM)

      // End marker (circle)
      const endGeom = new THREE.CircleGeometry(isSelected ? r * 1.3 : r, 16)
      const endM = new THREE.Mesh(endGeom, isSelected ? selectedMarkerMat : endMarkerMat)
      endM.position.set(t.end.x, t.end.y, 0)
      markerGroup.add(endM)
    }
  }

  function doRender() {
    glRenderer.render(scene, camera)
  }

  return {
    container,
    dispose() {
      resizeObserver.disconnect()
      disposeGroup(triangulationGroup)
      disposeGroup(corridorGroup)
      disposeGroup(obstacleGroup)
      disposeGroup(initialPathGroup)
      disposeGroup(rubberbandGroup)
      disposeGroup(markerGroup)
      interiorEdgeMat.dispose()
      boundaryEdgeMat.dispose()
      obsFillMat.dispose()
      obsSelectedFillMat.dispose()
      corridorFillMat.dispose()
      startMarkerMat.dispose()
      endMarkerMat.dispose()
      selectedMarkerMat.dispose()
      for (const m of traceLineMats) m.dispose()
      glRenderer.dispose()
    },
    update(opts: PcbUpdateOpts) {
      if (opts.mesh) {
        if (opts.showTriangulation) {
          buildTriangulation(opts.mesh, opts.bounds)
          triangulationGroup.visible = true
        } else {
          disposeGroup(triangulationGroup)
          updateCamera(opts.bounds)
          triangulationGroup.visible = false
        }

        if (opts.showCorridors) {
          buildCorridors(opts.mesh, opts.routes)
          corridorGroup.visible = true
        } else {
          disposeGroup(corridorGroup)
          corridorGroup.visible = false
        }
      } else {
        disposeGroup(triangulationGroup)
        disposeGroup(corridorGroup)
        updateCamera(opts.bounds)
      }

      buildObstacles(opts.obstacles, opts.selectedObs)
      buildPaths(opts.traces, opts.routes, opts.selectedTrace, opts.showInitialPaths, opts.showRubberbandPaths)
      buildMarkers(opts.traces, opts.selectedTrace)
    },
    screenToWorld,
    render: doRender,
  }
}
