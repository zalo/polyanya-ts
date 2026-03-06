import { createRoot } from "react-dom/client"

createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 32, fontFamily: "system-ui" }}>
    <h1>PCB Autorouter</h1>
    <p>Use React Cosmos to view the interactive PCB routing playground.</p>
  </div>,
)
