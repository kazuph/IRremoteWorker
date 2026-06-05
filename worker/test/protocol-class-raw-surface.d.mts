export type ProtocolClassRawSurfaceClass = {
  file: string;
  className: string;
  rawType: "bytes" | "uint32" | "uint64";
  setRawLengthArg: boolean;
  stateLengthExpression: string | null;
  rawLengthMethod: string | null;
  inheritedFrom: string | null;
  sendVia?: "class" | "irsend";
  sendMethod?: string;
};

export type ProtocolClassRawSurfaceExclusion = {
  file: string;
  className: string;
  reason: string;
};

export type ProtocolClassRawSurface = {
  classes: ProtocolClassRawSurfaceClass[];
  classCount: number;
  excluded: ProtocolClassRawSurfaceExclusion[];
  excludedCount: number;
};

export function protocolClassRawSurface(root?: string): ProtocolClassRawSurface;
