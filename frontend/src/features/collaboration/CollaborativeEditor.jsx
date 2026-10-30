import { Editor } from "@monaco-editor/react"

function CollaborativeEditor({ onMount, readOnly = false }) {
  return (
    <section className="w-3/4 overflow-hidden rounded-lg bg-neutral-800">
      <Editor
        height="100%"
        defaultLanguage="javascript"
        defaultValue=""
        theme="vs-dark"
        options={{ readOnly, minimap: { enabled: false } }}
        onMount={onMount}
      />
    </section>
  )
}

export default CollaborativeEditor
