/**
 * html.ts — Inline HTML template for the AgentSentry v5 real-time dashboard.
 *
 * Returns a self-contained HTML string with all CSS and JS inline.
 * 5-tab layout: Overview, Events, System, Agents, Plugins.
 * Tab-aware polling: only fetches data for the active tab.
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
nav.tabs{display:flex;gap:0;background:var(--surface);border-bottom:1px solid var(--border);padding:0 24px;overflow-x:auto}
nav.tabs button{background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);font-size:13px;padding:10px 16px;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s}
nav.tabs button:hover{color:var(--text)}
nav.tabs button.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-content{display:none;padding:var(--gap);max-width:1400px;margin:0 auto}
.tab-content.active{display:block}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
.panel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;min-height:180px}
.panel.full{grid-column:1/-1}
.panel h2{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between}
.panel h2 .badge{background:var(--bg);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:400}
.event-feed{max-height:500px;overflow-y:auto;font-family:'SF Mono',Menlo,monospace;font-size:12px;line-height:1.8}
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
.check-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.check-row:last-child{border-bottom:none}
.check-row .status-pass,.check-row .status-healthy{color:var(--green)}
.check-row .status-warn,.check-row .status-degraded{color:var(--yellow)}
.check-row .status-fail,.check-row .status-unhealthy{color:var(--red)}
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
.agent-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.agent-row:last-child{border-bottom:none}
.agent-row .agent-name{font-weight:500}
.agent-row .agent-role{color:var(--muted);font-size:12px}
.agent-status{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px}
.agent-status-active{background:#3fb95022;color:var(--green)}
.agent-status-idle{background:#d2992222;color:var(--yellow)}
.agent-status-busy{background:#58a6ff22;color:var(--accent)}
.agent-status-offline{background:#f8514922;color:var(--red)}
.skill-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.skill-row:last-child{border-bottom:none}
.skill-row .skill-title{font-weight:500}
.skill-row .skill-mode{color:var(--muted);font-size:12px}
.empty{color:var(--muted);font-size:13px;font-style:italic;padding:20px;text-align:center}
@media(max-width:768px){.grid{grid-template-columns:1fr}nav.tabs{padding:0 8px}nav.tabs button{padding:10px 12px;font-size:12px}}
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

<nav class="tabs" id="tab-bar">
  <button class="active" data-tab="overview">Overview</button>
  <button data-tab="events">Events</button>
  <button data-tab="system">System</button>
  <button data-tab="agents">Agents</button>
  <button data-tab="plugins">Plugins</button>
</nav>

<!-- Tab: Overview -->
<div class="tab-content active" id="tab-overview">
  <div class="grid">
    <div class="panel full">
      <h2>Stats</h2>
      <div class="stats-grid" id="stats-grid">
        <div class="stat-card"><div class="val" id="stat-uptime">--</div><div class="label">Uptime (s)</div></div>
        <div class="stat-card"><div class="val" id="stat-clients">--</div><div class="label">SSE Clients</div></div>
        <div class="stat-card"><div class="val" id="stat-events">--</div><div class="label">Events Published</div></div>
        <div class="stat-card"><div class="val" id="stat-dropped">--</div><div class="label">Events Dropped</div></div>
        <div class="stat-card"><div class="val" id="stat-feed">0</div><div class="label">Feed Items</div></div>
      </div>
    </div>
    <div class="panel">
      <h2>Enablement <span class="badge" id="enablement-level">--</span></h2>
      <div id="enablement-content"><div class="empty">Loading...</div></div>
    </div>
    <div class="panel">
      <h2>Health Status <span class="badge" id="health-status">--</span></h2>
      <div id="health-checks"><div class="empty">Loading...</div></div>
    </div>
  </div>
</div>

<!-- Tab: Events -->
<div class="tab-content" id="tab-events">
  <div class="grid">
    <div class="panel full">
      <h2>Live Event Feed <span class="badge" id="feed-count">0</span></h2>
      <div class="event-feed" id="event-feed"><div class="empty">Waiting for events...</div></div>
    </div>
    <div class="panel full">
      <h2>Streaming Stats</h2>
      <div class="stats-grid" id="streaming-stats">
        <div class="stat-card"><div class="val" id="stream-clients">--</div><div class="label">Clients</div></div>
        <div class="stat-card"><div class="val" id="stream-buffer">--</div><div class="label">Buffer Size</div></div>
        <div class="stat-card"><div class="val" id="stream-published">--</div><div class="label">Published</div></div>
        <div class="stat-card"><div class="val" id="stream-dropped">--</div><div class="label">Dropped</div></div>
      </div>
    </div>
  </div>
</div>

<!-- Tab: System -->
<div class="tab-content" id="tab-system">
  <div class="grid">
    <div class="panel">
      <h2>Health Checks <span class="badge" id="sys-health-status">--</span></h2>
      <div id="sys-health-checks"><div class="empty">Loading...</div></div>
    </div>
    <div class="panel">
      <h2>Metrics</h2>
      <pre class="metrics-pre" id="metrics-content">Loading...</pre>
    </div>
  </div>
</div>

<!-- Tab: Agents -->
<div class="tab-content" id="tab-agents">
  <div class="grid">
    <div class="panel full">
      <h2>Registered Agents <span class="badge" id="agent-count">0</span></h2>
      <div id="agents-list"><div class="empty">Loading...</div></div>
    </div>
  </div>
</div>

<!-- Tab: Plugins -->
<div class="tab-content" id="tab-plugins">
  <div class="grid">
    <div class="panel full">
      <h2>Installed Plugins <span class="badge" id="plugin-count">0</span></h2>
      <div id="plugins-list"><div class="empty">Loading...</div></div>
    </div>
    <div class="panel full">
      <h2>Enablement Skills</h2>
      <div id="skills-list"><div class="empty">Loading...</div></div>
    </div>
  </div>
</div>

<script>
(function() {
  'use strict';

  var MAX_FEED = 200;
  var feedCount = 0;
  var sse = null;
  var reconnectTimer = null;
  var activeTab = 'overview';
  var intervals = {};

  // ----- Tab Navigation -----

  var tabBar = document.getElementById('tab-bar');
  tabBar.addEventListener('click', function(e) {
    var btn = e.target.closest('button[data-tab]');
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  function switchTab(tab) {
    activeTab = tab;
    var btns = tabBar.querySelectorAll('button');
    var panes = document.querySelectorAll('.tab-content');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].dataset.tab === tab);
    }
    for (var j = 0; j < panes.length; j++) {
      panes[j].classList.toggle('active', panes[j].id === 'tab-' + tab);
    }
    pollForTab(tab);
  }

  function pollForTab(tab) {
    if (tab === 'overview') { pollStats(); pollHealth(); pollEnablement(); }
    if (tab === 'events') { pollStreaming(); }
    if (tab === 'system') { pollSysHealth(); pollMetrics(); }
    if (tab === 'agents') { pollAgents(); }
    if (tab === 'plugins') { pollPlugins(); pollEnablement(); }
  }

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
      sse.close(); sse = null;
      reconnectTimer = setTimeout(connectSSE, 3000);
    };
    var types = ['tool_use','session_start','session_end','error','metric','task','checkpoint','agent'];
    types.forEach(function(t) {
      sse.addEventListener(t, function(e) { addEvent(t, safeJSON(e.data)); });
    });
    sse.onmessage = function(e) { addEvent('event', safeJSON(e.data)); };
  }

  function setConnected(ok) {
    document.getElementById('conn-dot').className = 'dot ' + (ok ? 'connected' : 'disconnected');
    document.getElementById('conn-text').textContent = ok ? 'Connected' : 'Disconnected';
  }

  function safeJSON(s) { try { return JSON.parse(s); } catch(e) { return s; } }

  // ----- Event Feed -----

  function addEvent(type, data) {
    feedCount++;
    var feed = document.getElementById('event-feed');
    if (feedCount === 1) feed.innerHTML = '';
    var row = document.createElement('div');
    row.className = 'event-row';
    var ts = new Date().toLocaleTimeString();
    var summary = typeof data === 'string' ? data : JSON.stringify(data).slice(0, 120);
    row.innerHTML =
      '<span class="ts">' + ts + '</span>' +
      '<span class="type type-' + type + '">' + type + '</span>' +
      '<span class="data">' + escHtml(summary) + '</span>';
    feed.insertBefore(row, feed.firstChild);
    while (feed.children.length > MAX_FEED) feed.removeChild(feed.lastChild);
    document.getElementById('feed-count').textContent = feedCount;
    document.getElementById('stat-feed').textContent = feedCount;
  }

  function escHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  // ----- Polling Functions -----

  async function pollStats() {
    try {
      var r = await fetch('/api/stats');
      var d = await r.json();
      document.getElementById('stat-uptime').textContent = d.uptime != null ? d.uptime : '--';
      document.getElementById('stat-clients').textContent = d.clients != null ? d.clients : '0';
      document.getElementById('stat-events').textContent = d.eventsPublished != null ? d.eventsPublished : '0';
      document.getElementById('uptime-text').textContent = 'Up ' + (d.uptime || 0) + 's';
    } catch(e) {}
  }

  async function pollHealth() {
    try {
      var r = await fetch('/api/health');
      var d = await r.json();
      document.getElementById('health-status').textContent = d.status || '--';
      renderHealthChecks(d, 'health-checks');
    } catch(e) {
      document.getElementById('health-status').textContent = 'error';
      document.getElementById('health-checks').innerHTML = '<div class="empty">Failed to fetch health</div>';
    }
  }

  async function pollSysHealth() {
    try {
      var r = await fetch('/api/health');
      var d = await r.json();
      document.getElementById('sys-health-status').textContent = d.status || '--';
      renderHealthChecks(d, 'sys-health-checks');
    } catch(e) {
      document.getElementById('sys-health-status').textContent = 'error';
      document.getElementById('sys-health-checks').innerHTML = '<div class="empty">Failed to fetch health</div>';
    }
  }

  function renderHealthChecks(d, containerId) {
    var html = '';
    if (d.checks) {
      Object.keys(d.checks).forEach(function(name) {
        var c = d.checks[name];
        html += '<div class="check-row"><span>' + escHtml(name) + '</span>' +
          '<span class="status-' + c.status + '">' + c.status +
          (c.latencyMs != null ? ' (' + c.latencyMs + 'ms)' : '') + '</span></div>';
      });
    }
    document.getElementById(containerId).innerHTML = html || '<div class="empty">No checks registered</div>';
  }

  async function pollMetrics() {
    try {
      var r = await fetch('/api/metrics');
      var text = await r.text();
      document.getElementById('metrics-content').textContent = text || 'No metrics collected yet.';
    } catch(e) {
      document.getElementById('metrics-content').textContent = 'Failed to fetch metrics.';
    }
  }

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
        html += '<div class="plugin-row"><div><span class="name">' + escHtml(m.name || 'unknown') + '</span> ' +
          '<span class="meta">v' + escHtml(m.version || '?') + ' / ' + escHtml(m.category || '?') + '</span></div>' +
          '<span class="pill ' + (p.enabled ? 'pill-on' : 'pill-off') + '">' +
          (p.enabled ? 'enabled' : 'disabled') + '</span></div>';
      });
      document.getElementById('plugins-list').innerHTML = html;
    } catch(e) {
      document.getElementById('plugins-list').innerHTML = '<div class="empty">Failed to fetch plugins</div>';
    }
  }

  async function pollStreaming() {
    try {
      var r = await fetch('/api/streaming');
      var d = await r.json();
      document.getElementById('stream-clients').textContent = d.clientCount != null ? d.clientCount : '--';
      document.getElementById('stream-buffer').textContent = d.bufferSize != null ? d.bufferSize : '--';
      document.getElementById('stream-published').textContent = d.eventsPublished != null ? d.eventsPublished : '--';
      document.getElementById('stream-dropped').textContent = d.eventsDropped != null ? d.eventsDropped : '--';
      document.getElementById('stat-dropped').textContent = d.eventsDropped != null ? d.eventsDropped : '--';
    } catch(e) {}
  }

  async function pollEnablement() {
    try {
      var r = await fetch('/api/enablement');
      var d = await r.json();
      if (!d.available) {
        document.getElementById('enablement-level').textContent = 'N/A';
        document.getElementById('enablement-content').innerHTML = '<div class="empty">Enablement not configured</div>';
        document.getElementById('skills-list').innerHTML = '<div class="empty">Enablement not configured</div>';
        return;
      }
      document.getElementById('enablement-level').textContent = 'L' + d.level + ' ' + (d.name || '');
      var info = '<div style="font-size:13px;margin-bottom:8px">' + d.activeCount + '/' + d.totalCount + ' skills active</div>';
      document.getElementById('enablement-content').innerHTML = info;
      if (d.panels && d.panels.length) {
        var html = '';
        d.panels.forEach(function(p) {
          html += '<div class="skill-row"><span class="skill-title">' + escHtml(p.title) + '</span>' +
            '<div><span class="skill-mode">' + escHtml(p.mode) + '</span> ' +
            '<span class="pill ' + (p.enabled ? 'pill-on' : 'pill-off') + '">' +
            (p.enabled ? 'on' : 'off') + '</span>' +
            (p.upgradeMessage ? ' <span style="font-size:11px;color:var(--muted)">' + escHtml(p.upgradeMessage) + '</span>' : '') +
            '</div></div>';
        });
        document.getElementById('skills-list').innerHTML = html;
      }
    } catch(e) {
      document.getElementById('enablement-content').innerHTML = '<div class="empty">Failed to fetch enablement</div>';
    }
  }

  async function pollAgents() {
    try {
      var r = await fetch('/api/coordination');
      var d = await r.json();
      if (!d.available) {
        document.getElementById('agent-count').textContent = '0';
        document.getElementById('agents-list').innerHTML = '<div class="empty">Coordination not configured</div>';
        return;
      }
      var agents = d.agents || [];
      document.getElementById('agent-count').textContent = agents.length;
      if (!agents.length) {
        document.getElementById('agents-list').innerHTML = '<div class="empty">No agents registered</div>';
        return;
      }
      var html = '';
      agents.forEach(function(a) {
        html += '<div class="agent-row"><div><span class="agent-name">' + escHtml(a.name || a.id) + '</span> ' +
          '<span class="agent-role">' + escHtml(a.role || 'unknown') + '</span></div>' +
          '<span class="agent-status agent-status-' + (a.status || 'offline') + '">' +
          escHtml(a.status || 'offline') + '</span></div>';
      });
      document.getElementById('agents-list').innerHTML = html;
    } catch(e) {
      document.getElementById('agents-list').innerHTML = '<div class="empty">Failed to fetch agents</div>';
    }
  }

  // ----- Tab-Aware Interval Polling -----

  function tickPolling() {
    pollStats();
    if (activeTab === 'overview') { pollHealth(); pollEnablement(); }
    if (activeTab === 'events') { pollStreaming(); }
    if (activeTab === 'system') { pollSysHealth(); pollMetrics(); }
    if (activeTab === 'agents') { pollAgents(); }
    if (activeTab === 'plugins') { pollPlugins(); pollEnablement(); }
  }

  // ----- Init -----

  connectSSE();
  pollForTab('overview');
  setInterval(tickPolling, 10000);
  setInterval(pollStats, 5000);
})();
</script>
</body>
</html>`;
}
