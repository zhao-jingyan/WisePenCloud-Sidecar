const reference = (name: string): Record<string, string> => ({
  $ref: `#/components/schemas/${name}`,
});

const errorResponse = {
  description: '请求失败',
  content: {
    'application/json': {
      schema: reference('ErrorResponse'),
    },
  },
};

const commonErrors = {
  '400': errorResponse,
  '403': errorResponse,
  '409': errorResponse,
  '413': errorResponse,
  '500': errorResponse,
};

const internalOperation = {
  security: [{ UserID: [] }],
  parameters: [
    { $ref: '#/components/parameters/ResourceID' },
    { $ref: '#/components/parameters/GroupRoleMap' },
  ],
};

export const openApiDocument: Record<string, unknown> = {
  openapi: '3.1.0',
  info: {
    title: 'WisePen 笔记协同 Sidecar API',
    version: '1.0.0',
    description: '面向内部 AI 工具的活跃笔记读取与 AI Diff 写入接口。',
  },
  tags: [
    {
      name: 'AI Note',
      description: '只操作当前 Sidecar 实例中的活跃协同房间。',
    },
  ],
  paths: {
    '/internal/ai-note/read': {
      get: {
        ...internalOperation,
        tags: ['AI Note'],
        operationId: 'readActiveNote',
        summary: '读取整篇活跃笔记',
        responses: {
          '200': {
            description: '读取成功',
            content: {
              'application/json': {
                schema: reference('ReadNoteResponse'),
              },
            },
          },
          ...commonErrors,
        },
      },
      post: {
        ...internalOperation,
        tags: ['AI Note'],
        operationId: 'readActiveNoteWithScope',
        summary: '按范围读取活跃笔记',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: reference('ReadNoteRequest'),
            },
          },
        },
        responses: {
          '200': {
            description: '读取成功',
            content: {
              'application/json': {
                schema: reference('ReadNoteResponse'),
              },
            },
          },
          ...commonErrors,
        },
      },
    },
    '/internal/ai-note/apply': {
      post: {
        ...internalOperation,
        tags: ['AI Note'],
        operationId: 'applyActiveNotePatch',
        summary: '向活跃笔记写入 AI Diff',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: reference('ApplyNoteRequest'),
            },
          },
        },
        responses: {
          '200': {
            description: '处理完成；逐操作结果位于 data.results',
            content: {
              'application/json': {
                schema: reference('ApplyNoteResponseEnvelope'),
              },
            },
          },
          ...commonErrors,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      UserID: {
        type: 'apiKey',
        in: 'header',
        name: 'X-User-Id',
        description: '当前用户 ID。',
      },
    },
    parameters: {
      ResourceID: {
        name: 'resourceId',
        in: 'query',
        required: true,
        description: '笔记资源 ID。',
        schema: { type: 'string', minLength: 1 },
      },
      GroupRoleMap: {
        name: 'X-Group-Role-Map',
        in: 'header',
        required: false,
        description: '用户小组角色 JSON。',
        schema: { type: 'string' },
        example: '{"10001":0}',
      },
    },
    schemas: {
      EasyMark: {
        type: 'string',
        enum: ['bold', 'italic', 'underline', 'strike', 'code'],
      },
      TextInline: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text'],
        properties: {
          type: { const: 'text' },
          text: { type: 'string' },
          marks: { type: 'array', items: reference('EasyMark'), uniqueItems: true },
          textColor: { type: 'string' },
          backgroundColor: { type: 'string' },
        },
      },
      LinkInline: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'text', 'href'],
        properties: {
          type: { const: 'link' },
          text: { type: 'string' },
          href: { type: 'string', minLength: 1 },
          marks: { type: 'array', items: reference('EasyMark'), uniqueItems: true },
        },
      },
      InlineMath: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'expression'],
        properties: {
          type: { const: 'inlineMath' },
          expression: { type: 'string' },
        },
      },
      EasyInline: {
        oneOf: [reference('TextInline'), reference('LinkInline'), reference('InlineMath')],
        discriminator: { propertyName: 'type' },
      },
      InlineContent: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'items'],
        properties: {
          kind: { const: 'inline' },
          items: { type: 'array', items: reference('EasyInline') },
        },
      },
      TableContent: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'headerRows', 'headerCols', 'rows'],
        properties: {
          kind: { const: 'table' },
          headerRows: { type: 'integer', minimum: 0 },
          headerCols: { type: 'integer', minimum: 0 },
          rows: {
            type: 'array',
            items: {
              type: 'array',
              items: {
                type: 'array',
                items: reference('EasyInline'),
              },
            },
          },
        },
      },
      ExpressionContent: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'expression'],
        properties: {
          kind: { const: 'expression' },
          expression: { type: 'string' },
        },
      },
      NoneContent: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: { kind: { const: 'none' } },
      },
      UnsupportedContent: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: { kind: { const: 'unsupported' } },
      },
      EasyContent: {
        oneOf: [
          reference('InlineContent'),
          reference('TableContent'),
          reference('ExpressionContent'),
          reference('NoneContent'),
          reference('UnsupportedContent'),
        ],
        discriminator: { propertyName: 'kind' },
      },
      JsonScalar: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
      },
      EasyBlock: {
        type: 'object',
        additionalProperties: false,
        required: ['line', 'id', 'type', 'editable', 'content', 'children'],
        properties: {
          line: { type: 'integer', minimum: 1 },
          id: { type: 'string' },
          type: { type: 'string' },
          editable: { type: 'boolean' },
          attrs: {
            type: 'object',
            additionalProperties: reference('JsonScalar'),
          },
          content: reference('EasyContent'),
          aiContent: reference('EasyContent'),
          children: { type: 'array', items: reference('EasyBlock') },
        },
      },
      EasyNoteDocument: {
        type: 'object',
        additionalProperties: false,
        required: ['format', 'formatVersion', 'resourceId', 'version', 'blocks'],
        properties: {
          format: { const: 'wisepen-note-easy-json' },
          formatVersion: { const: 1 },
          resourceId: { type: 'string' },
          version: { type: 'string', pattern: '^yjs-v1:' },
          blocks: { type: 'array', items: reference('EasyBlock') },
        },
      },
      WholeNoteScope: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: { kind: { const: 'whole_note' } },
      },
      BlocksScope: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'blockIds'],
        properties: {
          kind: { const: 'blocks' },
          blockIds: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
      SubtreeScope: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'blockId'],
        properties: {
          kind: { const: 'subtree' },
          blockId: { type: 'string', minLength: 1 },
        },
      },
      BlockRangeScope: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'startBlockId', 'endBlockId'],
        properties: {
          kind: { const: 'block_range' },
          startBlockId: { type: 'string', minLength: 1 },
          endBlockId: { type: 'string', minLength: 1 },
        },
      },
      ReadNoteScope: {
        oneOf: [
          reference('WholeNoteScope'),
          reference('BlocksScope'),
          reference('SubtreeScope'),
          reference('BlockRangeScope'),
        ],
        discriminator: { propertyName: 'kind' },
      },
      ReadNoteRequest: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scope: reference('ReadNoteScope'),
          includeAiContent: { type: 'boolean', default: true },
        },
      },
      InsertBlockCandidate: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'content'],
        properties: {
          type: { type: 'string', minLength: 1 },
          attrs: {
            type: 'object',
            additionalProperties: reference('JsonScalar'),
          },
          content: reference('EasyContent'),
        },
      },
      ReplaceContentOperation: {
        type: 'object',
        additionalProperties: false,
        required: ['opId', 'kind', 'blockId', 'content'],
        properties: {
          opId: { type: 'string', minLength: 1 },
          kind: { const: 'replaceContent' },
          blockId: { type: 'string', minLength: 1 },
          content: reference('EasyContent'),
        },
      },
      DeleteBlockOperation: {
        type: 'object',
        additionalProperties: false,
        required: ['opId', 'kind', 'blockId'],
        properties: {
          opId: { type: 'string', minLength: 1 },
          kind: { const: 'deleteBlock' },
          blockId: { type: 'string', minLength: 1 },
        },
      },
      InsertBlockOperation: {
        type: 'object',
        additionalProperties: false,
        required: ['opId', 'kind', 'anchorBlockId', 'position', 'block'],
        properties: {
          opId: { type: 'string', minLength: 1 },
          kind: { const: 'insertBlock' },
          anchorBlockId: { type: 'string', minLength: 1 },
          position: { type: 'string', enum: ['before', 'after'] },
          block: reference('InsertBlockCandidate'),
        },
      },
      PatchOperation: {
        oneOf: [
          reference('ReplaceContentOperation'),
          reference('DeleteBlockOperation'),
          reference('InsertBlockOperation'),
        ],
        discriminator: { propertyName: 'kind' },
      },
      ApplyNoteRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['patchId', 'version', 'operations'],
        properties: {
          patchId: { type: 'string', minLength: 1 },
          version: { type: 'string', pattern: '^yjs-v1:' },
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: reference('PatchOperation'),
          },
        },
      },
      ApplyOperationResult: {
        type: 'object',
        additionalProperties: false,
        required: ['opId', 'status'],
        properties: {
          opId: { type: 'string' },
          status: { type: 'string', enum: ['applied', 'unchanged', 'conflict'] },
          reason: {
            type: 'string',
            enum: ['block_missing', 'anchor_missing', 'unsupported_type', 'invalid_content'],
          },
          blockId: { type: 'string' },
        },
      },
      ApplyNoteResponse: {
        type: 'object',
        additionalProperties: false,
        required: [
          'resourceId',
          'requestedVersion',
          'currentVersion',
          'resultVersion',
          'modified',
          'results',
        ],
        properties: {
          resourceId: { type: 'string' },
          requestedVersion: { type: 'string' },
          currentVersion: { type: 'string' },
          resultVersion: { type: 'string' },
          modified: { type: 'boolean' },
          results: { type: 'array', items: reference('ApplyOperationResult') },
        },
      },
      ReadNoteResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'msg', 'data'],
        properties: {
          code: { const: 200 },
          msg: { type: 'string' },
          data: reference('EasyNoteDocument'),
        },
      },
      ApplyNoteResponseEnvelope: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'msg', 'data'],
        properties: {
          code: { const: 200 },
          msg: { type: 'string' },
          data: reference('ApplyNoteResponse'),
        },
      },
      ErrorResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'msg', 'data'],
        properties: {
          code: { type: 'integer' },
          msg: { type: 'string' },
          data: { type: 'null' },
        },
      },
    },
  },
};
