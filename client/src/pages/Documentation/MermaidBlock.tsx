import React, { useEffect, useRef } from 'react'
import mermaid from 'mermaid'

let mermaidReady = false

function ensureMermaid() {
  if (mermaidReady) return
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'strict',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  })
  mermaidReady = true
}

export const MermaidBlock: React.FC<{ chart: string }> = ({ chart }) => {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ensureMermaid()
    const el = ref.current
    if (!el) return
    el.textContent = chart
    el.removeAttribute('data-processed')
    void mermaid.run({ nodes: [el] }).catch(() => {
      el.textContent = '（图表渲染失败，请检查 Mermaid 语法）'
    })
  }, [chart])

  return <div ref={ref} className="mermaid" />
}
