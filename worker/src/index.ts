import { Hono } from "hono";
import { cors } from "hono/cors";
import protocolClassCommonSurface from "../generated/protocol-class-common-surface.json";
import protocolClassFromCommonSurface from "../generated/protocol-class-from-common-surface.json";
import protocolClassMethodSurface from "../generated/protocol-class-method-surface.json";
import protocolClassRawSurface from "../generated/protocol-class-raw-surface.json";
import protocolClassStaticSurface from "../generated/protocol-class-static-surface.json";
import protocolClassStringSurface from "../generated/protocol-class-string-surface.json";
import protocolClassSurface from "../generated/protocol-class-surface.json";
import { generateIr, inferIr, listProtocols } from "./ir";

type Env = {
  IR_LOGS?: D1Database;
};

const app = new Hono<{ Bindings: Env }>();
let memoryLatest: unknown = null;

app.use("*", cors());

app.onError((error, c) => c.json({ error: error.message || "unexpected error" }, 400));

app.get("/", (c) => c.html(renderPage()));

app.get("/api/protocols", async (c) => c.json({ protocols: await listProtocols() }));

app.post("/api/call", async (c) => {
  const request = await c.req.json();
  if (request?.op === "protocols") return c.json({ protocols: await listProtocols() });
  if (request?.op === "infer") {
    const payload = request.payload ?? {};
    const response = await inferIr(payload);
    await recordEvent(c.env ?? {}, "infer", payload, response, "raw" in payload ? payload.raw : null);
    return c.json(response);
  }
  if (request?.op === "generate") {
    const payload = request.payload ?? {};
    const response = await generateIr(payload);
    await recordEvent(c.env ?? {}, "generate", payload, response, response.raw);
    return c.json(response);
  }
  throw new Error("unsupported call op");
});

app.get("/api/class-surface", (c) => c.json(protocolClassSurface));

app.get("/api/class-raw-surface", (c) => c.json(protocolClassRawSurface));

app.get("/api/class-method-surface", (c) => c.json(protocolClassMethodSurface));

app.get("/api/class-static-surface", (c) => c.json(protocolClassStaticSurface));

app.get("/api/class-common-surface", (c) => c.json(protocolClassCommonSurface));

app.get("/api/class-string-surface", (c) => c.json(protocolClassStringSurface));

app.get("/api/class-from-common-surface", (c) => c.json(protocolClassFromCommonSurface));

app.post("/api/infer", async (c) => {
  const request = await c.req.json();
  const response = await inferIr(request);
  await recordEvent(c.env ?? {}, "infer", request, response, "raw" in request ? request.raw : null);
  return c.json(response);
});

app.post("/api/generate", async (c) => {
  const request = await c.req.json();
  const response = await generateIr(request);
  await recordEvent(c.env ?? {}, "generate", request, response, response.raw);
  return c.json(response);
});

app.get("/api/latest", async (c) => {
  const latest = await readLatest(c.env ?? {});
  return c.json({ latest });
});

