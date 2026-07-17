/**
 * Minimal read-write web dashboard for QueueCTL.
 *
 * Serves a live dashboard showing job counts, recent jobs, and worker status.
 * Auto-refreshes every 2 seconds via fetch. Supports enqueuing custom jobs
 * directly from the web UI to bypass Render Free Tier CLI shell limitations.
 *
 * Usage: queuectl dashboard [--port 3000]
 */

import express from 'express';
import type Database from 'better-sqlite3';
import { getJobCounts, getMetrics, listJobs, insertJob } from '../core/jobRepository';
import type { WorkerInfo, Job } from '../types';

export function startDashboard(db: Database.Database, port: number): void {
  const app = express();

  // Enable JSON body parsing for API requests
  app.use(express.json());

  // ─── API Endpoints ────────────────────────────────────────────────────────

  app.get('/api/status', (_req, res) => {
    const counts = getJobCounts(db);
    const metrics = getMetrics(db);
    const workers = db
      .prepare("SELECT * FROM workers WHERE status IN ('idle', 'busy') ORDER BY started_at")
      .all() as WorkerInfo[];

    res.json({ counts, metrics, workers });
  });

  app.get('/api/jobs', (req, res) => {
    const state = req.query.state as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const jobs = listJobs(
      db,
      state as Job['state'] | undefined,
      limit,
    );
    res.json(jobs);
  });

  // POST endpoint to allow enqueuing from the dashboard (bypasses Render Free shell limits)
  app.post('/api/enqueue', (req, res) => {
    const { command, priority, max_retries, timeout_seconds } = req.body;

    if (!command || typeof command !== 'string') {
      res.status(400).json({ success: false, error: 'Command string is required' });
      return;
    }

    try {
      const job = insertJob(db, {
        command,
        priority: priority !== undefined ? Number(priority) : undefined,
        max_retries: max_retries !== undefined ? Number(max_retries) : undefined,
        timeout_seconds: timeout_seconds !== undefined ? Number(timeout_seconds) : undefined,
      });

      res.json({ success: true, job });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ─── Dashboard HTML ───────────────────────────────────────────────────────

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(getDashboardHTML());
  });

  app.listen(port, () => {
    console.log(`🌐 Dashboard running at http://localhost:${port}`);
    console.log('   Press Ctrl+C to stop.');
  });
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QueueCTL Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-bottom: 1px solid #334155;
      padding: 1.5rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      color: #f8fafc;
    }
    .header h1 span { color: #38bdf8; }
    .header .status-dot {
      width: 10px; height: 10px;
      background: #22c55e;
      border-radius: 50%;
      display: inline-block;
      margin-right: 8px;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.25rem;
      text-align: center;
      transition: transform 0.2s, border-color 0.2s;
    }
    .card:hover { transform: translateY(-2px); border-color: #475569; }
    .card .count {
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .card.pending .count { background: linear-gradient(135deg, #fbbf24, #f59e0b); -webkit-background-clip: text; }
    .card.processing .count { background: linear-gradient(135deg, #38bdf8, #06b6d4); -webkit-background-clip: text; }
    .card.completed .count { background: linear-gradient(135deg, #22c55e, #10b981); -webkit-background-clip: text; }
    .card.failed .count { background: linear-gradient(135deg, #f97316, #ef4444); -webkit-background-clip: text; }
    .card.dead .count { background: linear-gradient(135deg, #ef4444, #dc2626); -webkit-background-clip: text; }
    .card .label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #94a3b8;
      margin-top: 0.5rem;
    }
    .metrics-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .metric .value { font-size: 1.25rem; font-weight: 700; color: #38bdf8; }
    .metric .label { font-size: 0.8rem; color: #94a3b8; }
    
    /* Enqueue Form styles */
    .enqueue-section {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .enqueue-form {
      display: flex;
      gap: 1rem;
      align-items: flex-end;
      flex-wrap: wrap;
    }
    .form-group {
      flex: 1;
      min-width: 120px;
    }
    .form-group.wide {
      flex: 3;
      min-width: 250px;
    }
    .form-group label {
      display: block;
      font-size: 0.8rem;
      color: #94a3b8;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .form-group input {
      width: 100%;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.6rem;
      color: #e2e8f0;
      font-size: 0.9rem;
    }
    .form-group input:focus {
      outline: none;
      border-color: #38bdf8;
    }
    .form-group input.code {
      font-family: 'SF Mono', 'Cascadia Code', monospace;
    }
    .enqueue-btn {
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      border: none;
      border-radius: 6px;
      padding: 0.6rem 2rem;
      color: #0f172a;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }
    .enqueue-btn:hover {
      opacity: 0.9;
    }
    .enqueue-btn:active {
      transform: scale(0.98);
    }
    .feedback {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      font-weight: 500;
      min-height: 1.25rem;
    }

    .section { margin-bottom: 2rem; }
    .section h2 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #1e293b;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #334155;
    }
    th {
      background: #0f172a;
      padding: 0.75rem 1rem;
      text-align: left;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #64748b;
      border-bottom: 1px solid #334155;
    }
    td {
      padding: 0.65rem 1rem;
      font-size: 0.85rem;
      border-bottom: 1px solid #1e293b;
      color: #cbd5e1;
    }
    tr:hover td { background: #1e293b80; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.pending { background: #fbbf2420; color: #fbbf24; }
    .badge.processing { background: #38bdf820; color: #38bdf8; }
    .badge.completed { background: #22c55e20; color: #22c55e; }
    .badge.failed { background: #f9731620; color: #f97316; }
    .badge.dead { background: #ef444420; color: #ef4444; }
    .badge.idle { background: #22c55e20; color: #22c55e; }
    .badge.busy { background: #38bdf820; color: #38bdf8; }
    .mono { font-family: 'SF Mono', 'Cascadia Code', monospace; font-size: 0.8rem; }
    .footer {
      text-align: center;
      padding: 2rem;
      color: #475569;
      font-size: 0.8rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1><span>Queue</span>CTL Dashboard</h1>
    <div><span class="status-dot"></span> Live</div>
  </div>
  <div class="container">
    <div class="cards" id="cards"></div>
    <div class="metrics-row" id="metrics"></div>

    <!-- Enqueue Job Box (Direct Web UI Interaction) -->
    <div class="enqueue-section">
      <h2 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
        Enqueue Custom Job
      </h2>
      <div class="enqueue-form">
        <div class="form-group wide">
          <label for="cmd">Shell Command</label>
          <input type="text" id="cmd" class="code" placeholder="e.g., echo 'Hello World'" value="echo 'Hello Flam!'">
        </div>
        <div class="form-group">
          <label for="priority">Priority</label>
          <input type="number" id="priority" value="0" min="0" max="100">
        </div>
        <div class="form-group">
          <label for="retries">Max Retries</label>
          <input type="number" id="retries" value="3" min="1" max="10">
        </div>
        <div>
          <button class="enqueue-btn" onclick="enqueueJob()">Enqueue</button>
        </div>
      </div>
      <div id="feedback" class="feedback"></div>
    </div>

    <div class="section">
      <h2>Workers</h2>
      <table id="workers-table">
        <thead><tr><th>Worker ID</th><th>Status</th><th>Current Job</th><th>PID</th><th>Uptime</th></tr></thead>
        <tbody id="workers-body"></tbody>
      </table>
    </div>
    <div class="section">
      <h2>Recent Jobs</h2>
      <table id="jobs-table">
        <thead><tr><th>ID</th><th>Command</th><th>State</th><th>Attempts</th><th>Error</th><th>Created</th></tr></thead>
        <tbody id="jobs-body"></tbody>
      </table>
    </div>
  </div>
  <div class="footer">QueueCTL v1.0.0 &mdash; Auto-refreshing every 2s</div>

  <script>
    function formatUptime(startedAt) {
      const diff = Date.now() - new Date(startedAt).getTime();
      const s = Math.floor(diff / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return h + 'h' + (m % 60) + 'm';
      if (m > 0) return m + 'm' + (s % 60) + 's';
      return s + 's';
    }

    function truncate(str, len) {
      return str && str.length > len ? str.slice(0, len-3) + '...' : (str || '');
    }

    async function enqueueJob() {
      const command = document.getElementById('cmd').value.trim();
      const priority = parseInt(document.getElementById('priority').value, 10) || 0;
      const max_retries = parseInt(document.getElementById('retries').value, 10) || 3;
      const feedback = document.getElementById('feedback');

      if (!command) {
        feedback.style.color = '#ef4444';
        feedback.innerText = 'Error: Command cannot be empty';
        return;
      }

      feedback.style.color = '#38bdf8';
      feedback.innerText = 'Enqueuing...';

      try {
        const response = await fetch('/api/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, priority, max_retries })
        });
        const data = await response.json();

        if (data.success) {
          feedback.style.color = '#22c55e';
          feedback.innerText = 'Job enqueued successfully: ' + data.job.id;
          refresh();
        } else {
          feedback.style.color = '#ef4444';
          feedback.innerText = 'Error: ' + data.error;
        }
      } catch (err) {
        feedback.style.color = '#ef4444';
        feedback.innerText = 'Request failed: ' + err.message;
      }
    }

    async function refresh() {
      try {
        const [statusRes, jobsRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/jobs?limit=30')
        ]);
        const status = await statusRes.json();
        const jobs = await jobsRes.json();

        // Cards
        const states = ['pending', 'processing', 'completed', 'failed', 'dead'];
        document.getElementById('cards').innerHTML = states.map(s =>
          '<div class="card ' + s + '">' +
            '<div class="count">' + (status.counts[s] || 0) + '</div>' +
            '<div class="label">' + s + '</div>' +
          '</div>'
        ).join('');

        // Metrics
        const m = status.metrics;
        document.getElementById('metrics').innerHTML =
          '<div class="metric"><div class="label">Total Processed</div><div class="value">' + m.totalProcessed + '</div></div>' +
          '<div class="metric"><div class="label">Success Rate</div><div class="value">' + (m.successRate !== null ? (m.successRate * 100).toFixed(1) + '%' : 'N/A') + '</div></div>' +
          '<div class="metric"><div class="label">Avg Exec Time</div><div class="value">' + (m.avgExecutionTimeMs !== null ? m.avgExecutionTimeMs + 'ms' : 'N/A') + '</div></div>';

        // Workers
        const wb = document.getElementById('workers-body');
        if (status.workers.length === 0) {
          wb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#475569">No active workers</td></tr>';
        } else {
          wb.innerHTML = status.workers.map(w =>
            '<tr>' +
              '<td class="mono">' + w.worker_id + '</td>' +
              '<td><span class="badge ' + w.status + '">' + w.status + '</span></td>' +
              '<td class="mono">' + (w.current_job_id || '-') + '</td>' +
              '<td>' + w.pid + '</td>' +
              '<td>' + formatUptime(w.started_at) + '</td>' +
            '</tr>'
          ).join('');
        }

        // Jobs
        const jb = document.getElementById('jobs-body');
        if (jobs.length === 0) {
          jb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#475569">No jobs yet</td></tr>';
        } else {
          jb.innerHTML = jobs.map(j =>
            '<tr>' +
              '<td class="mono">' + truncate(j.id, 20) + '</td>' +
              '<td class="mono">' + truncate(j.command, 30) + '</td>' +
              '<td><span class="badge ' + j.state + '">' + j.state + '</span></td>' +
              '<td>' + j.attempts + '/' + j.max_retries + '</td>' +
              '<td>' + truncate(j.last_error, 30) + '</td>' +
              '<td>' + new Date(j.created_at).toLocaleString() + '</td>' +
            '</tr>'
          ).join('');
        }
      } catch (e) {
        console.error('Refresh failed:', e);
      }
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
}
