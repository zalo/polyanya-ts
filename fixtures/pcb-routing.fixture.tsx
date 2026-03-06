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
  buildMeshFromRegions,
  type Point,
} from "../lib/index"
import { cdtTriangulate, rectToPolygon } from "../lib/cdt-builder"
import { routeTraces, type Trace, type TraceRoute } from "../lib/rubberband"
import { createPcbRenderer, type PcbRenderer } from "./pcb-renderer"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOUNDS = { minX: 0, maxX: 100, minY: 0, maxY: 100 }

const DEFAULT_OBSTACLES: Obstacle[] = [
  { id: 1, x1: 30, y1: 25, x2: 50, y2: 45 },
  { id: 2, x1: 55, y1: 55, x2: 75, y2: 70 },
]

const DEFAULT_TRACES: TraceState[] = [
  { id: 1, start: { x: 15, y: 30 }, end: { x: 85, y: 70 } },
  { id: 2, start: { x: 20, y: 80 }, end: { x: 80, y: 20 } },
]

let nextGlobalId = 100

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function obstacleToPolygon(o: Obstacle, clearance: number): Point[] {
  const x1 = Math.min(o.x1, o.x2) - clearance
  const y1 = Math.min(o.y1, o.y2) - clearance
  const x2 = Math.max(o.x1, o.x2) + clearance
  const y2 = Math.max(o.y1, o.y2) + clearance
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ]
}

function pathLen(pts: Point[]) {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x
    const dy = pts[i]!.y - pts[i - 1]!.y
    len += Math.sqrt(dx * dx + dy * dy)
  }
  return len
}

