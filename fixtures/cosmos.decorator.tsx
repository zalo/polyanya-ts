import type { ReactNode } from "react"

export default function Decorator({ children }: { children: ReactNode }) {
  return (
    <>
      <style>{`
        @media (max-width: 700px) {
          /* Hide Cosmos nav panel on mobile */
          [class*="panelContainer"],
          div[style*="width: 320px"] {
            display: none !important;
          }
        }
      `}</style>
      {children}
    </>
  )
}
