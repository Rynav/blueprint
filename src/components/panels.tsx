import type { ReactNode } from 'react'
import { CircuitBoard, Play, Square } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BuildOutput, SketchEditor } from '@/components/editor'
import { SerialMonitor } from '@/components/monitor'
import { useRunner } from '@/hooks/use-runner'
import { cn } from '@/lib/utils'
import { useSimulation } from '@/store/simulation'

/**
 * shortcut: version string hardcoded here; inject from package.json at build time
 * when release automation needs a single source of truth.
 */
const VERSION = 'v0.10.0'

/** Shared panel chrome: uppercase title bar + body. */
export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-sidebar/40">
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
          {title}
        </span>
        {actions}
      </header>
      <div className={cn('min-h-0 flex-1', className)}>{children}</div>
    </section>
  )
}

export function TopBar() {
  const { start, stop } = useRunner()
  const status = useSimulation((s) => s.status)
  const running = status === 'running'
  const busy = status === 'compiling'

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-sidebar px-3">
      <div className="flex items-center gap-2">
        <CircuitBoard className="size-5 text-primary" />
        <span className="font-mono text-sm font-semibold tracking-tight">blueprint</span>
        <Badge variant="secondary" className="font-mono text-[10px]">
          {VERSION}
        </Badge>
      </div>
      <div className="ml-auto">
        {running ? (
          <Button size="sm" variant="secondary" onClick={stop}>
            <Square />
            Stop
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void start()}>
            <Play />
            {busy ? 'Compiling…' : 'Run'}
          </Button>
        )}
      </div>
    </header>
  )
}

export function BottomPanel() {
  return (
    <section className="flex h-full min-h-0 flex-col bg-sidebar/40">
      <Tabs defaultValue="sketch" className="flex h-full min-h-0 flex-col gap-0">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
          <TabsList className="h-7 bg-transparent">
            <TabsTrigger value="sketch" className="font-mono text-[11px]">
              sketch.ino
            </TabsTrigger>
            <TabsTrigger value="serial" className="font-mono text-[11px]">
              serial
            </TabsTrigger>
            <TabsTrigger value="build" className="font-mono text-[11px]">
              build
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="sketch" className="min-h-0 flex-1">
          <SketchEditor />
        </TabsContent>
        <TabsContent value="serial" className="min-h-0 flex-1">
          <SerialMonitor />
        </TabsContent>
        <TabsContent value="build" className="min-h-0 flex-1">
          <BuildOutput />
        </TabsContent>
      </Tabs>
    </section>
  )
}

const SIM_LABEL: Record<string, string> = {
  idle: 'sim: idle',
  compiling: 'sim: compiling…',
  ready: 'sim: ready',
  running: 'sim: running',
  error: 'sim: error',
}

export function StatusBar({ saved }: { saved: boolean }) {
  const status = useSimulation((s) => s.status)
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-sidebar px-3 font-mono text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full', saved ? 'bg-emerald-400' : 'bg-amber-400')} />
        persist: {saved ? 'saved' : 'saving…'}
      </span>
      <span
        className={cn(status === 'error' && 'text-destructive', status === 'running' && 'text-primary')}
      >
        {SIM_LABEL[status] ?? status}
      </span>
      <span className="ml-auto">milestone p3 · {VERSION}</span>
    </footer>
  )
}
