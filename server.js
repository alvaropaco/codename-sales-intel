const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Mock data
const prospects = [
  {
    id: '1',
    cnpj: '12.345.678/0001-99',
    company_name: 'Tech Solutions Brasil LTDA',
    status: 'qualified',
    opportunity_score: 92,
    revenue_estimate: 5000000,
    employees: 150,
    industry: 'Software',
    activities_count: 8,
    last_contact: '2024-08-11',
    qualification_stage: 'advanced_discovery'
  },
  {
    id: '2',
    cnpj: '98.765.432/0001-11',
    company_name: 'Logística Global SA',
    status: 'prospect',
    opportunity_score: 78,
    revenue_estimate: 12000000,
    employees: 450,
    industry: 'Logistics',
    activities_count: 3,
    last_contact: '2024-08-08',
    qualification_stage: 'initial_contact'
  }
];

const analytics = {
  pipeline_summary: {
    total_prospects: 47,
    qualified: 20,
    prospects: 15,
    leads: 12,
    qualification_rate: 0.80,
    closure_rate: 0.83
  },
  forecast: {
    this_month: 125000,
    next_month: 185000,
    q3_projection: 450000
  }
};

// Routes
app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>SalesIntel Platform</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px 0; margin-bottom: 30px; border-radius: 8px; }
        h1 { font-size: 2.5em; margin-bottom: 10px; }
        .subtitle { font-size: 1.1em; opacity: 0.9; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .card h3 { color: #667eea; margin-bottom: 10px; font-size: 1.3em; }
        .metric { font-size: 2em; font-weight: bold; color: #333; margin-bottom: 5px; }
        .label { color: #666; font-size: 0.9em; }
        .section { margin-bottom: 40px; }
        .section h2 { color: #333; margin-bottom: 15px; font-size: 1.5em; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        th { background: #667eea; color: white; padding: 15px; text-align: left; font-weight: 600; }
        td { padding: 15px; border-bottom: 1px solid #eee; }
        tr:hover { background: #f5f7fa; }
        .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 0.85em; font-weight: 600; }
        .badge.qualified { background: #d4edda; color: #155724; }
        .badge.prospect { background: #fff3cd; color: #856404; }
        .score { font-weight: bold; color: #667eea; }
        .api-section { margin-top: 30px; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .endpoint { background: #f5f7fa; padding: 10px; margin: 10px 0; border-left: 3px solid #667eea; font-family: 'Courier New', monospace; font-size: 0.9em; }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>📊 SalesIntel Platform</h1>
          <p class="subtitle">B2B SaaS for CNPJ Data Intelligence & Prospect Management</p>
        </header>

        <div class="section">
          <h2>Pipeline Overview</h2>
          <div class="grid">
            <div class="card">
              <h3>Total Prospects</h3>
              <div class="metric">47</div>
              <div class="label">Active opportunities</div>
            </div>
            <div class="card">
              <h3>Qualified Leads</h3>
              <div class="metric">20</div>
              <div class="label">Ready to engage</div>
            </div>
            <div class="card">
              <h3>Qualification Rate</h3>
              <div class="metric">80%</div>
              <div class="label">Leads meeting criteria</div>
            </div>
            <div class="card">
              <h3>Closure Rate</h3>
              <div class="metric">83%</div>
              <div class="label">Converted to deals</div>
            </div>
          </div>
        </div>

        <div class="section">
          <h2>Top Prospects</h2>
          <table>
            <thead>
              <tr>
                <th>Company</th>
                <th>CNPJ</th>
                <th>Industry</th>
                <th>Score</th>
                <th>Status</th>
                <th>Employees</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Tech Solutions Brasil LTDA</td>
                <td>12.345.678/0001-99</td>
                <td>Software</td>
                <td><span class="score">92/100</span></td>
                <td><span class="badge qualified">Qualified</span></td>
                <td>150</td>
              </tr>
              <tr>
                <td>Logística Global SA</td>
                <td>98.765.432/0001-11</td>
                <td>Logistics</td>
                <td><span class="score">78/100</span></td>
                <td><span class="badge prospect">Prospect</span></td>
                <td>450</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Revenue Forecast</h2>
          <div class="grid">
            <div class="card">
              <h3>This Month</h3>
              <div class="metric">R$ 125K</div>
              <div class="label">Expected revenue</div>
            </div>
            <div class="card">
              <h3>Next Month</h3>
              <div class="metric">R$ 185K</div>
              <div class="label">Projected revenue</div>
            </div>
            <div class="card">
              <h3>Q3 Projection</h3>
              <div class="metric">R$ 450K</div>
              <div class="label">Quarter outlook</div>
            </div>
          </div>
        </div>

        <div class="api-section">
          <h2>Available API Endpoints</h2>
          <p style="color: #666; margin-bottom: 15px;">All endpoints are running and ready for testing:</p>
          <div class="endpoint">GET /api/prospects - List all prospects</div>
          <div class="endpoint">GET /api/prospects/:id - Get prospect details</div>
          <div class="endpoint">POST /api/prospects - Create new prospect</div>
          <div class="endpoint">GET /api/analytics/pipeline - Pipeline analytics</div>
          <div class="endpoint">GET /api/analytics/forecast - Revenue forecast</div>
          <div class="endpoint">POST /api/intelligence/qualify - Qualification analysis</div>
          <div class="endpoint">POST /api/intelligence/credit-risk - Credit risk assessment</div>
          <div class="endpoint">GET /api/discovery/search - Search prospects</div>
          <div class="endpoint">POST /api/automation/workflow - Create automation workflow</div>
        </div>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

// API Endpoints
app.get('/api/prospects', (req, res) => {
  res.json({
    success: true,
    data: prospects,
    count: prospects.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/prospects/:id', (req, res) => {
  const prospect = prospects.find(p => p.id === req.params.id);
  if (!prospect) {
    return res.status(404).json({ error: 'Prospect not found' });
  }
  res.json({ success: true, data: prospect });
});

app.post('/api/prospects', (req, res) => {
  const newProspect = {
    id: String(prospects.length + 1),
    ...req.body,
    created_at: new Date().toISOString()
  };
  prospects.push(newProspect);
  res.status(201).json({ success: true, data: newProspect });
});

app.get('/api/analytics/pipeline', (req, res) => {
  res.json({
    success: true,
    data: analytics.pipeline_summary,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/analytics/forecast', (req, res) => {
  res.json({
    success: true,
    data: analytics.forecast,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/intelligence/qualify', (req, res) => {
  const { company_name } = req.body;
  res.json({
    success: true,
    company: company_name,
    qualification: {
      score: Math.floor(Math.random() * 40 + 60),
      level: Math.random() > 0.5 ? 'qualified' : 'prospect',
      confidence: (Math.random() * 0.4 + 0.6).toFixed(2)
    }
  });
});

app.post('/api/intelligence/credit-risk', (req, res) => {
  const { cnpj } = req.body;
  res.json({
    success: true,
    cnpj,
    risk_assessment: {
      score: Math.floor(Math.random() * 30 + 70),
      level: Math.random() > 0.6 ? 'low' : 'medium',
      factors: ['payment_history', 'revenue_stability', 'market_position']
    }
  });
});

app.get('/api/discovery/search', (req, res) => {
  const { q } = req.query;
  const results = prospects.filter(p => 
    p.company_name.toLowerCase().includes(String(q).toLowerCase())
  );
  res.json({ success: true, data: results, query: q });
});

app.post('/api/automation/workflow', (req, res) => {
  const { name, trigger, action } = req.body;
  res.json({
    success: true,
    workflow: {
      id: Date.now(),
      name,
      trigger,
      action,
      status: 'active',
      created_at: new Date().toISOString()
    }
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     SalesIntel Platform Running! 🚀       ║
╠════════════════════════════════════════════╣
║                                            ║
║  🌐 Dashboard: http://localhost:${PORT}          ║
║                                            ║
║  📊 API Endpoints Available:               ║
║     • GET  /api/prospects                  ║
║     • POST /api/prospects                  ║
║     • GET  /api/analytics/pipeline         ║
║     • GET  /api/analytics/forecast         ║
║     • POST /api/intelligence/qualify       ║
║     • POST /api/intelligence/credit-risk   ║
║     • GET  /api/discovery/search           ║
║     • POST /api/automation/workflow        ║
║                                            ║
║  Press Ctrl+C to stop                      ║
║                                            ║
╚════════════════════════════════════════════╝
  `);
});

process.on('SIGINT', () => {
  console.log('\n✅ Server stopped gracefully');
  process.exit(0);
});
