import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { protocolClassRawSurface } from "./protocol-class-raw-surface.mjs";

const CLASS_WITH_PARENT_RE = /class\s+(IR[A-Za-z0-9_]+)(?:\s*:\s*public\s+(IR[A-Za-z0-9_]+)[^{]*)?\s*\{([\s\S]*?)(?:\n\};)/g;
const TOSTRING_RE = /String\s+toString\s*\(([^;{}]*)\)\s*(const\s*)?(?:override\s*)?(?:;|\{)/;

export function protocolClassStringSurface(root = ".") {
  const rawSurface = protocolClassRawSurface(root);
  const classes = [];
  const excluded = [];

  for (const raw of rawSurface.classes) {
    const source = readFileSync(join(root, "src", raw.file), "utf8");
    const implementation = readFileSync(join(root, "src", raw.file.replace(/\.h$/, ".cpp")), "utf8");
    const declarations = [];
    let match;
    while ((match = CLASS_WITH_PARENT_RE.exec(source))) {
      declarations.push({ className: match[1], parentName: match[2] ?? null, body: match[3] });
    }
    const byClass = new Map(declarations.map((entry) => [entry.className, entry]));
    const findToString = (className) => {
      const current = byClass.get(className);
      if (!current) return null;
      const signature = current.body.match(TOSTRING_RE);
      if (signature) return { signature, ownerClassName: className };
      return current.parentName ? findToString(current.parentName) : null;
    };
    const result = findToString(raw.className);
    if (!result) {
      excluded.push({ file: raw.file, className: raw.className, reason: "missing public String toString() declaration" });
      continue;
    }
    if (!new RegExp(`${result.ownerClassName}::toString\\s*\\(`).test(implementation)) {
      excluded.push({ file: raw.file, className: raw.className, reason: "missing linkable Class::toString implementation" });
      continue;
    }
    classes.push({
      file: raw.file,
      className: raw.className,
      rawType: raw.rawType,
      setRawLengthArg: raw.setRawLengthArg,
      stateLengthExpression: raw.stateLengthExpression,
      rawLengthMethod: raw.rawLengthMethod,
      inheritedFrom: result.ownerClassName === raw.className ? null : result.ownerClassName,
      method: {
        name: "toString",
        returnType: "String",
        parameters: result.signature[1].trim() ? result.signature[1].trim() : "",
        isConst: Boolean(result.signature[2]),
        signature: `String toString(${result.signature[1].trim() || "void"})${result.signature[2] ? " const" : ""}`,
      },
    });
  }

  return {
    classes,
    classCount: classes.length,
    totalMethods: classes.length,
    excluded,
    excludedCount: excluded.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? ".";
  process.stdout.write(`${JSON.stringify(protocolClassStringSurface(root), null, 2)}\n`);
}
