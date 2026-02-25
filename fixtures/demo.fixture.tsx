import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  memo,
  type CSSProperties,
} from "react"
import {
  Mesh,
  SearchInstance,
  StepEventType,
  buildMeshFromRegions,
  type Point,
  type SearchNode,
  type StepEvent,
} from "../lib/index"
import { computeConvexRegions } from "@tscircuit/find-convex-regions"

const BASE = import.meta.env.BASE_URL

// ---------------------------------------------------------------------------
// Mesh catalog — fetched on-demand from public/meshes/
// ---------------------------------------------------------------------------

interface MeshEntry {
  id: string
  label: string
  group: string
  path?: string // undefined = generated, not a file
  start: Point
  goal: Point
}

const MESH_CATALOG: MeshEntry[] = [
  // --- Generated (editor) ---
  { id: "editor", label: "Obstacle Editor", group: "Editor", start: { x: -8, y: 0 }, goal: { x: 8, y: 0 } },
  // --- Simple ---
  { id: "square", label: "Square (4 poly)", group: "Simple", path: "/meshes/tests/square.mesh", start: { x: 0.5, y: 0.5 }, goal: { x: -0.5, y: -0.5 } },
  { id: "hard", label: "Hard (38 poly)", group: "Simple", path: "/meshes/tests/hard.mesh", start: { x: 3, y: 3 }, goal: { x: 8, y: 8 } },
  { id: "bad-ambig", label: "bad-ambig (4 poly)", group: "Simple", path: "/meshes/tests/bad-ambig.mesh", start: { x: 0, y: 0.5 }, goal: { x: 2, y: 1.5 } },
  { id: "bad-collinear", label: "bad-collinear (6 poly)", group: "Simple", path: "/meshes/tests/bad-collinear.mesh", start: { x: 1, y: 1 }, goal: { x: 3, y: 5 } },
  // --- Game maps ---
  { id: "arena-merged", label: "Arena — DAO (55 poly)", group: "Game Maps", path: "/meshes/arena-merged.mesh", start: { x: 3, y: 5 }, goal: { x: 45, y: 35 } },
  { id: "arena", label: "Arena unmerged — DAO (120 poly)", group: "Game Maps", path: "/meshes/arena.mesh", start: { x: 3, y: 5 }, goal: { x: 45, y: 35 } },
  { id: "brc202d", label: "brc202d — DAO (4k poly)", group: "Game Maps", path: "/meshes/dao/brc202d.mesh", start: { x: 38, y: 55 }, goal: { x: 509, y: 447 } },
  { id: "AR0602SR", label: "AR0602SR — BG (5.5k poly)", group: "Game Maps", path: "/meshes/bgmaps/AR0602SR.mesh", start: { x: 150, y: 200 }, goal: { x: 500, y: 600 } },
  { id: "catwalk", label: "CatwalkAlley — SC (15k poly)", group: "Game Maps", path: "/meshes/sc/CatwalkAlley.mesh", start: { x: 11, y: 290 }, goal: { x: 316, y: 404 } },
  { id: "aurora-merged", label: "Aurora — SC (19k poly)", group: "Game Maps", path: "/meshes/aurora-merged.mesh", start: { x: 200, y: 200 }, goal: { x: 800, y: 600 } },
  // --- City streets ---
  { id: "new-york", label: "New York (10k poly)", group: "City Streets", path: "/meshes/street-maps/NewYork_0_1024.mesh", start: { x: 185, y: 380 }, goal: { x: 1005, y: 489 } },
  { id: "paris", label: "Paris (11k poly)", group: "City Streets", path: "/meshes/street-maps/Paris_0_1024.mesh", start: { x: 200, y: 200 }, goal: { x: 800, y: 800 } },
  { id: "shanghai", label: "Shanghai (13k poly)", group: "City Streets", path: "/meshes/street-maps/Shanghai_2_1024.mesh", start: { x: 200, y: 200 }, goal: { x: 800, y: 800 } },
  { id: "london", label: "London (19k poly)", group: "City Streets", path: "/meshes/street-maps/London_0_1024.mesh", start: { x: 200, y: 200 }, goal: { x: 800, y: 800 } },
  { id: "berlin", label: "Berlin (20k poly)", group: "City Streets", path: "/meshes/street-maps/Berlin_0_1024.mesh", start: { x: 200, y: 200 }, goal: { x: 800, y: 800 } },
  { id: "moscow", label: "Moscow (27k poly)", group: "City Streets", path: "/meshes/street-maps/Moscow_0_1024.mesh", start: { x: 200, y: 200 }, goal: { x: 800, y: 800 } },
  { id: "london2", label: "London area 2 (32k poly)", group: "City Streets", path: "/meshes/street-maps/London_2_1024.mesh", start: { x: 200, y: 200 }, goal: { x: 800, y: 800 } },
  { id: "boston", label: "Boston (33k poly)", group: "City Streets", path: "/meshes/street-maps/Boston_0_1024.mesh", start: { x: 355, y: 233 }, goal: { x: 855, y: 574 } },
  // --- Random obstacles ---
  { id: "random-900", label: "900 obstacles (13k poly)", group: "Random", path: "/meshes/random-obstacles/random-900.mesh", start: { x: 100, y: 100 }, goal: { x: 900, y: 900 } },
  { id: "random-3000", label: "3000 obstacles (42k poly)", group: "Random", path: "/meshes/random-obstacles/random-3000.mesh", start: { x: 100, y: 100 }, goal: { x: 900, y: 900 } },
  { id: "random-6000", label: "6000 obstacles (84k poly)", group: "Random", path: "/meshes/random-obstacles/random-6000.mesh", start: { x: 100, y: 100 }, goal: { x: 900, y: 900 } },
  { id: "random-9000", label: "9000 obstacles (126k poly)", group: "Random", path: "/meshes/random-obstacles/random-9000.mesh", start: { x: 100, y: 100 }, goal: { x: 900, y: 900 } },
  // --- Maze ---
  { id: "maze512", label: "Maze 512 (43k poly)", group: "Maze", path: "/meshes/maze512-1-0-merged.mesh", start: { x: 100, y: 100 }, goal: { x: 400, y: 400 } },
]

