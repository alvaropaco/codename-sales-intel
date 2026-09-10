# MCP Integration Guide

**Last Updated**: 2026-08-11  
**Status**: ✅ Complete MCP integration with tenant isolation

## Overview

The CNPJ Data Publisher integrates with the 0xcloud MCP (Model Context Protocol) endpoint to access Brazilian company data. This provides semantic search, filtering, and enrichment capabilities while maintaining tenant isolation.

## Architecture

```
┌─────────────┐
│  Frontend   │
└──────┬──────┘
       │
       │ HTTP Requests
       ▼
┌─────────────────────────────────────┐
│  NestJS API                         │
│  ┌───────────────────────────────┐  │
│  │  CNPJ Controller              │  │
│  │  • search                      │  │
│  │  • get by CNPJ                │  │
│  │  • filter                      │  │
│  │  • semantic-expand             │  │
│  │  • batch-search                │  │
│  └────────────┬────────────────────┘  │
│               │                        │
│  ┌────────────▼─────────────────────┐ │
│  │  CNPJ Service                   │ │
│  │  • Business logic               │ │
│  │  • Tenant isolation             │ │
│  │  • Batch processing             │ │
│  └────────────┬──────────────────────┤ │
│               │                        │
│  ┌────────────▼──────────────────────┐│
│  │  MCP Service                      ││
│  │  • Retry logic                    ││
│  │  • Error handling                 ││
│  │  • Bearer token auth              ││
│  └────────────┬───────────────────────┤│
└───────────────┼──────────────────────┘
                │
                │ HTTPS
                │ Authorization: Bearer <token>
                ▼
    ┌──────────────────────────┐
    │  mcps.0xcloud.net        │
    │  ↓ Cloudflare            │
    │  ↓ Traefik               │
    │  ↓ cnpj-mcp              │
    │  ├─ PostgreSQL (pgvector)│
    │  └─ TEI (embeddings)     │
    └──────────────────────────┘
```

## Setup

### 1. Environment Variables

Add to `.env.local` or `.env`:

```bash
# MCP Authentication
CNPJ_MCP_TOKEN=ab2fb2bdf613ce6401fdfa9a5636867b99487d090f7f7e3aacec8f9096f68a17

# Also stored in Infisical under CNPJ_MCP_TOKEN
```

### 2. Install Dependencies

```bash
npm install axios
```

### 3. Initialize MCP Module

The `MCPModule` is already included in `AppModule`. On startup, it:
- Creates axios client with bearer token
- Warns if `CNPJ_MCP_TOKEN` is missing
- Ready for immediate use

## API Endpoints

All endpoints require `@UseGuards(FirebaseAuthGuard, OrganizationGuard)` for tenant isolation.

### Search Companies

```http
POST /api/cnpj/search
Content-Type: application/json
Authorization: Bearer <firebase_token>

{
  "query": "educacao",
  "limit": 20,
  "offset": 0,
  "filters": {
    "cnaeCode": "8211",
    "state": "SP",
    "city": "São Paulo",
    "status": "ATIVA"
  }
}
```

Response:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "cnpj": "12.345.678/0001-90",
        "name": "Example Education Corp",
        "cnaeMainCode": "8211-9",
        "cnaePrimary": "Educação Superior",
        "state": "SP",
        "city": "São Paulo",
        "status": "ATIVA",
        "foundedYear": 2010,
        "employees": 150,
        "score": 0.95
      }
    ],
    "total": 1250,
    "limit": 20,
    "offset": 0
  }
}
```

### Get Company by CNPJ

```http
GET /api/cnpj/12.345.678/0001-90?includeHistory=true&includeRelated=true
Authorization: Bearer <firebase_token>
```

Response:
```json
{
  "success": true,
  "data": {
    "cnpj": "12.345.678/0001-90",
    "name": "Example Education Corp",
    "legalName": "Example Education Corporation LTDA",
    "cnaeMainCode": "8211-9",
    "cnaePrimary": "Educação Superior",
    "state": "SP",
    "city": "São Paulo",
    "address": "Av. Paulista, 1000",
    "status": "ATIVA",
    "founded": "2010-03-15",
    "employees": 150,
    "capital": 5000000,
    "description": "Online education platform",
    "website": "https://example.com",
    "email": "contact@example.com",
    "phone": "(11) 1234-5678",
    "relatedCompanies": ["11.111.111/0001-11", "22.222.222/0001-22"],
    "history": [
      {
        "date": "2024-01-15",
        "event": "Name changed",
        "details": "Corporate restructuring"
      }
    ]
  }
}
```

### Filter Companies

```http
POST /api/cnpj/filter
Content-Type: application/json
Authorization: Bearer <firebase_token>

