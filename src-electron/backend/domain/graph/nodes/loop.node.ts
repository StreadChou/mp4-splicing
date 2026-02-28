import { LoopMode } from "../../../../../src/shared/nodes/enums";
import type { WorkflowTaskRecord } from "../../../shared/types";
import { asNumber } from "../node-execution-helpers";
import type { NodeExecutionResult } from "../node-execution";

function readConcurrency(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  runtimeInput: Record<string, unknown>,
): number {
  const raw = Math.round(asNumber(payload.concurrency ?? config.concurrency ?? runtimeInput.loopConcurrency ?? 1));
  return Math.max(1, raw || 1);
}

function readFixedTimes(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
  runtimeInput: Record<string, unknown>,
): number {
  const raw = Math.round(asNumber(payload.times ?? config.times ?? payload.count ?? runtimeInput.times ?? 1));
  return Math.max(1, raw || 1);
}

function readIterateItems(payload: Record<string, unknown>): unknown[] {
  const rawItems = payload.items ?? payload.raw ?? payload.result;
  if (Array.isArray(rawItems)) {
    return rawItems;
  }
  if (rawItems === undefined || rawItems === null) {
    return [];
  }
  throw new Error("遍历节点输入必须是数组(items)");
}

export async function executeIterateNode(
  task: WorkflowTaskRecord,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<NodeExecutionResult> {
  const concurrency = readConcurrency(payload, config, task.runtimeInput);
  const items = readIterateItems(payload);
  const index = items.map((_, idx) => idx);
  const count = items.length;

  return {
    kind: "output",
    output: {
      item: items,
      raw: items,
      index,
      done: true,
      count,
      __loop: {
        mode: LoopMode.ITERATE_ITEMS,
        strategy: "iterate",
        concurrency,
        times: Math.max(1, count || 1),
        count,
      },
      result: `遍历已就绪: concurrency=${String(concurrency)}, count=${String(count)}`,
    },
  };
}

export async function executeRepeatNode(
  task: WorkflowTaskRecord,
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): Promise<NodeExecutionResult> {
  const concurrency = readConcurrency(payload, config, task.runtimeInput);
  const times = readFixedTimes(payload, config, task.runtimeInput);
  const raw = payload.raw ?? payload.value ?? payload.result;
  const index = Array.from({ length: times }, (_item, idx) => idx);

  return {
    kind: "output",
    output: {
      raw,
      index,
      done: true,
      count: times,
      __loop: {
        mode: LoopMode.FIXED_TIMES,
        strategy: "repeat",
        concurrency,
        times,
        count: times,
      },
      result: `循环已就绪: concurrency=${String(concurrency)}, times=${String(times)}`,
    },
  };
}
