import type { Root } from 'mdast';
import type { VFile } from 'vfile';

// Keep the original syntax; only the visible destination becomes interactive.
export function remarkPlainLinks() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    type Node = { type: string; value?: string; url?: string; children?: Node[]; data?: object; position?: { start: { offset?: number }; end: { offset?: number } } };
    const text = (value: string): Node => ({ type: 'text', value });
    function walk(node: Node) {
      if (!node.children) return;
      node.children = node.children.flatMap((child): Node[] => {
        if (['link', 'linkReference', 'definition'].includes(child.type)) {
          const start = child.position?.start.offset;
          const end = child.position?.end.offset;
          if (start !== undefined && end !== undefined) {
            const raw = source.slice(start, end);
            const target = child.url || '';
            // Unknown protocols stay copyable text. Windows drive letters are paths.
            const supported = target && !target.startsWith('#') &&
              (!/^[a-z][a-z0-9+.-]*:/i.test(target) || /^(https?:|file:|[a-z]:[\\/])/i.test(target));
            const from = raw.startsWith('[') ? Math.max(0, raw.lastIndexOf('](') + 2) : 0;
            const offset = raw.indexOf(target, from);
            const parts: Node[] = supported && offset >= 0 ? [
              text(raw.slice(0, offset)),
              { type: 'link', url: target, children: [text(target)], data: { hProperties: { 'data-target': target } } },
              text(raw.slice(offset + target.length)),
            ] : [text(raw)];
            return child.type === 'definition' ? [{ type: 'paragraph', children: parts }] : parts;
          }
        }
        walk(child);
        return [child];
      });
    }
    walk(tree);
  };
}
