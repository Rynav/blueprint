import type { McuSpec, PinDef, PinKind, PartDef } from '@/lib/types'
import { ACCENT, BODY, BODY_DARK, LINE, Pads, Txt } from './shared'

/** [id, label, kind] shorthand for a pin row. */
type Row = [string, string, PinKind]

/** Spread pins evenly along a horizontal edge at `y`. */
function edgeH(items: Row[], w: number, y: number, pad: number): PinDef[] {
  const span = w - pad * 2
  return items.map(([id, label, kind], i) => ({
    id,
    label,
    kind,
    x: pad + (items.length === 1 ? span / 2 : (span * i) / (items.length - 1)),
    y,
  }))
}

/** Spread pins evenly along a vertical edge at `x`. */
function edgeV(items: Row[], h: number, x: number, pad: number): PinDef[] {
  const span = h - pad * 2
  return items.map(([id, label, kind], i) => ({
    id,
    label,
    kind,
    x,
    y: pad + (items.length === 1 ? span / 2 : (span * i) / (items.length - 1)),
  }))
}

/** Pin labels on the two horizontal edges, drawn just outside the outline. */
function EdgeLabels({ pins, h }: { pins: PinDef[]; h: number }) {
  return (
    <>
      {pins.map((p) => {
        const top = p.y === 0
        return (
          <g key={p.id} transform={`translate(${p.x} ${top ? -4 : h + 4}) rotate(-90)`}>
            <Txt x={0} y={2.5} size={6.5} anchor={top ? 'start' : 'end'}>
              {p.label ?? p.id}
            </Txt>
          </g>
        )
      })}
    </>
  )
}

const UNO_W = 270
const UNO_H = 190

const unoDigital = edgeH(
  Array.from({ length: 14 }, (_, i): Row => [`d${i}`, `${i}`, i === 13 ? 'pwm' : 'io']),
  UNO_W,
  0,
  30,
)

const unoLower: Row[] = [
  ['vin', 'VIN', 'power'],
  ['5v', '5V', 'power'],
  ['3v3', '3.3V', 'power'],
  ['aref', 'AREF', 'analog'],
  ['gnd1', 'GND', 'ground'],
  ['gnd2', 'GND', 'ground'],
  ['a0', 'A0', 'analog'],
  ['a1', 'A1', 'analog'],
  ['a2', 'A2', 'analog'],
  ['a3', 'A3', 'analog'],
  ['a4', 'A4', 'analog'],
  ['a5', 'A5', 'analog'],
]

const unoPins: PinDef[] = [...unoDigital, ...edgeH(unoLower, UNO_W, UNO_H, 30)]

/** ATmega328P breakout pinout: d0-d7 = PD0-PD7, d8-d13 = PB0-PB5, a0-a5 = PC0-PC5. */
const mcu328: McuSpec = {
  chip: 'atmega328p',
  clockHz: 16_000_000,
  pins: {
    d0: { port: 'D', bit: 0 },
    d1: { port: 'D', bit: 1 },
    d2: { port: 'D', bit: 2 },
    d3: { port: 'D', bit: 3 },
    d4: { port: 'D', bit: 4 },
    d5: { port: 'D', bit: 5 },
    d6: { port: 'D', bit: 6 },
    d7: { port: 'D', bit: 7 },
    d8: { port: 'B', bit: 0 },
    d9: { port: 'B', bit: 1 },
    d10: { port: 'B', bit: 2 },
    d11: { port: 'B', bit: 3 },
    d12: { port: 'B', bit: 4 },
    d13: { port: 'B', bit: 5 },
    a0: { port: 'C', bit: 0 },
    a1: { port: 'C', bit: 1 },
    a2: { port: 'C', bit: 2 },
    a3: { port: 'C', bit: 3 },
    a4: { port: 'C', bit: 4 },
    a5: { port: 'C', bit: 5 },
  },
}

