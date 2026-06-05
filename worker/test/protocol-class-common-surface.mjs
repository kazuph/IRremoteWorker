import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { protocolClassRawSurface } from "./protocol-class-raw-surface.mjs";
import { protocolClassSurface } from "./protocol-class-surface.mjs";

const CLASS_WITH_PARENT_RE = /class\s+(IR[A-Za-z0-9_]+)(?:\s*:\s*public\s+(IR[A-Za-z0-9_]+)[^{]*)?\s*\{([\s\S]*?)(?:\n\};)/g;

export function protocolClassCommonSurface(root = ".") {
  const rawSurface = protocolClassRawSurface(root);
  const rawByClass = new Map(rawSurface.classes.map((entry) => [entry.className, entry]));
  const classSurface = protocolClassSurface(root);
  const classes = [];
  const excluded = [];

  for (const file of classSurface.files) {
    const source = readFileSync(join(root, "src", file.name), "utf8");
    const declarations = [];
    let declaration;
    while ((declaration = CLASS_WITH_PARENT_RE.exec(source))) {
      declarations.push({ className: declaration[1], parentName: declaration[2] ?? null });
    }
    const classByName = new Map(file.classes.map((entry) => [entry.className, entry]));
    const declarationByName = new Map(declarations.map((entry) => [entry.className, entry]));
    const findToCommon = (className) => {
      const current = classByName.get(className);
      const method = current?.methods.find(
        (candidate) =>
          !candidate.isStatic &&
          candidate.name === "toCommon" &&
          candidate.returnType === "stdAc::state_t" &&
          candidate.parameters.every((param) => param.defaultValue || param.type === "void"),
      );
      if (method) return { method, ownerClassName: className };
      const parentName = declarationByName.get(className)?.parentName;
      return parentName ? findToCommon(parentName) : null;
    };
    for (const klass of file.classes) {
      const raw = rawByClass.get(klass.className);
      if (!raw) continue;
      const implementation = readFileSync(join(root, "src", file.name.replace(/\.h$/, ".cpp")), "utf8");
      const match = findToCommon(klass.className);
      if (!match) {
        excluded.push({ file: file.name, className: klass.className, reason: "missing public instance toCommon() returning stdAc::state_t" });
        continue;
      }
      if (!new RegExp(`${match.ownerClassName}::toCommon\\s*\\(`).test(implementation)) {
        excluded.push({ file: file.name, className: klass.className, reason: "missing linkable Class::toCommon implementation" });
        continue;
      }
      classes.push({
        file: file.name,
        className: klass.className,
        rawType: raw.rawType,
        setRawLengthArg: raw.setRawLengthArg,
        stateLengthExpression: raw.stateLengthExpression,
        rawLengthMethod: raw.rawLengthMethod,
        inheritedFrom: match.ownerClassName === klass.className ? null : match.ownerClassName,
        method: match.method,
      });
    }
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
  process.stdout.write(`${JSON.stringify(protocolClassCommonSurface(root), null, 2)}\n`);
}