const GROUPS = [...new Set(MESH_CATALOG.map((m) => m.group))]

// ---------------------------------------------------------------------------
// Editor obstacle types
// ---------------------------------------------------------------------------

interface Obstacle {
  id: number
  cx: number
  cy: number
  w: number
  h: number
}

const DEFAULT_BOUNDS = { minX: -10, maxX: 10, minY: -10, maxY: 10 }

const DEFAULT_OBSTACLES: Obstacle[] = [
  { id: 1, cx: 0, cy: 0, w: 4, h: 4 },
]

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function getMeshBounds(mesh: Mesh) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const v of mesh.vertices) {
    if (!v) continue
    minX = Math.min(minX, v.p.x); maxX = Math.max(maxX, v.p.x)
    minY = Math.min(minY, v.p.y); maxY = Math.max(maxY, v.p.y)
  }
  return { minX, maxX, minY, maxY }
}

function buildEdgePaths(mesh: Mesh) {
  const seen = new Set<string>()
  let boundaryD = "", interiorD = ""
  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices, P = poly.polygons
    for (let i = 0; i < V.length; i++) {
      const a = V[i]!, b = V[(i + 1) % V.length]!
      const key = a < b ? `${a},${b}` : `${b},${a}`
      if (seen.has(key)) continue
      seen.add(key)
      const va = mesh.vertices[a], vb = mesh.vertices[b]
      if (!va || !vb) continue
      const seg = `M${va.p.x} ${-va.p.y}L${vb.p.x} ${-vb.p.y}`
      if (P[(i + 1) % V.length] === -1) boundaryD += seg; else interiorD += seg
    }
  }
  return { boundaryD, interiorD }
}

function buildPolyPath(mesh: Mesh) {
  let d = ""
  for (const poly of mesh.polygons) {
    if (!poly) continue
    const V = poly.vertices
    let seg = ""
    let valid = true
    for (let i = 0; i < V.length; i++) {
      const v = mesh.vertices[V[i]!]
      if (!v) { valid = false; break }
      seg += i === 0 ? `M${v.p.x} ${-v.p.y}` : `L${v.p.x} ${-v.p.y}`
    }
    if (valid) d += seg + "Z"
  }
  return d
}

function pathLen(pts: Point[]) {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x, dy = pts[i]!.y - pts[i - 1]!.y
    len += Math.sqrt(dx * dx + dy * dy)
  }
  return len
}

// ---------------------------------------------------------------------------
// Memoized static mesh layer
// ---------------------------------------------------------------------------

const MeshLayer = memo(function MeshLayer({ polyPath, interiorD, boundaryD, sw }: { polyPath: string; interiorD: string; boundaryD: string; sw: number }) {
  return (
    <g>
      <path d={polyPath} fill="#1a1a3e" fillOpacity={0.6} stroke="none" />
      <path d={interiorD} fill="none" stroke="#4a4e69" strokeWidth={sw} opacity={0.4} />
      <path d={boundaryD} fill="none" stroke="#e94560" strokeWidth={sw * 1.5} opacity={0.8} />
    </g>
  )
})

// ---------------------------------------------------------------------------
// Build mesh from editor obstacles using find-convex-regions
// ---------------------------------------------------------------------------

