export type JsonScalar = string | number | boolean;

export type PatchMark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

export type PatchInline =
  | {
      type: 'text';
      text: string;
      marks?: PatchMark[];
      textColor?: string;
      backgroundColor?: string;
    }
  | {
      type: 'link';
      text: string;
      href: string;
      marks?: PatchMark[];
    }
  | {
      type: 'inlineMath';
      expression: string;
    };

export type PatchContent =
  | { kind: 'inline'; items: PatchInline[] }
  | { kind: 'table'; headerRows: number; headerCols: number; rows: PatchInline[][][] };

export interface NoteSnapshot {
  resourceId: string;
  version: string;
  blocks: NativeBlock[];
}

export type NoteReadScope =
  | { kind: 'whole_note' }
  | { kind: 'blocks'; blockIds: string[] }
  | { kind: 'subtree'; blockId: string }
  | { kind: 'block_range'; startBlockId: string; endBlockId: string };

export interface NoteReadRequest {
  scope?: NoteReadScope;
  includeAiContent?: boolean;
  version?: string;
}

export interface NativeTextInline {
  type: 'text';
  text: string;
  styles: Record<string, boolean | string>;
}

export interface NativeLinkInline {
  type: 'link';
  href: string;
  content: NativeTextInline[];
}

export interface NativeMathInline {
  type: 'inlineMath';
  props: { expression: string };
}

export type NativeInline = NativeTextInline | NativeLinkInline | NativeMathInline;

export interface NativeTableCell {
  type: 'tableCell';
  content: NativeInline[];
  props: {
    colspan: number;
    rowspan: number;
    backgroundColor: string;
    textColor: string;
    textAlignment: string;
  };
}

export interface NativeTableContent {
  type: 'tableContent';
  columnWidths: number[];
  headerRows: number;
  headerCols: number;
  rows: Array<{ cells: NativeTableCell[] }>;
}

export type NativeContent = NativeInline[] | NativeTableContent | string | undefined;

export interface NativeBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: NativeContent;
  aiContent?: unknown;
  children: NativeBlock[];
}

export type PatchOperation =
  | { opId: string; kind: 'replaceContent'; blockId: string; content: PatchContent }
  | { opId: string; kind: 'deleteBlock'; blockId: string }
  | {
      opId: string;
      kind: 'insertBlock';
      anchorBlockId: string;
      position: 'before' | 'after';
      block: {
        type: string;
        attrs?: Record<string, JsonScalar>;
        content: PatchContent;
      };
    };

export interface NoteApplyRequest {
  patchId: string;
  version: string;
  operations: PatchOperation[];
}

export type ApplyConflictReason =
  | 'block_missing'
  | 'anchor_missing'
  | 'unsupported_type'
  | 'invalid_content';

export interface ApplyOperationResult {
  opId: string;
  status: 'applied' | 'unchanged' | 'conflict';
  reason?: ApplyConflictReason;
  blockId?: string;
}

export interface NoteApplyResponse {
  resourceId: string;
  requestedVersion: string;
  currentVersion: string;
  resultVersion: string;
  modified: boolean;
  results: ApplyOperationResult[];
}
