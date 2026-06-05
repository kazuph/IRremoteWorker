import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { protocolClassCommonSurface } from "./protocol-class-common-surface.mjs";
import { protocolClassFromCommonSurface } from "./protocol-class-from-common-surface.mjs";
import { protocolClassMethodSurface } from "./protocol-class-method-surface.mjs";
import { protocolClassRawSurface } from "./protocol-class-raw-surface.mjs";
import { protocolClassStaticSurface } from "./protocol-class-static-surface.mjs";
import { protocolClassStringSurface } from "./protocol-class-string-surface.mjs";
import { protocolClassSurface } from "./protocol-class-surface.mjs";

const HAIER_YRW02_STATE = [0xA6, 0xE1, 0x00, 0x00, 0x40, 0x20, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x07, 0x6E];

function native(command, args) {
  const output = execFileSync("worker/oracle/ir_native_oracle", [command, ...args.map(String)], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryJson(label, action, maxAttempts) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await sleep(250 * attempt);
    }
  }
  throw new Error(`${label} failed after ${maxAttempts} attempts: ${lastError.message}`);
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function getText(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  return text;
}

async function postJson(baseUrl, path, body, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

function expectEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label} differed from native oracle\nactual=${actualJson}\nexpected=${expectedJson}`);
  }
}

function expectIncludes(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`${label} did not include ${JSON.stringify(expected)}`);
  }
}

function expectDecodeFields(actual, expected, label) {
  for (const key of ["decodeType", "decode_type", "bits", "value", "valueHex", "value_hex", "address", "command", "repeat", "rawlen", "rawLength", "raw_length"]) {
    if (actual[key] !== expected[key]) {
      throw new Error(`${label} ${key} differed from native oracle: actual=${actual[key]} expected=${expected[key]}`);
    }
  }
  if (actual.decodeType !== actual.decode_type) {
    throw new Error(`${label} decodeType/decode_type aliases diverged`);
  }
  if (actual.valueHex !== actual.value_hex) {
    throw new Error(`${label} valueHex/value_hex aliases diverged`);
  }
  if (actual.rawLength !== actual.raw_length) {
    throw new Error(`${label} rawLength/raw_length aliases diverged`);
  }
  if (JSON.stringify(actual.state) !== JSON.stringify(expected.state)) {
    throw new Error(`${label} state differed from native oracle`);
  }
}

function climaButlerFixture() {
  const source = readFileSync("test/ir_ClimaButler_test.cpp", "utf8");
  const match = source.match(/uint16_t\s+rawData\s*\[[^\]]+\]\s*=\s*\{([\s\S]*?)\};/);
  if (!match) throw new Error("ClimaButler rawData fixture not found");
  return match[1]
    .replace(/\/\/.*$/gm, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
}

export async function verifyHttpOracle({ baseUrl, label, maxAttempts = 6 }) {
  const checkLabel = label || baseUrl;
  const dashboard = await retryJson(`${checkLabel} dashboard`, () => getText(baseUrl, "/"), maxAttempts);
  for (const marker of [
    "<title>StackChan IR Remote</title>",
    "受光中",
    "検知済み",
    "現在値を生成",
    "接続確認",
    "生ログ表示",
    'id="payload"',
    'id="detected-list"',
    'id="mode-segments"',
  ]) {
    expectIncludes(dashboard, marker, `${checkLabel} dashboard`);
  }

  const protocols = await retryJson(`${checkLabel} /api/protocols`, () => getJson(baseUrl, "/api/protocols"), maxAttempts);
  expectEqual(protocols, native("protocols", []), `${checkLabel} /api/protocols`);

  const classSurface = await retryJson(`${checkLabel} /api/class-surface`, () => getJson(baseUrl, "/api/class-surface"), maxAttempts);
  expectEqual(classSurface, protocolClassSurface(), `${checkLabel} /api/class-surface`);

  const classRawSurface = await retryJson(`${checkLabel} /api/class-raw-surface`, () => getJson(baseUrl, "/api/class-raw-surface"), maxAttempts);
  expectEqual(classRawSurface, protocolClassRawSurface(), `${checkLabel} /api/class-raw-surface`);

  const classMethodSurface = await retryJson(`${checkLabel} /api/class-method-surface`, () => getJson(baseUrl, "/api/class-method-surface"), maxAttempts);
  expectEqual(classMethodSurface, protocolClassMethodSurface(), `${checkLabel} /api/class-method-surface`);

  const classStaticSurface = await retryJson(`${checkLabel} /api/class-static-surface`, () => getJson(baseUrl, "/api/class-static-surface"), maxAttempts);
  expectEqual(classStaticSurface, protocolClassStaticSurface(), `${checkLabel} /api/class-static-surface`);

  const classCommonSurface = await retryJson(`${checkLabel} /api/class-common-surface`, () => getJson(baseUrl, "/api/class-common-surface"), maxAttempts);
  expectEqual(classCommonSurface, protocolClassCommonSurface(), `${checkLabel} /api/class-common-surface`);

  const classStringSurface = await retryJson(`${checkLabel} /api/class-string-surface`, () => getJson(baseUrl, "/api/class-string-surface"), maxAttempts);
  expectEqual(classStringSurface, protocolClassStringSurface(), `${checkLabel} /api/class-string-surface`);

  const classFromCommonSurface = await retryJson(`${checkLabel} /api/class-from-common-surface`, () => getJson(baseUrl, "/api/class-from-common-surface"), maxAttempts);
  expectEqual(classFromCommonSurface, protocolClassFromCommonSurface(), `${checkLabel} /api/class-from-common-surface`);

  const valueRequest = { kind: "value", protocol: "NEC", data: "0x20DF10EF", bits: 32, repeat: 0 };
  const generated = await retryJson(
    `${checkLabel} value generation`,
    () => postJson(baseUrl, "/api/generate", valueRequest),
    maxAttempts,
  );
  expectEqual(
    generated,
    native("value", [valueRequest.protocol, valueRequest.data, valueRequest.bits, valueRequest.repeat]),
    `${checkLabel} value generation`,
  );

  const inferred = await retryJson(
    `${checkLabel} generated inference`,
    () => postJson(baseUrl, "/api/infer", { raw: generated.raw, frequency: generated.frequency }),
    maxAttempts,
  );
  const nativeInferred = native("infer", [generated.raw.join(","), generated.frequency]);
  expectEqual(inferred, nativeInferred, `${checkLabel} generated inference`);
  expectDecodeFields(inferred, nativeInferred, `${checkLabel} generated inference`);

  const defaultMethodGenerated = await retryJson(
    `${checkLabel} default-argument method generation`,
    () => postJson(baseUrl, "/api/generate", { kind: "method", method: "sendSony", args: ["0x1"] }),
    maxAttempts,
  );
  expectEqual(
    defaultMethodGenerated,
    native("method", ["sendSony", "0x1"]),
    `${checkLabel} default-argument method generation`,
  );

  const defaultEncodeGenerated = await retryJson(
    `${checkLabel} default-argument encode generation`,
    () => postJson(baseUrl, "/api/generate", { kind: "encode", method: "encodeSharp", args: [0x1, 0x2] }),
    maxAttempts,
  );
  expectEqual(
    defaultEncodeGenerated,
    native("encode", ["encodeSharp", "1,2"]),
    `${checkLabel} default-argument encode generation`,
  );

  const classOnlyGenerated = await retryJson(
    `${checkLabel} class-only method generation`,
    () => postJson(baseUrl, "/api/generate", { kind: "method", method: "sendSamsungAcOn", args: [] }),
    maxAttempts,
  );
  expectEqual(
    classOnlyGenerated,
    native("method", ["sendSamsungAcOn", ""]),
    `${checkLabel} class-only method generation`,
  );

  const stateRequest = {
    kind: "state",
    protocol: "MITSUBISHI_HEAVY_152",
    state: [173, 81, 60, 200, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    nbytes: 19,
  };
  const stateGenerated = await retryJson(
    `${checkLabel} state generation`,
    () => postJson(baseUrl, "/api/generate", stateRequest),
    maxAttempts,
  );
  expectEqual(
    stateGenerated,
    native("state", [stateRequest.protocol, stateRequest.state.join(","), stateRequest.nbytes]),
    `${checkLabel} state generation`,
  );

  const defaultStateMethodGenerated = await retryJson(
    `${checkLabel} default-argument state method generation`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "method",
      method: "sendMitsubishiHeavy152",
      state: stateRequest.state,
    }),
    maxAttempts,
  );
  expectEqual(
    defaultStateMethodGenerated,
    native("method", ["sendMitsubishiHeavy152", `state:${stateRequest.state.join(",")}`]),
    `${checkLabel} default-argument state method generation`,
  );

  const stateInferred = await retryJson(
    `${checkLabel} state generated inference`,
    () => postJson(baseUrl, "/api/infer", { raw: stateGenerated.raw, frequency: stateGenerated.frequency }),
    maxAttempts,
  );
  expectEqual(
    stateInferred,
    native("infer", [stateGenerated.raw.join(","), stateGenerated.frequency]),
    `${checkLabel} state generated inference`,
  );
  expectDecodeFields(
    stateInferred,
    native("infer", [stateGenerated.raw.join(","), stateGenerated.frequency]),
    `${checkLabel} state generated inference`,
  );

  const rawRequest = { kind: "raw", raw: [9000, 4500, 560, 560, 560, 1690, 560, 560], frequency: 38000 };
  const rawGenerated = await retryJson(
    `${checkLabel} raw generation`,
    () => postJson(baseUrl, "/api/generate", rawRequest),
    maxAttempts,
  );
  expectEqual(rawGenerated, native("raw", [rawRequest.raw.join(","), rawRequest.frequency]), `${checkLabel} raw generation`);

  const acRequest = {
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
  };
  const acGenerated = await retryJson(
    `${checkLabel} Panasonic A/C generation`,
    () => postJson(baseUrl, "/api/generate", acRequest),
    maxAttempts,
  );
  expectEqual(
    acGenerated,
    native("ac-full", [
      acRequest.protocol,
      acRequest.model,
      acRequest.power ? 1 : 0,
      acRequest.mode,
      acRequest.degrees,
      acRequest.celsius ? 1 : 0,
      acRequest.fan,
      acRequest.swingv,
      acRequest.swingh,
      acRequest.quiet ? 1 : 0,
      acRequest.turbo ? 1 : 0,
      acRequest.econo ? 1 : 0,
      acRequest.light ? 1 : 0,
      acRequest.filter ? 1 : 0,
      acRequest.clean ? 1 : 0,
      acRequest.beep ? 1 : 0,
      acRequest.sleep,
      acRequest.clock,
    ]),
    `${checkLabel} Panasonic A/C generation`,
  );

  const acFrequency = acGenerated.frequency ?? 38000;
  const acInferred = await retryJson(
    `${checkLabel} Panasonic A/C generated inference`,
    () => postJson(baseUrl, "/api/infer", { raw: acGenerated.raw, frequency: acFrequency }),
    maxAttempts,
  );
  expectEqual(
    acInferred,
    native("infer", [acGenerated.raw.join(","), acFrequency]),
    `${checkLabel} Panasonic A/C generated inference`,
  );
  expectDecodeFields(
    acInferred,
    native("infer", [acGenerated.raw.join(","), acFrequency]),
    `${checkLabel} Panasonic A/C generated inference`,
  );
  if (
    acInferred.protocol !== "PANASONIC_AC" ||
    acInferred.manufacturer !== "PANASONIC" ||
    acInferred.model !== 4 ||
    acInferred.modelName !== "JKE" ||
    acInferred.ac?.mode !== "Cool" ||
    acInferred.ac?.degrees !== 26 ||
    acInferred.ac?.fan !== "Auto"
  ) {
    throw new Error(`${checkLabel} Panasonic A/C state fields were missing or incorrect: ${JSON.stringify(acInferred)}`);
  }

  const multibracketsRaw = [20100, 20472, 15092, 30704, 20102, 20472, 15086];
  const multibracketsInferred = await retryJson(
    `${checkLabel} Multibrackets non-A/C inference`,
    () => postJson(baseUrl, "/api/infer", { raw: multibracketsRaw, frequency: 38000 }),
    maxAttempts,
  );
  expectEqual(
    multibracketsInferred,
    native("infer", [multibracketsRaw.join(","), 38000]),
    `${checkLabel} Multibrackets non-A/C inference`,
  );
  expectDecodeFields(
    multibracketsInferred,
    native("infer", [multibracketsRaw.join(","), 38000]),
    `${checkLabel} Multibrackets non-A/C inference`,
  );
  if (
    multibracketsInferred.protocol !== "MULTIBRACKETS" ||
    multibracketsInferred.manufacturer !== null ||
    multibracketsInferred.model !== null ||
    multibracketsInferred.modelName !== null ||
    multibracketsInferred.ac !== null
  ) {
    throw new Error(
      `${checkLabel} Multibrackets non-A/C fields were incorrectly promoted: ${JSON.stringify(multibracketsInferred)}`,
    );
  }

  const climaRaw = climaButlerFixture();
  const climaInferred = await retryJson(
    `${checkLabel} ClimaButler fixture inference`,
    () => postJson(baseUrl, "/api/infer", { raw: climaRaw, frequency: 38000 }),
    maxAttempts,
  );
  expectEqual(climaInferred, native("infer", [climaRaw.join(","), 38000]), `${checkLabel} ClimaButler fixture inference`);
  expectDecodeFields(
    climaInferred,
    native("infer", [climaRaw.join(","), 38000]),
    `${checkLabel} ClimaButler fixture inference`,
  );

  const panasonicClassState = [
    0x02, 0x20, 0xe0, 0x04, 0x00, 0x00, 0x00, 0x06, 0x02,
    0x20, 0xe0, 0x04, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00,
    0x00, 0x0e, 0xe0, 0x00, 0x00, 0x81, 0x00, 0x00, 0x00,
  ];
  const panasonicClass = await retryJson(
    `${checkLabel} protocol class raw generation`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "class",
      className: "IRPanasonicAc",
      state: panasonicClassState,
      repeat: 0,
    }),
    maxAttempts,
  );
  expectEqual(
    panasonicClass,
    native("class", ["IRPanasonicAc", panasonicClassState.join(","), 0, 0]),
    `${checkLabel} protocol class raw generation`,
  );

  const fujitsuClassState = [0x14, 0x63, 0x00, 0x10, 0x10, 0xFE, 0x09, 0x30, 0x81, 0x01, 0x31, 0x00, 0x00, 0x00, 0x20, 0xFD];
  const fujitsuClass = await retryJson(
    `${checkLabel} Fujitsu protocol class raw generation`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "class",
      className: "IRFujitsuAC",
      state: fujitsuClassState,
      repeat: 0,
    }),
    maxAttempts,
  );
  expectEqual(
    fujitsuClass,
    native("class", ["IRFujitsuAC", fujitsuClassState.join(","), 0, 0]),
    `${checkLabel} Fujitsu protocol class raw generation`,
  );

  const airtonClassMethod = await retryJson(
    `${checkLabel} protocol class scalar method`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "class",
      className: "IRAirtonAc",
      data: "0x11D30000000000",
      method: "setPower",
      args: [true],
    }),
    maxAttempts,
  );
  expectEqual(
    airtonClassMethod,
    native("class-method", ["IRAirtonAc", "", "0x11D30000000000", "setPower", "1"]),
    `${checkLabel} protocol class scalar method`,
  );

  const airtonClassStatic = await retryJson(
    `${checkLabel} protocol class static method`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "classStatic",
      className: "IRAirtonAc",
      method: "toCommonMode",
      args: [1],
    }),
    maxAttempts,
  );
  expectEqual(
    airtonClassStatic,
    native("class-static", ["IRAirtonAc", "", "toCommonMode", "1"]),
    `${checkLabel} protocol class static method`,
  );

  const airtonClassCommon = await retryJson(
    `${checkLabel} protocol class common-state conversion`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "classCommon",
      className: "IRAirtonAc",
      data: "0x11D30000000000",
    }),
    maxAttempts,
  );
  expectEqual(
    airtonClassCommon,
    native("class-common", ["IRAirtonAc", "", "0x11D30000000000"]),
    `${checkLabel} protocol class common-state conversion`,
  );

  const inheritedClassCommon = await retryJson(
    `${checkLabel} inherited protocol class common-state conversion`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "classCommon",
      className: "IRHaierACYRW02",
      state: HAIER_YRW02_STATE,
    }),
    maxAttempts,
  );
  expectEqual(
    inheritedClassCommon,
    native("class-common", ["IRHaierACYRW02", HAIER_YRW02_STATE.join(","), 0]),
    `${checkLabel} inherited protocol class common-state conversion`,
  );

  const airtonClassString = await retryJson(
    `${checkLabel} protocol class string conversion`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "classString",
      className: "IRAirtonAc",
      data: "0x11D30000000000",
    }),
    maxAttempts,
  );
  expectEqual(
    airtonClassString,
    native("class-string", ["IRAirtonAc", "", "0x11D30000000000"]),
    `${checkLabel} protocol class string conversion`,
  );

  const inheritedClassString = await retryJson(
    `${checkLabel} inherited protocol class string conversion`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "classString",
      className: "IRHaierACYRW02",
      state: HAIER_YRW02_STATE,
    }),
    maxAttempts,
  );
  expectEqual(
    inheritedClassString,
    native("class-string", ["IRHaierACYRW02", HAIER_YRW02_STATE.join(","), 0]),
    `${checkLabel} inherited protocol class string conversion`,
  );

  const mirageFromCommon = await retryJson(
    `${checkLabel} protocol class fromCommon conversion`,
    () => postJson(baseUrl, "/api/generate", {
      kind: "classFromCommon",
      className: "IRMirageAc",
      model: 1,
      power: true,
      mode: "cool",
      degrees: 25,
      celsius: true,
      fan: "auto",
      light: true,
      beep: true,
      repeat: 0,
    }),
    maxAttempts,
  );
  expectEqual(
    mirageFromCommon,
    native("class-from-common", ["IRMirageAc", 1, "true", "cool", 25, 1, "auto", 0, 0, 0, 0, 0, 1, 0, 0, 1, -1, -1, 0, -1, 0]),
    `${checkLabel} protocol class fromCommon conversion`,
  );

  const unsupported = await retryJson(
    `${checkLabel} unsupported method error`,
    () => postJson(baseUrl, "/api/generate", { kind: "method", method: "sendDefinitelyUnsupported", args: [] }, 400),
    maxAttempts,
  );
  expectEqual(unsupported, { error: "unsupported IRsend method" }, `${checkLabel} unsupported method error`);

  const unsupportedKind = await retryJson(
    `${checkLabel} unsupported generation kind error`,
    () => postJson(baseUrl, "/api/generate", { kind: "pretend", protocol: "NEC" }, 400),
    maxAttempts,
  );
  expectEqual(
    unsupportedKind,
    { error: "unsupported generation kind: pretend" },
    `${checkLabel} unsupported generation kind error`,
  );

  const invalidInfer = await retryJson(
    `${checkLabel} invalid inference input error`,
    () => postJson(baseUrl, "/api/infer", { protocol: "NEC", data: "0x20DF10EF" }, 400),
    maxAttempts,
  );
  expectEqual(
    invalidInfer,
    { error: "raw must be an array of pulse durations" },
    `${checkLabel} invalid inference input error`,
  );

  const unsupportedClass = await retryJson(
    `${checkLabel} unsupported protocol class error`,
    () =>
      postJson(
        baseUrl,
        "/api/generate",
        { kind: "class", className: "IRAirtonAc", data: "0x11D30000000000", method: "setHumidity", args: [50] },
        400,
      ),
    maxAttempts,
  );
  expectEqual(
    unsupportedClass,
    { error: "unsupported protocol class scalar method" },
    `${checkLabel} unsupported protocol class error`,
  );

  return {
    ok: true,
    baseUrl,
    dashboard: "StackChan-style remote UI with raw log",
    protocolCount: protocols.protocols.length,
    classSurfaceClasses: classSurface.totalClasses,
    classSurfaceMethods: classSurface.totalMethods,
    classRawSurfaceClasses: classRawSurface.classCount,
    classMethodSurfaceMethods: classMethodSurface.totalMethods,
    classStaticSurfaceMethods: classStaticSurface.totalMethods,
    classCommonSurfaceMethods: classCommonSurface.totalMethods,
    classStringSurfaceMethods: classStringSurface.totalMethods,
    classFromCommonSurfaceMethods: classFromCommonSurface.totalMethods,
    protocolClassRaw: panasonicClass.className,
    protocolClassRawFujitsu: fujitsuClass.className,
    protocolClassMethod: airtonClassMethod.method,
    protocolClassStatic: airtonClassStatic.method,
    protocolClassCommon: airtonClassCommon.className,
    protocolClassString: airtonClassString.className,
    protocolClassFromCommon: mirageFromCommon.className,
    generatedProtocol: generated.protocol,
    inferredProtocol: inferred.protocol,
    defaultMethod: defaultMethodGenerated.method,
    defaultEncode: defaultEncodeGenerated.method,
    classOnlyMethod: classOnlyGenerated.method,
    defaultStateMethod: defaultStateMethodGenerated.method,
    stateGeneratedProtocol: stateGenerated.protocol,
    stateInferredProtocol: stateInferred.protocol,
    acGeneratedProtocol: acGenerated.protocol,
    acInferredProtocol: acInferred.protocol,
    acMode: acInferred.ac.mode,
    acDegrees: acInferred.ac.degrees,
    multibracketsManufacturer: multibracketsInferred.manufacturer,
    rawLength: rawGenerated.raw.length,
    climaButlerProtocol: climaInferred.protocol,
    unsupportedStatus: 400,
    unsupportedKindStatus: 400,
    invalidInferStatus: 400,
    unsupportedClassStatus: 400,
  };
}
