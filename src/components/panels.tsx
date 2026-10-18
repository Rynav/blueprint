import type { ReactNode } from 'react'
import { CircuitBoard, FilePlus2, FolderOpen, Play, Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const VERSION = 'v0.1.0'

/** Shared panel chrome: uppercase title bar + scrollable body. */
function Panel({
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

      <Separator orientation="vertical" className="!h-5" />

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" disabled>
          <FilePlus2 />
          New
        </Button>
        <Button variant="ghost" size="sm" disabled>
          <FolderOpen />
          Open
        </Button>
      </div>

      <div className="ml-auto">
        <Button size="sm" disabled>
          <Play />
          Run
        </Button>
      </div>
    </header>
  )
}

const PART_CATEGORIES = [
  'Boards',
  'Breadboards',
  'Power',
  'LEDs',
  'Resistors',
  'Buttons & switches',
  'Displays',
  'Motors & servos',
  'Sensors',
  'Sound',
  'ICs & logic',
  'Wires & probes',
] as const

export function PartsPalette() {
  return (
    <Panel
      title="Parts"
      actions={
        <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
          {PART_CATEGORIES.length}
        </Badge>
      }
    >
      <div className="flex h-full flex-col">
        <div className="relative shrink-0 p-2">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search parts…" className="h-8 pl-7 text-xs" disabled />
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-0.5 p-2 pt-0">
            {PART_CATEGORIES.map((category) => (
              <li key={category}>
                <button
                  type="button"
                  disabled
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground/80 hover:bg-accent/50"
                >
                  {category}
                </button>
              </li>
            ))}
          </ul>
          <p className="px-3 pb-3 text-[10px] text-muted-foreground/60">
            Data-driven registry lands in P1.
          </p>
        </ScrollArea>
      </div>
    </Panel>
  )
}

export function BlueprintCanvas() {
  return (
    <div className="blueprint-grid relative h-full w-full">
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-mono text-xs tracking-[0.3em] text-primary/70 uppercase">canvas</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Pan, zoom, parts and wiring arrive in P1.
          </p>
        </div>
      </div>
    </div>
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

export function Inspector() {
  return (
    <Panel title="Inspector">
      <div className="grid h-full place-items-center p-4">
        <p className="text-center text-xs text-muted-foreground">Nothing selected.</p>
      </div>
    </Panel>
  )
}

export function StatusBar() {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t bg-sidebar px-3 font-mono text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        persist: idle
      </span>
      <span>sim: off</span>
      <span className="ml-auto">
        milestone p0 · {VERSION}
      </span>
    </footer>
  )
}
