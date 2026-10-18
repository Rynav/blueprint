import { useSimulation } from '@/store/simulation'

/**
 * shortcut: plain textarea, no syntax highlighting. Monaco arrives in P4 along with
 * proper bundler worker config.
 */
export function SketchEditor() {
  const source = useSimulation((s) => s.source)
  const setSource = useSimulation((s) => s.setSource)

  return (
    <textarea
      value={source}
      onChange={(e) => setSource(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      aria-label="Arduino sketch"
      className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
    />
  )
}

/** Compiler output, sketch errors and circuit warnings. */
export function BuildOutput() {
  const message = useSimulation((s) => s.message)
  const status = useSimulation((s) => s.status)

  if (!message) {
    return (
      <p className="p-3 text-xs text-muted-foreground">
        {status === 'compiling' ? 'Compiling…' : 'Nothing to report. Press Run to compile and simulate.'}
      </p>
    )
  }
  return (
    <pre
      className={
        'max-h-full overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap ' +
        (status === 'error' ? 'text-destructive' : 'text-muted-foreground')
      }
    >
      {message}
    </pre>
  )
}
