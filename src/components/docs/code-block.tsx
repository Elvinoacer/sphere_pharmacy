"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { useTheme } from "next-themes"
import { PrismAsyncLight } from "react-syntax-highlighter"
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash"
import css from "react-syntax-highlighter/dist/esm/languages/prism/css"
import json from "react-syntax-highlighter/dist/esm/languages/prism/json"
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown"
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx"
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript"
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml"
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark"
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light"

PrismAsyncLight.registerLanguage("typescript", typescript)
PrismAsyncLight.registerLanguage("ts", typescript)
PrismAsyncLight.registerLanguage("tsx", tsx)
PrismAsyncLight.registerLanguage("javascript", tsx)
PrismAsyncLight.registerLanguage("js", tsx)
PrismAsyncLight.registerLanguage("json", json)
PrismAsyncLight.registerLanguage("bash", bash)
PrismAsyncLight.registerLanguage("shell", bash)
PrismAsyncLight.registerLanguage("sh", bash)
PrismAsyncLight.registerLanguage("yaml", yaml)
PrismAsyncLight.registerLanguage("css", css)
PrismAsyncLight.registerLanguage("markdown", markdown)

const LABELS: Record<string, string> = {
  typescript: "ts",
  tsx: "tsx",
  javascript: "js",
  bash: "sh",
  shell: "sh",
  sh: "sh",
}

export function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { resolvedTheme } = useTheme()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const label = useMemo(() => (language ? LABELS[language] ?? language : ""), [language])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable — the code remains selectable */
    }
  }

  return (
    <figure className="docs-code-wrap group">
      <div className="docs-mermaid-bar" aria-hidden="true">
        <span className="font-mono text-[0.6875rem] uppercase tracking-wider">{label || "code"}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <PrismAsyncLight
        language={language && PrismAsyncLight.languages[language] ? language : "markdown"}
        style={resolvedTheme === "dark" ? oneDark : oneLight}
        customStyle={{ margin: 0, background: "transparent", fontSize: "0.8125rem" }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: 1.65 } }}
      >
        {code.replace(/\n$/, "")}
      </PrismAsyncLight>
    </figure>
  )
}
