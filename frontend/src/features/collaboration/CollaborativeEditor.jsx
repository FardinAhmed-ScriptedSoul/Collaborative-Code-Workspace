import { Editor } from "@monaco-editor/react"

function CollaborativeEditor({ onMount }) {
  return (
    <section className="w-3/4 overflow-hidden rounded-lg bg-neutral-800">
      <Editor
        height="100%"
        defaultLanguage="javascript"
        defaultValue="// some comment"
        theme="vs-dark"
        onMount={onMount}
      />
    </section>
  )
}

export default CollaborativeEditor
