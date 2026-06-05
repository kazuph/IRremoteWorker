import { fileURLToPath } from "node:url";
import { protocolClassSurface } from "./protocol-class-surface.mjs";

export function protocolClassFromCommonSurface(root = ".") {
  const classSurface = protocolClassSurface(root);
  const classes = [];
  const excluded = [];

  for (const file of classSurface.files) {
    for (const klass of file.classes) {
      const method = klass.methods.find(
        (candidate) =>
          !candidate.isStatic &&
          candidate.name === "fromCommon" &&
          candidate.returnType === "void" &&
          candidate.parameters.length === 1 &&
          candidate.parameters[0].type === "const stdAc::state_t",
      );
      if (!method) continue;
      if (klass.className !== "IRMirageAc") {
        excluded.push({ file: file.name, className: klass.className, reason: "fromCommon bridge not implemented for this class" });
        continue;
      }
      classes.push({ file: file.name, className: klass.className, rawType: "bytes", method });
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
  process.stdout.write(`${JSON.stringify(protocolClassFromCommonSurface(root), null, 2)}\n`);
}