function buildMeshFromObstacles(obstacles: Obstacle[], clearance: number, concavityTolerance: number) {
  const t0 = performance.now()
  const result = computeConvexRegions({
    bounds: DEFAULT_BOUNDS,
    rects: obstacles.map((o) => ({
      center: { x: o.cx, y: o.cy },
      width: o.w,
      height: o.h,
      ccwRotation: 0,
    })),
    clearance,
    concavityTolerance,
    useConstrainedDelaunay: true,
  })
  const mesh = buildMeshFromRegions({ regions: result.regions })
  const buildTimeMs = performance.now() - t0
  return { mesh, buildTimeMs, regionCount: result.regions.length }
}

// ---------------------------------------------------------------------------
// Run search and produce path + stats
// ---------------------------------------------------------------------------

function runSearch(mesh: Mesh, start: Point, goal: Point, buildTimeMs: number): { path: Point[]; stats: Stats } {
  const s = new SearchInstance(mesh)
  s.setStartGoal(start, goal)
  const t0 = performance.now()
  s.search()
  const searchTimeMs = performance.now() - t0
  const pts = s.getPathPoints()
  return {
    path: pts,
    stats: {
      generated: s.nodesGenerated, pushed: s.nodesPushed,
      popped: s.nodesPopped, pruned: s.nodesPrunedPostPop,
      openSize: 0, cost: s.getCost(), pathLength: pathLen(pts),
      searchTimeMs, buildTimeMs,
    },
  }
}

// ---------------------------------------------------------------------------
// Direct-DOM overlay: updates markers + path without React re-renders
// ---------------------------------------------------------------------------

/** Refs for the overlay SVG elements that are mutated directly during drag */
interface OverlayRefs {
  pathEl: SVGPathElement | null
  startCircle: SVGCircleElement | null
  goalCircle: SVGCircleElement | null
  startLabel: SVGTextElement | null
  goalLabel: SVGTextElement | null
}

