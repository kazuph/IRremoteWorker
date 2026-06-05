import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { protocolClassRawSurface } from "./protocol-class-raw-surface.mjs";
import { protocolClassSurface } from "./protocol-class-surface.mjs";

function setElementType(type) {
  const normalized = type.replace(/\bconst\b/g, "").replace(/[&]/g, "").trim();
  const match = normalized.match(/^std::set<\s*([A-Za-z_][A-Za-z0-9_:]*)\s*>$/);
  return match?.[1] ?? null;
}

function unsupportedType(type) {
  if (setElementType(type)) return false;
  return /String|\bstd::|stdAc::state_t|[&*]|\[|\bptr\b/i.test(type);
}

function scalarType(type) {
  return type.replace(/\bconst\b/g, "").replace(/[&]/g, "").trim();
}

function paramMetadata(param) {
  const elementType = setElementType(param.type);
  if (elementType) return { ...param, scalarType: scalarType(param.type), source: "argsSet", setElementType: elementType };
  return { ...param, scalarType: scalarType(param.type), source: "args" };
}

function isSupportedReturn(method) {
  if (method.returnType === "void") return true;
  return !unsupportedType(method.returnType);
}

function isSupportedParams(method) {
  return method.parameters.every((param) => param.name && !unsupportedType(param.type));
}

export function protocolClassMethodSurface(root = ".") {
  const rawSurface = protocolClassRawSurface(root);
  const rawClasses = new Set(rawSurface.classes.map((entry) => entry.className));
  const classSurface = protocolClassSurface(root);
  const classes = [];
  const excluded = [];

  for (const file of classSurface.files) {
    for (const klass of file.classes) {
      if (!rawClasses.has(klass.className)) continue;
      const raw = rawSurface.classes.find((entry) => entry.className === klass.className);
      const implementation = readFileSync(join(root, "src", file.name.replace(/\.h$/, ".cpp")), "utf8");
      const methods = [];
      for (const method of klass.methods) {
        if (method.isStatic || !["setter", "getter"].includes(method.kind) || /Raw$/.test(method.name)) {
          excluded.push({ file: file.name, className: klass.className, method: method.name, reason: "not a generated instance setter/getter target" });
          continue;
        }
        if (!isSupportedReturn(method) || !isSupportedParams(method)) {
          excluded.push({ file: file.name, className: klass.className, method: method.name, reason: "unsupported pointer, array, String, or stdAc state signature" });
          continue;
        }
        if (new RegExp(`\\binline\\s+[^\\n;{}]*${klass.className}::\\s*${method.name}\\s*\\(`).test(implementation)) {
          excluded.push({ file: file.name, className: klass.className, method: method.name, reason: "inline implementation is not linkable from the generated bridge" });
          continue;
        }
        if (!method.hasInlineBody && !new RegExp(`${klass.className}::\\s*${method.name}\\s*\\(`).test(implementation)) {
          excluded.push({ file: file.name, className: klass.className, method: method.name, reason: "missing linkable Class::method implementation" });
          continue;
        }
        methods.push({
          ...method,
          parameters: method.parameters.map(paramMetadata),
          scalarReturnType: scalarType(method.returnType),
          resultKind: setElementType(method.returnType) ? "set" : "scalar",
          setElementType: setElementType(method.returnType),
        });
      }
      if (methods.length > 0) classes.push({
        file: file.name,
        className: klass.className,
        rawType: raw.rawType,
        setRawLengthArg: raw.setRawLengthArg,
        stateLengthExpression: raw.stateLengthExpression,
        rawLengthMethod: raw.rawLengthMethod,
        methods,
      });
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
  process.stdout.write(`${JSON.stringify(protocolClassMethodSurface(root), null, 2)}\n`);
}
