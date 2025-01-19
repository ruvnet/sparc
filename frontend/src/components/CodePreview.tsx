import { useState } from 'react';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import { docco } from 'react-syntax-highlighter/dist/esm/styles/hljs';

interface CodePreviewProps {
  code: string;
  language?: string;
  loading?: boolean;
  className?: string;
}

export const CodePreview: React.FC<CodePreviewProps> = ({
  code,
  language = 'typescript',
  loading = false,
  className = '',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800 p-4">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
      </div>
    );
  }

  return (
    <div className={`relative group ${className}`}>
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 px-2 py-1 text-sm rounded-md 
                 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 
                 dark:hover:bg-gray-600 transition-colors
                 opacity-0 group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <SyntaxHighlighter
        language={language}
        style={docco}
        className="rounded-lg !bg-gray-50 dark:!bg-gray-900 !p-4"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};
