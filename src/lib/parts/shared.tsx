import type { ReactNode } from 'react'

import type { PinDef, PinKind } from '@/lib/types'

/** Line-art palette for the dark canvas. */
export const BODY = '#1b2437'
export const BODY_DARK = '#0e1526'
export const LINE = '#2f3f5c'
export const TEXT = '#d7e2f2'
export const DIM = '#5b6b86'
export const ACCENT = '#22d3ee'
export const MONO = 'ui-monospace, monospace'

/** Pin pad colour by kind, so pin roles read at a glance. */
export const PIN_COLOR: Record<PinKind, string> = {
  power: '#ef4444',
  ground: '#64748b',
  io: ACCENT,
  analog: '#a78bfa',
  pwm: '#f59e0b',
  passive: '#94a3b8',
}

/** A pin pad drawn at the pin's exact local coordinate. */
export function Pad({
  x,
  y,
  kind = 'passive',
  r = 2.2,
}: {
  x: number
  y: number
  kind?: PinKind
  r?: number
}) {
  return <circle cx={x} cy={y} r={r} fill={PIN_COLOR[kind]} stroke={BODY_DARK} strokeWidth={0.6} />
}

/** All pads of a part, drawn at their def coordinates. */
export function Pads({ pins }: { pins: PinDef[] }) {
  return (
    <>
      {pins.map((p) => (
        <Pad key={p.id} x={p.x} y={p.y} kind={p.kind} />
      ))}
    </>
  )
}

export function Txt({
  x,
  y,
  size = 8,
  fill = TEXT,
  anchor = 'middle',
  children,
}: {
  x: number
  y: number
  size?: number
  fill?: string
  anchor?: 'start' | 'middle' | 'end'
  children: ReactNode
}) {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontFamily={MONO}>
      {children}
    </text>
  )
}
