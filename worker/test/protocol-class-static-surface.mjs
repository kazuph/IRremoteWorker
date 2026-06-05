import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { protocolClassSurface } from "./protocol-class-surface.mjs";

function rawStructType(type, source) {
  const match = type.match(/^const\s+([A-Za-z_][A-Za-z0-9_]*)\s*&$/);
  if (!match) return null;
  const structType = match[1];
  return new RegExp(`(?:union|struct)\\s+${structType}\\s*\\{[\\s\\S]*?uint8_t\\s+raw\\s*\\[`).test(source) ? structType : null;
}

function unsupportedType(type) {
  return /String|stdAc::state_t|&|\bptr\b/i.test(type);
}

function scalarType(type) {
  return type.replace(/\bconst\b/g, "").replace(/[&*]/g, "").replace(/\[[^\]]*\]/g, "").trim();
}

function isStateParam(param) {
  return /^const\s+uint8_t\s*(?:\*|\[[^\]]*\])$/.test(param.type);
}

function isSupportedParam(param, source) {
  return isStateParam(param) || rawStructType(param.type, source) || !unsupportedType(param.type);
}

function isSupportedMethod(method, source) {
  return !unsupportedType(method.returnType) &&
    method.parameters.every((param) => param.name && isSupportedParam(param, source));
}

function enrichMethod(method, source, extra = {}) {
  return {
    ...method,
    ...extra,
    parameters: method.parameters.map((param) => ({
      ...param,
      scalarType: scalarType(param.type),
      source: isStateParam(param) ? "state" : rawStructType(param.type, source) ? "stateStruct" : "args",
      structType: rawStructType(param.type, source),
    })),
    scalarReturnType: scalarType(method.returnType),
  };
}

function directImplementation(implementation, className, methodName) {
  return new RegExp(`${className}::${methodName}\\s*\\(`).test(implementation);
}

function templateBaseImplementation(implementation, templateArg, methodName) {
  return new RegExp(`IRArgoACBase\\s*<\\s*${templateArg}\\s*>\\s*::${methodName}\\s*\\(`).test(implementation);
}

function argoBaseTemplateArg(baseSpec) {
  return baseSpec?.match(/\bIRArgoACBase\s*<\s*([A-Za-z0-9_]+)\s*>/)?.[1] ?? null;
}

export function protocolClassStaticSurface(root = ".") {
  const classSurface = protocolClassSurface(root);
  const classes = [];
  const excluded = [];

  for (const file of classSurface.files) {
    const source = readFileSync(join(root, "src", file.name), "utf8");
    const implementation = readFileSync(join(root, "src", file.name.replace(/\.h$/, ".cpp")), "utf8");
    const templateBases = new Map(file.classes
      .filter((klass) => klass.className === "IRArgoACBase")
      .map((klass) => [klass.className, klass.methods.filter((method) => method.isStatic)]));
    for (const klass of file.classes) {
      if (klass.className === "IRArgoACBase") continue;
      const methods = [];
      for (const method of klass.methods) {
        if (!method.isStatic) continue;
        if (!isSupportedMethod(method, source)) {
          excluded.push({ file: file.name, className: klass.className, method: method.name, reason: "unsupported pointer, reference, array, String, or stdAc state signature" });
          continue;
        }
        if (!directImplementation(implementation, klass.className, method.name)) {
          excluded.push({ file: file.name, className: klass.className, method: method.name, reason: "missing linkable Class::method implementation" });
          continue;
        }
        methods.push(enrichMethod(method, source));
      }
      const argoTemplateArg = argoBaseTemplateArg(klass.baseSpec);
      if (argoTemplateArg) {
        for (const method of templateBases.get("IRArgoACBase") ?? []) {
          if (!isSupportedMethod(method, source)) continue;
          if (!templateBaseImplementation(implementation, argoTemplateArg, method.name)) continue;
          if (methods.some((entry) => entry.name === method.name && entry.signature === method.signature)) continue;
          methods.push(enrichMethod(method, source, { inheritedFrom: `IRArgoACBase<${argoTemplateArg}>` }));
        }
      }
      if (methods.length > 0) classes.push({ file: file.name, className: klass.className, methods });
    }
  }

  const totalMethods = classes.reduce((sum, klass) => sum + klass.methods.length, 0);
  return {
    classes,
    classCount: classes.length,
    totalMethods,
    excluded,
    excludedCount: excluded.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? ".";
  process.stdout.write(`${JSON.stringify(protocolClassStaticSurface(root), null, 2)}\n`);
}
