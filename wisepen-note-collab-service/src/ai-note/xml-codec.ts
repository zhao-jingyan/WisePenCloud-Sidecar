import { EasyBlock, EasyContent, EasyInline, EasyNoteDocument } from './types';

const XML_ELEMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const PUBLIC_BLOCK_ID_PATTERN = /^p_\d{3,}$/;

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
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

function inlineText(items: EasyInline[]): string {
  return items
    .map((item) => {
      if (item.type === 'inlineMath') return `$${item.expression}$`;
      if (item.type === 'link') return `[${item.text}](${item.href})`;
      return item.text;
    })
    .join('');
}

function contentText(content: EasyContent): string {
  if (content.kind === 'inline') return inlineText(content.items);
  if (content.kind === 'expression') return content.expression;
  if (content.kind === 'table') {
    return content.rows
      .map((row) => {
        const cells = row.map((cell) => inlineText(cell).trim());
        return cells.some(Boolean) ? cells.join(' | ') : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function encodeBlockContent(content: EasyContent): string {
  const text = contentText(content);
  if (!text) return '';
  return escapeXml(text);
}

function encodeBlock(block: EasyBlock): string {
  if (!PUBLIC_BLOCK_ID_PATTERN.test(block.id)) {
    throw new Error('INVALID_PUBLIC_BLOCK_ID');
  }
  const validType = XML_ELEMENT_NAME_PATTERN.test(block.type);
  const elementName = validType ? block.type : 'block';
  const attributes = [
    `id="${escapeXml(block.id)}"`,
    ...(validType ? [] : [`type="${escapeXml(block.type)}"`]),
    ...(block.type === 'codeBlock' && typeof block.attrs?.language === 'string'
      ? [`lang="${escapeXml(block.attrs.language)}"`]
      : []),
  ].join(' ');
  const content = encodeBlockContent(block.content);
  const aiContent = block.aiContent
    ? `<ai>${encodeBlockContent(block.aiContent)}</ai>`
    : '';
  const children = block.children.map(encodeBlock).join('');
  const body = content + aiContent + children;
  return body
    ? `<${elementName} ${attributes}>${body}</${elementName}>`
    : `<${elementName} ${attributes}/>`;
}

export function encodeEasyDocumentXml(document: EasyNoteDocument): string {
  const attributes = [
    `resourceId="${escapeXml(document.resourceId)}"`,
    `version="${escapeXml(document.version)}"`,
  ].join(' ');
  return `<document ${attributes}>${document.blocks.map(encodeBlock).join('')}</document>`;
}
