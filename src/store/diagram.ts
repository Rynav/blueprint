import { create } from 'zustand'

import { snapVec, type Viewport } from '@/lib/geometry'
import { EMPTY_DIAGRAM, type Diagram, type Endpoint, type Vec } from '@/lib/types'

const MAX_HISTORY = 100
const uid = () => crypto.randomUUID()
const clone = <T>(v: T): T => structuredClone(v)

/** In-flight wire drag. */
interface Wiring {
  from: Endpoint
  cursor: Vec
}

export interface DiagramStore {
  /** Treat as immutable: never mutate in place, always produce a new object. */
  diagram: Diagram
  selection: string[]
  viewport: Viewport
  wiring: Wiring | null
  past: Diagram[]
  future: Diagram[]

  /** Snapshot the current diagram so the next mutation can be undone. */
  pushHistory: () => void
  undo: () => void
  redo: () => void

  setSelection: (ids: string[]) => void
  toggleSelection: (id: string) => void
  setViewport: (vp: Viewport) => void

  addPart: (defId: string, at: Vec) => string
  moveSelection: (delta: Vec) => void
  rotateSelection: () => void
  deleteSelection: () => void
  setPartLabel: (id: string, label: string) => void

  addWire: (from: Endpoint, to: Endpoint) => string | undefined
  setWireLabel: (id: string, label: string) => void
  setWireColor: (id: string, color: string) => void
  startWire: (from: Endpoint, cursor: Vec) => void
  updateWireCursor: (cursor: Vec) => void
  cancelWire: () => void

  addNote: (at: Vec) => string
  setNoteText: (id: string, text: string) => void
  setNoteColor: (id: string, color: string) => void

  loadDiagram: (d: Diagram) => void
  clear: () => void
}

/** Snapshot for undo. Cloned so later in-place edits can never corrupt history. */
const snapshot = (d: Diagram) => clone(d)

function sameEndpoint(a: Endpoint, b: Endpoint) {
  return a.part === b.part && a.pin === b.pin
}

export const useDiagram = create<DiagramStore>((set, get) => ({
  diagram: clone(EMPTY_DIAGRAM),
  selection: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  wiring: null,
  past: [],
  future: [],

  pushHistory: () =>
    set((s) => ({ past: [...s.past, snapshot(s.diagram)].slice(-MAX_HISTORY), future: [] })),

  undo: () =>
    set((s) => {
      const prev = s.past[s.past.length - 1]
      if (!prev) return {}
      return {
        past: s.past.slice(0, -1),
        future: [snapshot(s.diagram), ...s.future].slice(0, MAX_HISTORY),
        diagram: prev,
        selection: [],
        wiring: null,
      }
    }),

  redo: () =>
    set((s) => {
      const next = s.future[0]
      if (!next) return {}
      return {
        past: [...s.past, snapshot(s.diagram)].slice(-MAX_HISTORY),
        future: s.future.slice(1),
        diagram: next,
        selection: [],
        wiring: null,
      }
    }),

  setSelection: (ids) => set({ selection: ids }),
  toggleSelection: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((i) => i !== id)
        : [...s.selection, id],
    })),
  setViewport: (vp) => set({ viewport: vp }),

  addPart: (defId, at) => {
    const id = uid()
    get().pushHistory()
    set((s) => ({
      diagram: {
        ...s.diagram,
        parts: [...s.diagram.parts, { id, def: defId, at: snapVec(at), rotation: 0 }],
      },
      selection: [id],
    }))
    return id
  },

  moveSelection: (delta) =>
    set((s) => {
      const sel = new Set(s.selection)
      if (sel.size === 0) return {}
      const shift = (p: Vec) => snapVec({ x: p.x + delta.x, y: p.y + delta.y })
      return {
        diagram: {
          ...s.diagram,
          parts: s.diagram.parts.map((p) => (sel.has(p.id) ? { ...p, at: shift(p.at) } : p)),
          notes: s.diagram.notes.map((n) => (sel.has(n.id) ? { ...n, at: shift(n.at) } : n)),
        },
      }
    }),

  rotateSelection: () => {
    get().pushHistory()
    set((s) => {
      const sel = new Set(s.selection)
      return {
        diagram: {
          ...s.diagram,
          parts: s.diagram.parts.map((p) =>
            sel.has(p.id) ? { ...p, rotation: (((p.rotation + 90) % 360) as 0 | 90 | 180 | 270) } : p,
          ),
        },
      }
    })
  },

  deleteSelection: () => {
    const sel = new Set(get().selection)
    if (sel.size === 0) return
    get().pushHistory()
    set((s) => {
      const parts = s.diagram.parts.filter((p) => !sel.has(p.id))
      const liveIds = new Set(parts.map((p) => p.id))
      return {
        diagram: {
          ...s.diagram,
          parts,
          // drop wires whose endpoints no longer exist, or that were themselves selected
          wires: s.diagram.wires.filter(
            (w) =>
              !sel.has(w.id) &&
              liveIds.has(w.from.part) &&
              liveIds.has(w.to.part),
          ),
          notes: s.diagram.notes.filter((n) => !sel.has(n.id)),
        },
        selection: [],
      }
    })
  },

  setPartLabel: (id, label) =>
    set((s) => ({
      diagram: {
        ...s.diagram,
        parts: s.diagram.parts.map((p) => (p.id === id ? { ...p, label } : p)),
      },
    })),

  addWire: (from, to) => {
    if (sameEndpoint(from, to)) return undefined
    const duplicate = get().diagram.wires.some(
      (w) =>
        (sameEndpoint(w.from, from) && sameEndpoint(w.to, to)) ||
        (sameEndpoint(w.from, to) && sameEndpoint(w.to, from)),
    )
    if (duplicate) return undefined
    const id = uid()
    get().pushHistory()
    set((s) => ({ diagram: { ...s.diagram, wires: [...s.diagram.wires, { id, from, to }] } }))
    return id
  },

  setWireLabel: (id, label) =>
    set((s) => ({
      diagram: { ...s.diagram, wires: s.diagram.wires.map((w) => (w.id === id ? { ...w, label } : w)) },
    })),

  setWireColor: (id, color) =>
    set((s) => ({
      diagram: { ...s.diagram, wires: s.diagram.wires.map((w) => (w.id === id ? { ...w, color } : w)) },
    })),

  startWire: (from, cursor) => set({ wiring: { from, cursor } }),
  updateWireCursor: (cursor) => set((s) => (s.wiring ? { wiring: { ...s.wiring, cursor } } : {})),
  cancelWire: () => set({ wiring: null }),

  addNote: (at) => {
    const id = uid()
    get().pushHistory()
    set((s) => ({
      diagram: {
        ...s.diagram,
        notes: [...s.diagram.notes, { id, at: snapVec(at), text: '' }],
      },
      selection: [id],
    }))
    return id
  },

  // Text edits skip history; callers pushHistory() once when an editing session begins.
  setNoteText: (id, text) =>
    set((s) => ({
      diagram: { ...s.diagram, notes: s.diagram.notes.map((n) => (n.id === id ? { ...n, text } : n)) },
    })),

  setNoteColor: (id, color) =>
    set((s) => ({
      diagram: { ...s.diagram, notes: s.diagram.notes.map((n) => (n.id === id ? { ...n, color } : n)) },
    })),

  loadDiagram: (d) =>
    set({
      diagram: clone(d),
      selection: [],
      wiring: null,
      past: [],
      future: [],
    }),

  clear: () => get().loadDiagram(clone(EMPTY_DIAGRAM)),
}))
