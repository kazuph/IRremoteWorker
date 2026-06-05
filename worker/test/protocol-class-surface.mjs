import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLASS_RE = /class\s+(IR[A-Za-z0-9_]+)(?:\s*:\s*([^{]+))?\s*\{([\s\S]*?)(?:\n\};)/g;
const METHOD_RE = /\n\s*(static\s+)?([A-Za-z0-9_:<>*&\s]+?)\s+((?:set|get|toCommon|fromCommon)[A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*(const\s*)?(?:override\s*)?(?:;|\{)/g;

function evalPreprocessorCondition(expr, directive) {
  const value = expr.trim();
  if (directive === "ifdef") return value !== "UNIT_TEST";
  if (directive === "ifndef") return value === "UNIT_TEST";
  if (value === "UNIT_TEST") return false;
  if (value === "!UNIT_TEST") return true;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  if (/^(SEND|DECODE)_/.test(value)) return true;
  if (value === "_IR_ENABLE_DEFAULT_") return true;
  return false;
}

function normalBuildBody(body) {
  const stack = [];
  const active = () => stack.every((entry) => entry.active);
  const lines = [];
  for (const line of body.split("\n")) {
    const ifdef = line.match(/^\s*#\s*ifdef\s+([A-Za-z0-9_]+)\b/);
    if (ifdef) {
      stack.push({ active: evalPreprocessorCondition(ifdef[1], "ifdef") });
      continue;
    }
    const ifndef = line.match(/^\s*#\s*ifndef\s+([A-Za-z0-9_]+)\b/);
    if (ifndef) {
      stack.push({ active: evalPreprocessorCondition(ifndef[1], "ifndef") });
      continue;
    }
    const ifDirective = line.match(/^\s*#\s*if\s+(.+?)\s*(?:\/\/.*)?$/);
    if (ifDirective) {
      stack.push({ active: evalPreprocessorCondition(ifDirective[1], "if") });
      continue;
    }
    if (/^\s*#\s*else\b/.test(line) && stack.length > 0) {
      const top = stack[stack.length - 1];
      top.active = !top.active;
      continue;
    }
    if (/^\s*#\s*endif\b/.test(line) && stack.length > 0) {
      stack.pop();
      continue;
    }
    if (active()) lines.push(line);
  }
  return lines.join("\n");
}

function publicSections(body) {
  const sections = [];
  let isPublic = false;
  let current = [];
  for (const line of normalBuildBody(body).split("\n")) {
    if (/^\s*public\s*:\s*$/.test(line)) {
      if (isPublic && current.length > 0) sections.push(current.join("\n"));
      isPublic = true;
      current = [];
      continue;
    }
    if (/^\s*(private|protected)\s*:\s*$/.test(line)) {
      if (isPublic && current.length > 0) sections.push(current.join("\n"));
      isPublic = false;
      current = [];
      continue;
    }
    if (isPublic) current.push(line);
  }
  if (isPublic && current.length > 0) sections.push(current.join("\n"));
  return sections.join("\n");
}

function splitParams(params) {
  const trimmed = params.trim();
  if (!trimmed || trimmed === "void") return [];
  const values = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < params.length; i++) {
    const ch = params[i];
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    if (ch === ">" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      values.push(params.slice(start, i).trim());
      start = i + 1;
    }
  }
  values.push(params.slice(start).trim());
  return values.filter(Boolean);
}

function parseParam(param) {
  const defaultIndex = param.indexOf("=");
  const withoutDefault = (defaultIndex >= 0 ? param.slice(0, defaultIndex) : param).trim();
  const defaultValue = defaultIndex >= 0 ? param.slice(defaultIndex + 1).trim() : null;
  const arrayMatch = withoutDefault.match(/^(.*?)([A-Za-z_][A-Za-z0-9_]*)\s*(\[[^\]]*\])$/);
  if (arrayMatch) {
    return {
      type: `${arrayMatch[1].trim()} ${arrayMatch[3]}`.replace(/\s+/g, " ").trim(),
      name: arrayMatch[2],
      defaultValue,
    };
  }
  const match = withoutDefault.match(/^(.*?)([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!match) return { type: withoutDefault, name: null, defaultValue };
  return {
    type: match[1].trim().replace(/\s+/g, " "),
    name: match[2],
    defaultValue,
  };
}

function methodKind(name) {
  if (name.startsWith("set")) return "setter";
  if (name.startsWith("get")) return "getter";
  if (name.startsWith("toCommon")) return "toCommon";
  if (name.startsWith("fromCommon")) return "fromCommon";
  return "other";
}

export function protocolClassSurface(root = ".") {
  const srcDir = join(root, "src");
  const files = readdirSync(srcDir)
    .filter((name) => /^ir_.*\.h$/.test(name))
    .sort()
    .map((name) => {
      const source = readFileSync(join(srcDir, name), "utf8");
      const classes = [];
      const methods = [];
      let classMatch;
      while ((classMatch = CLASS_RE.exec(source))) {
        const className = classMatch[1];
        const baseSpec = classMatch[2]?.trim().replace(/\s+/g, " ") ?? null;
        const body = publicSections(classMatch[3]);
        const classMethods = [];
        let methodMatch;
        while ((methodMatch = METHOD_RE.exec(body))) {
          const isStatic = Boolean(methodMatch[1]);
          const returnType = methodMatch[2].trim().replace(/\bvirtual\b/g, "").replace(/\s+/g, " ").trim();
          const methodName = methodMatch[3];
          const rawParams = methodMatch[4].trim();
          const isConst = Boolean(methodMatch[5]);
          const parameters = splitParams(rawParams).map(parseParam);
          const hasInlineBody = methodMatch[0].trimEnd().endsWith("{");
          const signature = `${isStatic ? "static " : ""}${returnType} ${methodName}(${rawParams})${isConst ? " const" : ""}`;
          methods.push(methodName);
          const entry = {
            name: methodName,
            kind: methodKind(methodName),
            returnType,
            parameters,
            isConst,
            isStatic,
            signature,
          };
          Object.defineProperty(entry, "hasInlineBody", {
            value: hasInlineBody,
            enumerable: false,
          });
          classMethods.push(entry);
        }
        if (classMethods.length > 0) classes.push({ className, baseSpec, methods: classMethods });
      }
      return { name, methods, classes };
    })
    .filter(({ methods }) => methods.length > 0);

  const totalMethods = files.reduce((sum, file) => sum + file.methods.length, 0);
  const totalClasses = files.reduce((sum, file) => sum + file.classes.length, 0);
  const topFiles = files
    .map((file) => ({ name: file.name, count: file.methods.length }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const kindCounts = files
    .flatMap((file) => file.classes)
    .flatMap((klass) => klass.methods)
    .reduce((counts, method) => {
      counts[method.kind] = (counts[method.kind] ?? 0) + 1;
      return counts;
    }, {});

  return {
    files,
    fileCount: files.length,
    totalClasses,
    totalMethods,
    kindCounts,
    topFiles,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? ".";
  process.stdout.write(`${JSON.stringify(protocolClassSurface(root), null, 2)}\n`);
}
