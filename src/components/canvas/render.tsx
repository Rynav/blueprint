import type { CSSProperties } from 'react'

import { GRID, type Viewport } from '@/lib/geometry'
import type { Note, PartDef, PartInstance, Vec } from '@/lib/types'

export const PIN_R = 2.5
export const PIN_HIT_R = 7
export const NOTE_W = 180
export const NOTE_H = 110
const PIN_FILL = '#0b1220'
const ACCENT = '#22d3ee'

/** Dot-grid background for the svg, kept in sync with pan/zoom. */
export function gridStyle(vp: Viewport): CSSProperties {
  const step = GRID * vp.zoom
  return {
    backgroundColor: 'var(--background)',
    backgroundImage:
      'radial-gradient(circle at 1px 1px, var(--grid-dot) 1px, transparent 0), radial-gradient(circle at 1px 1px, var(--grid-dot-major) 1px, transparent 0)',
    backgroundSize: `${step}px ${step}px, ${step * 5}px ${step * 5}px`,
    backgroundPosition: `${-vp.x * vp.zoom}px ${-vp.y * vp.zoom}px`,
  }
}

// shortcut: plain L-shaped elbow, no obstacle avoidance. Upgrade when wires cross parts often.
export function wirePath(a: Vec, b: Vec): string {
  const mx = (a.x + b.x) / 2
  return `M ${a.x} ${a.y} L ${mx} ${a.y} L ${mx} ${b.y} L ${b.x} ${b.y}`
}

/** Label anchor: middle of the elbow's vertical leg. */
export function wireMidpoint(a: Vec, b: Vec): Vec {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function noteBounds(at: Vec) {
  return { x: at.x, y: at.y, w: NOTE_W, h: NOTE_H }
}

// shortcut: fixed-width character wrapping, no measurement/clipping. Upgrade when notes need rich text.
export function wrapNoteText(text: string, maxChars = 26, maxLines = 6): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      if (line && line.length + 1 + word.length > maxChars) {
        out.push(line)
        line = word
      } else {
        line = line ? `${line} ${word}` : word
      }
    }
    out.push(line)
  }
  return out.slice(0, maxLines)
}

export function PartNode({
  part,
  def,
  hoveredPin,
}: {
  part: PartInstance
  def: PartDef
  hoveredPin: string | null
}) {
  return (
    <g
      data-part-id={part.id}
      transform={`translate(${part.at.x} ${part.at.y}) rotate(${part.rotation} ${def.width / 2} ${def.height / 2})`}
    >
      {def.render({ part, def })}
      {def.pins.map((pin) => (
        <g key={pin.id}>
          <circle
            cx={pin.x}
            cy={pin.y}
            r={hoveredPin === pin.id ? PIN_R + 1 : PIN_R}
            fill={hoveredPin === pin.id ? ACCENT : PIN_FILL}
            stroke={ACCENT}
            strokeWidth={1}
            pointerEvents="none"
          />
          <circle
            cx={pin.x}
            cy={pin.y}
            r={PIN_HIT_R}
            fill="transparent"
            data-part={part.id}
            data-pin={pin.id}
            style={{ pointerEvents: 'all' }}
          />
        </g>
      ))}
    </g>
  )
}

/** Rendered when a diagram references a PartDef the registry does not know. */
export function PlaceholderPart({ part }: { part: PartInstance }) {
  return (
    <g data-part-id={part.id} transform={`translate(${part.at.x} ${part.at.y})`}>
      <rect width={64} height={40} rx={3} fill="#1e293b" stroke="#f87171" strokeDasharray="4 3" />
      <text x={32} y={24} textAnchor="middle" fontSize={9} fill="#fca5a5">
        {`? ${part.def}`}
      </text>
    </g>
  )
}

export function NoteNode({ note, selected }: { note: Note; selected: boolean }) {
  const lines = wrapNoteText(note.text)
  return (
    <g data-note-id={note.id} transform={`translate(${note.at.x} ${note.at.y})`}>
      <rect
        width={NOTE_W}
        height={NOTE_H}
        rx={6}
        fill={note.color ?? '#fde68a'}
        opacity={0.95}
        stroke={selected ? ACCENT : 'rgba(15,23,42,0.2)'}
        strokeWidth={selected ? 2 : 1}
      />
      <text x={10} y={24} fontSize={12} fill="#1f2937" pointerEvents="none">
        {lines.map((line, i) => (
          <tspan key={i} x={10} dy={i === 0 ? 0 : 15}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  )
}
