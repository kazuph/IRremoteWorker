export type ProtocolClassMethodSurfaceMethod = {
  name: string;
  kind: "setter" | "getter";
  returnType: string;
  parameters: Array<{
    type: string;
    name: string;
    defaultValue: string | null;
    scalarType: string;
    source: "args" | "argsSet";
    setElementType?: string;
  }>;
  isConst: boolean;
  isStatic: boolean;
  signature: string;
  scalarReturnType: string;
  resultKind: "scalar" | "set";
  setElementType?: string | null;
};

export type ProtocolClassMethodSurfaceClass = {
  file: string;
  className: string;
  rawType: "bytes" | "uint32" | "uint64";
  setRawLengthArg: boolean;
  stateLengthExpression: string | null;
  rawLengthMethod: string | null;
  methods: ProtocolClassMethodSurfaceMethod[];
};

export type ProtocolClassMethodSurface = {
  classes: ProtocolClassMethodSurfaceClass[];
  classCount: number;
  totalMethods: number;
  excluded: Array<{ file: string; className: string; method: string; reason: string }>;
  excludedCount: number;
};

export function protocolClassMethodSurface(root?: string): ProtocolClassMethodSurface;
