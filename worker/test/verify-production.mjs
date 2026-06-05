import { execSync } from "node:child_process";
import { verifyHttpOracle } from "./http-oracle-checks.mjs";

const baseUrl = process.env.IRREMOTE_PROD_URL || "https://irremote-worker.kazu-san.workers.dev";

execSync("npm run native:oracle:build", { stdio: "inherit" });

console.log(JSON.stringify(await verifyHttpOracle({ baseUrl, label: "production" })));
