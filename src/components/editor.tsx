import { lazy, Suspense, Component, type ReactNode } from 'react'

import { useSimulation } from '@/store/simulation'

/**
 * Monaco is code-split: the app's own bundle stays small and the editor streams in
 * separately. It is also wrapped in a boundary, so if it cannot load (no worker, a
 * blocked chunk, an odd browser) the plain textarea below still lets you write code.
 * Losing syntax highlighting is a cosmetic failure; losing the editor is not.
 */
const MonacoSketch = lazy(() => import('@/components/editor/monaco-sketch'))

/** Fallback editor: no highlighting, but it always works. */
function PlainEditor({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      aria-label="Arduino sketch"
      className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-foreground outline-none"
    />
  )
}

class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function SketchEditor() {
  const source = useSimulation((s) => s.source)
  const setSource = useSimulation((s) => s.setSource)
  const fallback = <PlainEditor value={source} onChange={setSource} />

  return (
    <EditorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MonacoSketch value={source} onChange={setSource} />
      </Suspense>
    </EditorBoundary>
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
