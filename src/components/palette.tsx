import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PART_CATEGORIES, listParts } from '@/lib/parts'
import type { PartDef } from '@/lib/types'
import { useDiagram } from '@/store/diagram'

/**
 * The registry is written by a sibling module whose category shape isn't visible here;
 * tolerate either a bare id string or a `{ id, name }` record so the palette can't break.
 * shortcut: falls back to the id when `name` is absent; widen if the registry changes.
 */
type Category = (typeof PART_CATEGORIES)[number]
const categoryId = (c: Category): string =>
  typeof c === 'string' ? c : (c as { id: string }).id
const categoryName = (c: Category): string => {
  if (typeof c === 'string') return c
  const rec = c as { id: string; name?: string }
  return rec.name ?? rec.id
}

function PartTile({ def, onAdd }: { def: PartDef | undefined; onAdd: () => void }) {
  if (!def) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          draggable
          onClick={onAdd}
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-blueprint-part', def.id)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          className="flex w-full flex-col items-center gap-1 rounded-md border border-transparent p-1.5 text-center transition-colors hover:border-border hover:bg-accent/50"
        >
          <svg
            viewBox={`0 0 ${def.width} ${def.height}`}
            width={44}
            height={44}
            preserveAspectRatio="xMidYMid meet"
            className="shrink-0"
          >
            {def.render({
              part: { id: 'preview', def: def.id, at: { x: 0, y: 0 }, rotation: 0 },
              def,
            })}
          </svg>
          <span className="w-full truncate text-[10px] leading-tight text-muted-foreground">
            {def.name}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{def.name}</TooltipContent>
    </Tooltip>
  )
}

export function PartsPalette() {
  const [query, setQuery] = useState('')
  const viewport = useDiagram((s) => s.viewport)
  const addPart = useDiagram((s) => s.addPart)

  const all = useMemo(() => listParts(), [])
  const q = query.trim().toLowerCase()
  const matches = all.filter(
    (d) => !q || d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q),
  )

  return (
    <div className="flex h-full flex-col">
      <div className="relative shrink-0 p-2">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search parts…"
          className="h-8 pl-7 text-xs"
        />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {matches.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No parts match “{query}”.
          </p>
        ) : (
          <div className="pb-2">
            {PART_CATEGORIES.map((cat) => {
              const id = categoryId(cat)
              const items = matches.filter((d) => d.category === id)
              if (items.length === 0) return null
              return (
                <section key={id} className="px-2 pb-2">
                  <header className="flex items-center justify-between px-1 py-1.5">
                    <span className="text-[10px] font-medium tracking-widest text-muted-foreground uppercase">
                      {categoryName(cat)}
                    </span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {items.length}
                    </Badge>
                  </header>
                  <ul className="grid grid-cols-2 gap-1">
                    {items.map((def) => (
                      <li key={def.id}>
                        <PartTile
                          def={def}
                          onAdd={() =>
                            addPart(def.id, { x: viewport.x + 240, y: viewport.y + 180 })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  )
}
