export type ProtocolClassStaticSurfaceMethod = {
  name: string;
  kind: string;
  returnType: string;
  parameters: Array<{
    type: string;
    name: string;
    defaultValue: string | null;
    scalarType: string;
    source: "state" | "stateStruct" | "args";
    structType?: string | null;
  }>;
  isConst: boolean;
  isStatic: true;
  signature: string;
  inheritedFrom?: string;
  scalarReturnType: string;
};

export type ProtocolClassStaticSurface = {
  classes: Array<{ file: string; className: string; methods: ProtocolClassStaticSurfaceMethod[] }>;
  classCount: number;
  totalMethods: number;
  excluded: Array<{ file: string; className: string; method: string; reason: string }>;
  excludedCount: number;
};

export function protocolClassStaticSurface(root?: string): ProtocolClassStaticSurface;
