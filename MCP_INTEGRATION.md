# SalesIntel MCP Integration

**Status: ✅ IMPLEMENTED**

The SalesIntel platform now exposes its capabilities via the Model Context Protocol (MCP), allowing LLMs and other clients to interact with the platform programmatically.

## Overview

MCP is a standardized protocol that allows AI models to:
- **Read resources**: Query prospects, analytics, forecasts
- **Call tools**: Perform actions like creating prospects, qualifying leads
- **Interact seamlessly**: Integrate SalesIntel into AI workflows

## Quick Start

### Start MCP Server
```bash
node mcp-server.js
```

### Add to MCP Configuration
```json
{
  "mcpServers": {
    "salesintel": {
      "command": "node",
      "args": ["/Users/alvaropaco/salesintel-platform/mcp-server.js"],
      "env": {
        "DATABASE_URL": "postgresql://cnpj:cnpj@localhost:5432/cnpj"
      }
    }
  }
}
```

## Resources (Readable Data)

### `prospects://list` - List all prospects
```json
{
  "count": 4,
  "prospects": [{
    "id": "...",
    "cnpj": "12.345.678/0001-99",
    "companyName": "Tech Innovations",
    "status": "qualified",
    "opportunityScore": 92
  }]
}
```

### `prospects://count` - Count by status
```json
{
  "total": 4,
  "qualified": 3,
  "prospect": 1,
  "lead": 0
}
```

### `analytics://pipeline` - Pipeline metrics
```json
{
  "total_prospects": 4,
  "qualified": 3,
  "prospects": 1,
  "leads": 0,
  "qualification_rate": "0.75",
  "closure_rate": "0.64"
}
```

### `analytics://forecast` - Revenue projections
```json
{
  "this_month": 45000,
  "next_month": 51750,
  "q3_projection": 129375,
  "currency": "BRL"
}
```

### `analytics://breakdown` - Status breakdown
```json
{
  "breakdown": [
    {"status": "qualified", "count": 3, "avg_score": 88},
    {"status": "prospect", "count": 1, "avg_score": 45}
  ]
}
```

## Tools (Callable Actions)

### `qualify_prospect` - Score a prospect
```
Input:
  company_name (required): "StartUp Tech"
  industry (required): "Software"
  employees (optional): 250
  revenue_estimate (optional): 2500000

Output:
  score: 85
  level: "qualified"
  confidence: "0.92"
  factors: ["industry_fit", "company_size", "revenue_scale"]
```

### `assess_credit_risk` - Evaluate risk
```
Input:
  cnpj (required): "12.345.678/0001-99"

Output:
  score: 42
  level: "medium"
  factors: ["payment_history", "revenue_stability", "market_position"]
  recommendation: "Proceed with standard process"
```

### `create_prospect` - Add new prospect
```
Input:
  cnpj (required, unique): "99.999.999/0001-88"
  company_name (required): "Inovação Global SA"
  status (optional): "qualified"
  industry (optional): "Finance"
  employees (optional): 320
  revenue_estimate (optional): 8500000

Output:
  Created prospect object with ID and all fields
```

## Architecture

```
┌─────────────────────────────────────────┐
│        MCP Client (Claude, etc.)       │
└────────────────┬──────────────────────┘
                 │ stdio (MCP Protocol)
┌────────────────┴──────────────────────┐
│       mcp-server.js                   │
│  • Resources (list, read)             │
│  • Tools (call)                       │
│  • Validation & Error Handling        │
└────────────────┬──────────────────────┘
                 │ Prisma ORM
┌────────────────┴──────────────────────┐
│       PostgreSQL Database             │
│  • prospects                          │
│  • organizations                      │
│  • users                              │
│  • activities                         │
│  • workflows                          │
└─────────────────────────────────────────┘
```

## What MCP Enables

✅ **Query prospects** - Get all prospects or specific ones via MCP  
✅ **View analytics** - Access pipeline metrics and forecasts  
✅ **Qualify leads** - Score prospects automatically  
✅ **Create prospects** - Add new leads to database via MCP  
✅ **Assess risk** - Evaluate credit risk for companies  

## Requirements

- Node.js 16+
- PostgreSQL running
- MCP SDK installed (`npm install @modelcontextprotocol/sdk`)

## Connection Details

- **Database**: PostgreSQL at localhost:5432
- **Database**: cnpj
- **User**: cnpj
- **Port**: 5432

## Next Steps

1. Start MCP server: `node mcp-server.js`
2. Add to Claude/LLM configuration
3. Query resources and call tools via MCP client
4. Integrate with AI workflows
