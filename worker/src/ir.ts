// @ts-ignore: Emscripten generates this ES module at build time.
import createNativeModule from "../native/dist/ir_native.js";

export type Mode = "auto" | "cool" | "heat" | "dry" | "fan";
export type Fan = "auto" | "min" | "low" | "medium" | "high" | "max";

export type GenerateRequest =
  | {
      kind?: "ac";
      protocol: string;
      model?: number;
      power?: boolean;
      mode?: Mode;
      degrees?: number;
      temperatureC?: number;
      celsius?: boolean;
      fan?: Fan;
      swingv?: number;
      swingh?: number;
      quiet?: boolean;
      turbo?: boolean;
      econo?: boolean;
      light?: boolean;
      filter?: boolean;
      clean?: boolean;
      beep?: boolean;
      sleep?: number;
      clock?: number;
    }
  | {
      kind: "value";
      protocol: string;
      data: string | number;
      bits?: number;
      repeat?: number;
    }
  | {
      kind: "state";
      protocol: string;
      state: number[];
      nbytes?: number;
    }
  | {
      kind: "raw";
      raw: number[];
      frequency?: number;
    }
  | {
      kind: "method";
      method: string;
      args?: Array<string | number | boolean>;
      state?: number[];
    }
  | {
      kind: "encode";
      method: string;
      args: Array<string | number | boolean>;
    }
  | {
      kind: "class";
      className: string;
      method?: string;
      args?: Array<string | number | boolean>;
      state?: number[];
      data?: string | number;
      repeat?: number;
    }
  | {
      kind: "classStatic";
      className: string;
      method: string;
      args?: Array<string | number | boolean>;
      state?: number[];
    }
  | {
      kind: "classCommon";
      className: string;
      state?: number[];
      data?: string | number;
    }
  | {
      kind: "classString";
      className: string;
      state?: number[];
      data?: string | number;
    }
  | {
      kind: "classFromCommon";
      className: string;
      model?: number;
      power?: boolean;
      mode?: Mode;
      degrees?: number;
      temperatureC?: number;
      celsius?: boolean;
      fan?: Fan;
      swingv?: number;
      swingh?: number;
      quiet?: boolean;
      turbo?: boolean;
      econo?: boolean;
      light?: boolean;
      filter?: boolean;
      clean?: boolean;
      beep?: boolean;
      sleep?: number;
      clock?: number;
      iFeel?: boolean;
      sensorTemperature?: number;
      repeat?: number;
    };

type LegacyGenerateRequest = {
  protocol?: string;
  manufacturer?: string;
  model?: string | number;
  power?: boolean;
  mode?: Mode;
  degrees?: number;
  temperatureC?: number;
  fan?: Fan;
  celsius?: boolean;
  swingv?: number;
  swingh?: number;
  quiet?: boolean;
  turbo?: boolean;
  econo?: boolean;
  light?: boolean;
  filter?: boolean;
  clean?: boolean;
  beep?: boolean;
  sleep?: number;
  clock?: number;
};

type RawGenerateRequest = Extract<GenerateRequest, { kind: "raw" }>;
type ValueGenerateRequest = Extract<GenerateRequest, { kind: "value" }>;
type StateGenerateRequest = Extract<GenerateRequest, { kind: "state" }>;
type MethodGenerateRequest = Extract<GenerateRequest, { kind: "method" }>;
type EncodeGenerateRequest = Extract<GenerateRequest, { kind: "encode" }>;
type ClassGenerateRequest = Extract<GenerateRequest, { kind: "class" }>;
type ClassStaticGenerateRequest = Extract<GenerateRequest, { kind: "classStatic" }>;
type ClassCommonGenerateRequest = Extract<GenerateRequest, { kind: "classCommon" }>;
type ClassStringGenerateRequest = Extract<GenerateRequest, { kind: "classString" }>;
type ClassFromCommonGenerateRequest = Extract<GenerateRequest, { kind: "classFromCommon" }>;

export type InferRequest = {
  raw: number[];
  frequency?: number;
};

type Protocol = {
  id: string;
  decodeType: number;
  hasState: boolean;
  defaultBits: number;
  minRepeats: number;
  acSupported: boolean;
};

type NativeModule = {
  ccall: (
    ident:
      | "ir_protocols_json"
      | "ir_generate_value_json"
      | "ir_generate_state_json"
      | "ir_generate_raw_json"
      | "ir_generate_method_json"
      | "ir_encode_json"
      | "ir_generate_class_json"
      | "ir_generate_class_method_json"
      | "ir_generate_class_static_json"
      | "ir_generate_class_common_json"
      | "ir_generate_class_string_json"
      | "ir_generate_class_from_common_json"
      | "ir_generate_ac_full_json"
      | "ir_infer_json",
    returnType: "string",
    argTypes: Array<"string" | "number">,
    args: Array<string | number>,
  ) => string;
};

const nativeModule = createNativeModule() as Promise<NativeModule>;

