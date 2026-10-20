import { Fragment, type ReactNode } from 'react';

// Small renderer for Genie Agent answers: headings, lists, bold, code, links (citations),
// and pipe tables. Escaped brackets from Genie citations (\[1\]) are unescaped first.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.replace(/\\([[\]])/g, '$1').split(INLINE).filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-bold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded-sm bg-muted px-1 py-0.5 text-sm">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const isCitation = /^\d+$/.test(link[1]);
      return (
        <a key={index} href={link[2]} target="_blank" rel="noreferrer"
          className={isCitation ? 'hz-num align-super text-xs font-medium underline underline-offset-2' : 'underline underline-offset-2'}
          aria-label={isCitation ? `Source ${link[1]}` : undefined}>
          {isCitation ? `[${link[1]}]` : link[1]}
        </a>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }

    if (line.startsWith('|') && /^\|?\s*:?-{3,}/.test(lines[index + 1]?.trim() ?? '')) {
      const header = cells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) { rows.push(cells(lines[index])); index += 1; }
      blocks.push(
        <div key={`table-${index}`} className="mb-4 overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead><tr className="border-b">{header.map((cell, i) => <th key={i} className="px-3 py-2 text-left font-medium">{inline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r} className="border-b last:border-0">{row.map((cell, i) => <td key={i} className={`px-3 py-2 ${/^[\d$.,%-]+$/.test(cell) ? 'hz-num' : ''}`}>{inline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(<h3 key={index} className="mb-2 mt-6 text-base font-bold first:mt-0">{inline(heading[2])}</h3>);
      index += 1; continue;
    }

    const unordered = /^[-*]\s+/.test(line);
    const ordered = /^\d+[.)]\s+/.test(line);
    if (unordered || ordered) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const matches = unordered ? /^[-*]\s+(.+)$/.exec(current) : /^\d+[.)]\s+(.+)$/.exec(current);
        if (!matches) break;
        items.push(<li key={index}>{inline(matches[1])}</li>);
        index += 1;
      }
      blocks.push(unordered
        ? <ul key={`list-${index}`} className="mb-4 list-disc space-y-1 pl-6">{items}</ul>
        : <ol key={`list-${index}`} className="mb-4 list-decimal space-y-1 pl-6">{items}</ol>);
      continue;
    }

    blocks.push(<p key={index} className="mb-4 last:mb-0">{inline(line)}</p>);
    index += 1;
  }
  return <div className="max-w-[72ch] leading-7">{blocks}</div>;
}
