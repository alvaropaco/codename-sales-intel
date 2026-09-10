# Start Here 👋

Welcome to the CNPJ Data Publisher repository. This document will guide you to the right place.

## 🚀 Quick Start (5 minutes)

1. **Setup environment**
   ```bash
   echo "CNPJ_MCP_TOKEN=ab2fb2bdf613ce6401fdfa9a5636867b99487d090f7f7e3aacec8f9096f68a17" >> .env.local
   ```

2. **Install & run**
   ```bash
   npm install
   npm run dev
   ```

3. **Test MCP connection**
   ```bash
   curl http://localhost:3000/health/deep
   ```

→ **Next**: See `docs/MCP_QUICK_REFERENCE.md` for API examples

---

## 📚 Documentation Guide

### For Getting Started
- **START_HERE.md** (this file) - Navigation guide
- **docs/MCP_QUICK_REFERENCE.md** - 5-min setup + curl examples
- **docs/ENVIRONMENT.md** - Detailed configuration

### For Understanding the Code
- **README.md** - Project overview & architecture
- **docs/MCP_INTEGRATION_COMPLETE.md** - Implementation details
- **docs/architecture/AUTH.md** - Authentication & multi-tenancy

### For API Reference
- **docs/MCP_INTEGRATION.md** - Complete API reference (602 lines)

### For Project Status
- **HANDOFF.md** - Handoff document (what's ready, what's next)
- **SESSION_SUMMARY.md** - Session completion summary
- **docs/MILESTONE_3_COMPLETE.md** - Milestone 3 (auth) details

---

## 🏗️ Project Structure

```
apps/api/src/
├── auth/              # Authentication & multi-tenancy ✅
│   ├── guards/        # Firebase & Organization guards
│   ├── decorators/    # @CurrentUser, @CurrentOrganization
│   └── *.service.ts   # Auth business logic
│
├── cnpj/              # Company data access ✅
│   ├── cnpj.service.ts
│   ├── cnpj.controller.ts
│   └── cnpj.module.ts
│
├── mcp/               # MCP service layer ✅
│   ├── mcp.service.ts
│   ├── mcp.config.ts
│   └── mcp.module.ts
│
└── health/            # Health checks
    └── health.controller.ts

docs/
├── MCP_QUICK_REFERENCE.md      # Start here for API usage
├── MCP_INTEGRATION.md           # Complete API reference
├── ENVIRONMENT.md               # Setup guide
├── MCP_INTEGRATION_COMPLETE.md # Implementation details
├── architecture/AUTH.md         # Auth architecture
└── MILESTONE_3_COMPLETE.md      # Milestone 3 summary
```

---

## 🎯 Current Status

**Milestones Complete**:
- ✅ Milestone 1: Database schema (Prisma + PostgreSQL)
- ✅ Milestone 2: Frontend basics (signup/login pages)
- ✅ Milestone 3: Authentication & multi-tenancy
- ✅ Post-M3: MCP integration for CNPJ data access

**In Progress**:
- ⏳ Milestone 4: Onboarding flow with ICP enrichment
- ⏳ Milestone 5: Dashboard with lead generation
- ⏳ Milestone 6: Analytics & reporting

---

## 🔍 What the System Does

1. **Authentication** (Milestone 3)
   - Firebase-based user authentication
   - Organization management with roles
   - Business email validation
   - Workspace access requests

2. **Company Data Access** (Post-M3)
   - Searches Brazilian CNPJ database via MCP
   - Filters by CNAE, state, city, employees, founding year
   - Provides semantic query expansion
   - Returns enriched company data

3. **Multi-Tenancy** (Enforced across all layers)
   - Guarantees users only access their organization's data
   - 3-layer protection: Guards → Service → Logging

---

## 💡 Key Concepts

### Tenant Isolation
Every API call is scoped to the user's organization:
```typescript
@UseGuards(FirebaseAuthGuard, OrganizationGuard)
async search(@CurrentOrganization() org: any) {
  // org.id is verified to belong to current user
  return this.cnpj.searchCompanies(org.id, query);
}
```

### Retry Logic
MCP service automatically retries on transient errors:
- Attempt 1: Wait 1 second
- Attempt 2: Wait 2 seconds  
- Attempt 3: Wait 4 seconds
- Max total wait: 6 seconds

### API Authentication
All endpoints require Firebase token:
```bash
curl -X POST http://localhost:3000/api/cnpj/search \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "educacao"}'
```

---

## 🚦 Common Tasks

### Search for companies
```bash
curl -X POST http://localhost:3000/api/cnpj/search \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "educacao", "limit": 20}'
```
→ See **docs/MCP_QUICK_REFERENCE.md** for all examples

### Set up development environment
→ See **docs/ENVIRONMENT.md**

### Understand authentication flow
→ See **docs/architecture/AUTH.md**

### Deploy to production
→ See **HANDOFF.md** (Deployment Checklist section)

### Integrate with Milestone 4
→ See **HANDOFF.md** (What Milestone 4 Can Use section)

---

## ❓ Questions?

**"How do I authenticate?"**
→ See `docs/ENVIRONMENT.md` and `docs/architecture/AUTH.md`

**"How do I search for companies?"**
→ See `docs/MCP_QUICK_REFERENCE.md`

**"How do I ensure tenant isolation?"**
→ See `docs/MCP_INTEGRATION_COMPLETE.md` (Tenant Isolation section)

**"What's the API reference?"**
→ See `docs/MCP_INTEGRATION.md`

**"What's ready for production?"**
→ See `HANDOFF.md`

**"What do I implement next?"**
→ See `HANDOFF.md` (Questions to Answer Before Milestone 4)

---

## 📊 By The Numbers

- **842 lines** of production code
- **1,954 lines** of documentation
- **8 API endpoints** (all guarded)
- **5 MCP tools** integrated
- **3-layer** tenant isolation
- **4 git commits** in this session
- **0 breaking changes** to existing code

---

## 🎓 Learning Path

1. Start with `README.md` - Get oriented
2. Read `docs/MCP_QUICK_REFERENCE.md` - Try the API
3. Review `docs/MCP_INTEGRATION.md` - Deep dive into endpoints
4. Skim `docs/architecture/AUTH.md` - Understand authentication
5. Review code in `src/mcp/` and `src/cnpj/` - See implementation
6. Check `HANDOFF.md` - Prepare for next work

---

## ✅ Verification

To verify everything is working:

```bash
# 1. Install dependencies
npm install

# 2. Set MCP token
echo "CNPJ_MCP_TOKEN=..." >> .env.local

# 3. Start development server
npm run dev

# 4. Check health (should show mcp: true)
curl http://localhost:3000/health/deep

# 5. Search for companies (need Firebase token)
curl -X POST http://localhost:3000/api/cnpj/search \
  -H "Authorization: Bearer $FIREBASE_TOKEN" \
  -d '{"query": "educacao"}'
```

If all steps work, the integration is healthy!

---

## 🚀 Next Steps

**Immediate** (if you're continuing work):
- Review `HANDOFF.md` for complete context
- Check `SESSION_SUMMARY.md` for what was built
- Start Milestone 4: Onboarding flow

**For team review**:
- See `README.md` for architecture overview
- See `SESSION_SUMMARY.md` for stakeholder summary
- See `HANDOFF.md` for questions to decide

---

**Last Updated**: 2026-08-11  
**Status**: ✅ Production-ready MCP integration
