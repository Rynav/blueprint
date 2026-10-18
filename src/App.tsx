import { useEffect, useRef, useState } from 'react'

import { Canvas } from '@/components/canvas/canvas'
import { Inspector } from '@/components/inspector'
import { BottomPanel, Panel, StatusBar, TopBar } from '@/components/panels'
import { PartsPalette } from '@/components/palette'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { TooltipProvider } from '@/components/ui/tooltip'
import { loadLocal, saveLocal } from '@/lib/persist'
import { useDiagram } from '@/store/diagram'

const AUTOSAVE_MS = 400

export default function App() {
  const [saved, setSaved] = useState(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Restore the last session once, before the autosave subscription is attached.
  useEffect(() => {
    const restored = loadLocal()
    if (restored) useDiagram.getState().loadDiagram(restored)
  }, [])

  // Autosave to localStorage, debounced. Persistence is local-only, by design.
  useEffect(() => {
    const unsubscribe = useDiagram.subscribe((state, prev) => {
      if (state.diagram === prev.diagram) return
      if (timer.current) clearTimeout(timer.current)
      setSaved(false)
      timer.current = setTimeout(() => {
        saveLocal(useDiagram.getState().diagram)
        setSaved(true)
      }, AUTOSAVE_MS)
    })
    return () => {
      unsubscribe()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
        <TopBar />
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel defaultSize="18%" minSize={200} maxSize="32%" className="min-h-0">
            <Panel title="Parts">
              <PartsPalette />
            </Panel>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="60%" minSize={320} className="min-h-0">
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize="68%" minSize={200} className="min-h-0">
                <Canvas />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="32%" minSize={120} className="min-h-0">
                <BottomPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="22%" minSize={200} maxSize="36%" className="min-h-0">
            <Panel title="Inspector">
              <Inspector />
            </Panel>
          </ResizablePanel>
        </ResizablePanelGroup>
        <StatusBar saved={saved} />
      </div>
    </TooltipProvider>
  )
}
