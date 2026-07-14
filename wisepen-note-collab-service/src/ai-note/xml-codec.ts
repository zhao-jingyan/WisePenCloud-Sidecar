import { NativeBlock, NativeInline, NativeTableContent, NoteSnapshot } from './types';
import { isRecord } from './value-utils';

const XML_ELEMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PUBLIC_BLOCK_ID_PATTERN = /^p_\d{3,}$/;
const INLINE_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'quote',
  'bulletListItem',
  'numberedListItem',
  'checkListItem',
  'toggleListItem',
  'codeBlock',
  'highlightBlock',
  'mermaid',
]);

function sanitizeXml(value: string): string {
  let validXml = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const valid =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    validXml += valid ? character : '\ufffd';
  }
  return validXml;
}

function escapeXml(value: string): string {
  return sanitizeXml(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&apos;';
    }
  });
}

function inlineText(items: NativeInline[]): string {
  return items.map((item) => {
    if (item.type === 'inlineMath') return `$${item.props.expression}$`;
    if (item.type === 'link') {
      return item.content.map((part) => `[${part.text}](${item.href})`).join('');
    }
    return item.text;
  }).join('');
}

function tableText(content: NativeTableContent): string {
  return content.rows
    .map((row) => {
      const cells = row.cells.map((cell) => inlineText(cell.content).trim());
      return cells.some(Boolean) ? cells.join(' | ') : '';
    })
    .filter(Boolean)
    .join('\n');
}

function contentText(type: string, content: unknown): string {
  try {
    if (INLINE_BLOCK_TYPES.has(type)) {
      return Array.isArray(content) ? inlineText(content as NativeInline[]) : '';
    }
    if (type === 'table' && isRecord(content) && content.type === 'tableContent') {
      return tableText(content as unknown as NativeTableContent);
    }
    if (type === 'math' && typeof content === 'string') return content;
    return '';
  } catch {
    return '';
  }
}

function encodeBlock(
  block: NativeBlock,
  publicBlockId: (internalId: string) => string,
): string {
  const id = publicBlockId(block.id);
  if (!PUBLIC_BLOCK_ID_PATTERN.test(id)) throw new Error('INVALID_PUBLIC_BLOCK_ID');
  const validType = XML_ELEMENT_NAME_PATTERN.test(block.type);
  const elementName = validType ? block.type : 'block';
  const attributes = [
    `id="${escapeXml(id)}"`,
    ...(validType ? [] : [`type="${escapeXml(block.type)}"`]),
    ...(block.type === 'codeBlock' && typeof block.props.language === 'string'
      ? [`lang="${escapeXml(block.props.language)}"`]
      : []),
  ].join(' ');
  const content = escapeXml(contentText(block.type, block.content));
  const aiContent = block.aiContent === undefined
    ? ''
    : `<ai>${escapeXml(contentText(block.type, block.aiContent))}</ai>`;
  const children = block.children.map((child) => encodeBlock(child, publicBlockId)).join('');
  const body = content + aiContent + children;
  return body
    ? `<${elementName} ${attributes}>${body}</${elementName}>`
    : `<${elementName} ${attributes}/>`;
}

export function encodeNoteSnapshotXml(
  snapshot: NoteSnapshot,
  publicBlockId: (internalId: string) => string,
): string {
  const attributes = [
    `resourceId="${escapeXml(snapshot.resourceId)}"`,
    `version="${escapeXml(snapshot.version)}"`,
  ].join(' ');
  const blocks = snapshot.blocks.map((block) => encodeBlock(block, publicBlockId)).join('');
  return `<document ${attributes}>${blocks}</document>`;
}
