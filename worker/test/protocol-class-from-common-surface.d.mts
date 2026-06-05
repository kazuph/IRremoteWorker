export type ProtocolClassFromCommonSurfaceClass = {
  file: string;
  className: "IRMirageAc";
  rawType: "bytes";
  method: {
    name: "fromCommon";
    kind: "fromCommon";
    returnType: "void";
    parameters: Array<{
      type: "const stdAc::state_t";
      name: string;
      defaultValue: string | null;
    }>;
    isConst: boolean;
    isStatic: false;
    signature: string;
  };
};

export function protocolClassFromCommonSurface(root?: string): {
  classes: ProtocolClassFromCommonSurfaceClass[];
  classCount: number;
  totalMethods: number;
  excluded: Array<{ file: string; className: string; reason: string }>;
  excludedCount: number;
};