function buildMesh(obstacles: Obstacle[], traces: TraceState[], clearance: number) {
  try {
    const obstaclePolygons = obstacles.map((o) => obstacleToPolygon(o, clearance))
    // Collect all trace start/end points as Steiner points for the CDT
    const steinerPoints: Point[] = []
    for (const t of traces) {
      steinerPoints.push(t.start, t.end)
    }
    const result = cdtTriangulate({
      bounds: BOUNDS,
      obstacles: obstaclePolygons,
      steinerPoints,
    })
    const mesh = buildMeshFromRegions({ regions: result.regions })
    return mesh
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type InteractionMode = "trace" | "obstacle"
type DragState =
  | null
  | { type: "trace-start"; traceId: number }
  | { type: "trace-end"; traceId: number }
  | { type: "obstacle-draw"; obsId: number; anchor: Point }
  | { type: "obstacle-move"; obsId: number; offX: number; offY: number }

export default function PcbRoutingPlayground() {
  // --- State ---
  const [obstacles, setObstacles] = useState<Obstacle[]>(DEFAULT_OBSTACLES)
  const [traces, setTraces] = useState<TraceState[]>(DEFAULT_TRACES)
  const [clearance, setClearance] = useState(2)
  const [mode, setMode] = useState<InteractionMode>("trace")
  const [selectedTrace, setSelectedTrace] = useState<number | null>(null)
  const [selectedObs, setSelectedObs] = useState<number | null>(null)
  const [showTriangulation, setShowTriangulation] = useState(true)
  const [showInitialPaths, setShowInitialPaths] = useState(false)
  const [showCorridors, setShowCorridors] = useState(false)
  const [showRubberbandPaths, setShowRubberbandPaths] = useState(true)

  // --- Refs ---
  const rendererRef = useRef<PcbRenderer | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState>(null)
  const dragRaf = useRef(0)

  // --- Build mesh ---
  const mesh = useMemo(
    () => buildMesh(obstacles, traces, clearance),
    [obstacles, traces, clearance],
  )

  // --- Route traces ---
  const routes = useMemo<TraceRoute[]>(() => {
    if (!mesh || traces.length === 0) return []
    const traceInputs: Trace[] = traces.map((t) => ({
      id: t.id,
      start: t.start,
      end: t.end,
    }))
    return routeTraces(mesh, traceInputs)
  }, [mesh, traces])

  // --- Mount renderer ---
  useEffect(() => {
    const r = createPcbRenderer()
    rendererRef.current = r
    containerRef.current?.appendChild(r.container)
    return () => {
      r.dispose()
      rendererRef.current = null
    }
  }, [])

  // --- Update renderer ---
  useEffect(() => {
    const r = rendererRef.current
    if (!r) return
    r.update({
      mesh: mesh ?? undefined,
      bounds: BOUNDS,
      obstacles,
      traces,
      routes,
      selectedTrace,
      selectedObs,
      showTriangulation,
      showInitialPaths,
      showCorridors,
      showRubberbandPaths,
    })
    r.render()
  }, [
    mesh,
    obstacles,
    traces,
    routes,
    selectedTrace,
    selectedObs,
    showTriangulation,
    showInitialPaths,
    showCorridors,
    showRubberbandPaths,
  ])

  // --- Pointer handlers ---
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const r = rendererRef.current
      if (!r) return
      const p = r.screenToWorld(e.clientX, e.clientY)
      if (!p) return

      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)

      if (mode === "trace") {
        // Check if clicking near a trace endpoint
        for (const t of traces) {
          const ds = Math.hypot(p.x - t.start.x, p.y - t.start.y)
          const de = Math.hypot(p.x - t.end.x, p.y - t.end.y)
          const threshold = 3
          if (ds < threshold) {
            dragRef.current = { type: "trace-start", traceId: t.id }
            setSelectedTrace(t.id)
            setSelectedObs(null)
            return
          }
          if (de < threshold) {
            dragRef.current = { type: "trace-end", traceId: t.id }
            setSelectedTrace(t.id)
            setSelectedObs(null)
            return
          }
        }

        // Otherwise, start drawing a new trace
        const id = ++nextGlobalId
        setTraces((prev) => [...prev, { id, start: p, end: p }])
        dragRef.current = { type: "trace-end", traceId: id }
        setSelectedTrace(id)
        setSelectedObs(null)
      } else {
        // Obstacle mode: check for double-click handled separately
        // Check if clicking on existing obstacle
        for (let i = obstacles.length - 1; i >= 0; i--) {
          const o = obstacles[i]!
          const ox1 = Math.min(o.x1, o.x2)
          const oy1 = Math.min(o.y1, o.y2)
          const ox2 = Math.max(o.x1, o.x2)
          const oy2 = Math.max(o.y1, o.y2)
          if (p.x >= ox1 && p.x <= ox2 && p.y >= oy1 && p.y <= oy2) {
            const cx = (o.x1 + o.x2) / 2
            const cy = (o.y1 + o.y2) / 2
            dragRef.current = {
              type: "obstacle-move",
              obsId: o.id,
              offX: cx - p.x,
              offY: cy - p.y,
            }
            setSelectedObs(o.id)
            setSelectedTrace(null)
            return
          }
        }

        // Start drawing new obstacle
        const id = ++nextGlobalId
        setObstacles((prev) => [...prev, { id, x1: p.x, y1: p.y, x2: p.x, y2: p.y }])
        dragRef.current = { type: "obstacle-draw", obsId: id, anchor: p }
        setSelectedObs(id)
        setSelectedTrace(null)
      }
    },
    [mode, traces, obstacles],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const r = rendererRef.current
      if (!r) return
      const drag = dragRef.current
      if (!drag) return
      const p = r.screenToWorld(e.clientX, e.clientY)
      if (!p) return

      // Clamp to bounds
      p.x = Math.max(BOUNDS.minX + 1, Math.min(BOUNDS.maxX - 1, p.x))
      p.y = Math.max(BOUNDS.minY + 1, Math.min(BOUNDS.maxY - 1, p.y))

      if (drag.type === "trace-start") {
        setTraces((prev) =>
          prev.map((t) => (t.id === drag.traceId ? { ...t, start: p } : t)),
        )
      } else if (drag.type === "trace-end") {
        setTraces((prev) =>
          prev.map((t) => (t.id === drag.traceId ? { ...t, end: p } : t)),
        )
      } else if (drag.type === "obstacle-draw") {
        setObstacles((prev) =>
          prev.map((o) =>
            o.id === drag.obsId ? { ...o, x2: p.x, y2: p.y } : o,
          ),
        )
      } else if (drag.type === "obstacle-move") {
        setObstacles((prev) =>
          prev.map((o) => {
            if (o.id !== drag.obsId) return o
            const hw = Math.abs(o.x2 - o.x1) / 2
            const hh = Math.abs(o.y2 - o.y1) / 2
            const cx = p.x + drag.offX
            const cy = p.y + drag.offY
            return { ...o, x1: cx - hw, y1: cy - hh, x2: cx + hw, y2: cy + hh }
          }),
        )
      }
    },
    [],
  )

  const onPointerUp = useCallback(() => {
    const drag = dragRef.current
    // Remove zero-size obstacles
    if (drag?.type === "obstacle-draw") {
      setObstacles((prev) =>
        prev.filter((o) => {
          if (o.id !== drag.obsId) return true
          return Math.abs(o.x2 - o.x1) > 1 && Math.abs(o.y2 - o.y1) > 1
        }),
      )
    }
    // Remove zero-length traces
    if (drag?.type === "trace-end") {
      setTraces((prev) =>
        prev.filter((t) => {
          if (t.id !== drag.traceId) return true
          return Math.hypot(t.end.x - t.start.x, t.end.y - t.start.y) > 2
        }),
      )
    }
    dragRef.current = null
  }, [])

  const deleteSelected = useCallback(() => {
    if (selectedTrace !== null) {
      setTraces((prev) => prev.filter((t) => t.id !== selectedTrace))
      setSelectedTrace(null)
    }
    if (selectedObs !== null) {
      setObstacles((prev) => prev.filter((o) => o.id !== selectedObs))
      setSelectedObs(null)
    }
  }, [selectedTrace, selectedObs])

  // --- Stats ---
  const totalInitialLength = routes.reduce(
    (s, r) => s + pathLen(r.initialPath),
    0,
  )
  const totalRubberbandLength = routes.reduce(
    (s, r) => s + pathLen(r.rubberbandPath),
    0,
  )

  return (
    <div style={rootStyle}>
      <div
        style={canvasWrap}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div ref={containerRef} style={containerStyle} />
      </div>

      {/* Side panel */}
      <div style={panelStyle}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#06d6a0" }}>
          PCB Autorouter
        </h2>
        <div style={{ fontSize: 11, color: "#8d99ae" }}>
          Topological Rubberband Routing
        </div>

        {/* Interaction mode */}
        <label style={labelStyle}>Draw mode</label>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setMode("trace")}
            style={{
              ...toggleBtnStyle,
              background: mode === "trace" ? "#06d6a0" : "#1a1a3e",
              color: mode === "trace" ? "#000" : "#eee",
            }}
          >
            Trace (click+drag)
          </button>
          <button
            onClick={() => setMode("obstacle")}
            style={{
              ...toggleBtnStyle,
              background: mode === "obstacle" ? "#e94560" : "#1a1a3e",
            }}
          >
            Obstacle (click+drag)
          </button>
        </div>

        {/* Clearance */}
        <label style={labelStyle}>Clearance: {clearance.toFixed(1)}</label>
        <input
          type="range"
          min={0}
          max={5}
          step={0.5}
          value={clearance}
          onChange={(e) => setClearance(Number(e.target.value))}
          style={{ width: "100%" }}
        />

        {/* Visualization toggles */}
        <div style={cardStyle}>
          <div style={cardTitle}>Visualization</div>
          <Toggle
            label="Delaunay Triangulation"
            checked={showTriangulation}
            onChange={setShowTriangulation}
          />
          <Toggle
            label="Initial paths (A* on edges)"
            checked={showInitialPaths}
            onChange={setShowInitialPaths}
          />
          <Toggle
            label="Triangle corridors"
            checked={showCorridors}
            onChange={setShowCorridors}
          />
          <Toggle
            label="Rubberband paths"
            checked={showRubberbandPaths}
            onChange={setShowRubberbandPaths}
          />
        </div>

        {/* Selection */}
        {(selectedTrace !== null || selectedObs !== null) && (
          <div style={cardStyle}>
            <div style={cardTitle}>
              {selectedTrace !== null ? `Trace #${selectedTrace}` : `Obstacle #${selectedObs}`}
            </div>
            {selectedTrace !== null && (() => {
              const route = routes.find((r) => r.trace.id === selectedTrace)
              if (!route) return null
              return (
                <>
                  <Row label="Initial path" value={`${pathLen(route.initialPath).toFixed(1)} (${route.initialPath.length} pts)`} />
                  <Row label="Rubberband path" value={`${pathLen(route.rubberbandPath).toFixed(1)} (${route.rubberbandPath.length} pts)`} />
                  <Row label="Corridor" value={`${route.corridor.length} triangles`} />
                </>
              )
            })()}
            <Btn bg="#e94560" onClick={deleteSelected}>
              Delete
            </Btn>
          </div>
        )}

        {/* Stats */}
        <div style={cardStyle}>
          <div style={cardTitle}>Statistics</div>
          <Row label="Traces" value={traces.length} />
          <Row label="Obstacles" value={obstacles.length} />
          <Row label="Polygons" value={mesh?.polygons.length ?? 0} />
          <Row label="Total initial length" value={totalInitialLength.toFixed(1)} />
          <Row label="Total rubberband length" value={totalRubberbandLength.toFixed(1)} />
          {totalInitialLength > 0 && (
            <Row
              label="Improvement"
              value={`${((1 - totalRubberbandLength / totalInitialLength) * 100).toFixed(1)}%`}
            />
          )}
        </div>

        {/* Legend */}
        <div style={cardStyle}>
          <div style={{ ...cardTitle, color: "#8d99ae" }}>Legend</div>
          <Legend color="#06d6a0" label="Trace start" />
          <Legend color="#f72585" label="Trace end" />
          <Legend color="#4a4e69" label="Triangulation edges" />
          <Legend color="#e94560" label="Obstacles / Boundary" />
          <Legend color="#f8961e" label="Initial path (A* on CDT edges)" />
          <Legend color="#06d6a0" label="Rubberband path" />
          <Legend color="#4361ee33" label="Triangle corridor" />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn
            bg="#4a4e69"
            onClick={() => {
              setTraces(DEFAULT_TRACES)
              setObstacles(DEFAULT_OBSTACLES)
              setSelectedTrace(null)
              setSelectedObs(null)
              nextGlobalId = 100
            }}
          >
            Reset
          </Btn>
          <Btn
            bg="#4a4e69"
            onClick={() => {
              setTraces([])
              setSelectedTrace(null)
            }}
          >
            Clear traces
          </Btn>
          <Btn
            bg="#4a4e69"
            onClick={() => {
              setObstacles([])
              setSelectedObs(null)
            }}
          >
            Clear obstacles
          </Btn>
        </div>

        {/* Algorithm explanation */}
        <div style={{ ...cardStyle, fontSize: 11, color: "#8d99ae", lineHeight: 1.5 }}>
          <div style={{ ...cardTitle, color: "#8d99ae" }}>Algorithm</div>
          <ol style={{ margin: 0, paddingLeft: 16 }}>
            <li>Build CDT with obstacles + trace endpoints as vertices</li>
            <li>A* on CDT edges finds initial vertex-to-vertex path</li>
            <li>Initial path establishes topology (which side of each obstacle)</li>
            <li>String-pull: walk CDT to check line-of-sight between vertices</li>
            <li>Kept vertices = obstacle corners the trace wraps around</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Toggle({
  label,
  checked,
  onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", gap: 6, fontSize: 12, cursor: "pointer", marginBottom: 2 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
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
    <div style={{ fontSize: 12, lineHeight: 1.6, display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      {label}
    </div>
  )
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
const canvasWrap: CSSProperties = {
  flex: 1,
  padding: 12,
  position: "relative",
  touchAction: "none",
}
const containerStyle: CSSProperties = {
  position: "absolute",
  inset: 12,
  borderRadius: 8,
  overflow: "hidden",
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
const toggleBtnStyle: CSSProperties = {
  flex: 1,
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid #4a4e69",
  color: "#eee",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
}
