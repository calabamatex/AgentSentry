/**
 * html.ts — Inline HTML template for the AgentSentry v5 real-time dashboard.
 *
 * Returns a self-contained HTML string with all CSS and JS inline.
 * Connects to the SSE endpoint at /events and polls /api/* for data.
 */

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentSentry Dashboard v5</title>
<style>
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#58a6ff;--green:#3fb950;--yellow:#d29922;--red:#f85149;--orange:#db6d28;--purple:#bc8cff;--radius:8px;--gap:16px}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;justify-content:space-between}
header h1{font-size:16px;font-weight:600}
header .status{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
header .dot{width:8px;height:8px;border-radius:50%;background:var(--border)}
header .dot.connected{background:var(--green)}
header .dot.disconnected{background:var(--red)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap);padding:var(--gap);max-width:1400px;margin:0 auto}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;min-height:200px}
.panel.full{grid-column:1/-1}
.panel h2{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.panel h2 .badge{background:var(--bg);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:400}
.event-feed{max-height:400px;overflow-y:auto;font-family:'SF Mono',Menlo,monospace;font-size:12px;line-height:1.8}
.event-row{display:flex;gap:12px;padding:4px 8px;border-radius:4px;transition:background .15s}
.event-row:hover{background:var(--bg)}
.event-row .ts{color:var(--muted);min-width:80px}
.event-row .type{min-width:100px;font-weight:500}
.event-row .data{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.type-tool_use{color:var(--accent)}
.type-session_start{color:var(--green)}
.type-session_end{color:var(--yellow)}
.type-error{color:var(--red)}
.type-metric{color:var(--purple)}
.type-heartbeat{color:var(--border)}
.health-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.health-card{background:var(--bg);border-radius:var(--radius);padding:12px;text-align:center}
.health-card .label{font-size:11px;color:var(--muted);text-transform:uppercase;margin-bottom:6px}
.health-card .value{font-size:24px;font-weight:700}
.health-card .sub{font-size:11px;color:var(--muted);margin-top:4px}
.check-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.check-row:last-child{border-bottom:none}
.check-row .status-pass{color:var(--green)}
.check-row .status-warn{color:var(--yellow)}
.check-row .status-fail{color:var(--red)}
.metrics-pre{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:var(--muted);white-space:pre-wrap;max-height:300px;overflow-y:auto;background:var(--bg);padding:12px;border-radius:var(--radius)}
.plugin-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.plugin-row:last-child{border-bottom:none}
.plugin-row .name{font-weight:500}
.plugin-row .meta{color:var(--muted);font-size:12px}
.pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px}
.pill-on{background:#3fb95022;color:var(--green)}
.pill-off{background:#f8514922;color:var(--red)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px}
.stat-card{background:var(--bg);border-radius:var(--radius);padding:12px;text-align:center}
.stat-card .val{font-size:28px;font-weight:700;color:var(--accent)}
.stat-card .label{font-size:11px;color:var(--muted);margin-top:4px}
.empty{color:var(--muted);font-size:13px;font-style:italic;padding:20px;text-align:center}
@media(max-width:768px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header>
  <h1>AgentSentry Dashboard v5</h1>
  <div class="status">
    <span class="dot" id="conn-dot"></span>
    <span id="conn-text">Connecting...</span>
    <span style="margin-left:16px" id="uptime-text"></span>
  </div>
</header>

<div class="grid">
  <!-- Stats overview -->
  <div class="panel full" id="stats-panel">
    <h2>Overview</h2>
    <div class="stats-grid" id="stats-grid">
      <div class="stat-card"><div class="val" id="stat-uptime">--</div><div class="label">Uptime (s)</div></div>
      <div class="stat-card"><div class="val" id="stat-clients">--</div><div class="label">Clients</div></div>
      <div class="stat-card"><div class="val" id="stat-events">--</div><div class="label">Events</div></div>
      <div class="stat-card"><div class="val" id="stat-feed">0</div><div class="label">Feed Items</div></div>
    </div>
  </div>

  <!-- Live event feed -->
  <div class="panel" id="feed-panel">
    <h2>Live Event Feed <span class="badge" id="feed-count">0</span></h2>
    <div class="event-feed" id="event-feed"></div>
  </div>

  <!-- Health status -->
  <div class="panel" id="health-panel">
    <h2>Health Status <span class="badge" id="health-status">--</span></h2>
    <div id="health-checks"></div>
  </div>

  <!-- Metrics -->
  <div class="panel" id="metrics-panel">
    <h2>Metrics</h2>
    <pre class="metrics-pre" id="metrics-content">Loading...</pre>
  </div>

  <!-- Plugins -->
  <div class="panel" id="plugins-panel">
    <h2>Plugins <span class="badge" id="plugin-count">0</span></h2>
    <div id="plugins-list"></div>
  </div>
</div>

<script>
(function() {
  'use strict';

  const MAX_FEED = 200;
  let feedCount = 0;
  let sse = null;
  let reconnectTimer = null;

  // ----- SSE Connection -----

  function connectSSE() {
    if (sse) { sse.close(); sse = null; }

    sse = new EventSource('/events');

    sse.onopen = function() {
      setConnected(true);
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    sse.onerror = function() {
      setConnected(false);
      sse.close();
      sse = null;
      reconnectTimer = setTimeout(connectSSE, 3000);
    };

    // Listen for all event types
    var types = ['tool_use','session_start','session_end','error','metric','task','checkpoint','agent'];
    types.forEach(function(t) {
      sse.addEventListener(t, function(e) {
        addEvent(t, e.lastEventId || '', safeJSON(e.data));
      });
    });

    // Catch-all via onmessage
    sse.onmessage = function(e) {
      addEvent('event', e.lastEventId || '', safeJSON(e.data));
    };
  }

  function setConnected(ok) {
    var dot = document.getElementById('conn-dot');
    var txt = document.getElementById('conn-text');
    dot.className = 'dot ' + (ok ? 'connected' : 'disconnected');
    txt.textContent = ok ? 'Connected' : 'Disconnected';
  }

  function safeJSON(s) {
    try { return JSON.parse(s); } catch { return s; }
  }

  // ----- Event Feed -----

  function addEvent(type, id, data) {
    feedCount++;
    var feed = document.getElementById('event-feed');
    var row = document.createElement('div');
    row.className = 'event-row';

    var ts = new Date().toLocaleTimeString();
    var summary = typeof data === 'string' ? data : JSON.stringify(data).slice(0, 120);

    row.innerHTML =
      '<span class="ts">' + ts + '</span>' +
      '<span class="type type-' + type + '">' + type + '</span>' +
      '<span class="data">' + escHtml(summary) + '</span>';

    feed.insertBefore(row, feed.firstChild);

    // Trim old entries
    while (feed.children.length > MAX_FEED) {
      feed.removeChild(feed.lastChild);
    }

    document.getElementById('feed-count').textContent = feedCount;
    document.getElementById('stat-feed').textContent = feedCount;
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ----- Polling: Health -----

  async function pollHealth() {
    try {
      var r = await fetch('/api/health');
      var d = await r.json();

      document.getElementById('health-status').textContent = d.status || '--';

      var html = '';
      if (d.checks) {
        Object.keys(d.checks).forEach(function(name) {
          var c = d.checks[name];
          html +=
            '<div class="check-row">' +
            '<span>' + name + '</span>' +
            '<span class="status-' + c.status + '">' + c.status +
            (c.latencyMs != null ? ' (' + c.latencyMs + 'ms)' : '') +
            '</span></div>';
        });
      }
      document.getElementById('health-checks').innerHTML = html || '<div class="empty">No checks registered</div>';
    } catch {
      document.getElementById('health-status').textContent = 'error';
      document.getElementById('health-checks').innerHTML = '<div class="empty">Failed to fetch health</div>';
    }
  }

  // ----- Polling: Metrics -----

  async function pollMetrics() {
    try {
      var r = await fetch('/api/metrics');
      var text = await r.text();
      document.getElementById('metrics-content').textContent = text || 'No metrics collected yet.';
    } catch {
      document.getElementById('metrics-content').textContent = 'Failed to fetch metrics.';
    }
  }

  // ----- Polling: Plugins -----

  async function pollPlugins() {
    try {
      var r = await fetch('/api/plugins');
      var plugins = await r.json();

      document.getElementById('plugin-count').textContent = plugins.length;

      if (!plugins.length) {
        document.getElementById('plugins-list').innerHTML = '<div class="empty">No plugins installed</div>';
        return;
      }

      var html = '';
      plugins.forEach(function(p) {
        var m = p.manifest || {};
        html +=
          '<div class="plugin-row">' +
          '<div><span class="name">' + escHtml(m.name || 'unknown') + '</span> ' +
          '<span class="meta">v' + escHtml(m.version || '?') + ' / ' + escHtml(m.category || '?') + '</span></div>' +
          '<span class="pill ' + (p.enabled ? 'pill-on' : 'pill-off') + '">' +
          (p.enabled ? 'enabled' : 'disabled') + '</span></div>';
      });
      document.getElementById('plugins-list').innerHTML = html;
    } catch {
      document.getElementById('plugins-list').innerHTML = '<div class="empty">Failed to fetch plugins</div>';
    }
  }

  // ----- Polling: Stats -----

  async function pollStats() {
    try {
      var r = await fetch('/api/stats');
      var d = await r.json();
      document.getElementById('stat-uptime').textContent = d.uptime || '--';
      document.getElementById('stat-clients').textContent = d.clients || '0';
      document.getElementById('stat-events').textContent = d.eventsPublished || '0';
      document.getElementById('uptime-text').textContent = 'Up ' + (d.uptime || 0) + 's';
    } catch {}
  }

  // ----- Init -----

  connectSSE();

  // Initial poll
  pollHealth();
  pollMetrics();
  pollPlugins();
  pollStats();

  // Periodic refresh
  setInterval(pollHealth, 10000);
  setInterval(pollMetrics, 15000);
  setInterval(pollPlugins, 30000);
  setInterval(pollStats, 5000);
})();
</script>
</body>
</html>`;
}
