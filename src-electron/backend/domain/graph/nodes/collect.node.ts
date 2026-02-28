import type { NodeExecutionResult } from "../node-execution";

function flattenItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    const merged: unknown[] = [];
    for (const item of value) {
      merged.push(...flattenItems(item));
    }
    return merged;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function asDone(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => Boolean(item));
  }
  return Boolean(value);
}

export async function executeCollectNode(payload: Record<string, unknown>): Promise<NodeExecutionResult> {
  const done = asDone(payload.done);
  if (!done) {
    return {
      kind: "output",
      output: {
        items: [],
        count: 0,
        done: false,
        result: "等待结束信号",
      },
    };
  }

  const source = payload.items ?? payload.item ?? payload.raw ?? payload.result;
  const items = flattenItems(source);

  return {
    kind: "output",
    output: {
      items,
      count: items.length,
      done: true,
      result: `收集完成，共 ${String(items.length)} 项`,
    },
  };
}
