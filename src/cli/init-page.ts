import type { Config } from "../config.js"

export function html(cfg: Config): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>weixin-clawbot-bridge 配置</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 40px 20px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .sub { color: #888; font-size: 14px; margin-bottom: 30px; }
  .card { background: #16213e; border-radius: 16px; padding: 24px; width: 460px; margin-bottom: 20px; }
  .card h2 { font-size: 16px; margin-bottom: 16px; color: #07C160; }
  .hidden { display: none !important; }
  .steps { display: flex; gap: 8px; margin-bottom: 24px; }
  .step { padding: 6px 16px; border-radius: 20px; font-size: 13px; background: #222; color: #666; transition: all 0.3s; }
  .step.active { background: #07C160; color: white; }
  .step.done { background: #1a3c1a; color: #81c784; }
  label { display: block; font-size: 13px; color: #999; margin-bottom: 4px; margin-top: 14px; }
  label:first-child { margin-top: 0; }
  select, input[type="text"], input[type="number"] {
    width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #2a2a4a;
    background: #0f0f2a; color: #e0e0e0; font-size: 14px; outline: none; transition: border 0.2s;
  }
  select:focus, input:focus { border-color: #07C160; }
  .btn { background: #07C160; color: white; border: none; padding: 12px 28px; border-radius: 10px; font-size: 15px; cursor: pointer; transition: background 0.2s; margin-top: 20px; }
  .btn:hover { background: #06ae56; }
  .btn:disabled { background: #333; color: #666; cursor: not-allowed; }
  .btn-outline { background: transparent; border: 1px solid #555; color: #999; }
  .btn-outline:hover { border-color: #07C160; color: #07C160; background: transparent; }
  .btn-row { display: flex; gap: 12px; margin-top: 20px; }
  .msg { padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-top: 12px; }
  .msg-ok { background: #1a3c1a; color: #81c784; }
  .msg-err { background: #3c1a1a; color: #e57373; }
  .qr-box { background: white; border-radius: 12px; padding: 12px; display: inline-block; margin: 16px 0; }
  .qr-box img { width: 220px; height: 220px; }
  .center { text-align: center; }
  .phase { font-size: 14px; padding: 6px 14px; border-radius: 8px; display: inline-block; margin: 8px 0; }
  .phase-idle { background: #333; }
  .phase-qr { background: #1a3a5c; color: #4fc3f7; }
  .phase-scanned { background: #1a3c1a; color: #81c784; }
  .phase-confirmed { background: #07C160; color: white; }
  .phase-expired { background: #3c1a1a; color: #e57373; }
  .spinner { width: 32px; height: 32px; border: 3px solid #333; border-top-color: #07C160; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 16px auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .summary { font-size: 13px; line-height: 1.8; }
  .summary .label { color: #888; }
  .summary .val { color: #4fc3f7; font-family: monospace; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot-green { background: #07C160; }
  .dot-red { background: #e74c3c; }
  .account { padding: 8px 0; border-bottom: 1px solid #1a1a3e; font-size: 13px; }
  .account:last-child { border: none; }
</style>
</head>
<body>

<h1>weixin-clawbot-bridge</h1>
<p class="sub">初始化配置向导</p>

<div class="steps">
  <span class="step active" id="s1">1. 配置</span>
  <span class="step" id="s2">2. 登录</span>
  <span class="step" id="s3">3. 启动</span>
</div>

<!-- Step 1: Config -->
<div class="card" id="step1">
  <h2>服务配置</h2>

  <label>适配器</label>
  <select id="adapter" onchange="toggleAdapter()">
    <option value="echo"${cfg.adapter === "echo" ? " selected" : ""}>echo (测试)</option>
    <option value="opencode"${(cfg.adapter === "opencode" || !cfg.adapter) ? " selected" : ""}>opencode (AI 对话)</option>
    <option value="webhook"${cfg.adapter === "webhook" ? " selected" : ""}>webhook (自定义)</option>
  </select>

  <label>HTTP 端口</label>
  <input type="number" id="port" value="${cfg.port ?? 3200}" placeholder="3200">

  <div id="cfg-opencode">
    <label>OpenCode API 地址</label>
    <input type="text" id="oc-url" value="${cfg.opencode?.url ?? "http://localhost:4096"}" placeholder="http://localhost:4096">
    <label>工作目录 (可选)</label>
    <input type="text" id="oc-dir" value="${cfg.opencode?.directory ?? ""}" placeholder="留空使用当前目录">
  </div>

  <div id="cfg-webhook" class="hidden">
    <label>Webhook 端点</label>
    <input type="text" id="wh-endpoint" value="${cfg.webhook?.endpoint ?? ""}" placeholder="https://example.com/hook">
  </div>

  <div id="cfg-msg"></div>
  <button class="btn" onclick="saveConfig()">保存配置</button>
</div>

<!-- Step 2: Login -->
<div class="card center hidden" id="step2">
  <h2>微信登录</h2>
  <div id="login-phase" class="phase phase-idle">等待</div>
  <div id="login-area">
    <p style="color:#888;font-size:13px;margin:12px 0">绑定微信账号以接收和发送消息</p>
    <button class="btn" onclick="startLogin()">获取二维码</button>
  </div>
  <div class="btn-row" style="justify-content:center">
    <button class="btn btn-outline" onclick="goStep(3)">跳过登录</button>
  </div>
</div>

<!-- Step 3: Done -->
<div class="card center hidden" id="step3">
  <h2>启动服务</h2>
  <div id="summary"></div>
  <div id="start-msg"></div>
  <button class="btn" id="btn-start" onclick="startDaemon()">启动服务</button>
</div>

<script>
let sse = null
let phase = "idle"

function $(id) { return document.getElementById(id) }

function toggleAdapter() {
  const v = $("adapter").value
  $("cfg-opencode").className = v === "opencode" ? "" : "hidden"
  $("cfg-webhook").className = v === "webhook" ? "" : "hidden"
}
toggleAdapter()

function goStep(n) {
  $("step1").className = n === 1 ? "card" : "card hidden"
  $("step2").className = n === 2 ? "card center" : "card center hidden"
  $("step3").className = n === 3 ? "card center" : "card center hidden"
  $("s1").className = n > 1 ? "step done" : "step active"
  $("s2").className = n === 2 ? "step active" : n > 2 ? "step done" : "step"
  $("s3").className = n === 3 ? "step active" : "step"
  if (n === 2) connectSSE()
  if (n === 3) loadSummary()
}

async function saveConfig() {
  const body = {
    adapter: $("adapter").value,
    port: parseInt($("port").value, 10) || 3200,
  }
  if (body.adapter === "opencode") {
    body.opencode = { url: $("oc-url").value || undefined, directory: $("oc-dir").value || undefined }
  }
  if (body.adapter === "webhook") {
    body.webhook = { endpoint: $("wh-endpoint").value || undefined }
  }

  const res = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const data = await res.json()
  if (res.ok) {
    $("cfg-msg").innerHTML = '<div class="msg msg-ok">配置已保存</div>'
    setTimeout(() => goStep(2), 600)
  } else {
    $("cfg-msg").innerHTML = '<div class="msg msg-err">' + (data.error || "保存失败") + '</div>'
  }
}

// --- Login ---
function setPhase(p) {
  phase = p
  const el = $("login-phase")
  const labels = { idle: "等待", qr: "扫码", scanned: "已扫码", confirmed: "登录成功", expired: "已过期" }
  el.textContent = labels[p] || p
  el.className = "phase phase-" + p
}

function connectSSE() {
  if (sse) sse.close()
  sse = new EventSource("/events")

  sse.addEventListener("weixin.scanned", () => {
    setPhase("scanned")
    $("login-area").innerHTML = '<div style="font-size:40px;margin:16px 0">&#128241;</div><p style="color:#81c784;font-size:14px">已扫码，请在手机上确认</p>'
  })

  sse.addEventListener("weixin.confirmed", (e) => {
    const d = JSON.parse(e.data)
    setPhase("confirmed")
    $("login-area").innerHTML = '<div style="font-size:40px;margin:16px 0">&#9989;</div><p style="color:#07C160;font-size:15px;font-weight:600">登录成功!</p><p style="color:#888;font-size:13px;margin-top:8px">accountId: ' + (d.accountId || "-") + '</p>'
    setTimeout(() => goStep(3), 1500)
  })

  sse.addEventListener("weixin.expired", () => {
    setPhase("expired")
    $("login-area").innerHTML = '<p style="color:#e57373;font-size:14px;margin:16px 0">二维码已过期</p><button class="btn" onclick="startLogin()">重新获取</button>'
  })
}

async function startLogin() {
  setPhase("qr")
  $("login-area").innerHTML = '<div class="spinner"></div><p style="color:#888;font-size:13px">正在获取二维码...</p>'

  const res = await fetch("/api/login/qr", { method: "POST" }).catch(() => null)
  if (!res) {
    $("login-area").innerHTML = '<p style="color:#e57373">请求失败</p><button class="btn" onclick="startLogin()">重试</button>'
    return
  }
  const data = await res.json()
  if (data.url || data.img) {
    const qr = data.img || data.url
    const img = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(qr)
    $("login-area").innerHTML = '<div class="qr-box"><img src="' + img + '" alt="QR"></div><p style="color:#4fc3f7;font-size:14px">请用微信扫描上方二维码</p>'
  } else {
    $("login-area").innerHTML = '<p style="color:#e57373">' + (data.message || "获取失败") + '</p><button class="btn" onclick="startLogin()">重试</button>'
  }
}

// --- Summary & Start ---
async function loadSummary() {
  const [cfgRes, accRes] = await Promise.all([
    fetch("/api/config").then(r => r.json()).catch(() => ({})),
    fetch("/api/account").then(r => r.json()).catch(() => [])
  ])

  let h = '<div class="summary">'
  h += '<div><span class="label">适配器: </span><span class="val">' + (cfgRes.adapter || "echo") + '</span></div>'
  h += '<div><span class="label">端口: </span><span class="val">' + (cfgRes.port || 3200) + '</span></div>'
  if (cfgRes.adapter === "opencode" && cfgRes.opencode) {
    h += '<div><span class="label">OpenCode: </span><span class="val">' + (cfgRes.opencode.url || "-") + '</span></div>'
  }
  if (cfgRes.adapter === "webhook" && cfgRes.webhook) {
    h += '<div><span class="label">Webhook: </span><span class="val">' + (cfgRes.webhook.endpoint || "-") + '</span></div>'
  }
  h += '</div>'

  if (Array.isArray(accRes) && accRes.length > 0) {
    h += '<div style="margin-top:14px"><span class="label" style="font-size:13px">已登录账号:</span></div>'
    for (const a of accRes) {
      const dot = a.status === "connected" ? "dot-green" : "dot-red"
      h += '<div class="account"><span class="dot ' + dot + '"></span>' + a.id + '</div>'
    }
  } else {
    h += '<div style="margin-top:14px;color:#888;font-size:13px">暂无已登录账号</div>'
  }

  $("summary").innerHTML = h
}

async function startDaemon() {
  $("btn-start").disabled = true
  $("btn-start").textContent = "启动中..."

  const res = await fetch("/api/start", { method: "POST" }).catch(() => null)
  if (!res) {
    $("start-msg").innerHTML = '<div class="msg msg-err">请求失败</div>'
    $("btn-start").disabled = false
    $("btn-start").textContent = "启动服务"
    return
  }
  const data = await res.json()
  if (data.ok) {
    $("btn-start").className = "btn hidden"
    $("start-msg").innerHTML = '<div class="msg msg-ok">服务已启动! PID: ' + data.pid + '<br>日志: ' + (data.log || "") + '<br><br>可以关闭此页面了</div>'
  } else {
    $("start-msg").innerHTML = '<div class="msg msg-err">' + (data.error || "启动失败") + '</div>'
    $("btn-start").disabled = false
    $("btn-start").textContent = "启动服务"
  }
}
</script>
</body>
</html>`
}
