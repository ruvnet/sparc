// import "prismjs/plugins/line-numbers/prism-line-numbers.js";
// import "prismjs/plugins/line-numbers/prism-line-numbers.css";
import './code-theme.css'
import Prism from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-jsx'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-tsx'
import 'prismjs/components/prism-typescript'
import { useEffect, useState } from 'react'
import { Button } from './ui/button'

export function CodeView({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    Prism.highlightAll()
  }, [code])

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={copyToClipboard}
        className="absolute right-2 top-2"
      >
        {copied ? 'Copied!' : 'Copy'}
      </Button>
      <pre
        className="p-4 pt-2"
        style={{
          fontSize: 12,
          backgroundColor: 'transparent',
          borderRadius: 0,
          margin: 0,
        }}
      >
        <code className={`language-${lang}`}>{code}</code>
      </pre>
    </div>
  )
}
