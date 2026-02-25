import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type CSSProperties,
} from "react"
import {
  Mesh,
  SearchInstance,
  StepEventType,
  buildMeshFromRegions,
  mergeMesh,
  graphSearch,
  type Point,
  type SearchNode,
  type StepEvent,
} from "../lib/index"
import { cdtTriangulate, rectToPolygon } from "../lib/cdt-builder"
import { createThreeRenderer, type ThreeRenderer } from "./three-renderer"

const BASE = import.meta.env.BASE_URL

// ---------------------------------------------------------------------------
// Responsive hook
// ---------------------------------------------------------------------------

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener("change", handler)
    setMatches(mql.matches)
    return () => mql.removeEventListener("change", handler)
  }, [query])
  return matches
}

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
  {
    id: "editor",
    label: "Obstacle Editor",
    group: "Editor",
    start: { x: -8, y: 0 },
    goal: { x: 8, y: 0 },
  },
  // --- Simple ---
  {
    id: "square",
    label: "Square (4 poly)",
    group: "Simple",
    path: "/meshes/tests/square.mesh",
    start: { x: 0.5, y: 0.5 },
    goal: { x: -0.5, y: -0.5 },
  },
  {
    id: "hard",
    label: "Hard (38 poly)",
    group: "Simple",
    path: "/meshes/tests/hard.mesh",
    start: { x: 3, y: 3 },
    goal: { x: 8, y: 8 },
  },
  {
    id: "bad-ambig",
    label: "bad-ambig (4 poly)",
    group: "Simple",
    path: "/meshes/tests/bad-ambig.mesh",
    start: { x: 0, y: 0.5 },
    goal: { x: 2, y: 1.5 },
  },
  {
    id: "bad-collinear",
    label: "bad-collinear (6 poly)",
    group: "Simple",
    path: "/meshes/tests/bad-collinear.mesh",
    start: { x: 1, y: 1 },
    goal: { x: 3, y: 5 },
  },
  // --- Game maps ---
  {
    id: "arena-merged",
    label: "Arena — DAO (55 poly)",
    group: "Game Maps",
    path: "/meshes/arena-merged.mesh",
    start: { x: 3, y: 5 },
    goal: { x: 45, y: 35 },
  },
  {
    id: "arena",
    label: "Arena unmerged — DAO (120 poly)",
    group: "Game Maps",
    path: "/meshes/arena.mesh",
    start: { x: 3, y: 5 },
    goal: { x: 45, y: 35 },
  },
  {
    id: "brc202d",
    label: "brc202d — DAO (4k poly)",
    group: "Game Maps",
    path: "/meshes/dao/brc202d.mesh",
    start: { x: 38, y: 55 },
    goal: { x: 509, y: 447 },
  },
  {
    id: "AR0602SR",
    label: "AR0602SR — BG (5.5k poly)",
    group: "Game Maps",
    path: "/meshes/bgmaps/AR0602SR.mesh",
    start: { x: 150, y: 200 },
    goal: { x: 500, y: 600 },
  },
  {
    id: "catwalk",
    label: "CatwalkAlley — SC (15k poly)",
    group: "Game Maps",
    path: "/meshes/sc/CatwalkAlley.mesh",
    start: { x: 11, y: 290 },
    goal: { x: 316, y: 404 },
  },
  {
    id: "aurora-merged",
    label: "Aurora — SC (19k poly)",
    group: "Game Maps",
    path: "/meshes/aurora-merged.mesh",
    start: { x: 200, y: 200 },
    goal: { x: 800, y: 600 },
  },
  // --- City streets ---
  {
    id: "new-york",
    label: "New York (10k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/NewYork_0_1024.mesh",
    start: { x: 185, y: 380 },
    goal: { x: 1005, y: 489 },
  },
  {
    id: "paris",
    label: "Paris (11k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/Paris_0_1024.mesh",
    start: { x: 200, y: 200 },
    goal: { x: 800, y: 800 },
  },
  {
    id: "shanghai",
    label: "Shanghai (13k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/Shanghai_2_1024.mesh",
    start: { x: 200, y: 200 },
    goal: { x: 800, y: 800 },
  },
  {
    id: "london",
    label: "London (19k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/London_0_1024.mesh",
    start: { x: 200, y: 200 },
    goal: { x: 800, y: 800 },
  },
  {
    id: "berlin",
    label: "Berlin (20k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/Berlin_0_1024.mesh",
    start: { x: 200, y: 200 },
    goal: { x: 800, y: 800 },
  },
  {
    id: "moscow",
    label: "Moscow (27k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/Moscow_0_1024.mesh",
    start: { x: 200, y: 200 },
    goal: { x: 800, y: 800 },
  },
  {
    id: "london2",
    label: "London area 2 (32k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/London_2_1024.mesh",
    start: { x: 200, y: 200 },
    goal: { x: 800, y: 800 },
  },
  {
    id: "boston",
    label: "Boston (33k poly)",
    group: "City Streets",
    path: "/meshes/street-maps/Boston_0_1024.mesh",
    start: { x: 355, y: 233 },
    goal: { x: 855, y: 574 },
  },
  // --- Random obstacles ---
  {
    id: "random-900",
    label: "900 obstacles (13k poly)",
    group: "Random",
    path: "/meshes/random-obstacles/random-900.mesh",
    start: { x: 100, y: 100 },
    goal: { x: 900, y: 900 },
  },
  {
    id: "random-3000",
    label: "3000 obstacles (42k poly)",
    group: "Random",
    path: "/meshes/random-obstacles/random-3000.mesh",
    start: { x: 100, y: 100 },
    goal: { x: 900, y: 900 },
  },
  {
    id: "random-6000",
    label: "6000 obstacles (84k poly)",
    group: "Random",
    path: "/meshes/random-obstacles/random-6000.mesh",
    start: { x: 100, y: 100 },
    goal: { x: 900, y: 900 },
  },
  {
    id: "random-9000",
    label: "9000 obstacles (126k poly)",
    group: "Random",
    path: "/meshes/random-obstacles/random-9000.mesh",
    start: { x: 100, y: 100 },
    goal: { x: 900, y: 900 },
  },
  // --- Maze ---
  {
    id: "maze512",
    label: "Maze 512 (43k poly)",
    group: "Maze",
    path: "/meshes/maze512-1-0-merged.mesh",
    start: { x: 100, y: 100 },
    goal: { x: 400, y: 400 },
  },
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

