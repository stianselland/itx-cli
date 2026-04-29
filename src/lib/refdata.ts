import type { ItxClient } from "./client.js";
import { htmlToText } from "./activities.js";

/**
 * Reference-data cache for statuses, priorities, and categories.
 *
 * Memoized per-process — these are stable enums on the ITX side that change
 * rarely. A persistent on-disk cache would amortize across invocations but
 * adds schema complexity to `conf`; punt until profiling justifies it.
 */

interface NameField {
  defaultText?: string;
  translations?: Record<string, { translatedText?: string }>;
}

interface StatusRef {
  emstId: number;
  internalStatus: number;
  sort: number;
  name: string;
}

interface PriorityRef {
  empriId: number;
  sort: number;
  name: string;
}

interface CategoryRef {
  emcaId: number;
  name: string;
  parent?: number | null;
}

export interface RefData {
  statuses: StatusRef[];
  priorities: PriorityRef[];
  categories: CategoryRef[];
}

let cached: Promise<RefData> | null = null;

export function clearRefdataCache(): void {
  cached = null;
}

/** Resolve a translated name field to a string, preferring English. */
function translate(name: NameField | undefined): string {
  if (!name) return "";
  const en = name.translations?.en?.translatedText;
  if (en) return htmlToText(en);
  if (name.defaultText) return htmlToText(name.defaultText);
  return "";
}

export async function loadRefdata(client: ItxClient): Promise<RefData> {
  if (cached) return cached;
  cached = (async () => {
    const [statusesRaw, prioritiesRaw, categoriesRaw] = await Promise.all([
      client.request<Record<string, unknown>[]>(
        "/rest/itxems/statuses",
        { params: { type: 35013 } },
      ),
      client.request<Record<string, unknown>[]>("/rest/itxems/priorities"),
      client.request<Record<string, unknown>[]>("/rest/itxems/categories"),
    ]);

    const statuses: StatusRef[] = (statusesRaw ?? []).map((s) => ({
      emstId: s.emstId as number,
      internalStatus: (s.internalStatus as number) ?? 0,
      sort: (s.sort as number) ?? 0,
      name: translate(s.name as NameField | undefined),
    }));
    const priorities: PriorityRef[] = (prioritiesRaw ?? []).map((p) => ({
      empriId: p.empriId as number,
      sort: (p.sort as number) ?? 0,
      name: translate(p.name as NameField | undefined),
    }));
    const categories: CategoryRef[] = (categoriesRaw ?? []).map((c) => ({
      emcaId: c.emcaId as number,
      name: translate(c.name as NameField | undefined),
      parent: ((c.parent as { emcaId?: number } | undefined)?.emcaId) ?? null,
    }));

    return { statuses, priorities, categories };
  })();
  return cached;
}

/** Build a lookup map keyed by id, with name as the value. */
export function buildLookup<T extends { name: string }>(
  list: T[],
  keyFn: (item: T) => number,
): Map<number, string> {
  const m = new Map<number, string>();
  for (const item of list) m.set(keyFn(item), item.name);
  return m;
}
