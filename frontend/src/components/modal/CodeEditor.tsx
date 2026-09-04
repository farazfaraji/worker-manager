'use client';

import React, { useState, useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';
import { Copy, Check, RotateCcw, Code2 } from 'lucide-react';

interface CodeEditorProps {
  value: string;
  onChange: (val: string) => void;
  language?: string;
  isFunctionWrapper?: boolean;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  minHeight?: number;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value = '',
  onChange,
  language = 'javascript',
  isFunctionWrapper = false,
  placeholder = '',
  defaultValue,
  required = false,
  minHeight = 140,
}) => {
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  // Sync scroll between textarea and pre/code block
  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  // Handle Tab key for 2-space indentation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const currentVal = value || '';

      const newVal = currentVal.substring(0, start) + '  ' + currentVal.substring(end);
      onChange(newVal);

      // Set cursor position after state update
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  const handleCopy = () => {
    const fullCode = isFunctionWrapper
      ? `function run(input) {\n${value}\n}`
      : value;
    navigator.clipboard.writeText(fullCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleReset = () => {
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  };

  // Calculate line numbers
  const lines = (value || '').split('\n');
  const startLineNumber = isFunctionWrapper ? 2 : 1;

  // Highlight code using Prism
  const getHighlightedHtml = () => {
    const code = value || '';
    const lang = language.toLowerCase();
    const grammar = Prism.languages[lang] || Prism.languages.javascript;
    try {
      return Prism.highlight(code, grammar, lang);
    } catch {
      return code;
    }
  };

  return (
    <div className="code-editor-container">
      {/* Top Action Toolbar */}
      <div className="code-editor-toolbar">
        <div className="code-editor-lang-tag">
          <Code2 size={13} />
          <span>{language.toUpperCase()}</span>
          {isFunctionWrapper && (
            <span className="code-editor-badge">Function Body</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {defaultValue !== undefined && (
            <button
              type="button"
              className="code-editor-btn"
              onClick={handleReset}
              title="Reset to default template"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          )}
          <button
            type="button"
            className="code-editor-btn"
            onClick={handleCopy}
            title="Copy code to clipboard"
          >
            {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      <div className="code-editor-box">
        {/* Static Header: function run(input) { */}
        {isFunctionWrapper && (
          <div className="code-editor-static-line header">
            <span className="line-num">1</span>
            <div className="static-code">
              <span className="tok-kw">function</span>{' '}
              <span className="tok-fn">run</span>
              <span className="tok-punc">(</span>
              <span className="tok-param">input</span>
              <span className="tok-punc">)</span>{' '}
              <span className="tok-brace">{'{'}</span>
            </div>
            <span className="static-tag">read-only</span>
          </div>
        )}

        {/* Interactive Editor Area */}
        <div className="code-editor-main" style={{ minHeight }}>
          {/* Line Numbers */}
          <div className="code-editor-gutters" aria-hidden="true">
            {lines.map((_, idx) => (
              <div key={idx} className="gutter-line">
                {idx + startLineNumber}
              </div>
            ))}
          </div>

          {/* Code Area Wrapper */}
          <div className="code-editor-layer-wrap">
            {/* Highlighted Prism layer behind */}
            <pre
              ref={preRef}
              className="code-editor-highlighted"
              aria-hidden="true"
            >
              <code
                dangerouslySetInnerHTML={{
                  __html: getHighlightedHtml() + '\n',
                }}
              />
            </pre>

            {/* Editable Textarea overlay */}
            <textarea
              ref={textareaRef}
              className="code-editor-textarea"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onScroll={handleScroll}
              onKeyDown={handleKeyDown}
              placeholder={placeholder || (isFunctionWrapper ? '  // Return your output object\n  return {\n    result: input\n  };' : '')}
              required={required}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
            />
          </div>
        </div>

        {/* Static Footer: } */}
        {isFunctionWrapper && (
          <div className="code-editor-static-line footer">
            <span className="line-num">{lines.length + 2}</span>
            <div className="static-code">
              <span className="tok-brace">{'}'}</span>
            </div>
            <span className="static-tag">read-only</span>
          </div>
        )}
      </div>
    </div>
  );
};
