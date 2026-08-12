#!/usr/bin/env node

/**
 * SalesIntel MCP Server
 * Exposes SalesIntel platform capabilities via Model Context Protocol
 * 
 * Resources:
 *   - prospects: List/read prospect records
 *   - analytics/pipeline: Pipeline metrics and calculations
 *   - analytics/forecast: Revenue forecasts
 * 
 * Tools:
 *   - qualify_prospect: Score and qualify a prospect
 *   - assess_credit_risk: Evaluate credit risk for a company
 *   - create_prospect: Add new prospect to database
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  TextContent,
  ToolResultBlockSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { PrismaClient } = require("@prisma/client");

// Initialize Prisma client
const prisma = new PrismaClient();

// Initialize MCP server
const server = new Server({
  name: "salesintel-mcp",
  version: "1.0.0",
}, {
  capabilities: {
    resources: {},
    tools: {},
  },
});

// ============================================================================
// RESOURCES - Data sources that can be queried
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "prospects://list",
        name: "List Prospects",
        description: "Get all prospects from the database",
        mimeType: "application/json",
      },
      {
        uri: "prospects://count",
        name: "Count Prospects",
        description: "Get total count of prospects by status",
        mimeType: "application/json",
      },
      {
        uri: "analytics://pipeline",
        name: "Pipeline Analytics",
        description: "Get pipeline metrics: total, qualified, prospects, leads, rates",
        mimeType: "application/json",
      },
      {
        uri: "analytics://forecast",
        name: "Revenue Forecast",
        description: "Get revenue forecast for current and next month",
        mimeType: "application/json",
      },
      {
        uri: "analytics://breakdown",
        name: "Status Breakdown",
        description: "Get prospect count breakdown by status",
        mimeType: "application/json",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;

  try {
    if (uri === "prospects://list") {
      const prospects = await prisma.prospect.findMany({
        select: {
          id: true,
          cnpj: true,
          companyName: true,
          status: true,
          opportunityScore: true,
          revenueEstimate: true,
          employees: true,
          industry: true,
          createdAt: true,
        },
        orderBy: { opportunityScore: "desc" },
      });

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                count: prospects.length,
                prospects,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (uri === "prospects://count") {
      const counts = await prisma.prospect.groupBy({
        by: ["status"],
        _count: true,
      });

      const breakdown = {
        total: 0,
        qualified: 0,
        prospect: 0,
        lead: 0,
      };

      counts.forEach((item) => {
        breakdown[item.status] = item._count;
        breakdown.total += item._count;
      });

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(breakdown, null, 2),
          },
        ],
      };
    }

    if (uri === "analytics://pipeline") {
      const prospects = await prisma.prospect.findMany({
        select: { status: true, opportunityScore: true },
      });

      const qualified = prospects.filter((p) => p.status === "qualified").length;
      const prospectCount = prospects.filter((p) => p.status === "prospect").length;
      const leads = prospects.filter((p) => p.status === "lead").length;
      const total = prospects.length;

      const analytics = {
        total_prospects: total,
        qualified,
        prospects: prospectCount,
        leads,
        qualification_rate: total > 0 ? (qualified / total).toFixed(2) : 0,
        closure_rate: total > 0 ? (qualified / total * 0.85).toFixed(2) : 0, // Estimate
        timestamp: new Date().toISOString(),
      };

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(analytics, null, 2),
          },
        ],
      };
    }

    if (uri === "analytics://forecast") {
      // Simplified forecast based on current qualified prospects
      const qualified = await prisma.prospect.count({
        where: { status: "qualified" },
      });

      const avgDeal = 15000; // R$ 15k average deal size
      const thisMonth = qualified * avgDeal;
      const nextMonth = Math.round(thisMonth * 1.15); // 15% growth
      const q3 = Math.round(nextMonth * 2.5); // 2.5x for quarter

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                this_month: thisMonth,
                next_month: nextMonth,
                q3_projection: q3,
                currency: "BRL",
                basis: `${qualified} qualified prospects × ${avgDeal} avg deal`,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (uri === "analytics://breakdown") {
      const breakdown = await prisma.prospect.groupBy({
        by: ["status"],
        _count: true,
        _avg: { opportunityScore: true },
      });

      const formatted = breakdown.map((item) => ({
        status: item.status,
        count: item._count,
        avg_score: Math.round(item._avg.opportunityScore || 0),
      }));

      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                breakdown: formatted,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  } catch (error) {
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: error.message }, null, 2),
        },
      ],
    };
  }
});

// ============================================================================
// TOOLS - Actions that can be performed
// ============================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "qualify_prospect") {
      const { company_name, industry, employees, revenue_estimate } = args;

      // Simple qualification logic
      let score = 50; // Base score

      // Industry bonus
      if (
        ["Software", "Technology", "SaaS", "Fintech"].includes(industry)
      ) {
        score += 20;
      }

      // Size bonus
      if (employees >= 100) score += 15;
      if (employees >= 500) score += 10;

      // Revenue bonus
      if (revenue_estimate >= 1000000) score += 15;
      if (revenue_estimate >= 5000000) score += 10;

      const level =
        score >= 75
          ? "qualified"
          : score >= 50
          ? "prospect"
          : "lead";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                company: company_name,
                qualification: {
                  score: Math.min(100, score),
                  level,
                  confidence: (0.7 + Math.random() * 0.3).toFixed(2),
                  factors: [
                    "industry_fit",
                    "company_size",
                    "revenue_scale",
                  ],
                },
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "assess_credit_risk") {
      const { cnpj } = args;

      // Simulate credit risk assessment
      const riskScore = Math.floor(Math.random() * 100);
      const level =
        riskScore >= 70
          ? "high"
          : riskScore >= 40
          ? "medium"
          : "low";

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                cnpj,
                risk_assessment: {
                  score: riskScore,
                  level,
                  factors: [
                    "payment_history",
                    "revenue_stability",
                    "market_position",
                  ],
                  recommendation:
                    level === "high"
                      ? "Request additional documentation"
                      : "Proceed with standard process",
                },
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    if (name === "create_prospect") {
      const {
        cnpj,
        company_name,
        status,
        industry,
        employees,
        revenue_estimate,
      } = args;

      // Validate CNPJ format
      if (!/^\d{2}\.\d{3}\.\d{3}\/0001-\d{2}$/.test(cnpj)) {
        throw new Error(
          "Invalid CNPJ format. Expected: XX.XXX.XXX/0001-XX"
        );
      }

      // Check if prospect already exists
      const existing = await prisma.prospect.findUnique({
        where: { cnpj },
      });

      if (existing) {
        throw new Error(`Prospect with CNPJ ${cnpj} already exists`);
      }

      // Get or create default organization
      let org = await prisma.organization.findFirst();
      if (!org) {
        org = await prisma.organization.create({
          data: { name: "Default Organization" },
        });
      }

      // Create new prospect
      const prospect = await prisma.prospect.create({
        data: {
          cnpj,
          companyName: company_name,
          status: status || "prospect",
          industry,
          employees: employees || 0,
          revenueEstimate: revenue_estimate || 0,
          opportunityScore: 65, // Default score
          orgId: org.id,
        },
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                prospect: {
                  id: prospect.id,
                  cnpj: prospect.cnpj,
                  company_name: prospect.companyName,
                  status: prospect.status,
                  industry: prospect.industry,
                  employees: prospect.employees,
                  revenue_estimate: prospect.revenueEstimate,
                  opportunity_score: prospect.opportunityScore,
                  created_at: prospect.createdAt,
                },
                message: `Prospect ${company_name} created successfully`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: error.message,
              tool: name,
              timestamp: new Date().toISOString(),
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const toolsHandler = async () => {
  return {
    tools: [
      {
        name: "qualify_prospect",
        description:
          "Score and qualify a prospect based on company characteristics",
        inputSchema: {
          type: "object",
          properties: {
            company_name: {
              type: "string",
              description: "Name of the company",
            },
            industry: {
              type: "string",
              description:
                "Industry sector (e.g., Software, Finance, Healthcare)",
            },
            employees: {
              type: "number",
              description: "Number of employees",
            },
            revenue_estimate: {
              type: "number",
              description: "Estimated annual revenue in BRL",
            },
          },
          required: ["company_name", "industry"],
        },
      },
      {
        name: "assess_credit_risk",
        description: "Evaluate credit risk for a company",
        inputSchema: {
          type: "object",
          properties: {
            cnpj: {
              type: "string",
              description: "Company CNPJ (format: XX.XXX.XXX/0001-XX)",
            },
          },
          required: ["cnpj"],
        },
      },
      {
        name: "create_prospect",
        description: "Create a new prospect record in the database",
        inputSchema: {
          type: "object",
          properties: {
            cnpj: {
              type: "string",
              description:
                "Company CNPJ (format: XX.XXX.XXX/0001-XX, must be unique)",
            },
            company_name: {
              type: "string",
              description: "Legal company name",
            },
            status: {
              type: "string",
              enum: ["prospect", "qualified", "lead"],
              description: "Initial status (default: prospect)",
            },
            industry: {
              type: "string",
              description: "Industry classification",
            },
            employees: {
              type: "number",
              description: "Number of employees",
            },
            revenue_estimate: {
              type: "number",
              description: "Estimated annual revenue in BRL",
            },
          },
          required: ["cnpj", "company_name"],
        },
      },
    ],
  };
};

server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "qualify_prospect") {
        const { company_name, industry, employees, revenue_estimate } = args;

        // Simple qualification logic
        let score = 50; // Base score

        // Industry bonus
        if (
          ["Software", "Technology", "SaaS", "Fintech"].includes(industry)
        ) {
          score += 20;
        }

        // Size bonus
        if (employees >= 100) score += 15;
        if (employees >= 500) score += 10;

        // Revenue bonus
        if (revenue_estimate >= 1000000) score += 15;
        if (revenue_estimate >= 5000000) score += 10;

        const level =
          score >= 75
            ? "qualified"
            : score >= 50
            ? "prospect"
            : "lead";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  company: company_name,
                  qualification: {
                    score: Math.min(100, score),
                    level,
                    confidence: (0.7 + Math.random() * 0.3).toFixed(2),
                    factors: [
                      "industry_fit",
                      "company_size",
                      "revenue_scale",
                    ],
                  },
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === "assess_credit_risk") {
        const { cnpj } = args;

        // Simulate credit risk assessment
        const riskScore = Math.floor(Math.random() * 100);
        const level =
          riskScore >= 70
            ? "high"
            : riskScore >= 40
            ? "medium"
            : "low";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  cnpj,
                  risk_assessment: {
                    score: riskScore,
                    level,
                    factors: [
                      "payment_history",
                      "revenue_stability",
                      "market_position",
                    ],
                    recommendation:
                      level === "high"
                        ? "Request additional documentation"
                        : "Proceed with standard process",
                  },
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      if (name === "create_prospect") {
        const {
          cnpj,
          company_name,
          status,
          industry,
          employees,
          revenue_estimate,
        } = args;

        // Validate CNPJ format
        if (!/^\d{2}\.\d{3}\.\d{3}\/0001-\d{2}$/.test(cnpj)) {
          throw new Error(
            "Invalid CNPJ format. Expected: XX.XXX.XXX/0001-XX"
          );
        }

        // Check if prospect already exists
        const existing = await prisma.prospect.findUnique({
          where: { cnpj },
        });

        if (existing) {
          throw new Error(`Prospect with CNPJ ${cnpj} already exists`);
        }

        // Get or create default organization
        let org = await prisma.organization.findFirst();
        if (!org) {
          org = await prisma.organization.create({
            data: { name: "Default Organization" },
          });
        }

        // Create new prospect
        const prospect = await prisma.prospect.create({
          data: {
            cnpj,
            companyName: company_name,
            status: status || "prospect",
            industry,
            employees: employees || 0,
            revenueEstimate: revenue_estimate || 0,
            opportunityScore: 65, // Default score
            orgId: org.id,
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  prospect: {
                    id: prospect.id,
                    cnpj: prospect.cnpj,
                    company_name: prospect.companyName,
                    status: prospect.status,
                    industry: prospect.industry,
                    employees: prospect.employees,
                    revenue_estimate: prospect.revenueEstimate,
                    opportunity_score: prospect.opportunityScore,
                    created_at: prospect.createdAt,
                  },
                  message: `Prospect ${company_name} created successfully`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: error.message,
                tool: name,
                timestamp: new Date().toISOString(),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }
);

// ============================================================================
// SERVER LIFECYCLE
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();

  console.error("[MCP Server] Initializing SalesIntel MCP Server...");
  console.error("[MCP Server] Database connection to:", process.env.DATABASE_URL || "localhost:5432");

  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    console.error("[MCP Server] ✅ Database connected");
  } catch (error) {
    console.error("[MCP Server] ❌ Database connection failed:", error.message);
    process.exit(1);
  }

  await server.connect(transport);
  console.error("[MCP Server] ✅ Server connected and listening");
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.error("[MCP Server] Shutting down...");
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((error) => {
  console.error("[MCP Server] Fatal error:", error);
  process.exit(1);
});
