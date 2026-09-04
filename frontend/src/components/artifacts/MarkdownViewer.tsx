'use client';

import React, { useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-json';

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content }) => {
  // Simple, robust, dependency-free Markdown to structured elements parser
  const parsedElements = useMemo(() => {
    if (!content) return [];
    const lines = content.split(/\r?\n/);
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeLines: string[] = [];

    const formatInline = (text: string): React.ReactNode => {
      // Parse bold, italics, code, links
      const parts: React.ReactNode[] = [];
      let remaining = text;
      let key = 0;

      while (remaining.length > 0) {
        // Code: `code`
        const codeMatch = remaining.match(/`([^`]+)`/);
        // Bold: **bold**
        const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
        // Italic: *italic*
        const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/);
        // Link: [text](url)
        const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

        // Find which match comes first
        const matches = [
          codeMatch ? { type: 'code', index: codeMatch.index!, match: codeMatch } : null,
          boldMatch ? { type: 'bold', index: boldMatch.index!, match: boldMatch } : null,
          italicMatch ? { type: 'italic', index: italicMatch.index!, match: italicMatch } : null,
          linkMatch ? { type: 'link', index: linkMatch.index!, match: linkMatch } : null,
        ].filter(Boolean) as { type: string; index: number; match: RegExpMatchArray }[];

        if (matches.length === 0) {
          parts.push(remaining);
          break;
        }

        matches.sort((a, b) => a.index - b.index);
        const first = matches[0];

        if (first.index > 0) {
          parts.push(remaining.substring(0, first.index));
        }

        if (first.type === 'code') {
          parts.push(
            <code key={`c-${key++}`} className="md-inline-code">
              {first.match[1]}
            </code>
          );
          remaining = remaining.substring(first.index + first.match[0].length);
        } else if (first.type === 'bold') {
          parts.push(
            <strong key={`b-${key++}`}>
              {formatInline(first.match[1])}
            </strong>
          );
          remaining = remaining.substring(first.index + first.match[0].length);
        } else if (first.type === 'italic') {
          parts.push(
            <em key={`i-${key++}`}>
              {formatInline(first.match[1])}
            </em>
          );
          remaining = remaining.substring(first.index + first.match[0].length);
        } else if (first.type === 'link') {
          parts.push(
            <a
              key={`a-${key++}`}
              href={first.match[2]}
              target="_blank"
              rel="noreferrer"
              className="md-link"
            >
              {first.match[1]}
            </a>
          );
          remaining = remaining.substring(first.index + first.match[0].length);
        }
      }

      return parts;
    };

    lines.forEach((line, index) => {
      // Code block start/end
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLanguage = line.trim().slice(3).trim() || 'javascript';
          codeLines = [];
        } else {
          inCodeBlock = false;
          const codeText = codeLines.join('\n');
          let highlighted = codeText;
          try {
            const grammar = Prism.languages[codeLanguage] || Prism.languages.javascript;
            if (grammar) {
              highlighted = Prism.highlight(codeText, grammar, codeLanguage);
            }
          } catch {
            highlighted = codeText;
          }

          elements.push(
            <div key={`code-block-${index}`} className="md-code-block-wrapper">
              <div className="md-code-header">
                <span className="md-code-lang">{codeLanguage}</span>
              </div>
              <pre className="md-pre">
                <code
                  className={`language-${codeLanguage}`}
                  dangerouslySetInnerHTML={{ __html: highlighted }}
                />
              </pre>
            </div>
          );
        }
        return;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        return;
      }

      // Headers
      if (line.startsWith('# ')) {
        elements.push(<h1 key={`h1-${index}`} className="md-h1">{formatInline(line.slice(2))}</h1>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={`h2-${index}`} className="md-h2">{formatInline(line.slice(3))}</h2>);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={`h3-${index}`} className="md-h3">{formatInline(line.slice(4))}</h3>);
      } else if (line.startsWith('#### ')) {
        elements.push(<h4 key={`h4-${index}`} className="md-h4">{formatInline(line.slice(5))}</h4>);
      }
      // Horizontal Rule
      else if (/^(\*\*\*|---|___)$/.test(line.trim())) {
        elements.push(<hr key={`hr-${index}`} className="md-hr" />);
      }
      // Blockquote
      else if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={`bq-${index}`} className="md-blockquote">
            {formatInline(line.slice(2))}
          </blockquote>
        );
      }
      // Bullet list items
      else if (/^[-*]\s+/.test(line.trim())) {
        elements.push(
          <li key={`li-${index}`} className="md-li">
            {formatInline(line.trim().replace(/^[-*]\s+/, ''))}
          </li>
        );
      }
      // Numbered list items
      else if (/^\d+\.\s+/.test(line.trim())) {
        elements.push(
          <li key={`nli-${index}`} className="md-li-num">
            {formatInline(line.trim().replace(/^\d+\.\s+/, ''))}
          </li>
        );
      }
      // Empty line
      else if (!line.trim()) {
        elements.push(<div key={`sp-${index}`} className="md-spacer" />);
      }
      // Paragraph
      else {
        elements.push(<p key={`p-${index}`} className="md-p">{formatInline(line)}</p>);
      }
    });

    if (inCodeBlock && codeLines.length > 0) {
      elements.push(
        <pre key="trailing-code" className="md-pre">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
    }

    return elements;
  }, [content]);

  return <div className="markdown-body-rendered">{parsedElements}</div>;
};
