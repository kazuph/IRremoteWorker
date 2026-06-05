import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import app from "../src/index";
import { generateIr, inferIr, listProtocols } from "../src/ir";
import { protocolClassCommonSurface } from "./protocol-class-common-surface.mjs";
import { protocolClassFromCommonSurface } from "./protocol-class-from-common-surface.mjs";
import { protocolClassMethodSurface } from "./protocol-class-method-surface.mjs";
import { protocolClassRawSurface } from "./protocol-class-raw-surface.mjs";
import { protocolClassStaticSurface } from "./protocol-class-static-surface.mjs";
import { protocolClassStringSurface } from "./protocol-class-string-surface.mjs";
import { protocolClassSurface } from "./protocol-class-surface.mjs";

type Protocol = {
  id: string;
  decodeType: number;
  hasState: boolean;
  defaultBits: number;
  minRepeats: number;
  acSupported: boolean;
};

type JsonObject = Record<string, any>;
type DecodeFixture = {
  label: string;
  raw: number[];
};

const HAIER_YRW02_STATE = [0xA6, 0xE1, 0x00, 0x00, 0x40, 0x20, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x07, 0x6E];

function native(command: string, args: Array<string | number>) {
  const output = execFileSync("worker/oracle/ir_native_oracle", [command, ...args.map(String)], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function nativeInfer(raw: number[], frequency = 38000) {
  return native("infer", [raw.join(","), frequency]);
}

function expectSameJson(actual: unknown, expected: unknown, label: string) {
  expect(actual, label).toEqual(expected);
}

function rawValueFor(rawType: string) {
  return rawType === "uint32" ? "0x12345678" : "0x11D30000000000";
}

function stringRawValueFor(rawType: string) {
  return rawType === "uint32" ? "0xFFFFFFFF" : "0xFFFFFFFFFFFFFFFF";
}

function sampleArg(param: { scalarType?: string; type?: string }) {
  const type = param.scalarType ?? param.type ?? "";
  if (/\bbool\b/.test(type)) return 1;
  if (/\bfloat\b|\bdouble\b/.test(type)) return 1;
  return 1;
}

function sampleStaticState(method: { parameters: Array<{ source?: string }> }) {
  return method.parameters.some((param) => param.source === "state" || param.source === "stateStruct") ? Array(20).fill(0) : [];
}

function sampleStaticArgs(method: { parameters: Array<{ source?: string; scalarType?: string; type?: string }> }) {
  return method.parameters.filter((param) => param.source !== "state" && param.source !== "stateStruct").map(sampleArg);
}

function sampleMethodArgs(method: { parameters: Array<{ source?: string; scalarType?: string; type?: string }> }) {
  if (method.parameters.some((param) => param.source === "argsSet")) return [1, 3, 5];
  return method.parameters.map(sampleArg);
}

async function apiPost(path: string, body: unknown) {
  const response = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: (await response.json()) as JsonObject,
  };
}

function uniqueMatches(source: string, pattern: RegExp) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

function directMethodProtocolCases(kind: "value" | "state") {
  const testSource = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const startMarker =
    kind === "value"
      ? 'it("matches native C++ direct value-style IRsend method generation"'
      : 'it("matches native C++ direct state-array IRsend method generation"';
  const start = testSource.indexOf(startMarker, testSource.indexOf("describe("));
  const next = testSource.indexOf("\n  it(", start + startMarker.length);
  const section = testSource.slice(start, next === -1 ? undefined : next);
  return [...section.matchAll(/\{\s*method:\s*"([^"]+)",\s*protocol:\s*"([^"]+)"(?:,\s*nbytes:\s*(\d+))?(?:,\s*sendFooter:\s*(true|false))?\s*\}/g)].map(
    (match) => ({
      method: match[1],
      protocol: match[2],
      nbytes: match[3] ? Number(match[3]) : undefined,
      sendFooter: match[4] ? match[4] === "true" : undefined,
    }),
  );
}

function upstreamDecodeFixtures() {
  const fixtures: DecodeFixture[] = [];
  const skipped: string[] = [];
  const arrayPattern = /(?:const\s+)?uint16_t\s+(rawData\w*)\s*\[[^\]]+\]\s*=\s*\{([\s\S]*?)\};/g;

  for (const file of readdirSync("test").filter((name) => /^ir_.*_test\.cpp$/.test(name)).sort()) {
    const source = readFileSync(join("test", file), "utf8");
    for (const match of source.matchAll(arrayPattern)) {
      const body = match[2]
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      if (!/^[\s,0-9xXa-fA-F]+$/.test(body)) {
        skipped.push(`${file}:${match[1]}`);
        continue;
      }
      const raw = body
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => Number(value));
      if (raw.length > 0 && raw.every(Number.isFinite)) {
        fixtures.push({ label: `${file}:${match[1]}`, raw });
      }
    }
  }

  return { fixtures, skipped };
}