const DEFAULT_OBSTACLES: Obstacle[] = [{ id: 1, cx: 0, cy: 0, w: 4, h: 4 }]

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function getMeshBounds(mesh: Mesh) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  for (const v of mesh.vertices) {
    if (!v) continue
    minX = Math.min(minX, v.p.x)
    maxX = Math.max(maxX, v.p.x)
    minY = Math.min(minY, v.p.y)
    maxY = Math.max(maxY, v.p.y)
  }
  return { minX, maxX, minY, maxY }
}

function pathLen(pts: Point[]) {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x,
      dy = pts[i]!.y - pts[i - 1]!.y
    len += Math.sqrt(dx * dx + dy * dy)
  }
  return len
}

// ---------------------------------------------------------------------------
// Build mesh from editor obstacles using CDT
// ---------------------------------------------------------------------------

function buildMeshFromObstacles(obstacles: Obstacle[], clearance: number) {
  const t0 = performance.now()
  try {
    const obstaclePolygons = obstacles.map((o) =>
      rectToPolygon(o.cx, o.cy, o.w, o.h, clearance),
    )
    const regions = cdtTriangulate({
      bounds: DEFAULT_BOUNDS,
      obstacles: obstaclePolygons,
    })
    const mesh = buildMeshFromRegions({ regions })
    const buildTimeMs = performance.now() - t0
    return { mesh, buildTimeMs, regionCount: regions.length }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Run search and produce path + stats
// ---------------------------------------------------------------------------

type SearchAlgorithm = "polyanya" | "graph-astar"

function runSearch(
  mesh: Mesh,
  start: Point,
  goal: Point,
  buildTimeMs: number,
  algorithm: SearchAlgorithm = "polyanya",
): { path: Point[]; stats: Stats } {
  if (algorithm === "graph-astar") {
    const t0 = performance.now()
    const result = graphSearch(mesh, start, goal)
    const searchTimeMs = performance.now() - t0
    return {
      path: result.path,
      stats: {
        generated: result.nodesExpanded,
        pushed: 0,
        popped: result.nodesExpanded,
        pruned: 0,
        openSize: 0,
        cost: result.cost,
        pathLength: pathLen(result.path),
        searchTimeMs,
        buildTimeMs,
      },
    }
  }
  const s = new SearchInstance(mesh)
  s.setStartGoal(start, goal)
  const t0 = performance.now()
  s.search()
  const searchTimeMs = performance.now() - t0
  const pts = s.getPathPoints()
  return {
    path: pts,
    stats: {
      generated: s.nodesGenerated,
      pushed: s.nodesPushed,
      popped: s.nodesPopped,
      pruned: s.nodesPrunedPostPop,
      openSize: 0,
      cost: s.getCost(),
      pathLength: pathLen(pts),
      searchTimeMs,
      buildTimeMs,
    },
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Stats {
  generated: number
  pushed: number
  popped: number
  pruned: number
  openSize: number
  cost: number
  pathLength: number
  searchTimeMs: number
  buildTimeMs: number
}

const ZERO_STATS: Stats = {
  generated: 0,
  pushed: 0,
  popped: 0,
  pruned: 0,
  openSize: 0,
  cost: -1,
  pathLength: 0,
  searchTimeMs: 0,
  buildTimeMs: 0,
}

type BuildMethod = "file" | "cdt" | "merge"

export default function PolyanyaDemo() {
  const narrow = useMediaQuery("(max-width: 700px)")
  const [selectedId, setSelectedId] = useState("editor")
  const entry = MESH_CATALOG.find((m) => m.id === selectedId)!
  const isEditor = selectedId === "editor"

  // --- build method ---
  const [buildMethod, setBuildMethod] = useState<BuildMethod>("cdt")
  const canFile = !isEditor && !!entry.path
  const canMerge = true
  const effectiveMethod: BuildMethod = isEditor
    ? buildMethod === "file"
      ? "cdt"
      : buildMethod
    : buildMethod === "cdt"
      ? "file"
      : buildMethod

  // --- mesh state ---
  const [mesh, setMesh] = useState<Mesh | null>(null)
  const [loading, setLoading] = useState(false)
  const [buildTimeMs, setBuildTimeMs] = useState(0)
  const meshCache = useRef(new Map<string, Mesh>())
  const fileMeshRef = useRef<Mesh | null>(null) // original file mesh for stats comparison

  // --- editor state ---
  const [obstacles, setObstacles] = useState<Obstacle[]>(DEFAULT_OBSTACLES)
  const [nextId, setNextId] = useState(2)
  const [clearance, setClearance] = useState(0.5)
  const [selectedObs, setSelectedObs] = useState<number | null>(null)
  const draggingObs = useRef<{ id: number; offX: number; offY: number } | null>(
    null,
  )

  // --- search algorithm ---
  const [searchAlgorithm, setSearchAlgorithm] =
    useState<SearchAlgorithm>("polyanya")

  // --- search state ---
  const [start, setStart] = useState<Point>(entry.start)
  const [goal, setGoal] = useState<Point>(entry.goal)
  const [livePath, setLivePath] = useState<Point[]>([])
  const [liveStats, setLiveStats] = useState<Stats>(ZERO_STATS)

  // --- step-through state ---
  const [mode, setMode] = useState<"live" | "stepping" | "running" | "done">(
    "live",
  )
  const [stepSpeed, setStepSpeed] = useState(200)
  const [eventLog, setEventLog] = useState<StepEvent[]>([])
  const [highlight, setHighlight] = useState<{
    expandedPoly?: number
    poppedNode?: SearchNode
    pushedNodes?: SearchNode[]
    prunedNode?: SearchNode
  }>({})
  const [openNodes, setOpenNodes] = useState<SearchNode[]>([])
  const [stepPath, setStepPath] = useState<Point[]>([])
  const [stepStats, setStepStats] = useState<Stats>(ZERO_STATS)

  const searchRef = useRef<SearchInstance | null>(null)
  const draggingRef = useRef<"start" | "goal" | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const stepStartTime = useRef(0)

  // --- Three.js renderer ---
  const rendererRef = useRef<ThreeRenderer | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const dragRaf = useRef(0)
  // Mutable copies of start/goal that update during drag without React re-renders
  const liveStart = useRef(start)
  const liveGoal = useRef(goal)
  const liveAlgorithm = useRef(searchAlgorithm)
  // Keep in sync when React state changes
  useEffect(() => {
    liveStart.current = start
  }, [start])
  useEffect(() => {
    liveGoal.current = goal
  }, [goal])
  useEffect(() => {
    liveAlgorithm.current = searchAlgorithm
  }, [searchAlgorithm])

  // --- mount/dispose Three.js renderer ---
  useEffect(() => {
    const r = createThreeRenderer()
    rendererRef.current = r
    containerRef.current?.appendChild(r.container)
    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [])

  // --- load mesh from file or build from editor ---
  useEffect(() => {
    if (isEditor) {
      const t0 = performance.now()
      const result = buildMeshFromObstacles(obstacles, clearance)
      if (!result) return // CDT failed — keep previous mesh
      const { mesh: cdtMesh, buildTimeMs: cdtBt } = result
      if (effectiveMethod === "merge") {
        const m = mergeMesh(cdtMesh)
        const bt = performance.now() - t0
        setMesh(m)
        setBuildTimeMs(bt)
        fileMeshRef.current = cdtMesh
      } else {
        setMesh(cdtMesh)
        setBuildTimeMs(cdtBt)
        fileMeshRef.current = null
      }
      return
    }
    if (!entry.path) return

    const cacheKey =
      effectiveMethod === "merge" ? `${entry.id}:merge` : entry.id
    const cached = meshCache.current.get(cacheKey)
    if (cached) {
      setMesh(cached)
      setBuildTimeMs(0)
      if (effectiveMethod === "merge" && !fileMeshRef.current) {
        const fileCached = meshCache.current.get(entry.id)
        if (fileCached) fileMeshRef.current = fileCached
      }
      if (effectiveMethod === "file") fileMeshRef.current = cached
      return
    }

    setLoading(true)
    const fileKey = entry.id
    const fileMeshPromise = meshCache.current.has(fileKey)
      ? Promise.resolve(meshCache.current.get(fileKey)!)
      : fetch(`${BASE}${entry.path!.replace(/^\//, "")}`)
          .then((r) => r.text())
          .then((text) => {
            const t0 = performance.now()
            const m = Mesh.fromString(text)
            const bt = performance.now() - t0
            meshCache.current.set(fileKey, m)
            return m
          })

    fileMeshPromise
      .then((fileMesh) => {
        fileMeshRef.current = fileMesh
        if (effectiveMethod === "merge") {
          const t0 = performance.now()
          const m = mergeMesh(fileMesh)
          const bt = performance.now() - t0
          meshCache.current.set(cacheKey, m)
          setMesh(m)
          setBuildTimeMs(bt)
        } else {
          setMesh(fileMesh)
          setBuildTimeMs(0)
        }
      })
      .finally(() => setLoading(false))
  }, [
    isEditor
      ? `editor-${effectiveMethod}-${JSON.stringify(obstacles)}-${clearance}`
      : `${entry.id}:${effectiveMethod}`,
  ])

  // --- reset on mesh change ---
  useEffect(() => {
    setStart(entry.start)
    setGoal(entry.goal)
    setBuildMethod(selectedId === "editor" ? "cdt" : "file")
    setSearchAlgorithm("polyanya")
    exitStepMode()
  }, [selectedId])

  // --- compute path whenever mesh/start/goal/algorithm change (not during drag) ---
  useEffect(() => {
    if (!mesh) return
    const { path, stats } = runSearch(
      mesh,
      start,
      goal,
      buildTimeMs,
      searchAlgorithm,
    )
    setLivePath(path)
    setLiveStats(stats)
  }, [mesh, start, goal, buildTimeMs, searchAlgorithm])

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [eventLog.length])

  // --- derived data ---
  const bounds = useMemo(
    () =>
      mesh ? getMeshBounds(mesh) : { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    [mesh],
  )

  const sw = useMemo(() => {
    const meshExtent = Math.max(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    )
    return meshExtent * 0.003
  }, [bounds])

  const markerR = useMemo(() => {
    const meshExtent = Math.max(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    )
    return meshExtent * 0.015
  }, [bounds])

  // --- Wire state changes to Three.js renderer ---
  useEffect(() => {
    const r = rendererRef.current
    if (!r || !mesh) return
    r.setMesh(mesh, bounds)
    r.render()
  }, [mesh, bounds])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    if (isEditor) {
      r.setObstacles(obstacles, selectedObs, sw)
    } else {
      r.setObstacles([], null, sw)
    }
    r.render()
  }, [isEditor, obstacles, selectedObs, sw])

  // Update path display
  const inStep = mode !== "live"
  const displayPath = inStep ? stepPath : livePath
  const displayStats = inStep ? stepStats : liveStats

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.setPath(displayPath)
    r.render()
  }, [displayPath])

  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.setMarkers(start, goal)
    r.render()
  }, [start, goal, bounds])

  // Step overlays
  useEffect(() => {
    const r = rendererRef.current
    if (!r || !mesh) return
    if (inStep) {
      r.setStepOverlays({
        mesh,
        expandedPoly: highlight.expandedPoly,
        openNodes,
        pushedNodes: highlight.pushedNodes,
        prunedNode: highlight.prunedNode,
        poppedNode: highlight.poppedNode,
        sw,
      })
    } else {
      r.clearStepOverlays()
    }
    r.render()
  }, [inStep, highlight, openNodes, mesh, sw])

  // --- step helpers ---
  const readStats = useCallback(
    (s: SearchInstance): Stats => {
      const pts = s.getPathPoints()
      return {
        generated: s.nodesGenerated,
        pushed: s.nodesPushed,
        popped: s.nodesPopped,
        pruned: s.nodesPrunedPostPop,
        openSize: s.getOpenListNodes().length,
        cost: s.getCost(),
        pathLength: pathLen(pts),
        searchTimeMs: performance.now() - stepStartTime.current,
        buildTimeMs,
      }
    },
    [buildTimeMs],
  )

  const exitStepMode = useCallback(() => {
    setMode("live")
    setEventLog([])
    setHighlight({})
    setOpenNodes([])
    setStepPath([])
    setStepStats(ZERO_STATS)
    searchRef.current = null
  }, [])

  const doStep = useCallback(() => {
    const s = searchRef.current
    if (!s || s.isSearchComplete()) {
      if (s) {
        setStepPath(s.getPathPoints())
        setStepStats(readStats(s))
      }
      setMode("done")
      return
    }
    const events = s.step()
    setEventLog((prev) => [...prev, ...events])
    const hl: typeof highlight = {}
    for (const ev of events) {
      switch (ev.type) {
        case StepEventType.NODE_POPPED:
          hl.poppedNode = ev.node
          hl.expandedPoly = ev.node?.nextPolygon
          break
        case StepEventType.NODE_EXPANDED:
          hl.expandedPoly = ev.node?.nextPolygon
          break
        case StepEventType.NODE_PUSHED:
          if (!hl.pushedNodes) hl.pushedNodes = []
          if (ev.node) hl.pushedNodes.push(ev.node)
          break
        case StepEventType.NODE_PRUNED:
          hl.prunedNode = ev.node
          break
        case StepEventType.GOAL_REACHED:
          setStepPath(s.getPathPoints())
          setMode("done")
          break
        case StepEventType.SEARCH_EXHAUSTED:
          setMode("done")
          break
      }
    }
    setHighlight(hl)
    setOpenNodes([...s.getOpenListNodes()])
    setStepStats(readStats(s))
  }, [readStats])

  useEffect(() => {
    if (mode !== "running") return
    const id = setInterval(doStep, stepSpeed)
    return () => clearInterval(id)
  }, [mode, stepSpeed, doStep])

  const handleStepThrough = useCallback(() => {
    if (!mesh) return
    const s = new SearchInstance(mesh)
    s.setStartGoal(start, goal)
    searchRef.current = s
    stepStartTime.current = performance.now()
    const init = s.searchInit()
    setEventLog(init)
    setHighlight({})
    setOpenNodes([...s.getOpenListNodes()])
    setStepPath([])
    setStepStats(readStats(s))
    if (s.isSearchComplete()) {
      setStepPath(s.getPathPoints())
      setMode("done")
    } else setMode("stepping")
  }, [mesh, start, goal, readStats])

  // --- Unified canvas event handlers ---
  const onCanvasDown = useCallback(
    (e: React.PointerEvent) => {
      const r = rendererRef.current
      if (!r) return

      // Hit-test markers first
      const marker = r.hitTestMarker(
        e.clientX,
        e.clientY,
        start,
        goal,
        markerR * 1.5,
      )
      if (marker) {
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        if (mode !== "live") exitStepMode()
        draggingRef.current = marker
        return
      }

      // Hit-test obstacles in editor mode
      if (isEditor) {
        const obsIdx = r.hitTestObstacle(e.clientX, e.clientY, obstacles)
        if (obsIdx !== null) {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          const obs = obstacles[obsIdx]!
          const p = r.screenToMesh(e.clientX, e.clientY)
          if (p) {
            setSelectedObs(obs.id)
            draggingObs.current = {
              id: obs.id,
              offX: obs.cx - p.x,
              offY: obs.cy - p.y,
            }
          }
          return
        }
      }

      // Click on empty space — deselect obstacle + drag nearest point
      if (isEditor) setSelectedObs(null)
      const p = r.screenToMesh(e.clientX, e.clientY)
      if (p) {
        const dxS = p.x - start.x,
          dyS = p.y - start.y
        const dxG = p.x - goal.x,
          dyG = p.y - goal.y
        const nearest =
          dxS * dxS + dyS * dyS <= dxG * dxG + dyG * dyG ? "start" : "goal"
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        if (mode !== "live") exitStepMode()
        draggingRef.current = nearest
      }
    },
    [start, goal, markerR, mode, exitStepMode, isEditor, obstacles],
  )

  const onCanvasMove = useCallback(
    (e: React.PointerEvent) => {
      const r = rendererRef.current
      if (!r) return

      // --- drag start/goal ---
      if (draggingRef.current) {
        const p = r.screenToMesh(e.clientX, e.clientY)
        if (!p) return
        if (draggingRef.current === "start") liveStart.current = p
        else liveGoal.current = p

        // Throttle visual updates + search to once per rAF
        if (!dragRaf.current) {
          dragRaf.current = requestAnimationFrame(() => {
            dragRaf.current = 0
            const curStart = liveStart.current
            const curGoal = liveGoal.current
            if (mesh) {
              const { path } = runSearch(
                mesh,
                curStart,
                curGoal,
                buildTimeMs,
                liveAlgorithm.current,
              )
              r.setPath(path)
              r.setMarkers(curStart, curGoal)
              r.render()
            }
          })
        }
        return
      }
      // --- drag obstacle in editor ---
      const drag = draggingObs.current
      if (drag && isEditor) {
        const p = r.screenToMesh(e.clientX, e.clientY)
        if (!p) return
        setObstacles((prev) =>
          prev.map((o) =>
            o.id === drag.id
              ? { ...o, cx: p.x + drag.offX, cy: p.y + drag.offY }
              : o,
          ),
        )
        return
      }

      // --- cursor management (hover) ---
      const marker = r.hitTestMarker(
        e.clientX,
        e.clientY,
        start,
        goal,
        markerR * 1.5,
      )
      if (marker) {
        r.container.style.cursor = "grab"
        return
      }
      if (isEditor) {
        const obsIdx = r.hitTestObstacle(e.clientX, e.clientY, obstacles)
        if (obsIdx !== null) {
          r.container.style.cursor = "move"
          return
        }
      }
      r.container.style.cursor = "default"
    },
    [mesh, buildTimeMs, isEditor, obstacles, start, goal, markerR],
  )

  const onCanvasUp = useCallback((e?: React.PointerEvent) => {
    const r = rendererRef.current
    // Flush final drag position to React state
    if (draggingRef.current) {
      if (dragRaf.current) {
        cancelAnimationFrame(dragRaf.current)
        dragRaf.current = 0
      }
      setStart({ ...liveStart.current })
      setGoal({ ...liveGoal.current })
    }
    draggingRef.current = null
    draggingObs.current = null
    if (r) r.container.style.cursor = "default"
  }, [])

  // --- editor: add obstacle on double-click ---
  const onCanvasDblClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isEditor) return
      const r = rendererRef.current
      if (!r) return
      const p = r.screenToMesh(e.clientX, e.clientY)
      if (!p) return
      setObstacles((prev) => [
        ...prev,
        { id: nextId, cx: p.x, cy: p.y, w: 2, h: 2 },
      ])
      setNextId((n) => n + 1)
    },
    [isEditor, nextId],
  )

  const deleteSelected = useCallback(() => {
    if (selectedObs === null) return
    setObstacles((prev) => prev.filter((o) => o.id !== selectedObs))
    setSelectedObs(null)
  }, [selectedObs])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ ...rootStyle, ...(narrow ? { flexDirection: "column" } : {}) }}>
      <div
        style={{
          ...canvasWrap,
          touchAction: "none",
          ...(narrow ? { height: "50vh", flex: "none" } : {}),
        }}
        onPointerDown={onCanvasDown}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasUp}
        onDoubleClick={onCanvasDblClick}
      >
        {loading && <div style={loadingStyle}>Loading mesh...</div>}
        <div ref={containerRef} style={containerStyle} />
      </div>

      {/* ---- Side panel ---- */}
      <div
        style={{
          ...panelStyle,
          ...(narrow ? { width: "auto", maxHeight: "50vh" } : {}),
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, color: "#06d6a0" }}>
          Polyanya Demo
        </h2>

        <label style={labelStyle}>Mesh</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          style={selectStyle}
        >
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {MESH_CATALOG.filter((m) => m.group === g).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {mesh && (
          <div style={{ fontSize: 11, color: "#8d99ae" }}>
            {mesh.vertices.length.toLocaleString()} vertices,{" "}
            {mesh.polygons.length.toLocaleString()} polygons
            {mode === "live" && " — drag S/G to explore"}
          </div>
        )}

        <label style={labelStyle}>Build method</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {canFile && (
            <button
              onClick={() => setBuildMethod("file")}
              style={{
                ...toggleBtnStyle,
                background: effectiveMethod === "file" ? "#4361ee" : "#1a1a3e",
              }}
            >
              Load .mesh file
            </button>
          )}
          {isEditor && (
            <button
              onClick={() => setBuildMethod("cdt")}
              style={{
                ...toggleBtnStyle,
                background: effectiveMethod === "cdt" ? "#4361ee" : "#1a1a3e",
              }}
            >
              CDT
            </button>
          )}
          {canMerge && (
            <button
              onClick={() => setBuildMethod("merge")}
              style={{
                ...toggleBtnStyle,
                background: effectiveMethod === "merge" ? "#4361ee" : "#1a1a3e",
              }}
            >
              Polyanya merge
            </button>
          )}
        </div>

        <label style={labelStyle}>Search algorithm</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button
            onClick={() => setSearchAlgorithm("polyanya")}
            style={{
              ...toggleBtnStyle,
              background:
                searchAlgorithm === "polyanya" ? "#4361ee" : "#1a1a3e",
            }}
          >
            Polyanya
          </button>
          <button
            onClick={() => setSearchAlgorithm("graph-astar")}
            style={{
              ...toggleBtnStyle,
              background:
                searchAlgorithm === "graph-astar" ? "#4361ee" : "#1a1a3e",
            }}
          >
            Graph A*
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
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={clearance}
              onChange={(e) => setClearance(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            {selectedObs !== null && (
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <Btn bg="#e94560" onClick={deleteSelected}>
                  Delete selected
                </Btn>
                {(() => {
                  const obs = obstacles.find((o) => o.id === selectedObs)
                  if (!obs) return null
                  return (
                    <>
                      <label style={{ ...labelStyle, flex: 1 }}>
                        W
                        <input
                          type="number"
                          value={obs.w}
                          step={0.5}
                          min={0.5}
                          onChange={(e) =>
                            setObstacles((prev) =>
                              prev.map((o) =>
                                o.id === selectedObs
                                  ? { ...o, w: Number(e.target.value) }
                                  : o,
                              ),
                            )
                          }
                          style={numInputStyle}
                        />
                      </label>
                      <label style={{ ...labelStyle, flex: 1 }}>
                        H
                        <input
                          type="number"
                          value={obs.h}
                          step={0.5}
                          min={0.5}
                          onChange={(e) =>
                            setObstacles((prev) =>
                              prev.map((o) =>
                                o.id === selectedObs
                                  ? { ...o, h: Number(e.target.value) }
                                  : o,
                              ),
                            )
                          }
                          style={numInputStyle}
                        />
                      </label>
                    </>
                  )
                })()}
              </div>
            )}
            <Btn
              bg="#4a4e69"
              onClick={() => {
                setObstacles(DEFAULT_OBSTACLES)
                setSelectedObs(null)
                setNextId(2)
              }}
            >
              Reset obstacles
            </Btn>
          </div>
        )}

        {searchAlgorithm === "polyanya" && (
          <>
            <label style={labelStyle}>Step delay: {stepSpeed}ms</label>
            <input
              type="range"
              min={10}
              max={1000}
              step={10}
              value={stepSpeed}
              onChange={(e) => setStepSpeed(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {mode === "live" && searchAlgorithm === "polyanya" && (
            <Btn bg="#4361ee" onClick={handleStepThrough}>
              Step-through
            </Btn>
          )}
          {mode === "stepping" && (
            <>
              <Btn bg="#4361ee" onClick={doStep}>
                Step
              </Btn>
              <Btn bg="#06d6a0" onClick={() => setMode("running")}>
                Play
              </Btn>
              <Btn bg="#e94560" onClick={exitStepMode}>
                Reset
              </Btn>
            </>
          )}
          {mode === "running" && (
            <>
              <Btn bg="#f8961e" onClick={() => setMode("stepping")}>
                Pause
              </Btn>
              <Btn bg="#e94560" onClick={exitStepMode}>
                Reset
              </Btn>
            </>
          )}
          {mode === "done" && (
            <Btn bg="#4361ee" onClick={exitStepMode}>
              Reset
            </Btn>
          )}
        </div>

        <div style={cardStyle}>
          <div style={cardTitle}>Statistics</div>
          {searchAlgorithm === "polyanya" ? (
            <>
              <Row
                label="Generated"
                value={displayStats.generated.toLocaleString()}
              />
              <Row
                label="Pushed"
                value={displayStats.pushed.toLocaleString()}
              />
              <Row
                label="Popped"
                value={displayStats.popped.toLocaleString()}
              />
              <Row
                label="Pruned"
                value={displayStats.pruned.toLocaleString()}
              />
            </>
          ) : (
            <Row
              label="Nodes expanded"
              value={displayStats.popped.toLocaleString()}
            />
          )}
          {inStep && (
            <Row
              label="Open list"
              value={displayStats.openSize.toLocaleString()}
            />
          )}
          {displayStats.cost >= 0 && (
            <Row label="Cost" value={displayStats.cost.toFixed(4)} />
          )}
          {displayStats.pathLength > 0 && (
            <Row
              label="Path length"
              value={displayStats.pathLength.toFixed(4)}
            />
          )}
          <Row label="Mesh build" value={fmtTime(buildTimeMs)} />
          <Row label="Search" value={fmtTime(displayStats.searchTimeMs)} />
          {(effectiveMethod === "cdt" || effectiveMethod === "merge") &&
            fileMeshRef.current &&
            mesh &&
            (() => {
              const filePoly = fileMeshRef.current!.polygons.length
              const curPoly = mesh.polygons.length
              const pct =
                filePoly > 0 ? Math.round((1 - curPoly / filePoly) * 100) : 0
              return (
                <Row
                  label="Polygons"
                  value={`${filePoly.toLocaleString()} → ${curPoly.toLocaleString()} (${pct}% fewer)`}
                />
              )
            })()}
        </div>

        <div style={cardStyle}>
          <div style={{ ...cardTitle, color: "#8d99ae" }}>Legend</div>
          <Legend color="#06d6a0" label="Start / Path" />
          <Legend color="#f72585" label="Goal / Popped interval" />
          <Legend color="#e94560" label="Boundary / Obstacles" />
          {inStep && (
            <>
              <Legend color="#4361ee" label="Expanding polygon" />
              <Legend color="#f8961e" label="Open list intervals" />
              <Legend color="#2ec4b6" label="Pushed intervals" />
              <Legend color="#888" label="Pruned interval" />
            </>
          )}
        </div>

        {inStep && (
          <div style={logStyle}>
            <div style={{ ...cardTitle, color: "#8d99ae" }}>Event Log</div>
            {eventLog.slice(-80).map((ev, i) => (
              <div
                key={i}
                style={{
                  color: evtColor(ev.type),
                  marginBottom: 1,
                  fontSize: 11,
                }}
              >
                [{ev.type}] {ev.message ?? ""}
              </div>
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

function Btn({
  bg,
  onClick,
  children,
}: { bg: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 6,
        border: "none",
        background: bg,
        color: "#fff",
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 13,
      }}
    >
      {children}
    </button>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      <span style={{ color: "#8d99ae" }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        fontSize: 12,
        lineHeight: 1.6,
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}
    >
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 2,
          background: color,
          flexShrink: 0,
        }}
      />
      {label}
    </div>
  )
}

function evtColor(type: StepEventType) {
  switch (type) {
    case StepEventType.INIT:
      return "#8d99ae"
    case StepEventType.NODE_POPPED:
      return "#f72585"
    case StepEventType.NODE_EXPANDED:
      return "#4361ee"
    case StepEventType.NODE_PUSHED:
      return "#2ec4b6"
    case StepEventType.NODE_PRUNED:
      return "#888"
    case StepEventType.GOAL_REACHED:
      return "#06d6a0"
    case StepEventType.SEARCH_EXHAUSTED:
      return "#e94560"
    default:
      return "#eee"
  }
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const rootStyle: CSSProperties = {
  display: "flex",
  height: "100vh",
  fontFamily: "system-ui, -apple-system, sans-serif",
  background: "#1a1a2e",
  color: "#eee",
}
const canvasWrap: CSSProperties = { flex: 1, padding: 12, position: "relative" }
const containerStyle: CSSProperties = {
  position: "absolute",
  inset: 12,
  borderRadius: 8,
  overflow: "hidden",
}
const loadingStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%,-50%)",
  color: "#06d6a0",
  fontSize: 18,
  fontWeight: 600,
  zIndex: 10,
}
const panelStyle: CSSProperties = {
  width: 320,
  padding: 16,
  background: "#0f3460",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 10,
}
const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#8d99ae",
  marginBottom: -4,
}
const selectStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid #4a4e69",
  background: "#1a1a3e",
  color: "#eee",
}
const cardStyle: CSSProperties = {
  background: "#1a1a3e",
  borderRadius: 6,
  padding: 12,
}
const cardTitle: CSSProperties = {
  fontWeight: 600,
  marginBottom: 6,
  fontSize: 13,
  color: "#06d6a0",
}
const logStyle: CSSProperties = {
  background: "#1a1a3e",
  borderRadius: 6,
  padding: 12,
  flex: 1,
  maxHeight: 300,
  overflowY: "auto",
  fontFamily: "ui-monospace, monospace",
}
const numInputStyle: CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  borderRadius: 4,
  border: "1px solid #4a4e69",
  background: "#1a1a3e",
  color: "#eee",
  fontSize: 12,
}
const toggleBtnStyle: CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid #4a4e69",
  color: "#eee",
  fontSize: 11,
  fontWeight: 600,
}