async function recordEvent(env: Env, kind: string, request: unknown, response: any, raw: unknown) {
  const event = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    kind,
    protocol: response?.protocol ?? null,
    manufacturer: response?.manufacturer ?? null,
    model: response?.model ?? null,
    request_json: JSON.stringify(request),
    response_json: JSON.stringify(response),
    raw_json: JSON.stringify(raw ?? null),
  };
  memoryLatest = event;
  if (!env.IR_LOGS) return;
  await env.IR_LOGS.prepare(
    `INSERT INTO ir_events
      (id, created_at, kind, protocol, manufacturer, model, request_json, response_json, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      event.id,
      event.created_at,
      event.kind,
      event.protocol,
      event.manufacturer,
      event.model,
      event.request_json,
      event.response_json,
      event.raw_json,
    )
    .run();
}

async function readLatest(env: Env) {
  if (!env.IR_LOGS) return memoryLatest;
  const row = await env.IR_LOGS.prepare("SELECT * FROM ir_events ORDER BY created_at DESC LIMIT 1").first();
  return row ?? memoryLatest;
}

function renderPage() {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>StackChan IR Remote</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f8f9;
      color: #25272a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #f7f8f9; overflow-x: hidden; }
    button, select { font: inherit; }
    main {
      width: min(1320px, calc(100vw - 48px));
      margin: 28px auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 420px;
      gap: 28px;
      align-items: start;
    }
    .remote, .detected { min-width: 0; max-width: 100%; }
    .topbar {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    .status-label, .section-title {
      font-size: clamp(22px, 2.5vw, 32px);
      font-weight: 800;
      line-height: 1.1;
    }
    .refresh {
      width: 72px;
      height: 56px;
      border: 0;
      border-radius: 999px;
      background: #e9e9ea;
      color: #202225;
      font-size: 36px;
      line-height: 1;
      cursor: pointer;
    }
    .identity {
      text-align: center;
      border-bottom: 2px solid #e1e1e2;
      padding: 22px 0 26px;
    }
    .title {
      margin: 0;
      font-size: clamp(44px, 6.8vw, 76px);
      line-height: 0.98;
      font-weight: 900;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }
    .subtitle {
      margin-top: 12px;
      color: #74777b;
      font-size: clamp(20px, 2.8vw, 30px);
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .controls {
      width: min(620px, 100%);
      margin: 24px auto 0;
      display: grid;
      gap: 20px;
      padding-bottom: 26px;
      border-bottom: 2px solid #e1e1e2;
      min-width: 0;
    }
    .row {
      display: grid;
      grid-template-columns: 96px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }
    .label {
      text-align: right;
      font-size: 26px;
      font-weight: 800;
      white-space: nowrap;
    }
    .switch {
      justify-self: start;
      width: 130px;
      height: 56px;
      border: 4px solid #0f7df2;
      border-radius: 999px;
      background: #0f7df2;
      position: relative;
    }
    .switch::after {
      content: "";
      position: absolute;
      top: 3px;
      right: 3px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #fff;
    }
    .segments {
      display: grid;
      grid-template-columns: repeat(4, minmax(72px, 1fr));
      background: #e9e9ea;
      border-radius: 999px;
      overflow: hidden;
      min-height: 54px;
      min-width: 0;
    }
    .segment {
      display: grid;
      place-items: center;
      border-right: 2px solid #d8d8da;
      color: #27292c;
      font-size: 25px;
      font-weight: 800;
      min-width: 0;
    }
    .segment:last-child { border-right: 0; }
    .segment.active {
      background: #0f7df2;
      color: #fff;
      border-radius: 999px;
    }
    .temp {
      display: grid;
      grid-template-columns: 112px 1fr 112px;
      align-items: center;
      gap: 24px;
      min-width: 0;
    }
    .pill {
      height: 54px;
      border: 0;
      border-radius: 999px;
      background: #e9e9ea;
      color: #25272a;
      font-size: 28px;
      font-weight: 900;
    }
    .degrees {
      text-align: center;
      font-size: clamp(48px, 7vw, 68px);
      line-height: 1;
      font-weight: 900;
      white-space: nowrap;
    }
    .select-wrap { position: relative; }
    select {
      width: 100%;
      height: 56px;
      appearance: none;
      border: 0;
      border-radius: 999px;
      background: #e9e9ea;
      color: #25272a;
      padding: 0 54px 0 28px;
      font-size: 25px;
      font-weight: 800;
    }
    .select-wrap::after {
      content: "⌄";
      position: absolute;
      right: 22px;
      top: 6px;
      font-size: 32px;
      font-weight: 900;
      pointer-events: none;
    }
    .direction {
      display: flex;
      gap: 42px;
      color: #74777b;
      font-size: 25px;
      font-weight: 800;
      flex-wrap: wrap;
    }
    .status {
      margin-top: 24px;
      color: #74777b;
      font-size: 22px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .latest-box {
      margin-top: 16px;
      border: 2px solid #e0e0e1;
      background: #fff;
      min-height: 116px;
      padding: 16px 22px;
      color: #74777b;
      font-size: 22px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      justify-content: center;
      gap: 18px;
      flex-wrap: wrap;
      margin-top: 24px;
    }
    .action {
      min-width: min(180px, 100%);
      height: 54px;
      border: 0;
      border-radius: 999px;
      background: #e9e9ea;
      color: #25272a;
      font-size: 24px;
      font-weight: 900;
      cursor: pointer;
      padding: 0 28px;
    }
    .note {
      margin-top: 24px;
      color: #74777b;
      font-size: 20px;
      font-weight: 800;
    }
    .detected {
      border-left: 2px solid #cfcfd1;
      padding-left: 28px;
    }
    .detected-sub {
      margin: 12px 0 18px;
      color: #74777b;
      font-size: 20px;
      font-weight: 800;
    }
    .detected-list {
      border: 2px solid #c7c7c9;
      min-height: 320px;
      padding: 10px;
      background: #fff;
      display: grid;
      gap: 10px;
      align-content: start;
    }
    .detected-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 52px;
      gap: 12px;
      align-items: center;
      min-height: 92px;
      border: 2px solid transparent;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .detected-item.active { border-color: #c7c7c9; background: #f7f7f8; }
    .detected-name {
      font-size: 27px;
      line-height: 1.05;
      font-weight: 900;
      overflow-wrap: anywhere;
    }
    .detected-protocol {
      margin-top: 7px;
      color: #74777b;
      font-size: 21px;
      line-height: 1.05;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .remove {
      width: 44px;
      height: 40px;
      border: 0;
      border-radius: 9px;
      background: #e9e9ea;
      color: #25272a;
      font-size: 26px;
      font-weight: 900;
      cursor: pointer;
    }
    details.log {
      grid-column: 1 / -1;
      border-top: 2px solid #e1e1e2;
      padding-top: 18px;
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
    }
    details.log summary {
      cursor: pointer;
      color: #74777b;
      font-size: 21px;
      font-weight: 900;
      margin-bottom: 12px;
    }
    pre {
      margin: 0;
      overflow: auto;
      min-width: 0;
      max-width: 100%;
      padding: 20px;
      border-radius: 8px;
      background: #20282c;
      color: #edf5f6;
      max-height: 52vh;
      font: 16px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    @media (max-width: 980px) {
      main { grid-template-columns: 1fr; width: min(760px, calc(100vw - 28px)); margin-top: 20px; }
      .detected { border-left: 0; border-top: 2px solid #e1e1e2; padding: 22px 0 0; }
      .row { grid-template-columns: 82px minmax(0, 1fr); }
      .label { font-size: 22px; }
      .segments { grid-template-columns: repeat(2, minmax(92px, 1fr)); border-radius: 24px; }
      .segment.active { border-radius: 24px; }
      .temp { grid-template-columns: 86px 1fr 86px; gap: 12px; }
    }
    @media (max-width: 560px) {
      main { width: min(100vw - 20px, 480px); margin: 16px auto; }
      .topbar { margin-bottom: 16px; }
      .refresh { width: 58px; height: 46px; font-size: 30px; }
      .identity { padding: 18px 0 22px; }
      .title { font-size: clamp(36px, 15vw, 54px); }
      .subtitle { font-size: 18px; }
      .controls { gap: 16px; margin-top: 22px; }
      .row {
        grid-template-columns: 72px minmax(0, 1fr);
        gap: 10px;
      }
      .label {
        font-size: 21px;
      }
      .switch {
        width: 112px;
        height: 48px;
      }
      .switch::after {
        width: 36px;
        height: 36px;
      }
      .segments {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        border-radius: 22px;
      }
      .segment {
        min-height: 48px;
        font-size: 22px;
      }
      .segment.active { border-radius: 22px; }
      .temp {
        grid-template-columns: minmax(58px, 74px) minmax(76px, 1fr) minmax(58px, 74px);
        gap: 8px;
      }
      .pill {
        height: 48px;
        font-size: 24px;
      }
      .degrees {
        font-size: clamp(36px, 12vw, 48px);
      }
      select {
        height: 50px;
        padding-left: 20px;
        font-size: 22px;
      }
      .direction {
        gap: 16px;
        font-size: 21px;
      }
      .status, .latest-box {
        font-size: 19px;
      }
      .action {
        width: min(100%, 260px);
        font-size: 22px;
      }
    }
  </style>
</head>
<body>
  <main>
    <section class="remote" aria-label="受信中のIRリモート">
      <div class="topbar">
        <div class="status-label">受光中</div>
        <button id="refresh" class="refresh" type="button" aria-label="更新">↻</button>
      </div>

      <div class="identity">
        <h1 id="device-title" class="title">IRREMOTE</h1>
        <div id="device-subtitle" class="subtitle">Protocol: waiting</div>
      </div>

      <div class="controls">
        <div class="row">
          <div class="label">運転</div>
          <div id="power-switch" class="switch" aria-label="運転状態"></div>
        </div>
        <div class="row">
          <div class="label">モード</div>
          <div class="segments" id="mode-segments">
            <div class="segment" data-mode="Cool">冷房</div>
            <div class="segment" data-mode="Dry">除湿</div>
            <div class="segment" data-mode="Heat">暖房</div>
            <div class="segment" data-mode="Auto">自動</div>
          </div>
        </div>
        <div class="row">
          <div class="label">温度</div>
          <div class="temp">
            <button class="pill" type="button" id="temp-minus">-</button>
            <div id="degrees" class="degrees">-- C</div>
            <button class="pill" type="button" id="temp-plus">+</button>
          </div>
        </div>
        <div class="row">
          <div class="label">風量</div>
          <div class="select-wrap">
            <select id="fan">
              <option>Auto</option>
              <option>Min</option>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Max</option>
            </select>
          </div>
        </div>
        <div class="row">
          <div class="label">風向き</div>
          <div id="direction" class="direction">
            <span>上下&nbsp; -</span>
            <span>左右&nbsp; -</span>
          </div>
        </div>
      </div>

      <div id="poll-status" class="status">受光待機中: 新しい判定を待っています</div>
      <div id="latest-box" class="latest-box">判定: waiting</div>
      <div class="actions">
        <button id="send-current" class="action" type="button">現在値を生成</button>
        <button id="check-connection" class="action" type="button">接続確認</button>
      </div>
      <div class="note">表示値は受光結果から反映します。送信IRはWeb APIで生成します。</div>
    </section>

    <aside class="detected" aria-label="検知済みリモコン">
      <div class="section-title">検知済み</div>
      <div class="detected-sub">受光して判定できたメーカー/型番</div>
      <div id="detected-list" class="detected-list"></div>
    </aside>

    <details class="log" open>
      <summary>生ログ表示</summary>
      <pre id="payload">{}</pre>
    </details>
  </main>
  <script>
    var latestEvent = null;
    var latestResponse = null;
    var detected = [];
    var pollCount = 0;
    var detectedKey = 'irremote.detected.v1';
    var modeMap = { Cool: 'cool', Heat: 'heat', Dry: 'dry', Fan: 'fan', Auto: 'auto' };
    var fanMap = { Auto: 'auto', Min: 'min', Low: 'low', Medium: 'medium', High: 'high', Max: 'max' };

    var refresh = document.getElementById('refresh');
    var title = document.getElementById('device-title');
    var subtitle = document.getElementById('device-subtitle');
    var pollStatus = document.getElementById('poll-status');
    var latestBox = document.getElementById('latest-box');
    var payload = document.getElementById('payload');
    var modeSegments = document.getElementById('mode-segments');
    var degrees = document.getElementById('degrees');
    var fan = document.getElementById('fan');
    var direction = document.getElementById('direction');
    var detectedList = document.getElementById('detected-list');
    var sendCurrent = document.getElementById('send-current');
    var checkConnection = document.getElementById('check-connection');
    var tempMinus = document.getElementById('temp-minus');
    var tempPlus = document.getElementById('temp-plus');

    function safeJson(value, fallback) {
      try { return JSON.parse(value); } catch (_) { return fallback; }
    }

    function loadDetected() {
      detected = safeJson(localStorage.getItem(detectedKey) || '[]', []);
      if (!Array.isArray(detected)) detected = [];
    }

    function saveDetected() {
      localStorage.setItem(detectedKey, JSON.stringify(detected.slice(0, 12)));
    }

    function displayName(response) {
      if (!response) return 'IRREMOTE';
      return response.manufacturer || response.protocol || 'UNKNOWN';
    }

    function modelText(response) {
      if (!response) return 'Unknown';
      if (response.modelName && response.modelName !== 'UNKNOWN') return response.modelName;
      if (response.model !== null && response.model !== undefined && response.model !== -1) return String(response.model);
      return response.manufacturer ? response.manufacturer[0] + response.manufacturer.slice(1).toLowerCase() : 'Unknown';
    }

    function remember(response) {
      if (!response || !response.protocol || response.matched === false) return;
      var item = {
        protocol: response.protocol,
        name: modelText(response),
        manufacturer: response.manufacturer || null,
        seenAt: Date.now()
      };
      detected = detected.filter(function(existing) { return existing.protocol !== item.protocol; });
      detected.unshift(item);
      detected = detected.slice(0, 8);
      saveDetected();
    }

    function renderDetected() {
      if (detected.length === 0) {
        detectedList.innerHTML = '<div class="detected-item"><div><div class="detected-name">Waiting</div><div class="detected-protocol">NO_SIGNAL</div></div></div>';
        return;
      }
      detectedList.innerHTML = detected.map(function(item, index) {
        var active = latestResponse && latestResponse.protocol === item.protocol ? ' active' : '';
        return '<div class="detected-item' + active + '">' +
          '<div><div class="detected-name">' + escapeHtml(item.name || 'Unknown') + '</div>' +
          '<div class="detected-protocol">' + escapeHtml(item.protocol) + '</div></div>' +
          '<button class="remove" type="button" data-index="' + index + '" aria-label="削除">×</button>' +
          '</div>';
      }).join('');
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, function(ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
    }

    function setMode(mode) {
      Array.prototype.forEach.call(modeSegments.children, function(node) {
        node.classList.toggle('active', node.dataset.mode === mode);
      });
    }

    function updateControls(response) {
      var ac = response && response.ac ? response.ac : null;
      var mode = ac && ac.mode ? ac.mode : 'Cool';
      setMode(mode);
      degrees.textContent = ac && typeof ac.degrees === 'number' ? String(ac.degrees) + ' C' : '-- C';
      fan.value = ac && ac.fan ? ac.fan : 'Auto';
      direction.innerHTML = '<span>上下&nbsp; ' + escapeHtml(ac && ac.swingv ? ac.swingv : '-') + '</span>' +
        '<span>左右&nbsp; ' + escapeHtml(ac && ac.swingh ? ac.swingh : '-') + '</span>';
    }

    function renderLatest(event, response) {
      latestEvent = event || null;
      latestResponse = response || null;
      var name = displayName(response);
      title.textContent = name;
      subtitle.textContent = 'Protocol: ' + (response && response.protocol ? response.protocol : 'waiting');
      var age = event && event.created_at ? Math.max(0, (Date.now() - Date.parse(event.created_at)) / 1000).toFixed(1) + '秒前' : 'waiting';
      pollStatus.textContent = '受光待機中: poll #' + pollCount + ' / 新しい判定を待っています';
      latestBox.innerHTML = '判定: ' + escapeHtml(age) + '<br>' +
        'manufacturer: ' + escapeHtml(response && response.manufacturer ? response.manufacturer : 'Unknown') + '<br>' +
        'protocol: ' + escapeHtml(response && response.protocol ? response.protocol : 'Unknown');
      payload.textContent = JSON.stringify(response || event || {}, null, 2);
      updateControls(response);
      remember(response);
      renderDetected();
    }

    async function tick() {
      pollCount++;
      var res = await fetch('/api/latest');
      var data = await res.json();
      var latest = data.latest || null;
      var response = latest && latest.response_json ? safeJson(latest.response_json, latest) : latest;
      renderLatest(latest, response);
    }

    async function generateCurrent() {
      if (!latestResponse || !latestResponse.ac) {
        latestBox.innerHTML = '判定: A/C共通状態がないため生成できません<br>protocol: ' +
          escapeHtml(latestResponse && latestResponse.protocol ? latestResponse.protocol : 'Unknown');
        return;
      }
      var ac = latestResponse.ac;
      var body = {
        kind: 'ac',
        protocol: ac.protocol || latestResponse.protocol,
        model: typeof ac.model === 'number' ? ac.model : -1,
        power: !!ac.power,
        mode: modeMap[ac.mode] || 'auto',
        degrees: typeof ac.degrees === 'number' ? ac.degrees : 25,
        celsius: ac.celsius !== false,
        fan: fanMap[fan.value] || 'auto',
        swingv: typeof ac.swingvId === 'number' ? ac.swingvId : 0,
        swingh: typeof ac.swinghId === 'number' ? ac.swinghId : 0,
        quiet: !!ac.quiet,
        turbo: !!ac.turbo,
        econo: !!ac.econo,
        light: !!ac.light,
        filter: !!ac.filter,
        clean: !!ac.clean,
        beep: !!ac.beep,
        sleep: typeof ac.sleep === 'number' ? ac.sleep : -1,
        clock: typeof ac.clock === 'number' ? ac.clock : -1
      };
      var res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      var json = await res.json();
      payload.textContent = JSON.stringify(json, null, 2);
      latestBox.innerHTML = '生成: ' + escapeHtml(json.protocol || 'Unknown') + '<br>rawLength: ' +
        escapeHtml(json.raw ? json.raw.length : 0);
    }

    detectedList.addEventListener('click', function(event) {
      var button = event.target.closest('button[data-index]');
      if (!button) return;
      detected.splice(Number(button.dataset.index), 1);
      saveDetected();
      renderDetected();
    });

    tempMinus.addEventListener('click', function() {
      var value = Number((degrees.textContent || '').replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(value)) degrees.textContent = String(value - 1) + ' C';
    });
    tempPlus.addEventListener('click', function() {
      var value = Number((degrees.textContent || '').replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(value)) degrees.textContent = String(value + 1) + ' C';
    });
    refresh.addEventListener('click', tick);
    sendCurrent.addEventListener('click', generateCurrent);
    checkConnection.addEventListener('click', function() {
      payload.textContent = JSON.stringify({
        ok: true,
        endpoint: location.origin,
        latestProtocol: latestResponse && latestResponse.protocol ? latestResponse.protocol : null
      }, null, 2);
    });
    loadDetected();
    renderDetected();
    tick();
    setInterval(tick, 1500);
  </script>
</body>
</html>`;
}

export default app;