export async function listProtocols() {
  const native = await nativeModule;
  return parseNativeJson(native.ccall("ir_protocols_json", "string", [], [])).protocols as Protocol[];
}

export async function generateIr(request: GenerateRequest) {
  const native = await nativeModule;
  const kind = (request as { kind?: string }).kind;
  if (kind === "raw") {
    const rawRequest = request as RawGenerateRequest;
    const rawCsv = toCsv(rawRequest.raw, "raw");
    return parseNativeJson(
      native.ccall("ir_generate_raw_json", "string", ["string", "number"], [
        rawCsv,
        Math.round(rawRequest.frequency ?? 38000),
      ]),
    );
  }
  if (kind === "value") {
    const valueRequest = request as ValueGenerateRequest;
    return parseNativeJson(
      native.ccall(
        "ir_generate_value_json",
        "string",
        ["string", "string", "number", "number"],
        [
          valueRequest.protocol,
          String(valueRequest.data),
          Math.round(valueRequest.bits ?? 0),
          Math.round(valueRequest.repeat ?? 0),
        ],
      ),
    );
  }
  if (kind === "state") {
    const stateRequest = request as StateGenerateRequest;
    const stateCsv = toCsv(stateRequest.state, "state");
    return parseNativeJson(
      native.ccall(
        "ir_generate_state_json",
        "string",
        ["string", "string", "number"],
        [stateRequest.protocol, stateCsv, Math.round(stateRequest.nbytes ?? stateRequest.state.length)],
      ),
    );
  }
  if (kind === "method") {
    const methodRequest = request as MethodGenerateRequest;
    const argsCsv = Array.isArray(methodRequest.state)
      ? `state:${toCsv(methodRequest.state, "state")}`
      : (methodRequest.args ?? []).map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : String(value))).join(",");
    return parseNativeJson(
      native.ccall("ir_generate_method_json", "string", ["string", "string"], [
        methodRequest.method,
        argsCsv,
      ]),
    );
  }
  if (kind === "encode") {
    const encodeRequest = request as EncodeGenerateRequest;
    return parseNativeJson(
      native.ccall("ir_encode_json", "string", ["string", "string"], [
        encodeRequest.method,
        encodeRequest.args.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : String(value))).join(","),
      ]),
    );
  }
  if (kind === "class") {
    const classRequest = request as ClassGenerateRequest;
    const stateCsv = Array.isArray(classRequest.state) ? toCsv(classRequest.state, "state") : "";
    if (classRequest.method) {
      return parseNativeJson(
        native.ccall("ir_generate_class_method_json", "string", ["string", "string", "string", "string", "string"], [
          classRequest.className,
          stateCsv,
          String(classRequest.data ?? 0),
          classRequest.method,
          (classRequest.args ?? []).map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : String(value))).join(","),
        ]),
      );
    }
    return parseNativeJson(
      native.ccall("ir_generate_class_json", "string", ["string", "string", "string", "number"], [
        classRequest.className,
        stateCsv,
        String(classRequest.data ?? 0),
        Math.round(classRequest.repeat ?? 0),
      ]),
    );
  }
  if (kind === "classStatic") {
    const staticRequest = request as ClassStaticGenerateRequest;
    const stateCsv = Array.isArray(staticRequest.state) ? toCsv(staticRequest.state, "state") : "";
    return parseNativeJson(
      native.ccall("ir_generate_class_static_json", "string", ["string", "string", "string", "string"], [
        staticRequest.className,
        stateCsv,
        staticRequest.method,
        (staticRequest.args ?? []).map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : String(value))).join(","),
      ]),
    );
  }
  if (kind === "classCommon") {
    const commonRequest = request as ClassCommonGenerateRequest;
    const stateCsv = Array.isArray(commonRequest.state) ? toCsv(commonRequest.state, "state") : "";
    return parseNativeJson(
      native.ccall("ir_generate_class_common_json", "string", ["string", "string", "string"], [
        commonRequest.className,
        stateCsv,
        String(commonRequest.data ?? 0),
      ]),
    );
  }
  if (kind === "classString") {
    const stringRequest = request as ClassStringGenerateRequest;
    const stateCsv = Array.isArray(stringRequest.state) ? toCsv(stringRequest.state, "state") : "";
    return parseNativeJson(
      native.ccall("ir_generate_class_string_json", "string", ["string", "string", "string"], [
        stringRequest.className,
        stateCsv,
        String(stringRequest.data ?? 0),
      ]),
    );
  }
  if (kind === "classFromCommon") {
    const fromCommonRequest = normalizeClassFromCommonRequest(request as ClassFromCommonGenerateRequest);
    return parseNativeJson(
      native.ccall(
        "ir_generate_class_from_common_json",
        "string",
        [
          "string",
          "number",
          "number",
          "string",
          "number",
          "number",
          "string",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
          "number",
        ],
        [
          fromCommonRequest.className,
          fromCommonRequest.model,
          fromCommonRequest.power ? 1 : 0,
          fromCommonRequest.mode,
          fromCommonRequest.temperatureC,
          fromCommonRequest.celsius ? 1 : 0,
          fromCommonRequest.fan,
          fromCommonRequest.swingv,
          fromCommonRequest.swingh,
          fromCommonRequest.quiet ? 1 : 0,
          fromCommonRequest.turbo ? 1 : 0,
          fromCommonRequest.econo ? 1 : 0,
          fromCommonRequest.light ? 1 : 0,
          fromCommonRequest.filter ? 1 : 0,
          fromCommonRequest.clean ? 1 : 0,
          fromCommonRequest.beep ? 1 : 0,
          fromCommonRequest.sleep,
          fromCommonRequest.clock,
          fromCommonRequest.iFeel ? 1 : 0,
          fromCommonRequest.sensorTemperature,
          fromCommonRequest.repeat,
        ],
      ),
    );
  }
  if (kind && kind !== "ac") {
    throw new Error(`unsupported generation kind: ${kind}`);
  }

  const ac = normalizeAcRequest(request as LegacyGenerateRequest);
  return parseNativeJson(
    native.ccall(
      "ir_generate_ac_full_json",
      "string",
      [
        "string",
        "number",
        "number",
        "string",
        "number",
        "number",
        "string",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
        "number",
      ],
      [
        ac.protocol,
        ac.model,
        ac.power ? 1 : 0,
        ac.mode,
        ac.temperatureC,
        ac.celsius ? 1 : 0,
        ac.fan,
        ac.swingv,
        ac.swingh,
        ac.quiet ? 1 : 0,
        ac.turbo ? 1 : 0,
        ac.econo ? 1 : 0,
        ac.light ? 1 : 0,
        ac.filter ? 1 : 0,
        ac.clean ? 1 : 0,
        ac.beep ? 1 : 0,
        ac.sleep,
        ac.clock,
      ],
    ),
  );
}