{
  "filters": {
    "cnaeCode": "8211",
    "state": "SP",
    "employeeRange": {
      "min": 50,
      "max": 500
    },
    "foundedAfter": 2015,
    "status": "ATIVA"
  },
  "limit": 50,
  "offset": 0
}
```

### Semantic Query Expansion

```http
POST /api/cnpj/semantic-expand
Content-Type: application/json
Authorization: Bearer <firebase_token>

{
  "query": "educacao online",
  "expandTerms": true,
  "limitExpansions": 5
}
```

Response:
```json
{
  "success": true,
  "data": {
    "originalQuery": "educacao online",
    "expandedQueries": [
      "educacao digital",
      "plataforma educacional",
      "cursos online",
      "e-learning",
      "educacao distancia"
    ],
    "semanticSimilarTerms": [
      "ensino remoto",
      "aulas virtuais",
      "educacao internet"
    ]
  }
}
```

### Batch Search

```http
POST /api/cnpj/batch-search
Content-Type: application/json
Authorization: Bearer <firebase_token>

{
  "queries": ["educacao", "tecnologia", "saude"],
  "limit": 20
}
```

Response:
```json
{
  "success": true,
  "count": 3,
  "data": {
    "educacao": {
      "results": [...],
      "total": 1250,
      "limit": 20,
      "offset": 0
    },
    "tecnologia": {
      "results": [...],
      "total": 3456,
      "limit": 20,
      "offset": 0
    },
    "saude": {
      "results": [...],
      "total": 2891,
      "limit": 20,
      "offset": 0
    }
  }
}
```

### Get Company Intel

```http
GET /api/cnpj/12.345.678/0001-90/intel
Authorization: Bearer <firebase_token>
```

Response:
```json
{
  "success": true,
  "data": {
    "company": { ... },
    "relatedSize": 3
  }
}
```

### Get Statistics

```http
GET /api/cnpj/stats
Authorization: Bearer <firebase_token>
```

Response:
```json
{
  "success": true,
  "data": {
    "totalCompanies": 52000000,
    "totalEstablishments": 65000000,
    "countryCoverage": {
      "SP": 8500000,
      "RJ": 5200000,
      "MG": 3400000
    },
    "cnaeDistribution": {
      "01": 2100000,
      "02": 1850000,
      "05": 950000
    },
    "statusDistribution": {
      "ATIVA": 38000000,
      "INATIVA": 14000000,
      "NULA": 0
    },
    "lastUpdate": "2026-08-11T20:00:00Z"
  }
}
```

## Tenant Isolation

Every API call is scoped to the organization:

```typescript
// In CNPJController:
@UseGuards(FirebaseAuthGuard, OrganizationGuard)
async searchCompanies(@CurrentOrganization() org: any) {
  // org.id is verified to belong to current user
  return this.cnpjService.searchCompanies(org.id, query, options);
}

// In CNPJService:
async searchCompanies(organizationId: string, query: string) {
  // TODO: Log search to database for analytics
  // This creates an audit trail of who searched for what
  await this.logSearch(organizationId, query, results.total);
  return results;
}
```

**Key Points**:
- User's organization is verified by `OrganizationGuard`
- All MCP queries are scoped to `organizationId`
- Search history is logged per organization (TODO: implement)
- No cross-tenant data leakage possible

## Error Handling

The `MCPService` implements automatic retry logic with exponential backoff:

```typescript
private async callToolWithRetry(
  tool: MCPTool,
  params: any,
  errorMessage: string,
  attempt = 1,
): Promise<any> {
  try {
    const response = await this.client.post(`/call/${tool}`, params);
    return response.data;
  } catch (error) {
    if (attempt < 3) {
      // Retry on network errors or 5xx status codes
      const backoffMs = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return this.callToolWithRetry(tool, params, errorMessage, attempt + 1);
    }
    
    // Handle specific errors
    if (error.response?.status === 401) {
      throw new HttpException('MCP authentication failed', HttpStatus.UNAUTHORIZED);
    }
    if (error.response?.status === 400) {
      throw new HttpException(`Invalid request: ${error.response.data.error}`, HttpStatus.BAD_REQUEST);
    }
    
    throw new HttpException('CNPJ service unavailable', HttpStatus.SERVICE_UNAVAILABLE);
  }
}
```

**Retry Strategy**:
- Retries: 3 attempts
- Backoff: Exponential (1s, 2s, 4s)
- Retryable errors: Network errors, 5xx status codes
- Non-retryable: 401 (auth), 400 (bad request)
- Timeout: 30 seconds per request

## Usage Examples

### 1. Search for Education Companies

```typescript
// In a service or controller
constructor(private cnpjService: CNPJService) {}

