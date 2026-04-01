import { ClientIntent } from '../types';

/**
 * 解析客户端通过 WebSocket 文本帧发来的业务意图 (Intent)
 */
export function parseIntent(raw: Buffer): ClientIntent | null {
  try {
    const str = raw.toString('utf8');
    const parsed = JSON.parse(str);
    
    if (parsed.type === 'meta' && parsed.intent) {
      return {
        operationType: parsed.intent.operationType || 'OTHER',
        source: parsed.intent.source,
      };
    }
  } catch (err) {
    // 非法 JSON 或不符合格式，直接丢弃
  }
  return null;
}