export async function inferIr(request: InferRequest) {
  if (!Array.isArray(request.raw)) {
    throw new Error("raw must be an array of pulse durations");
  }
  const native = await nativeModule;
  const rawCsv = request.raw.map((value) => Math.max(0, Math.round(value))).join(",");
  const json = native.ccall(
    "ir_infer_json",
    "string",
    ["string", "number"],
    [rawCsv, Math.round(request.frequency ?? 0)],
  );
  return parseNativeJson(json);
}

function parseNativeJson(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.error) {
    throw new Error(parsed.error);
  }
  return parsed;
}

function normalizeAcRequest(request: LegacyGenerateRequest) {
  const protocol = request.protocol ?? (typeof request.model === "string" ? request.model : undefined);
  if (!protocol || request.manufacturer) {
    throw new Error("AC generation requires an exact IRremoteESP8266 protocol id");
  }
  return {
    protocol,
    model: typeof request.model === "number" ? Math.round(request.model) : -1,
    power: request.power ?? true,
    mode: request.mode ?? "cool",
    temperatureC: Math.round(request.degrees ?? request.temperatureC ?? 26),
    celsius: request.celsius ?? true,
    fan: request.fan ?? "auto",
    swingv: Math.round(request.swingv ?? 0),
    swingh: Math.round(request.swingh ?? 0),
    quiet: request.quiet ?? false,
    turbo: request.turbo ?? false,
    econo: request.econo ?? false,
    light: request.light ?? false,
    filter: request.filter ?? false,
    clean: request.clean ?? false,
    beep: request.beep ?? true,
    sleep: Math.round(request.sleep ?? -1),
    clock: Math.round(request.clock ?? -1),
  };
}

function normalizeClassFromCommonRequest(request: ClassFromCommonGenerateRequest) {
  return {
    className: request.className,
    model: Math.round(request.model ?? -1),
    power: request.power ?? true,
    mode: request.mode ?? "cool",
    temperatureC: Math.round(request.degrees ?? request.temperatureC ?? 26),
    celsius: request.celsius ?? true,
    fan: request.fan ?? "auto",
    swingv: Math.round(request.swingv ?? 0),
    swingh: Math.round(request.swingh ?? 0),
    quiet: request.quiet ?? false,
    turbo: request.turbo ?? false,
    econo: request.econo ?? false,
    light: request.light ?? false,
    filter: request.filter ?? false,
    clean: request.clean ?? false,
    beep: request.beep ?? true,
    sleep: Math.round(request.sleep ?? -1),
    clock: Math.round(request.clock ?? -1),
    iFeel: request.iFeel ?? false,
    sensorTemperature: Math.round(request.sensorTemperature ?? -1),
    repeat: Math.round(request.repeat ?? 0),
  };
}

function toCsv(values: number[], name: string) {
  if (!Array.isArray(values)) {
    throw new Error(`${name} must be an array`);
  }
  return values.map((value) => Math.max(0, Math.round(value))).join(",");
}
