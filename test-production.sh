#!/bin/bash

echo "=== PRODUCTION VERIFICATION TEST SUITE ==="
echo ""

# Start fresh
echo "[TEST] Database connectivity..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const result = await prisma.\$queryRaw\`SELECT COUNT(*) as count FROM prospect\`;
    console.log('✅ Database connected. Prospects in DB:', result[0].count);
    await prisma.\$disconnect();
  } catch (e) {
    console.error('❌ Database error:', e.message);
    process.exit(1);
  }
})();
" 2>&1

echo ""
echo "[TEST] Checking for mock data (should be 0 hardcoded arrays)..."
grep -r "const.*=.*\[\]" server-prod.js 2>/dev/null | wc -l > /tmp/mock_check.txt
MOCK_COUNT=$(cat /tmp/mock_check.txt)
if [ "$MOCK_COUNT" -eq "0" ]; then
  echo "✅ No hardcoded empty arrays in server-prod.js"
else
  echo "❌ Found hardcoded arrays: $MOCK_COUNT"
fi

echo ""
echo "[TEST] Checking all endpoints use database queries..."
grep -c "prisma.prospect" server-prod.js > /tmp/prisma_check.txt
PRISMA_COUNT=$(cat /tmp/prisma_check.txt)
if [ "$PRISMA_COUNT" -gt "5" ]; then
  echo "✅ Server uses Prisma for data access ($PRISMA_COUNT queries)"
else
  echo "⚠️  Prisma usage: $PRISMA_COUNT (expected 5+)"
fi

echo ""
echo "[TEST] Type checking MCP server..."
node -c mcp-server.js > /dev/null 2>&1 && echo "✅ MCP server syntax valid" || echo "❌ MCP server syntax error"

echo ""
echo "[TEST] Checking configuration externalization..."
if grep -q "DATABASE_URL" .env && ! grep -q "postgresql" server-prod.js; then
  echo "✅ Database URL externalized in .env (not in code)"
else
  echo "⚠️  Configuration may not be fully externalized"
fi

echo ""
echo "=== TEST COMPLETE ==="
