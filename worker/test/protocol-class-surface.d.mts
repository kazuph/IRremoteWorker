export type ProtocolClassSurfaceFile = {
  name: string;
  methods: string[];
  classes: Array<{
    className: string;
    baseSpec: string | null;
    methods: ProtocolClassSurfaceMethod[];
  }>;
};

export type ProtocolClassSurfaceMethod = {
  name: string;
  kind: "setter" | "getter" | "toCommon" | "fromCommon" | "other";
  returnType: string;
  parameters: Array<{
    type: string;
    name: string | null;
    defaultValue: string | null;
  }>;
  isConst: boolean;
  isStatic: boolean;
  signature: string;
};

export type ProtocolClassSurface = {
  files: ProtocolClassSurfaceFile[];
  fileCount: number;
  totalClasses: number;
  totalMethods: number;
  kindCounts: Record<string, number>;
  topFiles: Array<{ name: string; count: number }>;
};

export function protocolClassSurface(root?: string): ProtocolClassSurface;
