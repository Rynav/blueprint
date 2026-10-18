import { create } from 'zustand'

import { loadSketch, saveSketch } from '@/lib/persist'
import type { PartRenderState } from '@/lib/types'

/** The sketch the editor starts from: the pin-13 Blink every Arduino tutorial begins with. */
export const DEFAULT_SKETCH = `// Blink — LED on pin 13, 500 ms on, 500 ms off
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`

export type SimStatus = 'idle' | 'compiling' | 'ready' | 'running' | 'error'

interface SimulationStore {
  source: string
  status: SimStatus
  /** Compiler output or the reason the last build failed. */
  message: string
  /** Everything written to the serial port so far. */
  serial: string
  /** Part id -> live render state (LED brightness, lit segments, ...), set by the run loop. */
  partState: Record<string, PartRenderState>
  /** Net id -> solved volts, set by the run loop. Lets the UI show what a pin is reading. */
  volts: Record<string, number>

  setSource: (source: string) => void
  setStatus: (status: SimStatus) => void
  setMessage: (message: string) => void
  appendSerial: (text: string) => void
  clearSerial: () => void
  setPartState: (partState: Record<string, PartRenderState>) => void
  setVolts: (volts: Record<string, number>) => void
}

/** Coalesce writes while the user types; the sketch is tiny but keystrokes are frequent. */
let saveTimer: ReturnType<typeof setTimeout> | null = null
function persistSoon(source: string) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveSketch(source), 400)
}

export const useSimulation = create<SimulationStore>((set) => ({
  source: loadSketch() ?? DEFAULT_SKETCH,
  status: 'idle',
  message: '',
  serial: '',
  partState: {},
  volts: {},

  setSource: (source) => {
    persistSoon(source)
    set({ source })
  },
  setStatus: (status) => set({ status }),
  setMessage: (message) => set({ message }),
  appendSerial: (text) => set((s) => ({ serial: (s.serial + text).slice(-20000) })),
  clearSerial: () => set({ serial: '' }),
  setPartState: (partState) => set({ partState }),
  setVolts: (volts) => set({ volts }),
}))