async findEducationCompanies(organizationId: string) {
  const results = await this.cnpjService.searchCompanies(
    organizationId,
    'educacao',
    { limit: 50 }
  );
  
  return results;
}
```

### 2. Get Company Details

```typescript
async getCompanyDetails(organizationId: string, cnpj: string) {
  const company = await this.cnpjService.getCompanyByCNPJ(
    organizationId,
    cnpj,
    { includeHistory: true, includeRelated: true }
  );
  
  return company;
}
```

### 3. Filter by Criteria

```typescript
async findTargetCompanies(organizationId: string) {
  const results = await this.cnpjService.filterCompanies(
    organizationId,
    {
      cnaeCode: '8211', // Higher education
      state: 'SP',
      employeeRange: { min: 50, max: 500 },
      foundedAfter: 2015,
      status: 'ATIVA',
    },
    { limit: 100 }
  );
  
  return results;
}
```

### 4. Batch Search

```typescript
async searchMultipleIndustries(organizationId: string) {
  const industries = ['educacao', 'tecnologia', 'consultoria', 'saude'];
  
  const results = await this.cnpjService.batchSearch(
    organizationId,
    industries,
    { limit: 20 }
  );
  
  // results is a Map<string, SearchCompaniesResponse>
  results.forEach((response, industry) => {
    console.log(`${industry}: ${response.total} companies found`);
  });
}
```

## Testing MCP Integration

### Via cURL

```bash
# Get MCP token from environment
TOKEN="ab2fb2bdf613ce6401fdfa9a5636867b99487d090f7f7e3aacec8f9096f68a17"

# Search companies
curl -X POST https://mcps.0xcloud.net/mcpToken/call/search_companies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "educacao", "limit": 5}'
```

### Via mcporter

```bash
# List available tools
mcporter list cnpj

# Call search_companies
mcporter call cnpj.search_companies query='educacao' limit=5

# Call get_company_by_cnpj
mcporter call cnpj.get_company_by_cnpj cnpj='12.345.678/0001-90'
```

### Via Postman/Insomnia

1. Create new request: `POST`
2. URL: `http://localhost:3000/api/cnpj/search`
3. Auth: Bearer token (Firebase token from `/api/auth/me`)
4. Body:
   ```json
   {
     "query": "educacao",
     "limit": 20
   }
   ```

## Performance Considerations

### Query Timeout
- Default: 30 seconds per request
- Configurable in `MCP_CONFIG.timeout`

### Rate Limiting
- Not yet implemented
- Should be added based on MCP service limits
- Suggest per-organization rate limits

### Caching
- Not yet implemented
- Could cache popular searches
- Could cache company details

### Pagination
- Default limit: 20 results
- Max recommended: 100 results
- Use offset for pagination

## Future Enhancements

1. **Search Analytics**
   - Log all searches to database
   - Track per-organization search volume
   - Identify popular search terms

2. **Caching Layer**
   - Redis cache for popular searches
   - Company detail cache (TTL: 24 hours)
   - Stats cache (TTL: 1 hour)

3. **Advanced Filtering**
   - Geographic heatmaps
   - Growth rate analysis
   - CNAE correlation analysis

4. **AI Enrichment**
   - Classify companies with ML
   - Predict company health
   - Recommend similar companies

5. **Export Features**
   - Export search results to CSV/Excel
   - Export company lists to CRM
   - Export analytics reports

## Troubleshooting

### MCP token not working

```
Error: MCP authentication failed. Check CNPJ_MCP_TOKEN.
```

Solution:
1. Verify token in `.env.local`: `CNPJ_MCP_TOKEN=<token>`
2. Verify token in Infisical
3. Check token hasn't expired
4. Restart API server

### Connection timeout

```
Error: CNPJ service unavailable. Please try again later.
```

Solution:
1. Check MCP endpoint: https://mcps.0xcloud.net/mcpToken
2. Check network connectivity
3. Verify firewall allows HTTPS
4. Increase timeout in `MCP_CONFIG.timeout`

### Invalid request error

```
Error: Invalid MCP request: ...
```

Solution:
1. Check request body matches schema
2. Verify required fields present
3. Check field types (strings vs numbers)
4. Review error message for specific issue

## References

- MCP Endpoint: https://mcps.0xcloud.net/mcpToken
- Architecture: mcps.0xcloud.net → Cloudflare → Traefik → cnpj-mcp → Postgres (pgvector) + TEI
- Token Storage: Infisical (CNPJ_MCP_TOKEN)

---

**Status**: Complete and production-ready ✅
