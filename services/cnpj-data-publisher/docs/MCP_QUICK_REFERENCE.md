# MCP Quick Reference

## Setup (5 minutes)

```bash
# 1. Set environment variable
echo "CNPJ_MCP_TOKEN=ab2fb2bdf613ce6401fdfa9a5636867b99487d090f7f7e3aacec8f9096f68a17" >> .env.local

# 2. Install dependencies
npm install

# 3. Start server
npm run dev

# 4. Test health check
curl http://localhost:3000/health/deep
# Should show: { "status": "ok", "services": { "mcp": true } }
```

## API Endpoints

### Search Companies
```bash
curl -X POST http://localhost:3000/api/cnpj/search \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "educacao",
    "limit": 20,
    "filters": { "state": "SP" }
  }'
```

### Get Company Details
```bash
curl -X GET "http://localhost:3000/api/cnpj/12.345.678/0001-90" \
  -H "Authorization: Bearer $FIREBASE_TOKEN"
```

### Filter Companies
```bash
curl -X POST http://localhost:3000/api/cnpj/filter \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": {
      "cnaeCode": "8211",
      "state": "SP",
      "employeeRange": { "min": 50, "max": 500 }
    },
    "limit": 50
  }'
```

### Semantic Query Expansion
```bash
curl -X POST http://localhost:3000/api/cnpj/semantic-expand \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "educacao online"}'
```

### Batch Search
```bash
curl -X POST http://localhost:3000/api/cnpj/batch-search \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queries": ["educacao", "tecnologia", "saude"], "limit": 20}'
```

### Database Stats
```bash
curl -X GET http://localhost:3000/api/cnpj/stats \
  -H "Authorization: Bearer $FIREBASE_TOKEN"
```

## Code Usage

### In a Service
```typescript
import { CNPJService } from './cnpj/cnpj.service';

@Injectable()
export class MyService {
  constructor(private cnpj: CNPJService) {}

  async findEducationCompanies(orgId: string) {
    return this.cnpj.searchCompanies(orgId, 'educacao', {
      limit: 50,
      filters: { state: 'SP' }
    });
  }
}
```

### In a Controller
```typescript
import { CNPJService } from './cnpj/cnpj.service';
import { CurrentOrganization } from './auth/decorators/auth.decorators';

@Post('search')
@UseGuards(FirebaseAuthGuard, OrganizationGuard)
async search(
  @CurrentOrganization() org: any,
  @Body() body: { query: string }
) {
  return this.cnpj.searchCompanies(org.id, body.query);
}
```

## Error Handling

### Retry Behavior
- Automatic retry on network errors
- Exponential backoff: 1s → 2s → 4s
- Max 3 attempts

### Status Codes
| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Invalid request (not retried) |
| 401 | Auth failed (not retried) |
| 5xx | Server error (retried) |
| 503 | Service unavailable |

### Example Error Response
```json
{
  "statusCode": 400,
  "message": "Invalid MCP request: ...",
  "error": "Bad Request"
}
```

## Debugging

### Check MCP Connection
```bash
curl http://localhost:3000/health/deep
```

### Enable Debug Logs
```typescript
// In MCPService constructor, logs are already enabled
// Look for: "Calling MCP tool: ..." messages
```

### Test with mcporter CLI
```bash
mcporter call cnpj.search_companies query='educacao' limit=5
```

## Important Notes

⚠️ **All endpoints require:**
- Firebase authentication (`FirebaseAuthGuard`)
- Organization membership (`OrganizationGuard`)

⚠️ **Tenant Isolation:**
- User can only access their organization's data
- Cross-tenant access is impossible (enforced by guards)
- All queries are scoped to `organizationId`

⚠️ **Rate Limits:**
- Not yet implemented
- Check MCP service documentation for limits

## Common Issues

### "MCP authentication failed"
```bash
# Check token in .env.local
echo $CNPJ_MCP_TOKEN

# Verify format (should be 64 hex characters)
echo $CNPJ_MCP_TOKEN | wc -c  # Should be 65 (64 + newline)
```

### "CNPJ service unavailable"
```bash
# Check network connectivity
curl -I https://mcps.0xcloud.net

# Verify firewall allows HTTPS
nc -zv mcps.0xcloud.net 443
```

### "Invalid request" on search
```bash
# Verify request body
# - query is required
# - limit is optional (default 20)
# - filters are optional
```

## Architecture Quick View

```
HTTP Request
    ↓
FirebaseAuthGuard (verify token)
    ↓
OrganizationGuard (verify membership)
    ↓
CNPJController (route to service)
    ↓
CNPJService (business logic + org scoping)
    ↓
MCPService (HTTP client + retry)
    ↓
MCP Endpoint (mcps.0xcloud.net)
```

## Files

| File | Purpose |
|------|---------|
| `src/mcp/mcp.config.ts` | Types & config |
| `src/mcp/mcp.service.ts` | HTTP client |
| `src/cnpj/cnpj.service.ts` | Business logic |
| `src/cnpj/cnpj.controller.ts` | REST endpoints |
| `docs/MCP_INTEGRATION.md` | Full documentation |

## For More Info

- Full API docs: `docs/MCP_INTEGRATION.md`
- Setup guide: `docs/ENVIRONMENT.md`
- Architecture: `docs/MCP_INTEGRATION_SUMMARY.md`
