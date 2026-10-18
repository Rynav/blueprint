/**
 * I2C bus fan-out.
 *
 * Routes one AVR TWI transaction to the placed device whose 7-bit address matches. Each placed
 * part's `def.device.i2c` is a single shared object, so the bus binds it to that part's own
 * persistent state bag by invoking its methods with the bag as `this` — no per-instance object
 * is allocated.
 *
 * Nothing here throws: an address with no device is simply NACKed and the transaction goes
 * nowhere, and a device method that throws would only affect its own transfer.
 */

import type { Diagram, I2cBus, I2cDevice, PartDef } from '@/lib/types'

/** A placed device bound to the state bag its model should mutate. */
interface Bound {
  device: I2cDevice
  bag: Record<string, unknown>
}

export function createI2cBus(
  diagram: Diagram,
  defs: Map<string, PartDef>,
  state: Map<string, Record<string, unknown>>,
): I2cBus {
  const targets = new Map<number, Bound>()
  for (const part of diagram.parts) {
    const device = defs.get(part.def)?.device?.i2c
    if (!device) continue
    const bag = state.get(part.id) ?? {}
    state.set(part.id, bag)
    // shortcut: the first device at an address wins; two devices sharing an address (a real
    // address conflict) would need the write fanned out to both.
    if (!targets.has(device.address)) targets.set(device.address, { device, bag })
  }

  let current: Bound | null = null
  return {
    has: (address) => targets.has(address),

    start: () => {
      current = null
    },

    connect: (address, write) => {
      current = targets.get(address) ?? null
      if (!current) return false
      try {
        current.device.connect.call(current.bag, write)
      } catch {
        current = null
        return false
      }
      return true
    },

    write: (value) => {
      try {
        current?.device.write.call(current.bag, value)
      } catch {
        current = null
      }
    },

    // `I2cDevice.read` returns void — the model is told a byte is wanted, it does not supply
    // one — so the controller always sees 0x00 (0xFF with nothing addressed). Enough for a
    // status read not to hang.
    // shortcut: a device that must return a real register value needs a read-value channel in
    // the frozen I2cDevice contract; add one before a sensor is read.
    read: () => {
      if (!current) return 0xff
      try {
        current.device.read.call(current.bag, true)
      } catch {
        return 0xff
      }
      return 0x00
    },

    stop: () => {
      try {
        current?.device.stop.call(current.bag)
      } catch {
        /* a failed stop must not crash the frame */
      } finally {
        current = null
      }
    },
  }
}
