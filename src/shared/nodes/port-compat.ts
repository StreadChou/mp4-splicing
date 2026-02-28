import { PortDataType } from "./enums";

/** 端口类型规格（基础类型 + 是否数组包装）。 */
export interface PortTypeSpec {
  /** 端口基础类型。 */
  valueType: PortDataType;
  /** 是否数组包装。 */
  multiple?: boolean;
}

/** 端口类型兼容判断（按基础类型 + 包装关系）。 */
export function arePortDataTypesCompatible(
  /** 源端口基础类型。 */
  sourceType: PortDataType,
  /** 目标端口基础类型。 */
  targetType: PortDataType,
  /** 源端口是否数组包装。 */
  sourceMultiple = false,
  /** 目标端口是否数组包装。 */
  targetMultiple = false,
): boolean {
  if (sourceType === PortDataType.ANY_PAYLOAD || targetType === PortDataType.ANY_PAYLOAD) {
    return true;
  }
  if (sourceType !== targetType) {
    return false;
  }

  // 同基础类型下允许数组与非数组建立联系，由循环/遍历节点控制语义。
  if (sourceMultiple !== targetMultiple) {
    return true;
  }
  return true;
}

/** 端口规格兼容判断（结构化参数版本）。 */
export function arePortSpecsCompatible(source: PortTypeSpec, target: PortTypeSpec): boolean {
  return arePortDataTypesCompatible(
    source.valueType,
    target.valueType,
    source.multiple === true,
    target.multiple === true,
  );
}
