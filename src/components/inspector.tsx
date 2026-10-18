import { useRef, useState, type ReactNode } from 'react'
import { Download, FilePlus2, Redo2, RotateCw, Trash2, Undo2, Upload } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { getPartDef } from '@/lib/parts'
import { downloadDiagram, readDiagramFile } from '@/lib/persist'
import type { Diagram, Endpoint, Note, PartInstance, Wire } from '@/lib/types'
import { useDiagram } from '@/store/diagram'

/** Preset swatches shared by notes and wires. */
const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#64748b']

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] tracking-widest text-muted-foreground uppercase">{label}</span>
      {children}
    </label>
  )
}

function Swatches({ value, onChange }: { value?: string; onChange: (color: string) => void }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] tracking-widest text-muted-foreground uppercase">Colour</p>
      <div className="flex flex-wrap gap-1.5">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            aria-label={`Colour ${c}`}
            onClick={() => onChange(c)}
            style={{ backgroundColor: c }}
            className={
              'size-6 rounded-full border ' +
              (value === c ? 'ring-2 ring-ring ring-offset-1 ring-offset-background' : 'border-border')
            }
          />
        ))}
      </div>
    </div>
  )
}

function ProjectPanel({ diagram }: { diagram: Diagram }) {
  const clear = useDiagram((s) => s.clear)
  const loadDiagram = useDiagram((s) => s.loadDiagram)
  const undo = useDiagram((s) => s.undo)
  const redo = useDiagram((s) => s.redo)
  const canUndo = useDiagram((s) => s.past.length > 0)
  const canRedo = useDiagram((s) => s.future.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (window.confirm('Discard the current diagram and start a new one?')) clear()
          }}
        >
          <FilePlus2 />
          New
        </Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload />
          Import
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadDiagram(diagram)}>
          <Download />
          Export
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // let the same file be re-imported after an error
          if (!file) return
          try {
            setError(null)
            loadDiagram(await readDiagramFile(file))
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not read that file.')
          }
        }}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="ghost" size="sm" disabled={!canUndo} onClick={() => undo()}>
          <Undo2 />
          Undo
        </Button>
        <Button variant="ghost" size="sm" disabled={!canRedo} onClick={() => redo()}>
          <Redo2 />
          Redo
        </Button>
      </div>
      <Separator />
      <div className="mt-auto space-y-1 text-[10px] text-muted-foreground">
        <p>
          {diagram.parts.length} parts · {diagram.wires.length} wires · {diagram.notes.length} notes
        </p>
        <p className="text-muted-foreground/60">Nothing selected.</p>
      </div>
    </div>
  )
}

function PartPanel({ part }: { part: PartInstance }) {
  const def = getPartDef(part.def)
  const setPartLabel = useDiagram((s) => s.setPartLabel)
  const rotateSelection = useDiagram((s) => s.rotateSelection)
  const deleteSelection = useDiagram((s) => s.deleteSelection)
  const pushHistory = useDiagram((s) => s.pushHistory)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{def?.name ?? part.def}</Badge>
        <span className="font-mono text-[10px] text-muted-foreground">{part.def}</span>
      </div>
      <Field label="Label">
        <Input
          value={part.label ?? ''}
          placeholder={def?.name ?? part.def}
          className="h-8 text-xs"
          onFocus={() => pushHistory()}
          onChange={(e) => setPartLabel(part.id, e.target.value)}
        />
      </Field>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Rotation</span>
        <span className="font-mono">{part.rotation}°</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => rotateSelection()}>
          <RotateCw />
          Rotate
        </Button>
      </div>
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="mb-1 text-[10px] tracking-widest text-muted-foreground uppercase">Pins</p>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-0.5 pr-2">
            {(def?.pins ?? []).map((pin) => (
              <li
                key={pin.id}
                className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1"
              >
                <span className="font-mono text-[11px]">
                  {pin.id}
                  {pin.label ? ` · ${pin.label}` : ''}
                </span>
                <span className="text-[10px] text-muted-foreground">{pin.kind}</span>
              </li>
            ))}
            {(def?.pins ?? []).length === 0 && (
              <li className="px-2 py-1 text-[10px] text-muted-foreground">Unknown part definition.</li>
            )}
          </ul>
        </ScrollArea>
      </div>
      <Button variant="destructive" size="sm" onClick={() => deleteSelection()}>
        <Trash2 />
        Delete
      </Button>
    </div>
  )
}

