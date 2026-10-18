import type { PartDef } from '@/lib/types'
import { basicParts } from './basic'
import { boardParts } from './boards'
import { breadboardParts } from './breadboard'
import { deviceParts } from './devices'
import { digitalParts } from './digital'
import { displayParts } from './display'
import { powerParts } from './power'

export interface PartCategory {
  id: string
  name: string
}

/** Ordered as shown in the palette. Every category below has at least one part. */
export const PART_CATEGORIES: PartCategory[] = [
  { id: 'boards', name: 'Boards' },
  { id: 'breadboards', name: 'Breadboards' },
  { id: 'power', name: 'Power' },
  { id: 'leds', name: 'LEDs' },
  { id: 'diodes', name: 'Diodes' },
  { id: 'transistors', name: 'Transistors' },
  { id: 'resistors', name: 'Resistors' },
  { id: 'switches', name: 'Switches' },
  { id: 'sensors', name: 'Sensors' },
  { id: 'motors', name: 'Motors' },
  { id: 'sound', name: 'Sound' },
  { id: 'digital', name: 'Digital' },
]

const PARTS: PartDef[] = [
  ...boardParts,
  ...breadboardParts,
  ...powerParts,
  ...basicParts,
  ...deviceParts,
  ...digitalParts,
  ...displayParts,
]
const BY_ID = new Map(PARTS.map((p) => [p.id, p]))

/** Every registered part, in palette order. Treat as read-only. */
export function allPartDefs(): PartDef[] {
  return PARTS
}

export function getPartDef(id: string): PartDef | undefined {
  return BY_ID.get(id)
}

export function listParts(categoryId?: string): PartDef[] {
  return categoryId ? PARTS.filter((p) => p.category === categoryId) : PARTS
}