const arduinoUno: PartDef = {
  id: 'arduino-uno',
  name: 'Arduino Uno',
  category: 'boards',
  width: UNO_W,
  height: UNO_H,
  pins: unoPins,
  mcu: mcu328,
  render: () => (
    <>
      <rect x={0} y={0} width={UNO_W} height={UNO_H} rx={6} fill={BODY} stroke={LINE} strokeWidth={1.5} />
      <rect x={24} y={3} width={UNO_W - 48} height={9} rx={2} fill={BODY_DARK} />
      <rect x={24} y={UNO_H - 12} width={UNO_W - 48} height={9} rx={2} fill={BODY_DARK} />
      {[
        [16, 16],
        [UNO_W - 16, 16],
        [16, UNO_H - 16],
        [UNO_W - 16, UNO_H - 16],
      ].map(([x, y]) => (
        <circle key={`${x}:${y}`} cx={x} cy={y} r={4.5} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
      ))}
      <rect x={10} y={44} width={30} height={38} rx={3} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <rect x={16} y={50} width={18} height={26} rx={1.5} fill="none" stroke={LINE} strokeWidth={0.8} />
      <Txt x={25} y={94} size={6}>
        USB
      </Txt>
      <rect x={12} y={126} width={26} height={34} rx={4} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <circle cx={25} cy={143} r={5} fill="none" stroke={LINE} strokeWidth={1} />
      <rect
        x={UNO_W / 2 - 34}
        y={UNO_H / 2 - 20}
        width={68}
        height={40}
        rx={3}
        fill={BODY_DARK}
        stroke={LINE}
        strokeWidth={1.2}
      />
      <Txt x={UNO_W / 2} y={UNO_H / 2 + 3} size={7} fill={ACCENT}>
        ATmega328P
      </Txt>
      <Txt x={UNO_W - 62} y={UNO_H - 34} size={17}>
        UNO
      </Txt>
      <Pads pins={unoPins} />
      <EdgeLabels pins={unoPins} h={UNO_H} />
    </>
  ),
}

const NANO_W = 180
const NANO_H = 70

const nanoUpper: Row[] = [
  ['d13', '13', 'pwm'],
  ['d12', '12', 'io'],
  ['d11', '11', 'pwm'],
  ['d10', '10', 'pwm'],
  ['d9', '9', 'pwm'],
  ['d8', '8', 'io'],
  ['d7', '7', 'io'],
  ['d6', '6', 'pwm'],
  ['d5', '5', 'pwm'],
  ['d4', '4', 'io'],
  ['d3', '3', 'pwm'],
  ['d2', '2', 'io'],
  ['gnd1', 'GND', 'ground'],
  ['aref', 'AREF', 'analog'],
  ['reset', 'RST', 'io'],
]

const nanoLower: Row[] = [
  ['d0', 'RX', 'io'],
  ['d1', 'TX', 'io'],
  ['gnd2', 'GND', 'ground'],
  ['5v', '5V', 'power'],
  ['3v3', '3V3', 'power'],
  ['vin', 'VIN', 'power'],
  ['a0', 'A0', 'analog'],
  ['a1', 'A1', 'analog'],
  ['a2', 'A2', 'analog'],
  ['a3', 'A3', 'analog'],
  ['a4', 'A4', 'analog'],
  ['a5', 'A5', 'analog'],
  ['a6', 'A6', 'analog'],
  ['a7', 'A7', 'analog'],
]

const nanoPins: PinDef[] = [...edgeH(nanoUpper, NANO_W, 0, 14), ...edgeH(nanoLower, NANO_W, NANO_H, 14)]

