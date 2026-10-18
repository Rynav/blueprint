import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

import { complete, qualifierAt, resolveAt, type ApiKind } from '@/lib/editor/arduino-api'

/**
 * Monaco, wired with the Arduino intelligence from `lib/editor/arduino-api`.
 *
 * The package root is imported on purpose: `monaco-editor/esm/vs/editor.js` is the API
 * only, with none of the editor contributions, so a leaner import registers these
 * providers and then never renders a suggest or hover widget - a failure that looks like
 * "wired up but nothing happens", which is worse than not having them at all.
 */

// Monaco needs a worker, and Vite's `?worker` import is the documented way to hand it one.
// The specifier is relative to the package's exports map (`"./*": "./esm/vs/*.js"`), so it
// is NOT written as `monaco-editor/esm/vs/...` - that resolves to `esm/vs/esm/vs/...`.
//
// This always returns the *base editor* worker, whatever language asks. Only `cpp` models
// exist here, so Monaco's packaged language services (TypeScript, CSS, HTML, JSON) are never
// requested at runtime. Their chunks are still emitted into the build - roughly 8 MB of
// output bloat, and zero download cost, because nothing ever asks for them.
// shortcut: if a non-cpp model is ever added, dispatch on the requested label here.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

const KIND: Record<ApiKind, monaco.languages.CompletionItemKind> = {
  function: monaco.languages.CompletionItemKind.Function,
  method: monaco.languages.CompletionItemKind.Method,
  constant: monaco.languages.CompletionItemKind.Constant,
  class: monaco.languages.CompletionItemKind.Class,
  type: monaco.languages.CompletionItemKind.TypeParameter,
}

/** Registered once per page: Monaco has no per-component unregister worth using. */
let registered = false

function registerArduinoIntelligence() {
  if (registered) return
  registered = true

  monaco.editor.defineTheme('blueprint', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5b6b86', fontStyle: 'italic' },
      { token: 'keyword', foreground: '22d3ee' },
      { token: 'number', foreground: 'fbbf24' },
      { token: 'string', foreground: 'a7f3d0' },
      { token: 'type', foreground: 'a78bfa' },
    ],
    colors: {
      'editor.background': '#0e1526',
      'editor.foreground': '#d7e2f2',
      'editorLineNumber.foreground': '#3f4d66',
      'editorLineNumber.activeForeground': '#8094b0',
      'editorCursor.foreground': '#22d3ee',
      'editor.selectionBackground': '#1e3a5f',
      'editorSuggestWidget.background': '#0e1526',
      'editorSuggestWidget.border': '#1e2a44',
      'editorSuggestWidget.selectedBackground': '#172238',
      'editorHoverWidget.background': '#0e1526',
      'editorHoverWidget.border': '#1e2a44',
    },
  })

  monaco.languages.registerCompletionItemProvider('cpp', {
    // `.` re-opens the list, so `Serial.` offers that object's own methods.
    triggerCharacters: ['.'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const qualifier = qualifierAt(model.getLineContent(position.lineNumber), word.startColumn - 1)
      const qualified = qualifier ? complete(`${qualifier}.`) : []
      const items = qualified.length > 0 ? qualified : complete(word.word)

      return {
        suggestions: items.map((entry) => ({
          label: entry.label,
          kind: KIND[entry.kind],
          detail: entry.detail,
          documentation: { value: entry.doc },
          insertText: entry.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range: new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          ),
        })),
      }
    },
  })

  monaco.languages.registerHoverProvider('cpp', {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position)
      if (!word) return null
      const entry = resolveAt(model.getLineContent(position.lineNumber), word.startColumn - 1, word.word)
      if (!entry) return null
      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        contents: [{ value: '```cpp\n' + entry.detail + '\n```' }, { value: entry.doc }],
      }
    },
  })
}

export interface MonacoSketchProps {
  value: string
  onChange: (value: string) => void
}

export default function MonacoSketch({ value, onChange }: MonacoSketchProps) {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const latest = useRef(onChange)

  useEffect(() => {
    latest.current = onChange
  }, [onChange])

  useEffect(() => {
    const element = host.current
    if (!element) return
    registerArduinoIntelligence()
    const instance = monaco.editor.create(element, {
      value,
      language: 'cpp',
      theme: 'blueprint',
      fontSize: 12,
      minimap: { enabled: false },
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      renderLineHighlight: 'none',
      padding: { top: 8, bottom: 8 },
      fixedOverflowWidgets: true,
    })
    editor.current = instance
    const subscription = instance.onDidChangeModelContent(() =>
      latest.current(instance.getValue()),
    )
    return () => {
      subscription.dispose()
      instance.dispose()
      editor.current = null
    }
    // Created once: `value` is only the starting text, and synced below afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External changes (an imported or restored sketch) have to be pushed in, or only
  // keystrokes would ever reach the model.
  useEffect(() => {
    const instance = editor.current
    if (instance && instance.getValue() !== value) instance.setValue(value)
  }, [value])

  return <div ref={host} className="h-full w-full" />
}
