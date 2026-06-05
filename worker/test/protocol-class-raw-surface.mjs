import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLASS_WITH_PARENT_RE = /class\s+(IR[A-Za-z0-9_]+)(?:\s*:\s*public\s+(IR[A-Za-z0-9_]+)[^{]*)?\s*\{([\s\S]*?)(?:\n\};)/g;

function hasLinkableMethod(implementation, className, methodName) {
  return (
    new RegExp(`${className}::${methodName}\\s*\\(`).test(implementation) ||
    new RegExp(`${className}<[^>]+>::${methodName}\\s*\\(`).test(implementation)
  );
}

function irsendMethodForClass(implementation, className) {
  const methodName = `send${className.replace(/^IR/, "")}`;
  return new RegExp(`IRsend::${methodName}\\s*\\(`).test(implementation) ? methodName : null;
}

function rawArrayLengthExpression(source, className) {
  const classIndex = source.indexOf(`class ${className}`);
  const rawArrayPattern = /uint8_t\s+(?:raw|remote_state|longcode)\s*\[\s*([A-Za-z_][A-Za-z0-9_]*)\s*\]/g;
  if (classIndex > 0) {
    const before = source.slice(0, classIndex);
    const matches = [...before.matchAll(rawArrayPattern)];
    if (matches.length) return matches[matches.length - 1][1];
  }
  const after = classIndex >= 0 ? source.slice(classIndex) : source;
  return [...after.matchAll(rawArrayPattern)]?.[0]?.[1] ?? null;
}

function implementationStateLengthExpression(implementation, className) {
  const methodMatch = implementation.match(new RegExp(`${className}::\\s*(?:setRaw|send)\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!methodMatch) return null;
  return methodMatch[1].match(/\b(k[A-Za-z0-9_]*StateLength(?:Long|Short)?)\b/)?.[1] ?? null;
}

export function protocolClassRawSurface(root = ".") {
  const srcDir = join(root, "src");
  const classes = [];
  const excluded = [];

  for (const file of readdirSync(srcDir).filter((name) => /^ir_.*\.h$/.test(name)).sort()) {
    const source = readFileSync(join(srcDir, file), "utf8");
    const implementation = readFileSync(join(srcDir, file.replace(/\.h$/, ".cpp")), "utf8");
    const declarations = [];
    let match;
    while ((match = CLASS_WITH_PARENT_RE.exec(source))) {
      declarations.push({ className: match[1], parentName: match[2] ?? null, body: match[3] });
    }
    const byClass = new Map(declarations.map((entry) => [entry.className, entry]));
    const findMethod = (entry, pattern) => {
      const found = entry.body.match(pattern);
      if (found) return { ownerClassName: entry.className, match: found };
      if (entry.parentName && byClass.has(entry.parentName)) return findMethod(byClass.get(entry.parentName), pattern);
      return null;
    };

    for (const entry of declarations) {
      const className = entry.className;
      const body = entry.body;
      const hasConstructor = new RegExp(`explicit\\s+${className}\\s*\\(\\s*(?:const\\s+)?uint16_t\\s+pin`).test(body);
      const repeatSend = findMethod(entry, /void\s+send\s*\(\s*(?:const\s+)?uint16_t\s+repeat/);
      const byteGetter = findMethod(entry, /(?:uint8_t\s*\*|uint8_t\s+\*)\s*getRaw\s*\(/);
      const uint32Getter = findMethod(entry, /uint32_t\s+getRaw\s*\(/);
      const uint64Getter = findMethod(entry, /uint64_t\s+getRaw\s*\(/);
      const byteSetter = findMethod(entry, /(?:void|bool)\s+setRaw\s*\(\s*(?:const\s+)?uint8_t\s*(?:\*|[A-Za-z_][A-Za-z0-9_]*\s*\[)/);
      const byteSetterWithLength = findMethod(entry, /(?:void|bool)\s+setRaw\s*\([^)]*,\s*(?:const\s+)?uint16_t\s+length/);
      const byteSetterDefaultLength = findMethod(entry, /(?:void|bool)\s+setRaw\s*\([^)]*,\s*(?:const\s+)?uint16_t\s+length\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/);
      const checksumDefaultLength = findMethod(entry, /validChecksum\s*\([^)]*,\s*(?:const\s+)?uint16_t\s+length\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/);
      const implementationStateLength = implementationStateLengthExpression(implementation, className);
      const rawArrayLength = rawArrayLengthExpression(source, className);
      const rawLengthMethod = findMethod(entry, /(?:uint8_t|uint16_t)\s+(getRawByteLength|getStateLength)\s*\(\s*(?:void)?\s*\)\s*(?:const)?/);
      const uint32Setter = findMethod(entry, /void\s+setRaw\s*\(\s*(?:const\s+)?uint32_t/);
      const uint64Setter = findMethod(entry, /void\s+setRaw\s*\(\s*(?:const\s+)?uint64_t/);
      const rawType = byteGetter && byteSetter
        ? "bytes"
        : uint32Getter && uint32Setter
          ? "uint32"
          : uint64Getter && uint64Setter
            ? "uint64"
            : null;
      const sendOwnerClassName = repeatSend?.ownerClassName;
      const hasSendImplementation = sendOwnerClassName ? hasLinkableMethod(implementation, sendOwnerClassName, "send") : false;
      const irsendMethod = repeatSend && rawType === "bytes" ? irsendMethodForClass(implementation, className) : null;

      if (hasConstructor && repeatSend && rawType && (hasSendImplementation || irsendMethod) && !className.endsWith("Base")) {
        const bridgeEntry = {
          file,
          className,
          rawType,
          setRawLengthArg: rawType === "bytes" && Boolean(byteSetterWithLength),
          stateLengthExpression: rawType === "bytes" ? (byteSetterDefaultLength?.match?.[1] ?? checksumDefaultLength?.match?.[1] ?? implementationStateLength ?? rawArrayLength ?? null) : null,
          rawLengthMethod: rawType === "bytes" ? (rawLengthMethod?.match?.[1] ?? null) : null,
          inheritedFrom: sendOwnerClassName === className ? null : sendOwnerClassName,
        };
        if (!hasSendImplementation) {
          bridgeEntry.sendVia = "irsend";
          bridgeEntry.sendMethod = irsendMethod;
        }
        classes.push(bridgeEntry);
      } else if (hasConstructor || repeatSend || rawType) {
        excluded.push({
          file,
          className,
          reason: className.endsWith("Base")
            ? "base class"
            : "missing public pin constructor, repeat send, matching setRaw/getRaw, or Class::send implementation",
        });
      }
    }
  }

  return {
    classes,
    classCount: classes.length,
    excluded,
    excludedCount: excluded.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? ".";
  process.stdout.write(`${JSON.stringify(protocolClassRawSurface(root), null, 2)}\n`);
}
