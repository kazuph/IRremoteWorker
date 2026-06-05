export type ProtocolClassCommonSurfaceMethod = {
  name: "toCommon";
  kind: "toCommon";
  returnType: "stdAc::state_t";
  parameters: Array<{
    type: string;
    name: string;
    defaultValue: string | null;
  }>;
  isConst: boolean;
  isStatic: false;
  signature: string;
};

export type ProtocolClassCommonSurfaceClass = {
  file: string;
  className: string;
  rawType: "bytes" | "uint32" | "uint64";
  setRawLengthArg: boolean;
  stateLengthExpression: string | null;
  rawLengthMethod: string | null;
  inheritedFrom: string | null;
  method: ProtocolClassCommonSurfaceMethod;
};

export function protocolClassCommonSurface(root?: string): {
  classes: ProtocolClassCommonSurfaceClass[];
  classCount: number;
  totalMethods: number;
  excluded: Array<{ file: string; className: string; reason: string }>;
  excludedCount: number;
};