const arduinoNano: PartDef = {
  id: 'arduino-nano',
  name: 'Arduino Nano',
  category: 'boards',
  width: NANO_W,
  height: NANO_H,
  pins: nanoPins,
  // Same ATmega328P breakout; a6/a7 are analog-only inputs, so they carry no port bit.
  mcu: mcu328,
  render: () => (
    <>
      <rect x={0} y={0} width={NANO_W} height={NANO_H} rx={5} fill={BODY} stroke={LINE} strokeWidth={1.5} />
      <rect x={14} y={14} width={NANO_W - 28} height={NANO_H - 30} rx={3} fill={BODY_DARK} />
      <rect x={4} y={24} width={24} height={22} rx={3} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <Txt x={16} y={38} size={6}>
        USB
      </Txt>
      <rect
        x={NANO_W / 2 - 24}
        y={NANO_H / 2 - 10}
        width={48}
        height={20}
        rx={2}
        fill={BODY}
        stroke={LINE}
        strokeWidth={1}
      />
      <Txt x={NANO_W / 2} y={NANO_H / 2 + 3} size={6} fill={ACCENT}>
        ATmega328
      </Txt>
      <circle cx={NANO_W - 14} cy={20} r={3} fill="#f97316" />
      <circle cx={NANO_W - 14} cy={32} r={3} fill="#22c55e" />
      <Pads pins={nanoPins} />
      <EdgeLabels pins={nanoPins} h={NANO_H} />
    </>
  ),
}

const PICO_W = 210
const PICO_H = 90

const gp = (from: number, to: number): Row[] =>
  Array.from(
    { length: to - from + 1 },
    (_, i): Row => [`gp${from + i}`, `GP${from + i}`, from + i >= 26 ? 'analog' : 'io'],
  )

const picoLower: Row[] = [
  ...gp(20, 28),
  ['vbus', 'VBUS', 'power'],
  ['vsys', 'VSYS', 'power'],
  ['3v3', '3V3', 'power'],
  ['gnd1', 'GND', 'ground'],
  ['gnd2', 'GND', 'ground'],
  ['gnd3', 'GND', 'ground'],
]

const picoPins: PinDef[] = [...edgeH(gp(0, 19), PICO_W, 0, 16), ...edgeH(picoLower, PICO_W, PICO_H, 16)]

const raspberryPico: PartDef = {
  id: 'raspberry-pico',
  name: 'Raspberry Pi Pico',
  category: 'boards',
  width: PICO_W,
  height: PICO_H,
  pins: picoPins,
  render: () => (
    <>
      <rect x={0} y={0} width={PICO_W} height={PICO_H} rx={4} fill={BODY} stroke={LINE} strokeWidth={1.5} />
      <rect
        x={PICO_W / 2 - 30}
        y={10}
        width={60}
        height={34}
        rx={3}
        fill={BODY_DARK}
        stroke={LINE}
        strokeWidth={1.2}
      />
      {[0, 1, 2].map((i) => (
        <line
          key={i}
          x1={PICO_W / 2 - 22 + i * 14}
          y1={14}
          x2={PICO_W / 2 - 22 + i * 14}
          y2={40}
          stroke={LINE}
          strokeWidth={0.6}
          opacity={0.6}
        />
      ))}
      <Txt x={PICO_W / 2} y={31} size={6} fill={ACCENT}>
        RP2040
      </Txt>
      <circle cx={PICO_W / 2 + 34} cy={22} r={3.5} fill="#22c55e" />
      <rect
        x={PICO_W - 20}
        y={PICO_H / 2 - 15}
        width={20}
        height={30}
        rx={3}
        fill={BODY_DARK}
        stroke={LINE}
        strokeWidth={1.2}
      />
      <Txt x={PICO_W - 10} y={PICO_H / 2 + 2} size={6}>
        USB
      </Txt>
      <Txt x={26} y={PICO_H - 16} size={8} fill={ACCENT} anchor="start">
        PICO
      </Txt>
      <Pads pins={picoPins} />
      <EdgeLabels pins={picoPins} h={PICO_H} />
    </>
  ),
}

const ESP_W = 140
const ESP_H = 280

