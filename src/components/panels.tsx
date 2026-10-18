import type { ReactNode } from 'react'
import { CircuitBoard, Play } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

/**
 * shortcut: version string hardcoded here; inject from package.json at build time
 * when release automation needs a single source of truth.
 */
const VERSION = 'v0.3.0'

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
        <Button size="sm" disabled title="Compiling and running lands in P3">
          <Play />
          Run
        </Button>
      </div>
    </header>
  )
}

const SKETCH_STUB = `// Arduino C++ — compiled in-browser from P3
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}`

export function BottomPanel() {
  return (
    <section className="flex h-full min-h-0 flex-col bg-sidebar/40">
      <Tabs defaultValue="code" className="flex h-full min-h-0 flex-col gap-0">
        <div className="flex h-9 shrink-0 items-center border-b px-2">
          <TabsList className="h-7 bg-transparent">
            <TabsTrigger value="code" className="font-mono text-[11px]">
              sketch.ino
            </TabsTrigger>
            <TabsTrigger value="serial" className="font-mono text-[11px]">
              serial
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="code" className="min-h-0 flex-1 overflow-auto p-3">
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground">{SKETCH_STUB}</pre>
        </TabsContent>
        <TabsContent value="serial" className="min-h-0 flex-1 overflow-auto p-3">
          <pre className="font-mono text-xs text-muted-foreground">Serial monitor arrives in P3.</pre>
        </TabsContent>
      </Tabs>
    </section>
  )
}

export function StatusBar({ saved }: { saved: boolean }) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-sidebar px-3 font-mono text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className={cn('size-1.5 rounded-full', saved ? 'bg-emerald-400' : 'bg-amber-400')} />
        persist: {saved ? 'saved' : 'saving…'}
      </span>
      <span>sim: off</span>
      <span className="ml-auto">milestone p1 · {VERSION}</span>
    </footer>
  )
}
