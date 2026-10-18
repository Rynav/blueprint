import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'

import {
  NoteNode,
  PartNode,
  PlaceholderPart,
  gridStyle,
  noteBounds,
  wireMidpoint,
  wirePath,
} from '@/components/canvas/render'
import {
  hitTestPart,
  partBounds,
  pinWorld,
  rectsIntersect,
  screenToWorld,
  snapVec,
} from '@/lib/geometry'
import { allPartDefs } from '@/lib/parts'
import type { Endpoint, Vec, Wire } from '@/lib/types'
import { useDiagram } from '@/store/diagram'

const ACCENT = '#22d3ee'
const CLICK_SLOP = 4

type Drag =
  | { kind: 'pan'; last: Vec }
  | { kind: 'marquee'; start: Vec; cur: Vec; additive: boolean; moved: boolean }
  // `sent` is the last grid-aligned offset applied, so accumulation never stalls in the snap dead zone.
  | { kind: 'move'; startWorld: Vec; sent: Vec }
  | { kind: 'wire'; from: Endpoint }

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

export function Canvas() {
  const diagram = useDiagram((s) => s.diagram)
  const selection = useDiagram((s) => s.selection)
  const viewport = useDiagram((s) => s.viewport)
  const wiring = useDiagram((s) => s.wiring)

  const defs = useMemo(() => new Map(allPartDefs().map((d) => [d.id, d])), [])
  const selected = useMemo(() => new Set(selection), [selection])

  const hostRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [hoverPin, setHoverPin] = useState<Endpoint | null>(null)
  const [space, setSpace] = useState(false)
  const [panning, setPanning] = useState(false)

  const screenOf = (e: { clientX: number; clientY: number }): Vec => {
    const r = hostRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const worldOf = (e: { clientX: number; clientY: number }): Vec =>
    screenToWorld(useDiagram.getState().viewport, screenOf(e))

  /** The pin under the pointer, resolved through the DOM so it works during pointer capture. */
  const pinUnder = (e: { clientX: number; clientY: number }): Endpoint | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin]')
    const part = el?.getAttribute('data-part')
    const pin = el?.getAttribute('data-pin')
    return part && pin ? { part, pin } : null
  }

  const pinOf = (partId: string, pinId: string): Vec | undefined => {
    const part = useDiagram.getState().diagram.parts.find((p) => p.id === partId)
    const def = part && defs.get(part.def)
    return part && def ? pinWorld(part, def, pinId) : undefined
  }

  // Zoom about the pointer. Non-passive so preventDefault actually stops page zoom/scroll.
  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const screen = { x: e.clientX - r.left, y: e.clientY - r.top }
      const vp = useDiagram.getState().viewport
      const zoom = Math.min(4, Math.max(0.2, vp.zoom * Math.exp(-e.deltaY * 0.0015)))
      const world = screenToWorld(vp, screen)
      useDiagram.getState().setViewport({
        zoom,
        x: world.x - screen.x / zoom,
        y: world.y - screen.y / zoom,
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const beginMove = (id: string, world: Vec, additive: boolean, pointerId: number) => {
    const store = useDiagram.getState()
    if (additive) store.toggleSelection(id)
    // shortcut: clicking an already-selected part keeps the whole selection so groups drag together.
    else if (!store.selection.includes(id)) store.setSelection([id])
    store.pushHistory()
    setHoverPin(null)
    dragRef.current = { kind: 'move', startWorld: world, sent: { x: 0, y: 0 } }
    hostRef.current?.setPointerCapture(pointerId)
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    const el = hostRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    const store = useDiagram.getState()
    const target = e.target as Element
    const world = worldOf(e)

    // Pan: middle button, or space + left anywhere (wins over every other target).
    if (e.button === 1 || (space && e.button === 0)) {
      e.preventDefault()
      setHoverPin(null)
      dragRef.current = { kind: 'pan', last: screenOf(e) }
      setPanning(true)
      el.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return

    if (store.wiring && !target.closest('[data-pin]')) store.cancelWire()

    const pinEl = target.closest('[data-pin]')
    if (pinEl) {
      const from = { part: pinEl.getAttribute('data-part')!, pin: pinEl.getAttribute('data-pin')! }
      store.startWire(from, world)
      dragRef.current = { kind: 'wire', from }
      setHoverPin(from)
      el.setPointerCapture(e.pointerId)
      return
    }

    const noteEl = target.closest('[data-note-id]')
    if (noteEl) {
      beginMove(noteEl.getAttribute('data-note-id')!, world, e.shiftKey, e.pointerId)
      return
    }

    const part = hitTestPart(store.diagram, defs, world)
    if (part) {
      beginMove(part.id, world, e.shiftKey, e.pointerId)
      return
    }

    const wireEl = target.closest('[data-wire-id]')
    if (wireEl) {
      const id = wireEl.getAttribute('data-wire-id')!
      if (e.shiftKey) store.toggleSelection(id)
      else store.setSelection([id])
      return
    }

    const start = screenOf(e)
    dragRef.current = { kind: 'marquee', start, cur: start, additive: e.shiftKey, moved: false }
    setMarquee({ x: start.x, y: start.y, w: 0, h: 0 })
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    const store = useDiagram.getState()

    if (!drag) {
      const next = pinUnder(e)
      setHoverPin((prev) =>
        prev?.part === next?.part && prev?.pin === next?.pin ? prev : next,
      )
      return
    }

    if (drag.kind === 'pan') {
      const s = screenOf(e)
      const vp = store.viewport
      store.setViewport({
        ...vp,
        x: vp.x - (s.x - drag.last.x) / vp.zoom,
        y: vp.y - (s.y - drag.last.y) / vp.zoom,
      })
      drag.last = s
      return
    }

    if (drag.kind === 'marquee') {
      const s = screenOf(e)
      drag.cur = s
      const w = Math.abs(s.x - drag.start.x)
      const h = Math.abs(s.y - drag.start.y)
      if (w > CLICK_SLOP || h > CLICK_SLOP) drag.moved = true
      setMarquee({
        x: Math.min(drag.start.x, s.x),
        y: Math.min(drag.start.y, s.y),
        w,
        h,
      })
      return
    }

    if (drag.kind === 'move') {
      const world = worldOf(e)
      const shift = snapVec({
        x: world.x - drag.startWorld.x,
        y: world.y - drag.startWorld.y,
      })
      const delta = { x: shift.x - drag.sent.x, y: shift.y - drag.sent.y }
      if (delta.x || delta.y) {
        store.moveSelection(delta)
        drag.sent = shift
      }
      return
    }

    store.updateWireCursor(worldOf(e))
    setHoverPin(pinUnder(e))
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    const drag = dragRef.current
    dragRef.current = null
    setPanning(false)
    if (hostRef.current?.hasPointerCapture(e.pointerId)) {
      hostRef.current.releasePointerCapture(e.pointerId)
    }
    if (!drag) return
    const store = useDiagram.getState()

    if (drag.kind === 'marquee') {
      setMarquee(null)
      if (!drag.moved) {
        if (!drag.additive) store.setSelection([])
        return
      }
      const vp = store.viewport
      const a = screenToWorld(vp, drag.start)
      const b = screenToWorld(vp, drag.cur)
      const rect = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      }
      const hits: string[] = []
      // shortcut: AABB test, so a rotated part needs its box fully inside the marquee.
      for (const part of store.diagram.parts) {
        const def = defs.get(part.def)
        if (def && rectsIntersect(rect, partBounds(part, def))) hits.push(part.id)
      }
      for (const note of store.diagram.notes) {
        if (rectsIntersect(rect, noteBounds(note.at))) hits.push(note.id)
      }
      store.setSelection(drag.additive ? [...new Set([...store.selection, ...hits])] : hits)
      return
    }

    if (drag.kind === 'wire') {
      const target = pinUnder(e)
      const ontoSelf = target && target.part === drag.from.part && target.pin === drag.from.pin
      if (target && !ontoSelf) store.addWire(drag.from, target)
      else store.cancelWire()
    }
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (isEditable(e.target)) return
    const store = useDiagram.getState()
    const key = e.key.toLowerCase()
    const mod = e.metaKey || e.ctrlKey

    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault()
      setSpace(true)
      return
    }
    if (mod && key === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
      return
    }
    if (e.ctrlKey && key === 'y') {
      e.preventDefault()
      store.redo()
      return
    }
    if (e.key === 'Escape') {
      store.cancelWire()
      if (dragRef.current?.kind === 'wire') dragRef.current = null
      setHoverPin(null)
      store.setSelection([])
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      store.deleteSelection()
      return
    }
    if (!mod && key === 'r') store.rotateSelection()
  }

  const wireEnds = (wire: Wire): [Vec, Vec] | null => {
    const a = pinOf(wire.from.part, wire.from.pin)
    const b = pinOf(wire.to.part, wire.to.pin)
    return a && b ? [a, b] : null
  }

  const previewFrom = wiring ? pinOf(wiring.from.part, wiring.from.pin) : undefined
  const cursor = panning ? 'grabbing' : space ? 'grab' : wiring || hoverPin ? 'crosshair' : 'default'

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      role="application"
      aria-label="Circuit canvas"
      className="relative h-full w-full overflow-hidden outline-none"
      style={{ cursor, touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!dragRef.current) setHoverPin(null)
      }}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.code === 'Space') setSpace(false)
      }}
      onBlur={() => setSpace(false)}
      onDragOver={(e: ReactDragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e: ReactDragEvent) => {
        const defId = e.dataTransfer.getData('application/x-blueprint-part')
        if (!defId) return
        e.preventDefault()
        useDiagram.getState().addPart(defId, worldOf(e))
      }}
    >
      <svg className="block h-full w-full select-none" style={gridStyle(viewport)}>
        <g
          transform={`translate(${-viewport.x * viewport.zoom} ${-viewport.y * viewport.zoom}) scale(${viewport.zoom})`}
        >
          {diagram.wires.map((wire) => {
            const ends = wireEnds(wire)
            if (!ends) return null
            const [a, b] = ends
            const d = wirePath(a, b)
            const mid = wireMidpoint(a, b)
            const isSel = selected.has(wire.id)
            const labelW = (wire.label?.length ?? 0) * 6.4 + 6
            return (
              <g key={wire.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                  data-wire-id={wire.id}
                />
                <path
                  d={d}
                  fill="none"
                  stroke={isSel ? ACCENT : (wire.color ?? '#7dd3fc')}
                  strokeWidth={isSel ? 3 : 2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
                {wire.label ? (
                  <g pointerEvents="none">
                    <rect
                      x={mid.x - labelW / 2}
                      y={mid.y - 8}
                      width={labelW}
                      height={13}
                      rx={2}
                      fill="var(--background)"
                      opacity={0.85}
                    />
                    <text x={mid.x} y={mid.y + 2} textAnchor="middle" fontSize={10} fill="currentColor">
                      {wire.label}
                    </text>
                  </g>
                ) : null}
              </g>
            )
          })}

          {wiring && previewFrom ? (
            <line
              x1={previewFrom.x}
              y1={previewFrom.y}
              x2={wiring.cursor.x}
              y2={wiring.cursor.y}
              stroke={ACCENT}
              strokeWidth={2}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}

          {diagram.parts.map((part) => {
            const def = defs.get(part.def)
            return def ? (
              <PartNode
                key={part.id}
                part={part}
                def={def}
                hoveredPin={hoverPin?.part === part.id ? hoverPin.pin : null}
              />
            ) : (
              <PlaceholderPart key={part.id} part={part} />
            )
          })}

          {diagram.notes.map((note) => (
            <NoteNode key={note.id} note={note} selected={selected.has(note.id)} />
          ))}

          {diagram.parts.map((part) => {
            const def = defs.get(part.def)
            if (!def || !selected.has(part.id)) return null
            const b = partBounds(part, def)
            return (
              <rect
                key={part.id}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )
          })}
        </g>

        {/* Marquee lives in screen space, outside the pan/zoom group. */}
        {marquee ? (
          <rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
            fill={ACCENT}
            fillOpacity={0.08}
            stroke={ACCENT}
            strokeWidth={1}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        ) : null}
      </svg>
    </div>
  )
}
