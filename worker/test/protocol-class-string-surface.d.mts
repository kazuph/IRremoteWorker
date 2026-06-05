export type ProtocolClassStringSurfaceClass = {
  file: string;
  className: string;
  rawType: "bytes" | "uint32" | "uint64";
  setRawLengthArg: boolean;
  stateLengthExpression: string | null;
  rawLengthMethod: string | null;
  inheritedFrom: string | null;
  method: {
    name: "toString";
    returnType: "String";
    parameters: string;
    isConst: boolean;
    signature: string;
  };
};

export function protocolClassStringSurface(root?: string): {
  classes: ProtocolClassStringSurfaceClass[];
  classCount: number;
  totalMethods: number;
  excluded: Array<{ file: string; className: string; reason: string }>;
  excludedCount: number;
};