// shortcut: ESP32 is visual only, no simulation model yet; add sim when firmware/GPIO sim lands.
const espLeft: Row[] = [
  ['en', 'EN', 'io'],
  ['vp', 'VP', 'analog'],
  ['vn', 'VN', 'analog'],
  ['p34', '34', 'analog'],
  ['p35', '35', 'analog'],
  ['p32', '32', 'analog'],
  ['p33', '33', 'analog'],
  ['p25', '25', 'analog'],
  ['p26', '26', 'analog'],
  ['p27', '27', 'analog'],
  ['p14', '14', 'analog'],
  ['p12', '12', 'io'],
  ['p13', '13', 'io'],
  ['gnd1', 'GND', 'ground'],
  ['p2', '2', 'io'],
]

const espRight: Row[] = [
  ['vin', 'VIN', 'power'],
  ['3v3', '3V3', 'power'],
  ['gnd2', 'GND', 'ground'],
  ['p15', '15', 'io'],
  ['p4', '4', 'analog'],
  ['p0', '0', 'io'],
  ['p5', '5', 'io'],
  ['p18', '18', 'io'],
  ['p19', '19', 'io'],
  ['p21', '21', 'io'],
  ['rx0', 'RX0', 'io'],
  ['tx0', 'TX0', 'io'],
  ['p22', '22', 'io'],
  ['p23', '23', 'io'],
  ['gnd3', 'GND', 'ground'],
]

const espPins: PinDef[] = [...edgeV(espLeft, ESP_H, 0, 18), ...edgeV(espRight, ESP_H, ESP_W, 18)]

const esp32Devkit: PartDef = {
  id: 'esp32-devkit',
  name: 'ESP32 DevKit',
  category: 'boards',
  width: ESP_W,
  height: ESP_H,
  pins: espPins,
  render: () => (
    <>
      <rect x={0} y={0} width={ESP_W} height={ESP_H} rx={5} fill={BODY} stroke={LINE} strokeWidth={1.5} />
      <rect x={ESP_W / 2 - 32} y={8} width={64} height={40} rx={3} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={ESP_W / 2 - 24}
          y1={15 + i * 8}
          x2={ESP_W / 2 + 24}
          y2={15 + i * 8}
          stroke={LINE}
          strokeWidth={0.6}
          opacity={0.7}
        />
      ))}
      <Txt x={ESP_W / 2} y={34} size={6} fill={ACCENT}>
        ESP32
      </Txt>
      <rect x={ESP_W / 2 - 24} y={70} width={48} height={52} rx={3} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <Txt x={ESP_W / 2} y={100} size={6}>
        WROOM
      </Txt>
      <rect x={ESP_W / 2 - 44} y={150} width={24} height={12} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
      <Txt x={ESP_W / 2 - 32} y={159} size={6}>
        EN
      </Txt>
      <rect x={ESP_W / 2 + 20} y={150} width={24} height={12} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
      <Txt x={ESP_W / 2 + 32} y={159} size={6}>
        BOOT
      </Txt>
      <circle cx={ESP_W / 2} cy={192} r={3.5} fill="#ef4444" />
      <rect
        x={ESP_W / 2 - 16}
        y={ESP_H - 24}
        width={32}
        height={24}
        rx={3}
        fill={BODY_DARK}
        stroke={LINE}
        strokeWidth={1.2}
      />
      <Txt x={ESP_W / 2} y={ESP_H - 30} size={6}>
        USB
      </Txt>
      <Pads pins={espPins} />
      {espPins.map((p) => (
        <Txt key={p.id} x={p.x === 0 ? 8 : ESP_W - 8} y={p.y + 2} size={6} anchor={p.x === 0 ? 'start' : 'end'}>
          {p.label ?? p.id}
        </Txt>
      ))}
    </>
  ),
}

export const boardParts: PartDef[] = [arduinoUno, arduinoNano, raspberryPico, esp32Devkit]
