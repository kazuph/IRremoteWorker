import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { protocolClassSurface } from "./protocol-class-surface.mjs";

const outputPath = process.argv[2] ?? "worker/generated/protocol-class-surface.json";
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(protocolClassSurface(), null, 2)}\n`);
