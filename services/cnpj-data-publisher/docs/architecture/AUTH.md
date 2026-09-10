# Authentication Architecture

## Overview

The SalesIntel authentication system is built on **Firebase Authentication** for user identity management combined with a custom **multi-tenant authorization** layer in the backend.

## Architecture

```
┌──────────────────────────────────────────────────┐
│           Frontend (Next.js)                      │
│  Firebase Web SDK                                │
│  - Login / Signup                                │
│  - Token management                              │
└──────────────────┬───────────────────────────────┘
                   │ Firebase ID Token
                   ▼
┌──────────────────────────────────────────────────┐
│           Backend (NestJS)                        │
│  - Firebase Admin SDK (token verification)       │
│  - AuthGuard (middleware)                        │
│  - PrismaService (database)                      │
│  - AuthService (user/org management)             │
│  - DomainPolicyService (email validation)        │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│           Database (PostgreSQL)                   │
│  - Users                                         │
│  - Organizations                                 │
│  - Memberships                                   │
│  - WorkspaceAccessRequests                       │
│  - ICPs                                          │
└──────────────────────────────────────────────────┘
```

## Signup Flow

```
User enters:
  Email (business domain)
  Display Name
       │
       ▼
DomainPolicyService validates email
  ├─ Reject: Gmail, Yahoo, Outlook, etc. ❌
  ├─ Reject: Disposable email providers ❌
  └─ Accept: Business domain ✅
       │
       ▼
Firebase creates account
  └─ Sends verification email
       │
       ▼
AuthService.signup()
  ├─ Create User record
  ├─ Find or create Organization (by registrable domain)
  ├─ Create Membership (OWNER for first user)
  └─ Create default ICP
       │
       ▼
Redirect to Onboarding
```

## Login Flow

```
User enters credentials
       │
       ▼
Firebase authenticates
  └─ Returns ID token
       │
       ▼
Frontend sends ID token to backend
       │
       ▼
AuthGuard verifies token with Firebase Admin SDK
  └─ Extracts firebaseUid and email claims
       │
       ▼
Backend resolves User + Organization
  └─ Checks membership and roles
       │
       ▼
Request proceeds with organization context
```

## Multi-Tenancy Model

### Core Entities

**Users**
- `id` — Unique identifier
- `firebaseUid` — Firebase authentication ID
- `email` — Unique email address
- `emailDomain` — Full email domain (mail.company.com)
- `registrableDomain` — Registrable domain (company.com)
- `displayName` — User's display name
- `emailVerified` — Email verification status

**Organizations**
- `id` — Unique identifier
- `name` — Organization name
- `registrableDomain` — Unique business domain (e.g., company.com)
- `status` — ACTIVE / INACTIVE
- `createdAt` — Creation timestamp

**Memberships**
- `userId` — Foreign key to User
- `organizationId` — Foreign key to Organization
- `role` — OWNER / ADMIN / MEMBER / SALES_MANAGER / SALES_REP / VIEWER
- `acceptedAt` — When user accepted invitation

**WorkspaceAccessRequests**
- `userId` — Foreign key to User
- `organizationId` — Foreign key to Organization
- `status` — PENDING / APPROVED / REJECTED
- `email` — Email address for invitation tracking

### Authorization Rules

1. **First user from a domain becomes OWNER**
   ```
   User 1 from company.com → OWNER (org created)
   User 2 from company.com → MEMBER (pending approval)
   ```

2. **OWNER can manage organization**
   ```
   - Invite/remove members
   - Change member roles
   - Update organization settings
   ```

3. **All users scoped to organization**
   ```
   // ✅ Good: All queries include organization_id
   const lists = await getProspectLists({
     organizationId: "org-123",
     userId: "user-456"
   });

   // ❌ Bad: Missing organization context
   const lists = await getProspectLists({
     userId: "user-456"
   });
   ```

## Domain Validation

### DomainPolicyService

Validates email addresses for business use.

**Public Email Providers (Rejected)**
```
gmail.com, yahoo.com, outlook.com, hotmail.com,
icloud.com, mail.com, protonmail.com, fastmail.com,
yandex.com, mail.ru, inbox.com, aol.com
```

**Disposable Email Patterns (Rejected)**
```
Patterns containing: temp, temporary, throwaway,
guerrillamail, 10minutemail, mailinator, maildrop,
trashmail
```

**Business Domains (Accepted)**
```
company.com ✅
empresa.com.br ✅
organization.co.uk ✅
startup.io ✅
```

