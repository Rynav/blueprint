import { useSimulation } from '@/store/simulation'

export function SerialMonitor() {
  const serial = useSimulation((s) => s.serial)
  const clearSerial = useSimulation((s) => s.clearSerial)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-3 pt-2">
        <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
          {serial ? `${serial.length} bytes` : 'idle'}
        </span>
        <button
          type="button"
          onClick={clearSerial}
          disabled={!serial}
          className="text-[10px] tracking-widest text-muted-foreground uppercase hover:text-foreground disabled:opacity-40"
        >
          clear
        </button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground">
        {serial || 'Nothing on the serial port yet.'}
      </pre>
    </div>
  )
}
