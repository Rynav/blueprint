import {
  BlueprintCanvas,
  BottomPanel,
  Inspector,
  PartsPalette,
  StatusBar,
  TopBar,
} from '@/components/panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function App() {
  return (
    <TooltipProvider>
      <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
        <TopBar />
        <ResizablePanelGroup orientation="horizontal" className="flex-1">
          <ResizablePanel defaultSize="18%" minSize={200} maxSize="32%">
            <PartsPalette />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="60%" minSize={320}>
            <ResizablePanelGroup orientation="vertical">
              <ResizablePanel defaultSize="68%" minSize={200}>
                <BlueprintCanvas />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize="32%" minSize={120}>
                <BottomPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="22%" minSize={200} maxSize="36%">
            <Inspector />
          </ResizablePanel>
        </ResizablePanelGroup>
        <StatusBar />
      </div>
    </TooltipProvider>
  )
}