### Examples

```typescript
const service = new DomainPolicyService();

// Public email - rejected
service.validateDomain('user@gmail.com')
// → { allowed: false, reason: 'PUBLIC_EMAIL_PROVIDER' }

// Disposable email - rejected
service.validateDomain('user@tempmail.com')
// → { allowed: false, reason: 'DISPOSABLE_EMAIL_PROVIDER' }

// Business domain - accepted
service.validateDomain('user@company.com')
// → { allowed: true, registrableDomain: 'company.com' }

// Subdomain handled correctly
service.validateDomain('user@mail.company.com.br')
// → { allowed: true, registrableDomain: 'company.com.br' }
```

## Tenant Isolation Strategy

### Query Scoping

**Every query must include organization_id:**

```typescript
// User repos
repository.get({
  organizationId: currentUser.organizationId,
  userId: userId
})

// Prospect data
repository.getProspects({
  organizationId: currentUser.organizationId,
  filters: {...}
})

// Lists
repository.getLists({
  organizationId: currentUser.organizationId,
  listId: listId
})
```

### Database Constraints

**Every customer-owned table includes organization_id:**

```sql
CREATE TABLE prospect_lists (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, name)
);

CREATE INDEX idx_prospect_lists_org 
  ON prospect_lists(organization_id);
```

### Authorization Middleware

```typescript
// Example auth guard (pseudocode)
@Injectable()
export class OrgGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // From Firebase token
    const { organizationId } = request.params;

    // Verify user has access to organization
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId
        }
      }
    });

    return !!membership;
  }
}
```

## Security Checklist

✅ **Signup & Email Validation**
- Business email required
- Public email providers rejected
- Disposable email rejected
- Domain validation both frontend + backend

✅ **Multi-Tenancy**
- All queries include organization_id
- Database constraints enforce isolation
- Authorization guards verify membership
- Cross-tenant access impossible

✅ **Token Management**
- Firebase ID tokens verified server-side
- Tokens expire (typically 1 hour)
- Refresh tokens handled by Firebase SDK
- No secrets stored in localStorage (use HttpOnly cookies)

✅ **Password Security**
- Firebase handles password hashing
- No passwords stored in custom database
- PII protected by encryption where applicable

✅ **Audit Logging**
- All auth events logged
- Login/signup/permission changes tracked
- Tenant isolation verified in audit logs

## Testing

### Unit Tests

```typescript
// DomainPolicyService
- Reject Gmail/Yahoo/Outlook
- Reject disposable emails
- Accept business domains
- Handle multi-part TLDs (.co.uk, .com.br)
- Case-insensitive matching
```

### Integration Tests

```typescript
// Tenant Isolation
- User A cannot access Organization B lists
- User A cannot modify Organization B notes
- User A cannot export Organization B data
- Audit logs separate by organization
- Memberships cannot be spoofed
```

### E2E Tests

```typescript
// Signup Flow
- Reject personal email signup
- Accept business email signup
- Create organization + membership
- Send verification email
- Verify email link
- Redirect to onboarding

// Login Flow
- Login with business email
- Firebase token issued
- Backend validates token
- User + org context resolved
- Redirect to dashboard
```

## Future Enhancements

- [ ] Social login (Google Workspace, Microsoft 365)
- [ ] SSO (SAML 2.0, OIDC)
- [ ] MFA (multi-factor authentication)
- [ ] Organization domain verification (DNS TXT record)
- [ ] API tokens for service accounts
- [ ] Role-based access control (RBAC) per resource type
- [ ] Time-limited access tokens
- [ ] IP whitelisting per organization

## Debugging

### Check Firebase Token

```bash
# Decode Firebase ID token
firebase_token=$(curl -s http://localhost:4000/api/health | jq '.token')
echo $firebase_token | jq -R 'split(".") | .[1] | @base64d | fromjson'
```

### Verify Organization Membership

```sql
SELECT m.role, o.name, u.email
FROM memberships m
JOIN organizations o ON m.organization_id = o.id
JOIN users u ON m.user_id = u.id
WHERE u.firebase_uid = '...';
```

### Check Domain Policy

```typescript
// Test domain validation
const service = new DomainPolicyService();
console.log(service.validateDomain('user@your-company.com'));
```

## References

- [Firebase Authentication Docs](https://firebase.google.com/docs/auth)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)
- [OWASP Multi-Tenancy Security](https://owasp.org/www-community/attacks/Multitenant_data_isolation)