function updateOverlayDOM(
  refs: OverlayRefs,
  start: Point,
  goal: Point,
  pathPts: Point[],
  markerR: number,
) {
  if (refs.startCircle) { refs.startCircle.setAttribute("cx", String(start.x)); refs.startCircle.setAttribute("cy", String(-start.y)) }
  if (refs.goalCircle) { refs.goalCircle.setAttribute("cx", String(goal.x)); refs.goalCircle.setAttribute("cy", String(-goal.y)) }
  if (refs.startLabel) { refs.startLabel.setAttribute("x", String(start.x)); refs.startLabel.setAttribute("y", String(-start.y - markerR * 1.6)) }
  if (refs.goalLabel) { refs.goalLabel.setAttribute("x", String(goal.x)); refs.goalLabel.setAttribute("y", String(-goal.y - markerR * 1.6)) }
  if (refs.pathEl) {
    refs.pathEl.setAttribute("d", pathPts.length < 2 ? "" : "M" + pathPts.map((p) => `${p.x} ${-p.y}`).join("L"))
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Stats {
  generated: number; pushed: number; popped: number; pruned: number
  openSize: number; cost: number; pathLength: number; searchTimeMs: number; buildTimeMs: number
}

const ZERO_STATS: Stats = {
  generated: 0, pushed: 0, popped: 0, pruned: 0,
  openSize: 0, cost: -1, pathLength: 0, searchTimeMs: 0, buildTimeMs: 0,
}

type BuildMethod = "file" | "cdt"

export default function PolyanyaDemo() {
  const [selectedId, setSelectedId] = useState("editor")
  const entry = MESH_CATALOG.find((m) => m.id === selectedId)!
  const isEditor = selectedId === "editor"

  // --- build method ---
  const [buildMethod, setBuildMethod] = useState<BuildMethod>("cdt")
  const canCdt = isEditor
  const canFile = !isEditor && !!entry.path
  const effectiveMethod: BuildMethod = canCdt ? "cdt" : "file"

  // --- mesh state ---
  const [mesh, setMesh] = useState<Mesh | null>(null)
  const [loading, setLoading] = useState(false)
  const [buildTimeMs, setBuildTimeMs] = useState(0)
  const meshCache = useRef(new Map<string, Mesh>())

  // --- editor state ---
  const [obstacles, setObstacles] = useState<Obstacle[]>(DEFAULT_OBSTACLES)
  const [nextId, setNextId] = useState(2)
  const [clearance, setClearance] = useState(0.5)
  const [concavityTolerance, setConcavityTolerance] = useState(0)
  const [selectedObs, setSelectedObs] = useState<number | null>(null)
  const draggingObs = useRef<{ id: number; offX: number; offY: number } | null>(null)

  // --- search state ---
  const [start, setStart] = useState<Point>(entry.start)
  const [goal, setGoal] = useState<Point>(entry.goal)
  const [livePath, setLivePath] = useState<Point[]>([])
  const [liveStats, setLiveStats] = useState<Stats>(ZERO_STATS)

  // --- step-through state ---
  const [mode, setMode] = useState<"live" | "stepping" | "running" | "done">("live")
  const [stepSpeed, setStepSpeed] = useState(200)
  const [eventLog, setEventLog] = useState<StepEvent[]>([])
  const [highlight, setHighlight] = useState<{ expandedPoly?: number; poppedNode?: SearchNode; pushedNodes?: SearchNode[]; prunedNode?: SearchNode }>({})
  const [openNodes, setOpenNodes] = useState<SearchNode[]>([])
  const [stepPath, setStepPath] = useState<Point[]>([])
  const [stepStats, setStepStats] = useState<Stats>(ZERO_STATS)

  const searchRef = useRef<SearchInstance | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const draggingRef = useRef<"start" | "goal" | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const stepStartTime = useRef(0)

  // --- overlay refs for direct DOM updates during drag ---
  const overlayRefs = useRef<OverlayRefs>({ pathEl: null, startCircle: null, goalCircle: null, startLabel: null, goalLabel: null })
  const dragRaf = useRef(0)
  // Mutable copies of start/goal that update during drag without React re-renders
  const liveStart = useRef(start)
  const liveGoal = useRef(goal)
  // Keep in sync when React state changes
  useEffect(() => { liveStart.current = start }, [start])
  useEffect(() => { liveGoal.current = goal }, [goal])

  // --- load mesh from file or build from editor ---
  useEffect(() => {
    if (isEditor) {
      const { mesh: m, buildTimeMs: bt } = buildMeshFromObstacles(obstacles, clearance, concavityTolerance)
      setMesh(m)
      setBuildTimeMs(bt)
      return
    }
    if (!entry.path) return

    const cached = meshCache.current.get(entry.id)
    if (cached) { setMesh(cached); setBuildTimeMs(0); return }

    setLoading(true)
    fetch(`${BASE}${entry.path.replace(/^\//, "")}`)
      .then((r) => r.text())
      .then((text) => {
        const t0 = performance.now()
        const m = Mesh.fromString(text)
        const bt = performance.now() - t0
        meshCache.current.set(entry.id, m)
        setMesh(m)
        setBuildTimeMs(bt)
      })
      .finally(() => setLoading(false))
  }, [isEditor ? `editor-${JSON.stringify(obstacles)}-${clearance}-${concavityTolerance}` : entry.id])

  // --- reset on mesh change ---
  useEffect(() => {
    setStart(entry.start)
    setGoal(entry.goal)
    setBuildMethod(selectedId === "editor" ? "cdt" : "file")
    exitStepMode()
  }, [selectedId])

  // --- compute path whenever mesh/start/goal change (not during drag) ---
  useEffect(() => {
    if (!mesh) return
    const { path, stats } = runSearch(mesh, start, goal, buildTimeMs)
    setLivePath(path)
    setLiveStats(stats)
  }, [mesh, start, goal, buildTimeMs])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [eventLog.length])

  // --- derived SVG data ---
  const bounds = useMemo(() => mesh ? getMeshBounds(mesh) : { minX: -10, maxX: 10, minY: -10, maxY: 10 }, [mesh])
  const edgePaths = useMemo(() => mesh ? buildEdgePaths(mesh) : { boundaryD: "", interiorD: "" }, [mesh])
  const polyPath = useMemo(() => mesh ? buildPolyPath(mesh) : "", [mesh])

  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.06
  const vbX = bounds.minX - pad, vbY = -(bounds.maxY + pad)
  const vbW = bounds.maxX - bounds.minX + 2 * pad
  const vbH = bounds.maxY - bounds.minY + 2 * pad
  const sw = vbW * 0.003, markerR = vbW * 0.015
  const viewBox = `${vbX} ${vbY} ${vbW} ${vbH}`

  const svgToMesh = useCallback((e: React.MouseEvent | MouseEvent): Point | null => {
    const svg = svgRef.current; if (!svg) return null
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY
    const ctm = svg.getScreenCTM(); if (!ctm) return null
    const s = pt.matrixTransform(ctm.inverse())
    return { x: s.x, y: -s.y }
  }, [])

  // --- step helpers ---
  const readStats = useCallback((s: SearchInstance): Stats => {
    const pts = s.getPathPoints()
    return {
      generated: s.nodesGenerated, pushed: s.nodesPushed,
      popped: s.nodesPopped, pruned: s.nodesPrunedPostPop,
      openSize: s.getOpenListNodes().length, cost: s.getCost(),
      pathLength: pathLen(pts), searchTimeMs: performance.now() - stepStartTime.current, buildTimeMs,
    }
  }, [buildTimeMs])

  const exitStepMode = useCallback(() => {
    setMode("live"); setEventLog([]); setHighlight({}); setOpenNodes([]); setStepPath([]); setStepStats(ZERO_STATS); searchRef.current = null
  }, [])

  const doStep = useCallback(() => {
    const s = searchRef.current
    if (!s || s.isSearchComplete()) { if (s) { setStepPath(s.getPathPoints()); setStepStats(readStats(s)) }; setMode("done"); return }
    const events = s.step(); setEventLog((prev) => [...prev, ...events])
    const hl: typeof highlight = {}
    for (const ev of events) {
      switch (ev.type) {
        case StepEventType.NODE_POPPED: hl.poppedNode = ev.node; hl.expandedPoly = ev.node?.nextPolygon; break
        case StepEventType.NODE_EXPANDED: hl.expandedPoly = ev.node?.nextPolygon; break
        case StepEventType.NODE_PUSHED: if (!hl.pushedNodes) hl.pushedNodes = []; if (ev.node) hl.pushedNodes.push(ev.node); break
        case StepEventType.NODE_PRUNED: hl.prunedNode = ev.node; break
        case StepEventType.GOAL_REACHED: setStepPath(s.getPathPoints()); setMode("done"); break
        case StepEventType.SEARCH_EXHAUSTED: setMode("done"); break
      }
    }
    setHighlight(hl); setOpenNodes([...s.getOpenListNodes()]); setStepStats(readStats(s))
  }, [readStats])

  useEffect(() => { if (mode !== "running") return; const id = setInterval(doStep, stepSpeed); return () => clearInterval(id) }, [mode, stepSpeed, doStep])

  const handleStepThrough = useCallback(() => {
    if (!mesh) return
    const s = new SearchInstance(mesh); s.setStartGoal(start, goal); searchRef.current = s; stepStartTime.current = performance.now()
    const init = s.searchInit(); setEventLog(init); setHighlight({}); setOpenNodes([...s.getOpenListNodes()]); setStepPath([]); setStepStats(readStats(s))
    if (s.isSearchComplete()) { setStepPath(s.getPathPoints()); setMode("done") } else setMode("stepping")
  }, [mesh, start, goal, readStats])

  // --- dragging start/goal ---
  // Uses direct DOM manipulation during drag → no React re-renders.
  // Search runs at rAF rate (capped at 60fps) on a background timer.
  // On mouse-up the final position is flushed to React state.

  const onMarkerDown = useCallback((which: "start" | "goal") => (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (mode !== "live") exitStepMode()
    draggingRef.current = which
  }, [mode, exitStepMode])

  const onSvgMove = useCallback((e: React.MouseEvent) => {
    // --- drag start/goal: direct DOM path ---
    if (draggingRef.current) {
      const p = svgToMesh(e); if (!p) return
      if (draggingRef.current === "start") liveStart.current = p
      else liveGoal.current = p

      // Throttle visual updates + search to once per rAF
      if (!dragRaf.current) {
        dragRaf.current = requestAnimationFrame(() => {
          dragRaf.current = 0
          const curStart = liveStart.current
          const curGoal = liveGoal.current
          // Run search and update overlay DOM directly
          if (mesh) {
            const { path } = runSearch(mesh, curStart, curGoal, buildTimeMs)
            updateOverlayDOM(overlayRefs.current, curStart, curGoal, path, markerR)
          } else {
            updateOverlayDOM(overlayRefs.current, curStart, curGoal, [], markerR)
          }
        })
      }
      return
    }
    // --- drag obstacle in editor ---
    const drag = draggingObs.current
    if (drag && isEditor) {
      const p = svgToMesh(e); if (!p) return
      setObstacles((prev) => prev.map((o) => o.id === drag.id ? { ...o, cx: p.x + drag.offX, cy: p.y + drag.offY } : o))
    }
  }, [svgToMesh, isEditor, mesh, buildTimeMs, markerR])

  const onSvgUp = useCallback(() => {
    // Flush final drag position to React state (triggers proper re-render + stats update)
    if (draggingRef.current) {
      if (dragRaf.current) { cancelAnimationFrame(dragRaf.current); dragRaf.current = 0 }
      setStart({ ...liveStart.current })
      setGoal({ ...liveGoal.current })
    }
    draggingRef.current = null
    draggingObs.current = null
  }, [])

  // --- editor: add obstacle on double-click ---
  const onSvgDblClick = useCallback((e: React.MouseEvent) => {
    if (!isEditor) return
    const p = svgToMesh(e); if (!p) return
    setObstacles((prev) => [...prev, { id: nextId, cx: p.x, cy: p.y, w: 2, h: 2 }])
    setNextId((n) => n + 1)
  }, [isEditor, svgToMesh, nextId])

  // --- editor: start dragging an obstacle ---
  const onObstacleDown = useCallback((obs: Obstacle, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const p = svgToMesh(e); if (!p) return
    setSelectedObs(obs.id)
    draggingObs.current = { id: obs.id, offX: obs.cx - p.x, offY: obs.cy - p.y }
  }, [svgToMesh])

  const deleteSelected = useCallback(() => {
    if (selectedObs === null) return
    setObstacles((prev) => prev.filter((o) => o.id !== selectedObs))
    setSelectedObs(null)
  }, [selectedObs])

  // --- display ---
  const inStep = mode !== "live"
  const displayPath = inStep ? stepPath : livePath
  const displayStats = inStep ? stepStats : liveStats
  const pathD = useMemo(() => displayPath.length < 2 ? "" : "M" + displayPath.map((p) => `${p.x} ${-p.y}`).join("L"), [displayPath])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={rootStyle}>
      <div style={canvasWrap}>
        {loading && <div style={loadingStyle}>Loading mesh...</div>}

        {/* Bottom layer: static mesh — only re-renders when mesh changes */}
        <svg viewBox={viewBox} style={svgStyleBg}>
          <MeshLayer polyPath={polyPath} interiorD={edgePaths.interiorD} boundaryD={edgePaths.boundaryD} sw={sw} />

          {/* Editor: obstacle rectangles */}
          {isEditor && obstacles.map((o) => (
            <rect key={o.id} x={o.cx - o.w / 2} y={-(o.cy + o.h / 2)} width={o.w} height={o.h}
              fill={selectedObs === o.id ? "#f72585" : "#e94560"} fillOpacity={0.4}
              stroke={selectedObs === o.id ? "#f72585" : "#e94560"} strokeWidth={sw * 2} />
          ))}
        </svg>

        {/* Top layer: dynamic overlay — path, markers, step overlays, mouse events */}
        <svg ref={svgRef} viewBox={viewBox} style={svgStyleFg}
          onMouseMove={onSvgMove} onMouseUp={onSvgUp} onMouseLeave={onSvgUp} onDoubleClick={onSvgDblClick}>

          {/* Editor: invisible obstacle hit targets (for mouse events on top layer) */}
          {isEditor && obstacles.map((o) => (
            <rect key={o.id} x={o.cx - o.w / 2} y={-(o.cy + o.h / 2)} width={o.w} height={o.h}
              fill="transparent" stroke="none"
              style={{ cursor: "move" }} onMouseDown={(e) => onObstacleDown(o, e)} />
          ))}

          {/* Step-through overlays */}
          {inStep && highlight.expandedPoly != null && (() => {
            const poly = mesh!.polygons[highlight.expandedPoly]!
            return <polygon points={poly.vertices.map((vi) => { const p = mesh!.vertices[vi]!.p; return `${p.x},${-p.y}` }).join(" ")} fill="#4361ee" fillOpacity={0.5} />
          })()}
          {inStep && openNodes.map((n, i) => <line key={i} x1={n.left.x} y1={-n.left.y} x2={n.right.x} y2={-n.right.y} stroke="#f8961e" strokeWidth={sw * 2} opacity={0.6} strokeLinecap="round" />)}
          {inStep && highlight.pushedNodes?.map((n, i) => <line key={i} x1={n.left.x} y1={-n.left.y} x2={n.right.x} y2={-n.right.y} stroke="#2ec4b6" strokeWidth={sw * 3} opacity={0.9} strokeLinecap="round" />)}
          {inStep && highlight.prunedNode && <line x1={highlight.prunedNode.left.x} y1={-highlight.prunedNode.left.y} x2={highlight.prunedNode.right.x} y2={-highlight.prunedNode.right.y} stroke="#888" strokeWidth={sw * 3} opacity={0.5} strokeLinecap="round" strokeDasharray={`${sw * 3} ${sw * 2}`} />}
          {inStep && highlight.poppedNode && <line x1={highlight.poppedNode.left.x} y1={-highlight.poppedNode.left.y} x2={highlight.poppedNode.right.x} y2={-highlight.poppedNode.right.y} stroke="#f72585" strokeWidth={sw * 3} opacity={0.9} strokeLinecap="round" />}

          <path ref={(el) => { overlayRefs.current.pathEl = el }} d={pathD} fill="none" stroke="#06d6a0" strokeWidth={sw * 3} strokeLinecap="round" strokeLinejoin="round" />

          <circle ref={(el) => { overlayRefs.current.startCircle = el }} cx={start.x} cy={-start.y} r={markerR} fill="#06d6a0" stroke="#fff" strokeWidth={sw} style={{ cursor: "grab" }} onMouseDown={onMarkerDown("start")} />
          <circle ref={(el) => { overlayRefs.current.goalCircle = el }} cx={goal.x} cy={-goal.y} r={markerR} fill="#f72585" stroke="#fff" strokeWidth={sw} style={{ cursor: "grab" }} onMouseDown={onMarkerDown("goal")} />
          <text ref={(el) => { overlayRefs.current.startLabel = el }} x={start.x} y={-start.y - markerR * 1.6} textAnchor="middle" fill="#06d6a0" fontSize={markerR * 1.2} fontWeight={700}>S</text>
          <text ref={(el) => { overlayRefs.current.goalLabel = el }} x={goal.x} y={-goal.y - markerR * 1.6} textAnchor="middle" fill="#f72585" fontSize={markerR * 1.2} fontWeight={700}>G</text>
        </svg>
      </div>

      {/* ---- Side panel ---- */}
      <div style={panelStyle}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#06d6a0" }}>Polyanya Demo</h2>

        <label style={labelStyle}>Mesh</label>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={selectStyle}>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {MESH_CATALOG.filter((m) => m.group === g).map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </optgroup>
          ))}
        </select>

        {mesh && (
          <div style={{ fontSize: 11, color: "#8d99ae" }}>
            {mesh.vertices.length.toLocaleString()} vertices, {mesh.polygons.length.toLocaleString()} polygons
            {mode === "live" && " — drag S/G to explore"}
          </div>
        )}

        <label style={labelStyle}>Build method</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => canFile && setBuildMethod("file")} style={{
            ...toggleBtnStyle,
            background: effectiveMethod === "file" ? "#4361ee" : "#1a1a3e",
            opacity: canFile ? 1 : 0.35,
            cursor: canFile ? "pointer" : "default",
          }}>
            Load .mesh file
          </button>
          <button onClick={() => canCdt && setBuildMethod("cdt")} style={{
            ...toggleBtnStyle,
            background: effectiveMethod === "cdt" ? "#4361ee" : "#1a1a3e",
            opacity: canCdt ? 1 : 0.35,
            cursor: canCdt ? "pointer" : "default",
          }}>
            find-convex-regions CDT
          </button>
        </div>

        {/* Editor controls */}
        {isEditor && (
          <div style={cardStyle}>
            <div style={cardTitle}>Obstacle Editor</div>
            <div style={{ fontSize: 11, color: "#8d99ae", marginBottom: 6 }}>
              Double-click to add obstacles. Click to select, drag to move.
            </div>
            <label style={labelStyle}>Clearance: {clearance.toFixed(2)}</label>
            <input type="range" min={0} max={2} step={0.05} value={clearance}
              onChange={(e) => setClearance(Number(e.target.value))} style={{ width: "100%" }} />
            <label style={labelStyle}>Concavity tolerance: {concavityTolerance.toFixed(2)}</label>
            <input type="range" min={0} max={2} step={0.05} value={concavityTolerance}
              onChange={(e) => setConcavityTolerance(Number(e.target.value))} style={{ width: "100%" }} />
            {selectedObs !== null && (
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <Btn bg="#e94560" onClick={deleteSelected}>Delete selected</Btn>
                {(() => {
                  const obs = obstacles.find((o) => o.id === selectedObs)
                  if (!obs) return null
                  return (<>
                    <label style={{ ...labelStyle, flex: 1 }}>W
                      <input type="number" value={obs.w} step={0.5} min={0.5}
                        onChange={(e) => setObstacles((prev) => prev.map((o) => o.id === selectedObs ? { ...o, w: Number(e.target.value) } : o))}
                        style={numInputStyle} />
                    </label>
                    <label style={{ ...labelStyle, flex: 1 }}>H
                      <input type="number" value={obs.h} step={0.5} min={0.5}
                        onChange={(e) => setObstacles((prev) => prev.map((o) => o.id === selectedObs ? { ...o, h: Number(e.target.value) } : o))}
                        style={numInputStyle} />
                    </label>
                  </>)
                })()}
              </div>
            )}
            <Btn bg="#4a4e69" onClick={() => { setObstacles(DEFAULT_OBSTACLES); setSelectedObs(null); setNextId(2) }}>Reset obstacles</Btn>
          </div>
        )}

        <label style={labelStyle}>Step delay: {stepSpeed}ms</label>
        <input type="range" min={10} max={1000} step={10} value={stepSpeed}
          onChange={(e) => setStepSpeed(Number(e.target.value))} style={{ width: "100%" }} />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {mode === "live" && <Btn bg="#4361ee" onClick={handleStepThrough}>Step-through</Btn>}
          {mode === "stepping" && (<><Btn bg="#4361ee" onClick={doStep}>Step</Btn><Btn bg="#06d6a0" onClick={() => setMode("running")}>Play</Btn><Btn bg="#e94560" onClick={exitStepMode}>Reset</Btn></>)}
          {mode === "running" && (<><Btn bg="#f8961e" onClick={() => setMode("stepping")}>Pause</Btn><Btn bg="#e94560" onClick={exitStepMode}>Reset</Btn></>)}
          {mode === "done" && <Btn bg="#4361ee" onClick={exitStepMode}>Reset</Btn>}
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Statistics</div>
          <Row label="Generated" value={displayStats.generated.toLocaleString()} />
          <Row label="Pushed" value={displayStats.pushed.toLocaleString()} />
          <Row label="Popped" value={displayStats.popped.toLocaleString()} />
          <Row label="Pruned" value={displayStats.pruned.toLocaleString()} />
          {inStep && <Row label="Open list" value={displayStats.openSize.toLocaleString()} />}
          {displayStats.cost >= 0 && <Row label="Cost" value={displayStats.cost.toFixed(4)} />}
          {displayStats.pathLength > 0 && <Row label="Path length" value={displayStats.pathLength.toFixed(4)} />}
          <Row label="Mesh build" value={fmtTime(buildTimeMs)} />
          {displayStats.searchTimeMs > 0 && <Row label="Search" value={fmtTime(displayStats.searchTimeMs)} />}
        </div>

        <div style={cardStyle}>
          <div style={{ ...cardTitle, color: "#8d99ae" }}>Legend</div>
          <Legend color="#06d6a0" label="Start / Path" />
          <Legend color="#f72585" label="Goal / Popped interval" />
          <Legend color="#e94560" label="Boundary / Obstacles" />
          {inStep && (<><Legend color="#4361ee" label="Expanding polygon" /><Legend color="#f8961e" label="Open list intervals" /><Legend color="#2ec4b6" label="Pushed intervals" /><Legend color="#888" label="Pruned interval" /></>)}
        </div>

        {inStep && (
          <div style={logStyle}>
            <div style={{ ...cardTitle, color: "#8d99ae" }}>Event Log</div>
            {eventLog.slice(-80).map((ev, i) => (
              <div key={i} style={{ color: evtColor(ev.type), marginBottom: 1, fontSize: 11 }}>[{ev.type}] {ev.message ?? ""}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTime(ms: number) {
  if (ms === 0) return "—"
  return ms < 1 ? `${ms.toFixed(3)}ms` : `${ms.toFixed(1)}ms`
}

function Btn({ bg, onClick, children }: { bg: string; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: bg, color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>{children}</button>
}

function Row({ label, value }: { label: string; value: string | number }) {
  return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, lineHeight: 1.6 }}><span style={{ color: "#8d99ae" }}>{label}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span></div>
}

function Legend({ color, label }: { color: string; label: string }) {
  return <div style={{ fontSize: 12, lineHeight: 1.6, display: "flex", gap: 6, alignItems: "center" }}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />{label}</div>
}

function evtColor(type: StepEventType) {
  switch (type) {
    case StepEventType.INIT: return "#8d99ae"
    case StepEventType.NODE_POPPED: return "#f72585"
    case StepEventType.NODE_EXPANDED: return "#4361ee"
    case StepEventType.NODE_PUSHED: return "#2ec4b6"
    case StepEventType.NODE_PRUNED: return "#888"
    case StepEventType.GOAL_REACHED: return "#06d6a0"
    case StepEventType.SEARCH_EXHAUSTED: return "#e94560"
    default: return "#eee"
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const rootStyle: CSSProperties = { display: "flex", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif", background: "#1a1a2e", color: "#eee" }
const canvasWrap: CSSProperties = { flex: 1, padding: 12, display: "flex", position: "relative" }
const svgBase: CSSProperties = { position: "absolute", inset: 12, borderRadius: 8 }
const svgStyleBg: CSSProperties = { ...svgBase, background: "#16213e" }
const svgStyleFg: CSSProperties = { ...svgBase, background: "transparent" }
const loadingStyle: CSSProperties = { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", color: "#06d6a0", fontSize: 18, fontWeight: 600, zIndex: 10 }
const panelStyle: CSSProperties = { width: 320, padding: 16, background: "#0f3460", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }
const labelStyle: CSSProperties = { display: "block", fontSize: 12, color: "#8d99ae", marginBottom: -4 }
const selectStyle: CSSProperties = { width: "100%", padding: "6px 8px", borderRadius: 4, border: "1px solid #4a4e69", background: "#1a1a3e", color: "#eee" }
const cardStyle: CSSProperties = { background: "#1a1a3e", borderRadius: 6, padding: 12 }
const cardTitle: CSSProperties = { fontWeight: 600, marginBottom: 6, fontSize: 13, color: "#06d6a0" }
const logStyle: CSSProperties = { background: "#1a1a3e", borderRadius: 6, padding: 12, flex: 1, maxHeight: 300, overflowY: "auto", fontFamily: "ui-monospace, monospace" }
const numInputStyle: CSSProperties = { width: "100%", padding: "4px 6px", borderRadius: 4, border: "1px solid #4a4e69", background: "#1a1a3e", color: "#eee", fontSize: 12 }
const toggleBtnStyle: CSSProperties = { flex: 1, padding: "6px 8px", borderRadius: 4, border: "1px solid #4a4e69", color: "#eee", fontSize: 11, fontWeight: 600 }
