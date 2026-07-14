import { AsyncLocalStorage } from 'async_hooks';
import { IncomingHttpHeaders } from 'http';
import { processDeveloper } from './developer-config';
import { DEVELOPER_HEADER } from './constants';

interface DeveloperRequestContext {
  developer?: string;
}

const storage = new AsyncLocalStorage<DeveloperRequestContext>();

function firstHeader(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  const normalized = header?.trim();
  return normalized || undefined;
}

export function extractDeveloper(headers: IncomingHttpHeaders): string | undefined {
  return firstHeader(headers[DEVELOPER_HEADER.toLowerCase()]);
}

export function runWithDeveloperContext<T>(
  developer: string | undefined,
  callback: () => T,
): T {
  return storage.run({ developer }, callback);
}

export function getCurrentDeveloper(): string | undefined {
  return storage.getStore()?.developer ?? processDeveloper;
}