function NotePanel({ note }: { note: Note }) {
  const setNoteText = useDiagram((s) => s.setNoteText)
  const setNoteColor = useDiagram((s) => s.setNoteColor)
  const deleteSelection = useDiagram((s) => s.deleteSelection)
  const pushHistory = useDiagram((s) => s.pushHistory)

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Badge variant="secondary" className="w-fit">
        Note
      </Badge>
      {/* inline textarea: no shadcn `textarea` in the repo, and the CLI was off-limits */}
      <textarea
        value={note.text}
        placeholder="Note…"
        onFocus={() => pushHistory()}
        onChange={(e) => setNoteText(note.id, e.target.value)}
        className="min-h-24 w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Separator />
      <Swatches
        value={note.color}
        onChange={(c) => {
          pushHistory()
          setNoteColor(note.id, c)
        }}
      />
      <Button
        variant="destructive"
        size="sm"
        className="mt-auto"
        onClick={() => deleteSelection()}
      >
        <Trash2 />
        Delete
      </Button>
    </div>
  )
}

function WirePanel({ wire }: { wire: Wire }) {
  const diagram = useDiagram((s) => s.diagram)
  const setWireLabel = useDiagram((s) => s.setWireLabel)
  const setWireColor = useDiagram((s) => s.setWireColor)
  const deleteSelection = useDiagram((s) => s.deleteSelection)
  const pushHistory = useDiagram((s) => s.pushHistory)

  const endpointLabel = (ep: Endpoint) => {
    const part = diagram.parts.find((p) => p.id === ep.part)
    const label = part ? (part.label ?? getPartDef(part.def)?.name ?? part.def) : ep.part
    return `${label}.${ep.pin}`
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Badge variant="secondary" className="w-fit">
        Wire
      </Badge>
      <Swatches
        value={wire.color}
        onChange={(c) => {
          pushHistory()
          setWireColor(wire.id, c)
        }}
      />
      <Field label="Label">
        <Input
          value={wire.label ?? ''}
          className="h-8 text-xs"
          onFocus={() => pushHistory()}
          onChange={(e) => setWireLabel(wire.id, e.target.value)}
        />
      </Field>
      <Separator />
      <div className="space-y-1 text-[11px]">
        <p className="text-[10px] tracking-widest text-muted-foreground uppercase">Endpoints</p>
        <p className="font-mono">{endpointLabel(wire.from)}</p>
        <p className="font-mono">{endpointLabel(wire.to)}</p>
      </div>
      <Button
        variant="destructive"
        size="sm"
        className="mt-auto"
        onClick={() => deleteSelection()}
      >
        <Trash2 />
        Delete
      </Button>
    </div>
  )
}

function MultiPanel({ count }: { count: number }) {
  const deleteSelection = useDiagram((s) => s.deleteSelection)
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <p className="text-xs text-muted-foreground">{count} items selected</p>
      <Button variant="destructive" size="sm" onClick={() => deleteSelection()}>
        <Trash2 />
        Delete
      </Button>
    </div>
  )
}

export function Inspector() {
  const selection = useDiagram((s) => s.selection)
  const diagram = useDiagram((s) => s.diagram)

  if (selection.length === 0) return <ProjectPanel diagram={diagram} />
  if (selection.length > 1) return <MultiPanel count={selection.length} />

  const id = selection[0]
  const part = diagram.parts.find((p) => p.id === id)
  if (part) return <PartPanel part={part} />
  const note = diagram.notes.find((n) => n.id === id)
  if (note) return <NotePanel note={note} />
  const wire = diagram.wires.find((w) => w.id === id)
  if (wire) return <WirePanel wire={wire} />
  return <ProjectPanel diagram={diagram} />
}
