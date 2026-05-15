import type { ReactNode } from 'react';

function renderInline(text: string, baseKey: number): ReactNode {
  const parts: ReactNode[] = [];
  let rest = text;
  let k = baseKey * 100;

  while (rest.length > 0) {
    // Bold **text**
    const bIdx = rest.indexOf('**');
    const iIdx = rest.search(/(?<!\*)\*(?!\*)/);
    const cIdx = rest.indexOf('`');

    const next = [
      bIdx >= 0 ? { idx: bIdx, type: 'bold' as const, end: rest.indexOf('**', bIdx + 2) } : null,
      iIdx >= 0 ? { idx: iIdx, type: 'italic' as const, end: rest.indexOf('*', iIdx + 1) } : null,
      cIdx >= 0 ? { idx: cIdx, type: 'code' as const, end: rest.indexOf('`', cIdx + 1) } : null,
    ].filter(x => x !== null && x.end > x.idx) as Array<{ idx: number; type: 'bold' | 'italic' | 'code'; end: number }>;

    if (next.length === 0) { parts.push(rest); break; }

    next.sort((a, b) => a.idx - b.idx);
    const { idx, type, end } = next[0];

    if (idx > 0) parts.push(rest.slice(0, idx));

    if (type === 'bold') {
      const inner = rest.slice(idx + 2, end);
      parts.push(<strong key={k++} className="font-semibold text-gray-100">{inner}</strong>);
      rest = rest.slice(end + 2);
    } else if (type === 'italic') {
      const inner = rest.slice(idx + 1, end);
      parts.push(<em key={k++} className="italic">{inner}</em>);
      rest = rest.slice(end + 1);
    } else {
      const inner = rest.slice(idx + 1, end);
      parts.push(<code key={k++} className="bg-gray-800 px-1 rounded text-emerald-300 font-mono text-[10px]">{inner}</code>);
      rest = rest.slice(end + 1);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function isTableSeparator(line: string) {
  return /^\|?[-: |]+\|?$/.test(line.trim());
}

interface Props {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: Props) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Fenced code block ──────────────────────────────────────────────────
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={key++} className="bg-gray-950 border border-gray-800/60 rounded p-2 my-1 overflow-x-auto text-[10px] text-emerald-300 font-mono whitespace-pre">
          {lang && <span className="text-gray-600 text-[9px] block mb-1">{lang}</span>}
          {codeLines.join('\n')}
        </pre>
      );
      i++;
      continue;
    }

    // ── Headings ───────────────────────────────────────────────────────────
    const h3m = trimmed.match(/^### (.+)/);
    const h2m = trimmed.match(/^## (.+)/);
    const h1m = trimmed.match(/^# (.+)/);
    if (h1m) { elements.push(<p key={key++} className="text-sm font-bold text-white mt-2 mb-0.5 border-b border-gray-800 pb-0.5">{renderInline(h1m[1], key)}</p>); i++; continue; }
    if (h2m) { elements.push(<p key={key++} className="text-xs font-bold text-gray-100 mt-1.5 mb-0.5">{renderInline(h2m[1], key)}</p>); i++; continue; }
    if (h3m) { elements.push(<p key={key++} className="text-xs font-semibold text-gray-200 mt-1">{renderInline(h3m[1], key)}</p>); i++; continue; }

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^---+$/.test(trimmed)) {
      elements.push(<hr key={key++} className="border-gray-800 my-1.5" />);
      i++; continue;
    }

    // ── Markdown table ─────────────────────────────────────────────────────
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = trimmed.split('|').filter((_, ci) => !(ci === 0 && trimmed.startsWith('|'))).map(c => c.trim()).filter(c => c !== '');
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i].trim().split('|').filter((_, ci) => !(ci === 0 && lines[i].trim().startsWith('|'))).map(c => c.trim()).filter(c => c !== '');
        rows.push(cells);
        i++;
      }
      elements.push(
        <div key={key++} className="overflow-x-auto my-1.5 rounded border border-gray-800">
          <table className="w-full text-[10px] text-gray-300">
            <thead>
              <tr className="border-b border-gray-800 bg-gray-900/60">
                {headerCells.map((h, ci) => (
                  <th key={ci} className="px-2 py-1 text-left font-semibold text-gray-200">{renderInline(h, key + ci)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-gray-900 hover:bg-gray-900/40">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1 font-mono text-gray-400">{renderInline(cell, key + ri * 100 + ci)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // ── List items ─────────────────────────────────────────────────────────
    if (/^[-*] /.test(trimmed) || /^\d+\. /.test(trimmed)) {
      const items: string[] = [];
      const numbered = /^\d+\. /.test(trimmed);
      while (i < lines.length && (/^[-*] /.test(lines[i].trim()) || /^\d+\. /.test(lines[i].trim()))) {
        items.push(lines[i].trim().replace(/^[-*] /, '').replace(/^\d+\. /, ''));
        i++;
      }
      elements.push(
        <ul key={key++} className="space-y-0.5 my-0.5 pl-2">
          {items.map((item, j) => (
            <li key={j} className="flex gap-1.5 text-gray-300">
              <span className="text-gray-600 shrink-0 mt-px">{numbered ? `${j + 1}.` : '·'}</span>
              <span>{renderInline(item, key + j)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // ── Blank line ─────────────────────────────────────────────────────────
    if (trimmed === '') {
      elements.push(<div key={key++} className="h-1" />);
      i++; continue;
    }

    // ── Italic-only line (*text*) ──────────────────────────────────────────
    const italicLine = trimmed.match(/^\*(.+)\*$/);
    if (italicLine) {
      elements.push(<p key={key++} className="text-gray-500 italic text-[10px]">{renderInline(italicLine[1], key)}</p>);
      i++; continue;
    }

    // ── Regular paragraph ──────────────────────────────────────────────────
    elements.push(<p key={key++} className="text-gray-300 leading-relaxed">{renderInline(line, key)}</p>);
    i++;
  }

  return (
    <div className={`text-xs space-y-0.5 ${className}`}>
      {elements}
    </div>
  );
}