describe("IRremoteESP8266 Worker native WASM bridge", () => {
  beforeAll(() => {
    execSync("npm run native:oracle:build", { stdio: "inherit" });
  }, 120_000);

  it("exposes the same full protocol list as the native C++ oracle", async () => {
    const wasmProtocols = await listProtocols();
    const nativeProtocols = native("protocols", []).protocols as Protocol[];

    expect(wasmProtocols).toEqual(nativeProtocols);
    expect(wasmProtocols.length).toBe(128);
    expect(wasmProtocols.map((protocol) => protocol.id)).toContain("MITSUBISHI_HEAVY_152");
    expect(wasmProtocols.map((protocol) => protocol.id)).toContain("NEC");
    expect(wasmProtocols.map((protocol) => protocol.id)).toContain("DAIKIN312");
  });

  it("keeps every public direct IRsend helper exposed and oracle-tested", () => {
    const header = readFileSync("src/IRsend.h", "utf8");
    const bridge = readFileSync("worker/native/ir_full.cpp", "utf8");
    const testSource = readFileSync(fileURLToPath(import.meta.url), "utf8");

    const publicSendMethods = uniqueMatches(header, /void\s+(send[A-Za-z0-9_]+)\s*\(/g);
    const publicValueMethods = uniqueMatches(
      header,
      /void\s+(send[A-Za-z0-9_]+)\s*\(\s*(?:const\s+)?uint64_t\s+data/g,
    );
    const publicStateMethods = uniqueMatches(
      header,
      /void\s+(send[A-Za-z0-9_]+)\s*\(\s*(?:const\s+)?(?:unsigned\s+char|uint8_t)\s*(?:\*|\s)\s*data\s*(?:\[\])?/g,
    );
    const publicEncodeMethods = uniqueMatches(
      header,
      /(?:static\s+)?uint(?:16|32|64)_t\s+((?:encode|toggle)[A-Za-z0-9_]+)\s*\(/g,
    );

    const bridgeValueMethods = [
      ...uniqueMatches(bridge, /IR_VALUE_SEND_METHOD\((send[A-Za-z0-9_]+)\)/g),
      "sendGree",
    ].sort();
    const bridgeStateMethods = [
      ...uniqueMatches(bridge, /IR_(?:DEFAULT|REQUIRED)_STATE_SEND_METHOD\((send[A-Za-z0-9_]+)\)/g),
      "sendArgo",
      "sendGree",
    ].sort();
    const bridgeEncodeMethods = uniqueMatches(
      bridge,
      /!std::strcmp\(method,\s*"((?:encode|toggle)[A-Za-z0-9_]+)"\)/g,
    );
    const methodSchemaMethods = [...new Set([
      "sendData",
      "sendManchesterData",
      "sendManchester",
      "sendGeneric",
      "sendGC",
      "sendPronto",
      "sendSharp",
      "sendPanasonic",
      ...bridgeValueMethods,
      ...bridgeStateMethods,
    ])].sort();
    const testedMethods = uniqueMatches(testSource, /method:\s*"(send[A-Za-z0-9_]+)"/g);
    const testedPublicSendMethods = [
      ...testedMethods.filter((method) => publicSendMethods.includes(method)),
      ...(testSource.includes('kind: "raw"') ? ["sendRaw"] : []),
    ].sort();
    const testedEncodeMethods = uniqueMatches(testSource, /method:\s*"((?:encode|toggle)[A-Za-z0-9_]+)"/g);

    expect(["sendRaw", ...methodSchemaMethods].sort()).toEqual(publicSendMethods);
    expect(bridgeValueMethods).toEqual(publicValueMethods);
    expect(bridgeStateMethods).toEqual(publicStateMethods);
    expect(bridgeEncodeMethods).toEqual(publicEncodeMethods);
    expect(testedPublicSendMethods).toEqual(publicSendMethods);
    expect(testedMethods).toEqual(expect.arrayContaining(publicValueMethods));
    expect(testedMethods).toEqual(expect.arrayContaining(publicStateMethods));
    expect(testedEncodeMethods).toEqual(expect.arrayContaining(publicEncodeMethods));
  });

  it("keeps class-only send helpers exposed and oracle-tested", () => {
    const headers = readdirSync("src")
      .filter((name) => /^ir_.*\.h$/.test(name))
      .map((name) => ({ name, source: readFileSync(join("src", name), "utf8") }));
    const classOnlySendMethods = headers.flatMap(({ name, source }) =>
      [...source.matchAll(/\n\s*(?:virtual\s+|static\s+)?void\s+(send[A-Za-z0-9_]+)\s*\([^;{}]*\)\s*(?:override\s*)?;/g)]
        .map((match) => `${name}:${match[1]}`)
        .filter((method) => !method.endsWith(":send")),
    );
    const bridge = readFileSync("worker/native/ir_full.cpp", "utf8");
    const testSource = readFileSync(fileURLToPath(import.meta.url), "utf8");

    expect(classOnlySendMethods.sort()).toEqual([
      "ir_Argo.h:sendSensorTemp",
      "ir_Argo.h:sendSensorTemp",
      "ir_Samsung.h:sendExtended",
      "ir_Samsung.h:sendOff",
      "ir_Samsung.h:sendOn",
    ]);
    for (const method of [
      "sendArgoSensorTemp",
      "sendArgoWrem3SensorTemp",
      "sendSamsungAcExtended",
      "sendSamsungAcOff",
      "sendSamsungAcOn",
    ]) {
      expect(bridge, method).toContain(`"${method}"`);
      expect(testSource, method).toContain(`method: "${method}"`);
    }
  });

  it("keeps protocol class setter/getter APIs documented as not yet exposed", () => {
    const classApiSurface = protocolClassSurface();
    const generatedSurface = JSON.parse(readFileSync("worker/generated/protocol-class-surface.json", "utf8"));
    const readme = readFileSync("worker/README.md", "utf8");

    expect(generatedSurface).toEqual(classApiSurface);
    expect(classApiSurface.fileCount).toBe(42);
    expect(classApiSurface.totalClasses).toBe(68);
    expect(classApiSurface.totalMethods).toBe(1762);
    expect(classApiSurface.kindCounts).toEqual({
      setter: 762,
      getter: 784,
      toCommon: 215,
      fromCommon: 1,
    });
    expect(classApiSurface.topFiles.slice(0, 3)).toEqual([
      { name: "ir_Daikin.h", count: 281 },
      { name: "ir_Haier.h", count: 116 },
      { name: "ir_Hitachi.h", count: 90 },
    ]);
    const airton = classApiSurface.files
      .find((file) => file.name === "ir_Airton.h")
      ?.classes.find((entry) => entry.className === "IRAirtonAc");
    expect(airton?.methods.find((method) => method.name === "setTemp")).toMatchObject({
      kind: "setter",
      returnType: "void",
      parameters: [{ type: "const uint8_t", name: "degrees", defaultValue: null }],
      signature: "void setTemp(const uint8_t degrees)",
    });
    expect(airton?.methods.find((method) => method.name === "getTemp")).toMatchObject({
      kind: "getter",
      returnType: "uint8_t",
      parameters: [],
      isConst: true,
      signature: "uint8_t getTemp(void) const",
    });
    expect(readme).toContain("42 `src/ir_*.h`");
    expect(readme).toContain("68 protocol classes");
    expect(readme).toContain("evaluates the same compile-time header gates");
    expect(readme).toContain("headers with 68 protocol classes and 1762 public");
    expect(readme).toContain("class `set*`/`get*`/`toCommon*`/`fromCommon*` methods");
    expect(readme).toContain("762 setters,");
    expect(readme).toContain("784 getters");
    expect(readme).toContain("215 `toCommon*` methods");
    expect(readme).toContain("1 `fromCommon*` method");
    expect(readme).toContain("`set*`/`get*`/`toCommon*`/`fromCommon*` methods");
    expect(readme).toContain("The Worker still does not expose");
    expect(readme).toContain("REST object schemas");
    expect(readme).toContain("must not claim the");
    expect(readme).toContain("protocol class setter/getter surface is complete");
    expect(readme).toContain("must not be treated as complete parity");
  });

  it("keeps protocol class raw-state bridge generated from C++ headers", () => {
    const surface = protocolClassRawSurface();
    const generatedSurface = JSON.parse(readFileSync("worker/generated/protocol-class-raw-surface.json", "utf8"));
    const generatedBridge = readFileSync("worker/native/generated_class_raw_bridge.h", "utf8");

    expect(generatedSurface).toEqual(surface);
    expect(surface.classCount).toBe(67);
    expect(surface.excludedCount).toBe(1);
    expect(surface.classes.map((entry: { className: string }) => entry.className)).toContain("IRPanasonicAc");
    expect(surface.classes.map((entry: { className: string }) => entry.className)).toContain("IRAirtonAc");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC")?.inheritedFrom).toBe("IRArgoACBase");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC_WREM3")?.inheritedFrom).toBe("IRArgoACBase");
    const hitachiAc3 = surface.classes.find((entry) => entry.className === "IRHitachiAc3");
    expect(hitachiAc3?.sendVia).toBe("irsend");
    expect(hitachiAc3?.sendMethod).toBe("sendHitachiAc3");
    expect(generatedBridge).toContain("IRPanasonicAc ac(0);");
    expect(generatedBridge).toContain("IRAirtonAc ac(0);");
    expect(generatedBridge).toContain("IRArgoAC ac(0);");
    expect(generatedBridge).toContain("IRArgoAC_WREM3 ac(0);");
    const readme = readFileSync("worker/README.md", "utf8");
    expect(readme).toContain("`IRArgoACBase` (`ir_Argo.h`)");
    expect(readme).toContain("not a standalone sendable protocol class");
  });

  it("keeps protocol class scalar method bridge generated from C++ headers", () => {
    const surface = protocolClassMethodSurface();
    const generatedSurface = JSON.parse(readFileSync("worker/generated/protocol-class-method-surface.json", "utf8"));
    const generatedBridge = readFileSync("worker/native/generated_class_method_bridge.h", "utf8");

    expect(generatedSurface).toEqual(surface);
    expect(surface.classCount).toBe(65);
    expect(surface.totalMethods).toBe(1384);
    expect(surface.excludedCount).toBe(350);
    expect(surface.excluded.filter((entry) => entry.reason === "not a generated instance setter/getter target")).toHaveLength(347);
    expect(surface.excluded.filter((entry) => entry.reason !== "not a generated instance setter/getter target")).toEqual([
      {
        file: "ir_Hitachi.h",
        className: "IRHitachiAc3",
        method: "getMode",
        reason: "missing linkable Class::method implementation",
      },
      {
        file: "ir_York.h",
        className: "IRYorkAc",
        method: "setPowerToggle",
        reason: "missing linkable Class::method implementation",
      },
      {
        file: "ir_York.h",
        className: "IRYorkAc",
        method: "getPowerToggle",
        reason: "missing linkable Class::method implementation",
      },
    ]);
    expect(surface.classes.find((entry) => entry.className === "IRFujitsuAC")?.methods.map((method) => method.name)).toContain("setTemp");
    expect(surface.classes.find((entry) => entry.className === "IRAirtonAc")?.methods.map((method) => method.name)).toContain("setTemp");
    expect(surface.classes.find((entry) => entry.className === "IRAirtonAc")?.methods.map((method) => method.name)).toContain("getTemp");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC_WREM3")?.methods.map((method) => method.name)).toContain("setScheduleTimerActiveDays");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC_WREM3")?.methods.map((method) => method.name)).toContain("getScheduleTimerActiveDays");
    expect(surface.excluded).toContainEqual({
      file: "ir_York.h",
      className: "IRYorkAc",
      method: "setPowerToggle",
      reason: "missing linkable Class::method implementation",
    });
    expect(generatedBridge).toContain("generateClassMethodJson");
    expect(generatedBridge).toContain("IRAirtonAc ac(0);");
    expect(generatedBridge).toContain("IRArgoAC ac(0);");
    expect(generatedBridge).toContain("std::set<argoWeekday> arg0;");
    const readme = readFileSync("worker/README.md", "utf8");
    expect(readme).toContain("1384 generated instance");
    expect(readme).toContain("excludes 350 methods");
    expect(readme).toContain("347 of them are not generated instance");
    expect(readme).toContain("remaining 3 are still not exposed");
    expect(readme).toContain("`IRHitachiAc3::getMode`");
  });

  it("keeps protocol class static conversion bridge generated from C++ headers", () => {
    const surface = protocolClassStaticSurface();
    const generatedSurface = JSON.parse(readFileSync("worker/generated/protocol-class-static-surface.json", "utf8"));
    const generatedBridge = readFileSync("worker/native/generated_class_static_bridge.h", "utf8");

    expect(generatedSurface).toEqual(surface);
    expect(surface.classCount).toBe(61);
    expect(surface.totalMethods).toBe(149);
    expect(surface.excludedCount).toBe(5);
    expect(surface.classes.find((entry) => entry.className === "IRAirtonAc")?.methods.map((method) => method.name)).toContain("toCommonMode");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC_WREM3")?.methods).toContainEqual(
      expect.objectContaining({
        name: "getMessageType",
        parameters: [expect.objectContaining({ source: "stateStruct", structType: "ArgoProtocolWREM3" })],
      }),
    );
    expect(generatedBridge).toContain("generateClassStaticJson");
    expect(generatedBridge).toContain("IRAirtonAc::toCommonMode");
    expect(generatedBridge).toContain("ArgoProtocolWREM3 rawStruct0 = {};");
    const readme = readFileSync("worker/README.md", "utf8");
    expect(readme).toContain("149 scalar static class helpers");
    expect(readme).toContain("excludes 5 static methods");
    expect(readme).toContain("Raw-struct reference helpers with a `raw[]` backing field");
  expect(readme).toContain("`IRArgoAC_WREM3::getMessageType(const ArgoProtocolWREM3&)`");
    expect(readme).toContain("Declarations without a linkable");
    expect(readme).toContain("`IRKelvinatorAC::toCommonSwingV`");
  });

  it("keeps protocol class common-state bridge generated from C++ headers", () => {
    const surface = protocolClassCommonSurface();
    const generatedSurface = JSON.parse(readFileSync("worker/generated/protocol-class-common-surface.json", "utf8"));
    const generatedBridge = readFileSync("worker/native/generated_class_common_bridge.h", "utf8");

    expect(generatedSurface).toEqual(surface);
    expect(surface.classCount).toBe(66);
    expect(surface.totalMethods).toBe(66);
    expect(surface.excludedCount).toBe(1);
    expect(surface.classes.find((entry) => entry.className === "IRAirtonAc")?.method.name).toBe("toCommon");
    expect(surface.classes.find((entry) => entry.className === "IRHitachiAc424")?.method.name).toBe("toCommon");
    expect(surface.classes.find((entry) => entry.className === "IRHaierACYRW02")?.inheritedFrom).toBe("IRHaierAC176");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC")?.method.name).toBe("toCommon");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC_WREM3")?.method.name).toBe("toCommon");
    expect(generatedBridge).toContain("generateClassCommonJson");
    expect(generatedBridge).toContain("IRAirtonAc ac(0);");
    expect(generatedBridge).toContain("IRHaierACYRW02 ac(0);");
    expect(generatedBridge).toContain("const stdAc::state_t common = ac.toCommon();");
  });

  it("keeps protocol class string bridge generated from C++ headers", () => {
    const surface = protocolClassStringSurface();
    const generatedSurface = JSON.parse(readFileSync("worker/generated/protocol-class-string-surface.json", "utf8"));
    const generatedBridge = readFileSync("worker/native/generated_class_string_bridge.h", "utf8");

    expect(generatedSurface).toEqual(surface);
    expect(surface.classCount).toBe(66);
    expect(surface.totalMethods).toBe(66);
    expect(surface.excludedCount).toBe(1);
    expect(surface.classes.find((entry) => entry.className === "IRAirtonAc")?.method.name).toBe("toString");
    expect(surface.classes.find((entry) => entry.className === "IRHitachiAc424")?.method.name).toBe("toString");
    expect(surface.classes.find((entry) => entry.className === "IRHaierACYRW02")?.inheritedFrom).toBe("IRHaierAC176");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC")?.method.name).toBe("toString");
    expect(surface.classes.find((entry) => entry.className === "IRArgoAC_WREM3")?.method.name).toBe("toString");
    expect(generatedBridge).toContain("generateClassStringJson");
    expect(generatedBridge).toContain("IRHaierACYRW02 ac(0);");
    expect(generatedBridge).toContain("std::string(ac.toString().c_str())");
  });

  it("keeps protocol class fromCommon bridge generated from C++ headers", () => {
    const surface = protocolClassFromCommonSurface();
    const generatedSurface = JSON.parse(readFileSync("worker/generated/protocol-class-from-common-surface.json", "utf8"));
    const generatedBridge = readFileSync("worker/native/generated_class_from_common_bridge.h", "utf8");

    expect(generatedSurface).toEqual(surface);
    expect(surface.classCount).toBe(1);
    expect(surface.totalMethods).toBe(1);
    expect(surface.excludedCount).toBe(0);
    expect(surface.classes[0]?.className).toBe("IRMirageAc");
    expect(generatedBridge).toContain("generateClassFromCommonJson");
    expect(generatedBridge).toContain("ac.fromCommon(common)");
  });

  it("builds the Worker and native oracle from the full native bridge only", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const exportedFunctions = JSON.parse(
      packageJson.scripts["native:build"].match(/EXPORTED_FUNCTIONS='([^']+)'/)?.[1] ?? "[]",
    );

    expect(packageJson.scripts["native:build"]).toContain("worker/native/ir_full.cpp");
    expect(packageJson.scripts["native:oracle:build"]).toContain("worker/native/ir_full.cpp");
    expect(packageJson.scripts["native:build"]).not.toContain("worker/native/ir_native.cpp");
    expect(packageJson.scripts["native:oracle:build"]).not.toContain("worker/native/ir_native.cpp");
    expect(exportedFunctions).toEqual([
      "_ir_protocols_json",
      "_ir_generate_value_json",
      "_ir_generate_state_json",
      "_ir_generate_raw_json",
      "_ir_generate_method_json",
      "_ir_encode_json",
      "_ir_generate_class_json",
      "_ir_generate_class_method_json",
      "_ir_generate_class_static_json",
      "_ir_generate_class_common_json",
      "_ir_generate_class_string_json",
      "_ir_generate_class_from_common_json",
      "_ir_generate_ac_full_json",
      "_ir_infer_json",
    ]);
  });

  it("matches native C++ value generation for every generic value protocol that native accepts", async () => {
    const protocols = (await listProtocols()).filter((protocol) => !protocol.hasState && protocol.defaultBits > 0);
    const unsupported: string[] = [];
    let checked = 0;
    let checkedNonAc = 0;

    for (const protocol of protocols) {
      const expected = native("value", [protocol.id, "0x1", protocol.defaultBits, protocol.minRepeats]);
      if (expected.error) {
        unsupported.push(protocol.id);
        continue;
      }
      const actual = await generateIr({
        kind: "value",
        protocol: protocol.id,
        data: "0x1",
        bits: protocol.defaultBits,
        repeat: protocol.minRepeats,
      });
      expectSameJson(actual, expected, protocol.id);
      checked++;
      if (!protocol.acSupported) checkedNonAc++;
    }

    expect(checked + unsupported.length).toBe(protocols.length);
    expect(checkedNonAc).toBe(protocols.filter((protocol) => !protocol.acSupported).length);
    expect(checkedNonAc).toBe(48);
    expect(unsupported).toEqual([]);
  });

  it("matches native C++ state generation for every generic state protocol that native accepts", async () => {
    const protocols = (await listProtocols()).filter((protocol) => protocol.hasState && protocol.defaultBits > 0);
    const unsupported: string[] = [];
    let checked = 0;

    for (const protocol of protocols) {
      const nbytes = Math.ceil(protocol.defaultBits / 8);
      const state = Array.from({ length: nbytes }, (_, index) => (index * 17 + 3) & 0xff);
      const expected = native("state", [protocol.id, state.join(","), nbytes]);
      if (expected.error) {
        unsupported.push(protocol.id);
        continue;
      }
      const actual = await generateIr({ kind: "state", protocol: protocol.id, state, nbytes });
      expectSameJson(actual, expected, protocol.id);
      checked++;
    }

    expect(checked + unsupported.length).toBe(protocols.length);
    expect(unsupported).toEqual([]);
  });

  it("matches native C++ common AC generation with the full IRac::sendAc argument surface", async () => {
    const request = {
      kind: "ac" as const,
      protocol: "DAIKIN",
      model: -1,
      power: true,
      mode: "cool" as const,
      degrees: 25,
      celsius: true,
      fan: "medium" as const,
      swingv: 0,
      swingh: 0,
      quiet: true,
      turbo: false,
      econo: true,
      light: true,
      filter: false,
      clean: false,
      beep: true,
      sleep: -1,
      clock: -1,
    };
    const expected = native("ac-full", [
      request.protocol,
      request.model,
      String(request.power),
      request.mode,
      request.degrees,
      request.celsius ? 1 : 0,
      request.fan,
      request.swingv,
      request.swingh,
      request.quiet ? 1 : 0,
      request.turbo ? 1 : 0,
      request.econo ? 1 : 0,
      request.light ? 1 : 0,
      request.filter ? 1 : 0,
      request.clean ? 1 : 0,
      request.beep ? 1 : 0,
      request.sleep,
      request.clock,
    ]);
    const actual = await generateIr(request);

    expectSameJson(actual, expected, "full AC common API");
    expect(actual.raw.length).toBeGreaterThan(0);
  });

  it("matches native C++ protocol class raw-state generation", async () => {
    const panasonicState = [
      0x02, 0x20, 0xe0, 0x04, 0x00, 0x00, 0x00, 0x06, 0x02,
      0x20, 0xe0, 0x04, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00,
      0x00, 0x0e, 0xe0, 0x00, 0x00, 0x81, 0x00, 0x00, 0x00,
    ];
    const panasonicExpected = native("class", ["IRPanasonicAc", panasonicState.join(","), 0, 0]);
    const panasonicActual = await generateIr({
      kind: "class",
      className: "IRPanasonicAc",
      state: panasonicState,
      repeat: 0,
    });
    expectSameJson(panasonicActual, panasonicExpected, "IRPanasonicAc class raw state");
    expect(panasonicActual.raw.length).toBeGreaterThan(0);

    const airtonExpected = native("class", ["IRAirtonAc", "", "0x11D30000000000", 0]);
    const airtonActual = await generateIr({
      kind: "class",
      className: "IRAirtonAc",
      data: "0x11D30000000000",
      repeat: 0,
    });
    expectSameJson(airtonActual, airtonExpected, "IRAirtonAc class raw value");
    expect(airtonActual.raw.length).toBeGreaterThan(0);

    const addedByteClasses = [
      {
        className: "IRFujitsuAC",
        state: [0x14, 0x63, 0x00, 0x10, 0x10, 0xFE, 0x09, 0x30, 0x81, 0x01, 0x31, 0x00, 0x00, 0x00, 0x20, 0xFD],
      },
      {
        className: "IRHaierACYRW02",
        state: HAIER_YRW02_STATE,
      },
      { className: "IRHitachiAc344", state: Array(43).fill(0) },
      { className: "IRHitachiAc264", state: Array(33).fill(0) },
      {
        className: "IRHitachiAc3",
        state: [
          0x01, 0x10, 0x00, 0x40, 0xbf, 0xff, 0x00, 0xe6, 0x19, 0x89, 0x76, 0x01,
          0xfe, 0x3f, 0xc0, 0x2f, 0xd0, 0x18, 0xe7, 0x00, 0xff, 0xa0, 0x5f,
        ],
      },
    ];

    for (const fixture of addedByteClasses) {
      const expected = native("class", [fixture.className, fixture.state.join(","), 0, 0]);
      const actual = await generateIr({
        kind: "class",
        className: fixture.className,
        state: fixture.state,
        repeat: 0,
      });
      expectSameJson(actual, expected, `${fixture.className} class raw state`);
      expect(actual.raw.length).toBeGreaterThan(0);
    }
  });

  it("matches native C++ for every bytes protocol class raw generation from default state", async () => {
    const surface = protocolClassRawSurface();
    let checked = 0;

    for (const klass of surface.classes.filter((entry) => entry.rawType === "bytes")) {
      const expected = native("class", [klass.className, "", 0, 0]);
      const actual = await generateIr({
        kind: "class",
        className: klass.className,
        repeat: 0,
      });
      expectSameJson(actual, expected, `${klass.className} class raw default state`);
      expect(actual.raw.length).toBeGreaterThan(0);
      checked++;
    }

    expect(checked).toBe(50);
  });

  it("matches native C++ protocol class scalar setter/getter methods", async () => {
    const setExpected = native("class-method", ["IRAirtonAc", "", "0x11D30000000000", "setPower", "1"]);
    const setActual = await generateIr({
      kind: "class",
      className: "IRAirtonAc",
      data: "0x11D30000000000",
      method: "setPower",
      args: [true],
    });
    expectSameJson(setActual, setExpected, "IRAirtonAc.setPower");

    const getExpected = native("class-method", ["IRAirtonAc", "", setActual.value, "getPower", ""]);
    const getActual = await generateIr({
      kind: "class",
      className: "IRAirtonAc",
      data: setActual.value,
      method: "getPower",
      args: [],
    });
    expectSameJson(getActual, getExpected, "IRAirtonAc.getPower");
    expect(getActual.result).toBe(true);
  });

  it("matches native C++ Argo WREM3 weekday set method bridge", async () => {
    const state = Array(9).fill(0);
    const args = [0, 2, 4, 6];
    const setExpected = native("class-method", ["IRArgoAC_WREM3", state.join(","), 0, "setScheduleTimerActiveDays", args.join(",")]);
    const setActual = await generateIr({
      kind: "class",
      className: "IRArgoAC_WREM3",
      state,
      method: "setScheduleTimerActiveDays",
      args,
    });
    expectSameJson(setActual, setExpected, "IRArgoAC_WREM3.setScheduleTimerActiveDays");

    const getExpected = native("class-method", ["IRArgoAC_WREM3", setActual.state.join(","), 0, "getScheduleTimerActiveDays", ""]);
    const getActual = await generateIr({
      kind: "class",
      className: "IRArgoAC_WREM3",
      state: setActual.state,
      method: "getScheduleTimerActiveDays",
      args: [],
    });
    expectSameJson(getActual, getExpected, "IRArgoAC_WREM3.getScheduleTimerActiveDays");
    expect(getActual.result).toEqual(args);
  });

  it("matches native C++ for every raw-value protocol class scalar method", async () => {
    const surface = protocolClassMethodSurface();
    let checked = 0;

    for (const klass of surface.classes.filter((entry) => entry.rawType !== "bytes")) {
      for (const method of klass.methods) {
        const args = method.parameters.map(sampleArg);
        const rawValue = rawValueFor(klass.rawType);
        const expected = native("class-method", [
          klass.className,
          "",
          rawValue,
          method.name,
          args.join(","),
        ]);
        const actual = await generateIr({
          kind: "class",
          className: klass.className,
          data: rawValue,
          method: method.name,
          args,
        });
        expectSameJson(actual, expected, `${klass.className}.${method.name}`);
        checked++;
      }
    }

    expect(checked).toBe(326);
  });

  it("matches native C++ for every bytes protocol class method from default state", async () => {
    const surface = protocolClassMethodSurface();
    let checked = 0;

    for (const klass of surface.classes.filter((entry) => entry.rawType === "bytes")) {
      for (const method of klass.methods) {
        const args = sampleMethodArgs(method);
        const expected = native("class-method", [
          klass.className,
          "",
          0,
          method.name,
          args.join(","),
        ]);
        const actual = await generateIr({
          kind: "class",
          className: klass.className,
          method: method.name,
          args,
        });
        expectSameJson(actual, expected, `${klass.className}.${method.name}`);
        checked++;
      }
    }

    expect(checked).toBe(1058);
  });

  it("matches native C++ protocol class static conversion methods", async () => {
    const expected = native("class-static", ["IRAirtonAc", "", "toCommonMode", "1"]);
    const actual = await generateIr({
      kind: "classStatic",
      className: "IRAirtonAc",
      method: "toCommonMode",
      args: [1],
    });
    expectSameJson(actual, expected, "IRAirtonAc.toCommonMode");
  });

  it("matches native C++ for every exposed protocol class static conversion helper", async () => {
    const surface = protocolClassStaticSurface();
    let checked = 0;

    for (const klass of surface.classes) {
      for (const method of klass.methods) {
        const state = sampleStaticState(method);
        const args = sampleStaticArgs(method);
        const expected = native("class-static", [klass.className, state.join(","), method.name, args.join(",")]);
        const actual = await generateIr({
          kind: "classStatic",
          className: klass.className,
          method: method.name,
          args,
          state,
        });
        expectSameJson(actual, expected, `${klass.className}.${method.name}`);
        checked++;
      }
    }

    expect(checked).toBe(149);
  });

  it("matches native C++ protocol class common-state conversion", async () => {
    const expected = native("class-common", ["IRAirtonAc", "", "0x11D30000000000"]);
    const actual = await generateIr({
      kind: "classCommon",
      className: "IRAirtonAc",
      data: "0x11D30000000000",
    });
    expectSameJson(actual, expected, "IRAirtonAc.toCommon");
    expect(actual.ac).toMatchObject({
      protocol: "AIRTON",
      sourceProtocol: "IRAirtonAc",
    });

    const inheritedExpected = native("class-common", ["IRHaierACYRW02", HAIER_YRW02_STATE.join(","), 0]);
    const inheritedActual = await generateIr({
      kind: "classCommon",
      className: "IRHaierACYRW02",
      state: HAIER_YRW02_STATE,
    });
    expectSameJson(inheritedActual, inheritedExpected, "IRHaierACYRW02.toCommon inherited from IRHaierAC176");
    expect(inheritedActual.ac).toMatchObject({
      sourceProtocol: "IRHaierACYRW02",
    });
  });

  it("matches native C++ inherited protocol class string conversion", async () => {
    const expected = native("class-string", ["IRHaierACYRW02", HAIER_YRW02_STATE.join(","), 0]);
    const actual = await generateIr({
      kind: "classString",
      className: "IRHaierACYRW02",
      state: HAIER_YRW02_STATE,
    });
    expectSameJson(actual, expected, "IRHaierACYRW02.toString inherited from IRHaierAC176");
    expect(actual.result).toEqual(expect.any(String));
  });

  it("matches native C++ for every raw-value protocol class common-state conversion", async () => {
    const surface = protocolClassCommonSurface();
    let checked = 0;

    for (const klass of surface.classes.filter((entry) => entry.rawType !== "bytes")) {
      const rawValue = rawValueFor(klass.rawType);
      const expected = native("class-common", [klass.className, "", rawValue]);
      const actual = await generateIr({
        kind: "classCommon",
        className: klass.className,
        data: rawValue,
      });
      expectSameJson(actual, expected, `${klass.className}.toCommon`);
      checked++;
    }

    expect(checked).toBe(17);
  });

  it("matches native C++ for every bytes protocol class common-state conversion from default state", async () => {
    const surface = protocolClassCommonSurface();
    let checked = 0;

    for (const klass of surface.classes.filter((entry) => entry.rawType === "bytes")) {
      const expected = native("class-common", [klass.className, "", 0]);
      const actual = await generateIr({
        kind: "classCommon",
        className: klass.className,
      });
      expectSameJson(actual, expected, `${klass.className}.toCommon default state`);
      checked++;
    }

    expect(checked).toBe(49);
  });

  it("derives A/C manufacturer display names mechanically from common-state protocol ids", async () => {
    const cases = [
      { className: "IRWhirlpoolAc", manufacturer: "WHIRLPOOL" },
      { className: "IRElectraAc", manufacturer: "ELECTRA" },
      { className: "IRCarrierAc64", manufacturer: "CARRIER" },
      { className: "IRTcl112Ac", manufacturer: "TCL" },
      { className: "IRBosch144AC", manufacturer: "BOSCH" },
    ];

    for (const testCase of cases) {
      const expected = native("class-common", [testCase.className, "", 0]);
      const actual = await generateIr({ kind: "classCommon", className: testCase.className });

      expectSameJson(actual, expected, `${testCase.className}.toCommon manufacturer`);
      expect((actual as JsonObject).ac.manufacturer, testCase.className).toBe(testCase.manufacturer);
    }
  });

  it("matches native C++ for every raw-value protocol class string conversion", async () => {
    const surface = protocolClassStringSurface();
    let checked = 0;

    for (const klass of surface.classes.filter((entry) => entry.rawType !== "bytes")) {
      const rawValue = stringRawValueFor(klass.rawType);
      const expected = native("class-string", [klass.className, "", rawValue]);
      const actual = await generateIr({
        kind: "classString",
        className: klass.className,
        data: rawValue,
      });
      expectSameJson(actual, expected, `${klass.className}.toString`);
      checked++;
    }

    expect(checked).toBe(17);
  });

  it("matches native C++ for every bytes protocol class string conversion from default state", async () => {
    const surface = protocolClassStringSurface();
    let checked = 0;

    for (const klass of surface.classes.filter((entry) => entry.rawType === "bytes")) {
      const expected = native("class-string", [klass.className, "", 0]);
      const actual = await generateIr({
        kind: "classString",
        className: klass.className,
      });
      expectSameJson(actual, expected, `${klass.className}.toString default state`);
      checked++;
    }

    expect(checked).toBe(49);
  });

  it("matches native C++ protocol class fromCommon conversion", async () => {
    const args = ["IRMirageAc", 1, "true", "cool", 25, 1, "auto", 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, -1, 0, -1, 0];
    const expected = native("class-from-common", args);
    const actual = await generateIr({
      kind: "classFromCommon",
      className: "IRMirageAc",
      model: 1,
      power: true,
      mode: "cool",
      degrees: 25,
      celsius: true,
      fan: "auto",
      swingv: 0,
      swingh: 0,
      quiet: false,
      turbo: false,
      econo: false,
      light: true,
      filter: false,
      clean: false,
      beep: true,
      sleep: -1,
      clock: -1,
      iFeel: false,
      sensorTemperature: -1,
      repeat: 0,
    });
    expectSameJson(actual, expected, "IRMirageAc.fromCommon");
    expect(actual.raw.length).toBeGreaterThan(0);
    expect(actual.state.length).toBeGreaterThan(0);
  });

  it("matches native C++ common AC generation for every IRac-supported protocol", async () => {
    const protocols = (await listProtocols()).filter((protocol) => protocol.acSupported);
    const nativeErrors: Array<{ protocol: string; error: string }> = [];
    let checked = 0;

    for (const protocol of protocols) {
      const request = {
        kind: "ac" as const,
        protocol: protocol.id,
        model: protocol.id === "FUJITSU_AC" ? 1 : -1,
        power: true,
        mode: "cool" as const,
        degrees: 25,
        celsius: true,
        fan: "auto" as const,
        swingv: 0,
        swingh: 0,
        quiet: false,
        turbo: false,
        econo: false,
        light: false,
        filter: false,
        clean: false,
        beep: true,
        sleep: -1,
        clock: -1,
      };
      const expected = native("ac-full", [
        request.protocol,
        request.model,
        String(request.power),
        request.mode,
        request.degrees,
        request.celsius ? 1 : 0,
        request.fan,
        request.swingv,
        request.swingh,
        request.quiet ? 1 : 0,
        request.turbo ? 1 : 0,
        request.econo ? 1 : 0,
        request.light ? 1 : 0,
        request.filter ? 1 : 0,
        request.clean ? 1 : 0,
        request.beep ? 1 : 0,
        request.sleep,
        request.clock,
      ]);

      if (expected.error) {
        nativeErrors.push({ protocol: protocol.id, error: expected.error });
        await expect(generateIr(request), protocol.id).rejects.toThrow(expected.error);
        continue;
      }

      const actual = await generateIr(request);
      expectSameJson(actual, expected, protocol.id);
      expect(actual.raw.length, protocol.id).toBeGreaterThan(0);
      checked++;
    }

    expect(checked + nativeErrors.length).toBe(protocols.length);
    expect(nativeErrors).toEqual([{ protocol: "YORK", error: "unsupported AC common generation for protocol" }]);
  });

  it("matches native C++ raw generation", async () => {
    const raw = [9000, 4500, 560, 560, 560, 1690, 560, 560];
    const expected = native("raw", [raw.join(","), 38000]);
    const actual = await generateIr({ kind: "raw", raw, frequency: 38000 });

    expectSameJson(actual, expected, "raw passthrough");
  });

  it("keeps the required native decode_result fields explicit for value and state protocols", async () => {
    const valueGenerated = await generateIr({
      kind: "value",
      protocol: "NEC",
      data: "0x20DF10EF",
      bits: 32,
      repeat: 0,
    });
    const valueActual = await inferIr({ raw: valueGenerated.raw, frequency: valueGenerated.frequency });
    const valueExpected = nativeInfer(valueGenerated.raw, valueGenerated.frequency);

    expectSameJson(valueActual, valueExpected, "NEC decode_result fields");
    expect(valueActual).toMatchObject({
      matched: true,
      protocol: "NEC",
      decode_type: valueActual.decodeType,
      bits: 32,
      value: valueExpected.value,
      value_hex: valueActual.valueHex,
      address: valueExpected.address,
      command: valueExpected.command,
      repeat: valueExpected.repeat,
      rawlen: valueGenerated.raw.length + 1,
      state: null,
    });

    const stateGenerated = await generateIr({
      kind: "ac",
      protocol: "PANASONIC_AC",
      model: 4,
      power: true,
      mode: "cool",
      degrees: 26,
      celsius: true,
      fan: "auto",
      swingv: 0,
      swingh: 0,
      quiet: false,
      turbo: false,
      econo: false,
      light: false,
      filter: false,
      clean: false,
      beep: true,
      sleep: -1,
      clock: -1,
    });
    const stateFrequency = stateGenerated.frequency ?? 38000;
    const stateActual = await inferIr({ raw: stateGenerated.raw, frequency: stateFrequency });
    const stateExpected = nativeInfer(stateGenerated.raw, stateFrequency);

    expectSameJson(stateActual, stateExpected, "PANASONIC_AC decode_result fields");
    expect(stateActual).toMatchObject({
      matched: true,
      protocol: stateExpected.protocol,
      decode_type: stateActual.decodeType,
      bits: stateExpected.bits,
      value: stateExpected.value,
      value_hex: stateActual.valueHex,
      address: stateExpected.address,
      command: stateExpected.command,
      repeat: stateExpected.repeat,
      rawlen: stateGenerated.raw.length + 1,
    });
    expect(Array.isArray(stateActual.state)).toBe(true);
    expect(stateActual.state).toEqual(stateExpected.state);
  });

  it("matches native C++ public IRsend helper method generation", async () => {
    const cases: Array<{ method: string; args: Array<string | number | boolean> }> = [
      { method: "sendData", args: [560, 1690, 560, 560, "0xA", 4, true] },
      { method: "sendManchesterData", args: [889, "0x15", 5, true, true] },
      { method: "sendManchester", args: [2666, 889, 889, 889, 40000, "0x15", 5, 36000, true, 0, 50, true] },
      { method: "sendGeneric", args: [9000, 4500, 560, 1690, 560, 560, 560, 40000, "0x1", 1, 38000, true, 0, 50] },
      {
        method: "sendGenericMesgtime",
        args: [9000, 4500, 560, 1690, 560, 560, 560, 40000, 110000, "0x1", 1, 38000, true, 0, 50],
      },
      {
        method: "sendGenericBytes",
        args: [9000, 4500, 560, 1690, 560, 560, 560, 40000, 2, 38000, true, 0, 50, 0x12, 0x34],
      },
      { method: "sendSharp", args: [0x1, 0x2, 15, 0] },
      { method: "sendPanasonic", args: [0x4004, 0x100bcbd, 48, 0] },
      { method: "sendArgoSensorTemp", args: [22, 0] },
      { method: "sendArgoWrem3SensorTemp", args: [22, 0] },
      { method: "sendSamsungAcExtended", args: [0] },
      { method: "sendSamsungAcOn", args: [0] },
      { method: "sendSamsungAcOff", args: [0] },
      { method: "sendGC", args: [38000, 1, 1, 9, 70, 9, 30] },
      { method: "sendPronto", args: [0, 0x0000, 0x006d, 0x0000, 0x0002, 0x0156, 0x00ab, 0x0016, 0x0016] },
    ];

    for (const testCase of cases) {
      const argsCsv = testCase.args.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : String(value))).join(",");
      const expected = native("method", [testCase.method, argsCsv]);
      const actual = await generateIr({ kind: "method", method: testCase.method, args: testCase.args });

      expectSameJson(actual, expected, testCase.method);
      expect(actual.raw.length, testCase.method).toBeGreaterThan(0);
    }
  });

  it("supports native C++ default arguments for public IRsend helper methods", async () => {
    const cases: Array<{
      method: string;
      shortArgs: Array<string | number | boolean>;
      fullArgs: Array<string | number | boolean>;
    }> = [
      {
        method: "sendData",
        shortArgs: [560, 1690, 560, 560, "0xA", 4],
        fullArgs: [560, 1690, 560, 560, "0xA", 4, true],
      },
      {
        method: "sendManchesterData",
        shortArgs: [889, "0x15", 5],
        fullArgs: [889, "0x15", 5, true, true],
      },
      {
        method: "sendManchester",
        shortArgs: [2666, 889, 889, 889, 40000, "0x15", 5],
        fullArgs: [2666, 889, 889, 889, 40000, "0x15", 5, 38, true, 0, 50, true],
      },
      { method: "sendSharp", shortArgs: [0x1, 0x2], fullArgs: [0x1, 0x2, 15, 0] },
      { method: "sendPanasonic", shortArgs: [0x4004, 0x100bcbd], fullArgs: [0x4004, 0x100bcbd, 48, 0] },
      { method: "sendArgoSensorTemp", shortArgs: [22], fullArgs: [22, 0] },
      { method: "sendArgoWrem3SensorTemp", shortArgs: [22], fullArgs: [22, 0] },
      { method: "sendSamsungAcExtended", shortArgs: [], fullArgs: [0] },
      { method: "sendSamsungAcOn", shortArgs: [], fullArgs: [0] },
      { method: "sendSamsungAcOff", shortArgs: [], fullArgs: [0] },
    ];

    for (const testCase of cases) {
      const shortActual = await generateIr({ kind: "method", method: testCase.method, args: testCase.shortArgs });
      const fullActual = await generateIr({ kind: "method", method: testCase.method, args: testCase.fullArgs });

      expectSameJson(shortActual, fullActual, `${testCase.method} default args`);
    }
  });

  it("matches native C++ direct value-style IRsend method generation", async () => {
    const protocolById = new Map((await listProtocols()).map((protocol) => [protocol.id, protocol]));
    const cases: Array<{ method: string; protocol: string }> = [
      { method: "sendNEC", protocol: "NEC" },
      { method: "sendSony", protocol: "SONY" },
      { method: "sendSony38", protocol: "SONY_38K" },
      { method: "sendSherwood", protocol: "SHERWOOD" },
      { method: "sendSAMSUNG", protocol: "SAMSUNG" },
      { method: "sendSamsung36", protocol: "SAMSUNG36" },
      { method: "sendLG", protocol: "LG" },
      { method: "sendLG2", protocol: "LG2" },
      { method: "sendSharpRaw", protocol: "SHARP" },
      { method: "sendJVC", protocol: "JVC" },
      { method: "sendDenon", protocol: "DENON" },
      { method: "sendSanyoLC7461", protocol: "SANYO_LC7461" },
      { method: "sendDISH", protocol: "DISH" },
      { method: "sendPanasonic64", protocol: "PANASONIC" },
      { method: "sendRC5", protocol: "RC5" },
      { method: "sendRC6", protocol: "RC6" },
      { method: "sendRCMM", protocol: "RCMM" },
      { method: "sendCOOLIX", protocol: "COOLIX" },
      { method: "sendCoolix48", protocol: "COOLIX48" },
      { method: "sendWhynter", protocol: "WHYNTER" },
      { method: "sendMitsubishi", protocol: "MITSUBISHI" },
      { method: "sendMitsubishi2", protocol: "MITSUBISHI2" },
      { method: "sendInax", protocol: "INAX" },
      { method: "sendDaikin64", protocol: "DAIKIN64" },
      { method: "sendAiwaRCT501", protocol: "AIWA_RC_T501" },
      { method: "sendGree", protocol: "GREE" },
      { method: "sendGoodweather", protocol: "GOODWEATHER" },
      { method: "sendGorenje", protocol: "GORENJE" },
      { method: "sendNikai", protocol: "NIKAI" },
      { method: "sendMidea", protocol: "MIDEA" },
      { method: "sendMidea24", protocol: "MIDEA24" },
      { method: "sendMagiQuest", protocol: "MAGIQUEST" },
      { method: "sendLasertag", protocol: "LASERTAG" },
      { method: "sendCarrierAC", protocol: "CARRIER_AC" },
      { method: "sendCarrierAC40", protocol: "CARRIER_AC40" },
      { method: "sendCarrierAC64", protocol: "CARRIER_AC64" },
      { method: "sendGICable", protocol: "GICABLE" },
      { method: "sendLutron", protocol: "LUTRON" },
      { method: "sendPanasonicAC32", protocol: "PANASONIC_AC32" },
      { method: "sendPioneer", protocol: "PIONEER" },
      { method: "sendVestelAc", protocol: "VESTEL_AC" },
      { method: "sendTeco", protocol: "TECO" },
      { method: "sendLegoPf", protocol: "LEGOPF" },
      { method: "sendEpson", protocol: "EPSON" },
      { method: "sendSymphony", protocol: "SYMPHONY" },
      { method: "sendAirwell", protocol: "AIRWELL" },
      { method: "sendDelonghiAc", protocol: "DELONGHI_AC" },
      { method: "sendDoshisha", protocol: "DOSHISHA" },
      { method: "sendMultibrackets", protocol: "MULTIBRACKETS" },
      { method: "sendTechnibelAc", protocol: "TECHNIBEL_AC" },
      { method: "sendZepeal", protocol: "ZEPEAL" },
      { method: "sendMetz", protocol: "METZ" },
      { method: "sendTranscold", protocol: "TRANSCOLD" },
      { method: "sendElitescreens", protocol: "ELITESCREENS" },
      { method: "sendMilestag2", protocol: "MILESTAG2" },
      { method: "sendEcoclim", protocol: "ECOCLIM" },
      { method: "sendXmp", protocol: "XMP" },
      { method: "sendTruma", protocol: "TRUMA" },
      { method: "sendKelon", protocol: "KELON" },
      { method: "sendBose", protocol: "BOSE" },
      { method: "sendArris", protocol: "ARRIS" },
      { method: "sendAirton", protocol: "AIRTON" },
      { method: "sendToto", protocol: "TOTO" },
      { method: "sendClimaButler", protocol: "CLIMABUTLER" },
      { method: "sendWowwee", protocol: "WOWWEE" },
    ];

    for (const testCase of cases) {
      const protocol = protocolById.get(testCase.protocol);
      expect(protocol, testCase.protocol).toBeDefined();
      const args = ["0x1", protocol!.defaultBits, protocol!.minRepeats];
      const argsCsv = args.join(",");
      const expected = native("method", [testCase.method, argsCsv]);
      const actual = await generateIr({ kind: "method", method: testCase.method, args });

      expectSameJson(actual, expected, testCase.method);
      expect(actual.raw.length, testCase.method).toBeGreaterThan(0);
    }
  });

  it("supports native C++ default arguments for every direct value-style IRsend method", async () => {
    const protocolById = new Map((await listProtocols()).map((protocol) => [protocol.id, protocol]));

    for (const testCase of directMethodProtocolCases("value")) {
      const protocol = protocolById.get(testCase.protocol);
      expect(protocol, testCase.protocol).toBeDefined();

      const oneArg = await generateIr({ kind: "method", method: testCase.method, args: ["0x1"] });
      const twoArgs = await generateIr({
        kind: "method",
        method: testCase.method,
        args: ["0x1", protocol!.defaultBits],
      });
      const threeArgs = await generateIr({
        kind: "method",
        method: testCase.method,
        args: ["0x1", protocol!.defaultBits, protocol!.minRepeats],
      });

      expectSameJson(oneArg, threeArgs, `${testCase.method} one arg default`);
      expectSameJson(twoArgs, threeArgs, `${testCase.method} two arg default`);
    }
  });

  it("matches native C++ direct state-array IRsend method generation", async () => {
    const protocolById = new Map((await listProtocols()).map((protocol) => [protocol.id, protocol]));
    const cases: Array<{ method: string; protocol: string; nbytes?: number; sendFooter?: boolean }> = [
      { method: "sendMirage", protocol: "MIRAGE" },
      { method: "sendMitsubishi136", protocol: "MITSUBISHI136" },
      { method: "sendMitsubishi112", protocol: "MITSUBISHI112" },
      { method: "sendMitsubishiAC", protocol: "MITSUBISHI_AC" },
      { method: "sendMitsubishiHeavy88", protocol: "MITSUBISHI_HEAVY_88" },
      { method: "sendMitsubishiHeavy152", protocol: "MITSUBISHI_HEAVY_152" },
      { method: "sendFujitsuAC", protocol: "FUJITSU_AC", nbytes: 16 },
      { method: "sendKelvinator", protocol: "KELVINATOR" },
      { method: "sendSamsungAC", protocol: "SAMSUNG_AC" },
      { method: "sendSharpAc", protocol: "SHARP_AC" },
      { method: "sendSanyoAc", protocol: "SANYO_AC" },
      { method: "sendSanyoAc88", protocol: "SANYO_AC88" },
      { method: "sendSanyoAc152", protocol: "SANYO_AC152" },
      { method: "sendDaikin", protocol: "DAIKIN" },
      { method: "sendDaikin128", protocol: "DAIKIN128" },
      { method: "sendDaikin152", protocol: "DAIKIN152" },
      { method: "sendDaikin160", protocol: "DAIKIN160" },
      { method: "sendDaikin176", protocol: "DAIKIN176" },
      { method: "sendDaikin2", protocol: "DAIKIN2" },
      { method: "sendDaikin200", protocol: "DAIKIN200" },
      { method: "sendDaikin216", protocol: "DAIKIN216" },
      { method: "sendDaikin312", protocol: "DAIKIN312" },
      { method: "sendGree", protocol: "GREE" },
      { method: "sendArgo", protocol: "ARGO", sendFooter: false },
      { method: "sendArgoWREM3", protocol: "ARGO" },
      { method: "sendTrotec", protocol: "TROTEC" },
      { method: "sendTrotec3550", protocol: "TROTEC_3550" },
      { method: "sendToshibaAC", protocol: "TOSHIBA_AC" },
      { method: "sendCarrierAC84", protocol: "CARRIER_AC84" },
      { method: "sendCarrierAC128", protocol: "CARRIER_AC128" },
      { method: "sendHaierAC", protocol: "HAIER_AC" },
      { method: "sendHaierACYRW02", protocol: "HAIER_AC_YRW02" },
      { method: "sendHaierAC160", protocol: "HAIER_AC160" },
      { method: "sendHaierAC176", protocol: "HAIER_AC176" },
      { method: "sendHitachiAC", protocol: "HITACHI_AC" },
      { method: "sendHitachiAC1", protocol: "HITACHI_AC1" },
      { method: "sendHitachiAC2", protocol: "HITACHI_AC2" },
      { method: "sendHitachiAc3", protocol: "HITACHI_AC3" },
      { method: "sendHitachiAc264", protocol: "HITACHI_AC264" },
      { method: "sendHitachiAc296", protocol: "HITACHI_AC296" },
      { method: "sendHitachiAc344", protocol: "HITACHI_AC344" },
      { method: "sendHitachiAc424", protocol: "HITACHI_AC424" },
      { method: "sendWhirlpoolAC", protocol: "WHIRLPOOL_AC" },
      { method: "sendElectraAC", protocol: "ELECTRA_AC" },
      { method: "sendPanasonicAC", protocol: "PANASONIC_AC" },
      { method: "sendMWM", protocol: "MWM", nbytes: 3 },
      { method: "sendTcl96Ac", protocol: "TCL96AC" },
      { method: "sendTcl112Ac", protocol: "TCL112AC" },
      { method: "sendNeoclima", protocol: "NEOCLIMA" },
      { method: "sendAmcor", protocol: "AMCOR" },
      { method: "sendCoronaAc", protocol: "CORONA_AC" },
      { method: "sendVoltas", protocol: "VOLTAS" },
      { method: "sendTeknopoint", protocol: "TEKNOPOINT" },
      { method: "sendKelon168", protocol: "KELON168" },
      { method: "sendRhoss", protocol: "RHOSS" },
      { method: "sendBosch144", protocol: "BOSCH144" },
      { method: "sendYork", protocol: "YORK" },
      { method: "sendBluestarHeavy", protocol: "BLUESTARHEAVY" },
      { method: "sendEurom", protocol: "EUROM" },
    ];

    for (const testCase of cases) {
      const protocol = protocolById.get(testCase.protocol);
      expect(protocol, testCase.protocol).toBeDefined();
      const nbytes = testCase.nbytes ?? Math.ceil(protocol!.defaultBits / 8);
      const state = Array.from({ length: nbytes }, (_, index) => (index * 19 + 7) & 0xff);
      const args =
        testCase.method === "sendArgo"
          ? [nbytes, protocol!.minRepeats, testCase.sendFooter ? 1 : 0, ...state]
          : [nbytes, protocol!.minRepeats, ...state];
      const argsCsv = args.join(",");
      const expected = native("method", [testCase.method, argsCsv]);
      const actual = await generateIr({ kind: "method", method: testCase.method, args });

      expectSameJson(actual, expected, testCase.method);
      expect(actual.raw.length, testCase.method).toBeGreaterThan(0);
    }
  });

  it("matches native C++ inference fields for direct value-style method raw timings", async () => {
    const protocolById = new Map((await listProtocols()).map((protocol) => [protocol.id, protocol]));
    let checked = 0;

    for (const testCase of directMethodProtocolCases("value")) {
      const protocol = protocolById.get(testCase.protocol);
      expect(protocol, testCase.protocol).toBeDefined();
      const args = ["0x1", protocol!.defaultBits, protocol!.minRepeats];
      const generated = native("method", [testCase.method, args.join(",")]);
      if (generated.error || generated.raw.length === 0) continue;

      const actual = await inferIr({ raw: generated.raw, frequency: generated.frequency });
      const expected = nativeInfer(generated.raw, generated.frequency);
      expectSameJson(actual, expected, testCase.method);
      checked++;
    }

    expect(checked).toBe(directMethodProtocolCases("value").length);
  });

  it("supports native C++ default nbytes and repeat for state-array IRsend methods", async () => {
    const header = readFileSync("src/IRsend.h", "utf8");
    const defaultStateMethods = new Set(
      uniqueMatches(
        header,
        /void\s+(send[A-Za-z0-9_]+)\s*\(\s*(?:const\s+)?(?:unsigned\s+char|uint8_t)\s*(?:\*|\s)\s*data\s*(?:\[\])?\s*,\s*(?:const\s+)?uint16_t\s+nbytes\s*=/g,
      ),
    );
    const protocolById = new Map((await listProtocols()).map((protocol) => [protocol.id, protocol]));
    let checked = 0;

    for (const testCase of directMethodProtocolCases("state").filter((testCase) => defaultStateMethods.has(testCase.method))) {
      const protocol = protocolById.get(testCase.protocol);
      expect(protocol, testCase.protocol).toBeDefined();
      const nbytes = testCase.nbytes ?? Math.ceil(protocol!.defaultBits / 8);
      const state = Array.from({ length: nbytes }, (_, index) => (index * 19 + 7) & 0xff);
      const explicitArgs =
        testCase.method === "sendArgo"
          ? [nbytes, protocol!.minRepeats, testCase.sendFooter ? 1 : 0, ...state]
          : [nbytes, protocol!.minRepeats, ...state];

      const defaultActual = await generateIr({ kind: "method", method: testCase.method, state });
      const explicitActual = await generateIr({ kind: "method", method: testCase.method, args: explicitArgs });
      const expected = native("method", [testCase.method, `state:${state.join(",")}`]);

      expectSameJson(defaultActual, expected, `${testCase.method} state default args`);
      expectSameJson(defaultActual, explicitActual, `${testCase.method} explicit state args`);
      checked++;
    }

    expect(checked).toBe([...defaultStateMethods].filter((method) => directMethodProtocolCases("state").some((testCase) => testCase.method === method)).length);
    expect(defaultStateMethods).not.toContain("sendFujitsuAC");
    expect(defaultStateMethods).not.toContain("sendHitachiAc3");
    expect(defaultStateMethods).not.toContain("sendMWM");
  });

  it("matches native C++ inference fields for direct state-array method raw timings", async () => {
    const protocolById = new Map((await listProtocols()).map((protocol) => [protocol.id, protocol]));
    let checked = 0;

    for (const testCase of directMethodProtocolCases("state")) {
      const protocol = protocolById.get(testCase.protocol);
      expect(protocol, testCase.protocol).toBeDefined();
      const nbytes = testCase.nbytes ?? Math.ceil(protocol!.defaultBits / 8);
      const state = Array.from({ length: nbytes }, (_, index) => (index * 19 + 7) & 0xff);
      const args =
        testCase.method === "sendArgo"
          ? [nbytes, protocol!.minRepeats, testCase.sendFooter ? 1 : 0, ...state]
          : [nbytes, protocol!.minRepeats, ...state];
      const generated = native("method", [testCase.method, args.join(",")]);
      if (generated.error || generated.raw.length === 0) continue;

      const actual = await inferIr({ raw: generated.raw, frequency: generated.frequency });
      const expected = nativeInfer(generated.raw, generated.frequency);
      expectSameJson(actual, expected, testCase.method);
      checked++;
    }

    expect(checked).toBe(directMethodProtocolCases("state").length);
  });

  it("matches native C++ public encoder helper outputs", async () => {
    const cases: Array<{ method: string; args: Array<string | number | boolean> }> = [
      { method: "encodeNEC", args: [0x10, 0xef] },
      { method: "encodeSony", args: [20, 0x15, 0x1a, 0x0] },
      { method: "encodeSAMSUNG", args: [0xe0, 0x10] },
      { method: "encodeLG", args: [0x20, 0xdf] },
      { method: "encodeSharp", args: [0x1, 0x2, 1, 0, false] },
      { method: "encodeJVC", args: [0x7, 0x99] },
      { method: "encodeSanyoLC7461", args: [0x1, 0x2] },
      { method: "encodePanasonic", args: [0x4004, 0x01, 0x00, 0xbc] },
      { method: "encodeRC5", args: [0x0, 0x0b, true] },
      { method: "encodeRC5X", args: [0x2, 0x41, true] },
      { method: "toggleRC5", args: [0x175] },
      { method: "encodeRC6", args: [0x1234567, 0x89, 20] },
      { method: "toggleRC6", args: [0xc800f740c, 36] },
      { method: "encodeMagiQuest", args: [0x12345678, 0x9abc] },
      { method: "encodePioneer", args: [0xaa1c, 0xaa1c] },
      { method: "encodeDoshisha", args: [0x48, 0] },
      { method: "encodeMetz", args: [0x1, 0x2, false] },
      { method: "toggleArrisRelease", args: [0x123456] },
      { method: "encodeArris", args: [0x123456, false] },
    ];

    for (const testCase of cases) {
      const argsCsv = testCase.args.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : String(value))).join(",");
      const expected = native("encode", [testCase.method, argsCsv]);
      const actual = await generateIr({ kind: "encode", method: testCase.method, args: testCase.args });

      expectSameJson(actual, expected, testCase.method);
      expect(actual.valueHex, testCase.method).toMatch(/^0x[0-9A-F]+$/);
    }
  });

  it("supports native C++ default arguments for public encoder helpers", async () => {
    const cases: Array<{
      method: string;
      shortArgs: Array<string | number | boolean>;
      fullArgs: Array<string | number | boolean>;
    }> = [
      { method: "encodeSony", shortArgs: [20, 0x15, 0x1a], fullArgs: [20, 0x15, 0x1a, 0] },
      { method: "encodeSharp", shortArgs: [0x1, 0x2], fullArgs: [0x1, 0x2, 1, 0, false] },
      { method: "encodeRC5", shortArgs: [0x0, 0x0b], fullArgs: [0x0, 0x0b, false] },
      { method: "encodeRC5X", shortArgs: [0x2, 0x41], fullArgs: [0x2, 0x41, false] },
      { method: "encodeRC6", shortArgs: [0x1234567, 0x89], fullArgs: [0x1234567, 0x89, 20] },
      { method: "toggleRC6", shortArgs: [0xc800f740c], fullArgs: [0xc800f740c, 20] },
      { method: "encodeDoshisha", shortArgs: [0x48], fullArgs: [0x48, 0] },
      { method: "encodeMetz", shortArgs: [0x1, 0x2], fullArgs: [0x1, 0x2, false] },
    ];

    for (const testCase of cases) {
      const shortActual = await generateIr({ kind: "encode", method: testCase.method, args: testCase.shortArgs });
      const fullActual = await generateIr({ kind: "encode", method: testCase.method, args: testCase.fullArgs });
      const expected = native("encode", [
        testCase.method,
        testCase.shortArgs.map((value) => (typeof value === "boolean" ? (value ? 1 : 0) : String(value))).join(","),
      ]);

      expectSameJson(shortActual, expected, `${testCase.method} default encode args`);
      expectSameJson(shortActual, fullActual, `${testCase.method} explicit encode args`);
    }
  });

  it("uses native encoder helper output as value generation input", async () => {
    const encoded = await generateIr({ kind: "encode", method: "encodeNEC", args: [0x20, 0xef] });
    const generated = await generateIr({ kind: "value", protocol: "NEC", data: encoded.valueHex, bits: 32, repeat: 0 });
    const expected = native("value", ["NEC", encoded.valueHex, 32, 0]);

    expectSameJson(generated, expected, "encoded NEC value generation");
  });

  it("matches native C++ inference fields for generated value protocol raw timings", async () => {
    const protocols = (await listProtocols()).filter((protocol) => !protocol.hasState && protocol.defaultBits > 0);
    let checked = 0;

    for (const protocol of protocols) {
      const generated = native("value", [protocol.id, "0x1", protocol.defaultBits, protocol.minRepeats]);
      if (generated.error || generated.raw.length === 0) continue;

      const actual = await inferIr({ raw: generated.raw, frequency: generated.frequency });
      const expected = nativeInfer(generated.raw, generated.frequency);
      expectSameJson(actual, expected, protocol.id);
      checked++;
    }

    expect(checked).toBe(protocols.length);
  });

  it("matches native C++ inference fields for generated state protocol raw timings", async () => {
    const protocols = (await listProtocols()).filter((protocol) => protocol.hasState && protocol.defaultBits > 0);
    let checked = 0;

    for (const protocol of protocols) {
      const nbytes = Math.ceil(protocol.defaultBits / 8);
      const state = Array.from({ length: nbytes }, (_, index) => (index * 17 + 3) & 0xff);
      const generated = native("state", [protocol.id, state.join(","), nbytes]);
      if (generated.error || generated.raw.length === 0) continue;

      const actual = await inferIr({ raw: generated.raw, frequency: generated.frequency });
      const expected = nativeInfer(generated.raw, generated.frequency);
      expectSameJson(actual, expected, protocol.id);
      checked++;
    }

    expect(checked).toBe(protocols.length);
  });

  it("returns native common A/C state fields for generated Panasonic A/C raw timings", async () => {
    const request = {
      kind: "ac" as const,
      protocol: "PANASONIC_AC",
      model: 4,
      power: true,
      mode: "cool" as const,
      degrees: 26,
      celsius: true,
      fan: "auto" as const,
      swingv: 0,
      swingh: 0,
      quiet: false,
      turbo: false,
      econo: false,
      light: false,
      filter: false,
      clean: false,
      beep: true,
      sleep: -1,
      clock: -1,
    };
    const generated = await generateIr(request);
    const frequency = generated.frequency ?? 38000;
    const actual = await inferIr({ raw: generated.raw, frequency });
    const expected = nativeInfer(generated.raw, frequency);

    expectSameJson(actual, expected, "Panasonic A/C state inference");
    expect(actual.decode_type).toBe(actual.decodeType);
    expect(actual.value_hex).toBe(actual.valueHex);
    expect(actual.raw_length).toBe(actual.rawLength);
    expect(actual).toMatchObject({
      protocol: "PANASONIC_AC",
      manufacturer: "PANASONIC",
      ac: {
        protocol: "PANASONIC_AC",
        manufacturer: "PANASONIC",
        power: true,
        mode: "Cool",
        degrees: 26,
        celsius: true,
        fan: "Auto",
      },
    });
    expect(actual.model).toBe(4);
    expect(actual.modelName).toBe("JKE");
    expect(actual.ac.description).toContain("Power: On");
  });

  it("does not invent manufacturers for non-A/C protocol inference", async () => {
    const raw = [20100, 20472, 15092, 30704, 20102, 20472, 15086];
    const actual = await inferIr({ raw, frequency: 38000 });
    const expected = nativeInfer(raw, 38000);

    expectSameJson(actual, expected, "Multibrackets non-A/C inference");
    expect(actual.decode_type).toBe(actual.decodeType);
    expect(actual.value_hex).toBe(actual.valueHex);
    expect(actual.raw_length).toBe(actual.rawLength);
    expect(actual).toMatchObject({
      protocol: "MULTIBRACKETS",
      manufacturer: null,
      model: null,
      modelName: null,
      ac: null,
    });
  });

  it("matches native C++ inference fields for upstream decode fixtures", async () => {
    const { fixtures, skipped } = upstreamDecodeFixtures();

    expect(skipped).toEqual(["ir_Arris_test.cpp:rawData_1"]);

    for (const fixture of fixtures) {
      const actual = await inferIr({ raw: fixture.raw, frequency: 38000 });
      const expected = nativeInfer(fixture.raw, 38000);
      expectSameJson(actual, expected, fixture.label);
    }

    expect(fixtures.length).toBe(185);
  });

  it("matches native C++ oracle through the HTTP API surface", async () => {
    const protocolResponse = await app.request("/api/protocols");
    expect(protocolResponse.status).toBe(200);
    await expect(protocolResponse.json()).resolves.toEqual(native("protocols", []));

    const classSurfaceResponse = await app.request("/api/class-surface");
    expect(classSurfaceResponse.status).toBe(200);
    await expect(classSurfaceResponse.json()).resolves.toEqual(protocolClassSurface());

    const classRawSurfaceResponse = await app.request("/api/class-raw-surface");
    expect(classRawSurfaceResponse.status).toBe(200);
    await expect(classRawSurfaceResponse.json()).resolves.toEqual(protocolClassRawSurface());

    const classMethodSurfaceResponse = await app.request("/api/class-method-surface");
    expect(classMethodSurfaceResponse.status).toBe(200);
    await expect(classMethodSurfaceResponse.json()).resolves.toEqual(protocolClassMethodSurface());

    const classStaticSurfaceResponse = await app.request("/api/class-static-surface");
    expect(classStaticSurfaceResponse.status).toBe(200);
    await expect(classStaticSurfaceResponse.json()).resolves.toEqual(protocolClassStaticSurface());

    const classCommonSurfaceResponse = await app.request("/api/class-common-surface");
    expect(classCommonSurfaceResponse.status).toBe(200);
    await expect(classCommonSurfaceResponse.json()).resolves.toEqual(protocolClassCommonSurface());

    const classStringSurfaceResponse = await app.request("/api/class-string-surface");
    expect(classStringSurfaceResponse.status).toBe(200);
    await expect(classStringSurfaceResponse.json()).resolves.toEqual(protocolClassStringSurface());

    const classFromCommonSurfaceResponse = await app.request("/api/class-from-common-surface");
    expect(classFromCommonSurfaceResponse.status).toBe(200);
    await expect(classFromCommonSurfaceResponse.json()).resolves.toEqual(protocolClassFromCommonSurface());

    const generateRequest = {
      kind: "value" as const,
      protocol: "NEC",
      data: "0x20DF10EF",
      bits: 32,
      repeat: 0,
    };
    const generated = await apiPost("/api/generate", generateRequest);
    expect(generated.status).toBe(200);
    expectSameJson(
      generated.json,
      native("value", [generateRequest.protocol, generateRequest.data, generateRequest.bits, generateRequest.repeat]),
      "HTTP value generation",
    );
    const rpcGenerated = await apiPost("/api/call", { op: "generate", payload: generateRequest });
    expect(rpcGenerated.status).toBe(200);
    expectSameJson(rpcGenerated.json, generated.json, "HTTP RPC value generation");

    const classCommonRequest = {
      kind: "classCommon" as const,
      className: "IRAirtonAc",
      data: "0x11D30000000000",
    };
    const classCommon = await apiPost("/api/generate", classCommonRequest);
    expect(classCommon.status).toBe(200);
    expectSameJson(
      classCommon.json,
      native("class-common", [classCommonRequest.className, "", classCommonRequest.data]),
      "HTTP protocol class common-state conversion",
    );

    const inheritedClassCommonRequest = {
      kind: "classCommon" as const,
      className: "IRHaierACYRW02",
      state: HAIER_YRW02_STATE,
    };
    const inheritedClassCommon = await apiPost("/api/generate", inheritedClassCommonRequest);
    expect(inheritedClassCommon.status).toBe(200);
    expectSameJson(
      inheritedClassCommon.json,
      native("class-common", [inheritedClassCommonRequest.className, HAIER_YRW02_STATE.join(","), 0]),
      "HTTP inherited protocol class common-state conversion",
    );

    const classStringRequest = {
      kind: "classString" as const,
      className: "IRAirtonAc",
      data: "0x11D30000000000",
    };
    const classString = await apiPost("/api/generate", classStringRequest);
    expect(classString.status).toBe(200);
    expectSameJson(
      classString.json,
      native("class-string", [classStringRequest.className, "", classStringRequest.data]),
      "HTTP protocol class string conversion",
    );

    const inheritedClassStringRequest = {
      kind: "classString" as const,
      className: "IRHaierACYRW02",
      state: HAIER_YRW02_STATE,
    };
    const inheritedClassString = await apiPost("/api/generate", inheritedClassStringRequest);
    expect(inheritedClassString.status).toBe(200);
    expectSameJson(
      inheritedClassString.json,
      native("class-string", [inheritedClassStringRequest.className, HAIER_YRW02_STATE.join(","), 0]),
      "HTTP inherited protocol class string conversion",
    );

    const classFromCommonRequest = {
      kind: "classFromCommon" as const,
      className: "IRMirageAc",
      model: 1,
      power: true,
      mode: "cool" as const,
      degrees: 25,
      celsius: true,
      fan: "auto" as const,
      light: true,
      beep: true,
      repeat: 0,
    };
    const classFromCommon = await apiPost("/api/generate", classFromCommonRequest);
    expect(classFromCommon.status).toBe(200);
    expectSameJson(
      classFromCommon.json,
      native("class-from-common", ["IRMirageAc", 1, "true", "cool", 25, 1, "auto", 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, -1, 0, -1, 0]),
      "HTTP protocol class fromCommon conversion",
    );

    const inferred = await apiPost("/api/infer", {
      raw: generated.json.raw,
      frequency: generated.json.frequency,
    });
    expect(inferred.status).toBe(200);
    expectSameJson(
      inferred.json,
      nativeInfer(generated.json.raw, generated.json.frequency),
      "HTTP inference",
    );
    const rpcInferred = await apiPost("/api/call", {
      op: "infer",
      payload: { raw: generated.json.raw, frequency: generated.json.frequency },
    });
    expect(rpcInferred.status).toBe(200);
    expectSameJson(rpcInferred.json, inferred.json, "HTTP RPC inference");
  });

  it("serves the StackChan-style remote dashboard with raw log output", async () => {
    const response = await app.request("/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("<title>StackChan IR Remote</title>");
    expect(html).toContain("受光中");
    expect(html).toContain("検知済み");
    expect(html).toContain("現在値を生成");
    expect(html).toContain("生ログ表示");
    expect(html).toContain('id="payload"');
    expect(html).toContain('id="detected-list"');
    expect(html).toContain('id="mode-segments"');
    expect(html).toContain("body { margin: 0; min-height: 100vh; background: #f7f8f9; overflow-x: hidden; }");
    expect(html).toContain("details.log");
    expect(html).toContain("min-width: 0;");
    expect(html).toContain("@media (max-width: 560px)");
  });

  it("returns explicit JSON errors for unsupported HTTP generation input", async () => {
    const response = await apiPost("/api/generate", {
      kind: "method",
      method: "sendDefinitelyUnsupported",
      args: [],
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "unsupported IRsend method" });

    const unsupportedKind = await apiPost("/api/generate", {
      kind: "pretend",
      protocol: "NEC",
    });

    expect(unsupportedKind.status).toBe(400);
    expect(unsupportedKind.json).toEqual({ error: "unsupported generation kind: pretend" });
  });

  it("returns explicit JSON errors for invalid HTTP inference input", async () => {
    const response = await apiPost("/api/infer", {
      protocol: "NEC",
      data: "0x20DF10EF",
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({ error: "raw must be an array of pulse durations" });
  });

  it("does not pretend protocol class setter/getter generation is exposed", async () => {
    const response = await apiPost("/api/generate", {
      kind: "class",
      className: "IRAirtonAc",
      data: "0x11D30000000000",
      method: "setHumidity",
      args: [50],
    });

    expect(response.status).toBe(400);
    expect(response.json).toEqual({
      error: "unsupported protocol class scalar method",
    });
  });
});
