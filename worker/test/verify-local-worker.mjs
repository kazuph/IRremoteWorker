import { execSync, spawn } from "node:child_process";
import net from "node:net";
import { verifyHttpOracle } from "./http-oracle-checks.mjs";

const host = "127.0.0.1";
const preferredPort = Number(process.env.IRREMOTE_LOCAL_PORT || 8787);

execSync("npm run native:build", { stdio: "inherit" });
execSync("npm run native:oracle:build", { stdio: "inherit" });
execSync("npm run db:migrate:local", { stdio: "inherit" });

async function findOpenPort(startPort) {
  for (let port = startPort; port < startPort + 50; port++) {
    if (await isOpenPort(port)) return port;
  }
  throw new Error(`No open local port found from ${startPort} to ${startPort + 49}`);
}

async function isOpenPort(port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

const port = await findOpenPort(preferredPort);
const baseUrl = `http://${host}:${port}`;
const logs = [];
let exited = false;

const server = spawn("wrangler", ["dev", "--local", "--port", String(port)], {
  env: { ...process.env, NO_COLOR: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

function captureLog(chunk) {
  logs.push(chunk.toString());
  while (logs.join("").length > 8000) logs.shift();
}

server.stdout.on("data", captureLog);
server.stderr.on("data", captureLog);
server.once("exit", (code, signal) => {
  exited = true;
  logs.push(`\nwrangler dev exited with code=${code} signal=${signal}\n`);
});

try {
  const result = await verifyHttpOracle({
    baseUrl,
    label: "local Worker",
    maxAttempts: 30,
  });
  if (exited) throw new Error(`wrangler dev exited before verification completed\n${logs.join("")}`);
  console.log(JSON.stringify({ ...result, localPort: port }));
} catch (error) {
  throw new Error(`${error.message}\n\nwrangler dev logs:\n${logs.join("")}`);
} finally {
  server.kill("SIGTERM");
}
