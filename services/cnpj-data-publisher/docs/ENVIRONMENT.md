# Environment Configuration

## Required Environment Variables

### Firebase Configuration
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
FIREBASE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
FIREBASE_CLIENT_X509_CERT_URL=https://www.googleapis.com/robot/v1/metadata/x509/...
```

### Database Configuration
```bash
DATABASE_URL="postgresql://user:password@localhost:5432/cnpj_publisher"
```

### MCP (CNPJ Service) Configuration
```bash
# MCP Bearer Token for authentication
# Also stored in Infisical as CNPJ_MCP_TOKEN
CNPJ_MCP_TOKEN=ab2fb2bdf613ce6401fdfa9a5636867b99487d090f7f7e3aacec8f9096f68a17
```

### API Configuration
```bash
# Server port
PORT=3000

# Environment
NODE_ENV=development|production

# CORS (optional)
CORS_ORIGIN=http://localhost:3001,https://example.com
```

## Environment Files

### Development (`.env.local`)
```bash
# Firebase (use dev project)
FIREBASE_PROJECT_ID=cnpj-dev
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=...

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/cnpj_dev"

# MCP
CNPJ_MCP_TOKEN=ab2fb2bdf613ce6401fdfa9a5636867b99487d090f7f7e3aacec8f9096f68a17

# Server
PORT=3000
NODE_ENV=development
```

### Production (`.env`)
```bash
# Firebase (use production project)
FIREBASE_PROJECT_ID=cnpj-prod
FIREBASE_PRIVATE_KEY_ID=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=...

# Database (production database)
DATABASE_URL="postgresql://user:password@prod.db.example.com:5432/cnpj_prod"

# MCP
CNPJ_MCP_TOKEN=<production-token>

# Server
PORT=3000
NODE_ENV=production
```

## Setup Steps

### 1. Get Firebase Credentials
1. Go to Firebase Console
2. Project Settings → Service Accounts
3. Generate new private key
4. Copy JSON content
5. Extract to environment variables

### 2. Get MCP Token
1. From Infisical: CNPJ_MCP_TOKEN
2. Or ask team for the shared token
3. Add to `.env.local`

### 3. Setup Database
```bash
# Create local database
createdb cnpj_dev

# Add to .env.local
DATABASE_URL="postgresql://user:password@localhost:5432/cnpj_dev"

# Run migrations
npm run db:migrate:dev
```

### 4. Install Dependencies
```bash
npm install
```

### 5. Start Development Server
```bash
npm run dev
```

## Verification Checklist

- [ ] Firebase credentials working (can authenticate)
- [ ] MCP token working (can search companies)
- [ ] Database connection working (can run migrations)
- [ ] Environment variables set correctly
- [ ] No secrets in git history
- [ ] All required environment variables present

## Security Notes

**Do NOT commit** `.env.local` or `.env` files to git.

Secrets are stored in:
- **Development**: `.env.local` (gitignored)
- **Production**: Environment variables on deployment platform
- **Shared**: Infisical vault

## Troubleshooting

### Error: CNPJ_MCP_TOKEN not set
```bash
# Check if variable is set
echo $CNPJ_MCP_TOKEN

# Add to .env.local
CNPJ_MCP_TOKEN=ab2fb2bdf613ce6401fdfa9a5636867b99487d090f7f7e3aacec8f9096f68a17
```

### Error: Firebase authentication failed
```bash
# Verify Firebase credentials
echo $FIREBASE_PROJECT_ID

# Check private key format (should have \n for newlines)
echo $FIREBASE_PRIVATE_KEY | head -c 50
```

### Error: Database connection refused
```bash
# Check database is running
psql -U postgres -c "SELECT 1"

# Check DATABASE_URL is correct
echo $DATABASE_URL
```
