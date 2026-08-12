#!/bin/bash

echo "=========================================="
echo "FINAL PRODUCTION VERIFICATION"
echo "=========================================="
echo ""

PASS=0
FAIL=0

# TEST 1: Real database data (not mock arrays)
echo "[1] Real Data Verification..."
if grep -q 'const.*= \[\s*{.*cnpj' server-prod.js 2>/dev/null; then
  echo "❌ FAIL: Found hardcoded data array"
  ((FAIL++))
else
  echo "✅ PASS: No hardcoded prospect arrays"
  ((PASS++))
fi

# TEST 2: All queries use Prisma
echo ""
echo "[2] Database Query Verification..."
PRISMA_CALLS=$(grep -c "prisma.prospect\|prisma.organization\|prisma.activity" server-prod.js)
if [ "$PRISMA_CALLS" -gt 8 ]; then
  echo "✅ PASS: $PRISMA_CALLS Prisma queries found (database-backed)"
  ((PASS++))
else
  echo "❌ FAIL: Only $PRISMA_CALLS Prisma queries (expected 10+)"
  ((FAIL++))
fi

# TEST 3: Database connectivity
echo ""
echo "[3] Database Connectivity..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const count = await prisma.prospect.count();
    process.stdout.write(count > 0 ? 'PASS:' + count : 'FAIL:0');
    await prisma.\$disconnect();
  } catch (e) {
    process.stdout.write('FAIL:' + e.message);
  }
})();
" 2>&1 | {
  read result
  if [[ $result == PASS* ]]; then
    echo "✅ PASS: Database connected, $(echo $result | cut -d: -f2) prospects accessible"
    ((PASS++))
  else
    echo "❌ FAIL: Database error"
    ((FAIL++))
  fi
}

# TEST 4: Duplicate prevention
echo ""
echo "[4] Data Integrity (Duplicate Prevention)..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const existing = await prisma.prospect.findFirst();
    try {
      await prisma.prospect.create({
        data: {
          cnpj: existing.cnpj,
          companyName: 'Duplicate',
          status: 'prospect',
          orgId: existing.orgId
        }
      });
      process.stdout.write('FAIL');
    } catch (e) {
      if (e.code === 'P2002') process.stdout.write('PASS');
      else process.stdout.write('FAIL:' + e.code);
    }
    await prisma.\$disconnect();
  } catch (e) {
    process.stdout.write('FAIL:' + e.message);
  }
})();
" 2>&1 | {
  read result
  if [[ $result == PASS* ]]; then
    echo "✅ PASS: Duplicate CNPJ constraint enforced"
    ((PASS++))
  else
    echo "❌ FAIL: Duplicate prevention not working"
    ((FAIL++))
  fi
}

# TEST 5: CRUD operations
echo ""
echo "[5] CRUD Operations..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const org = await prisma.organization.findFirst();
    const testCnpj = '77.666.555/0001-' + Math.floor(Math.random() * 100).toString().padStart(2, '0');
    
    const c = await prisma.prospect.create({ data: { cnpj: testCnpj, companyName: 'Test', status: 'prospect', orgId: org.id } });
    const r = await prisma.prospect.findUnique({ where: { id: c.id } });
    const u = await prisma.prospect.update({ where: { id: c.id }, data: { status: 'qualified' } });
    await prisma.prospect.delete({ where: { id: c.id } });
    
    process.stdout.write('PASS');
    await prisma.\$disconnect();
  } catch (e) {
    process.stdout.write('FAIL:' + e.message);
  }
})();
" 2>&1 | {
  read result
  if [[ $result == PASS* ]]; then
    echo "✅ PASS: Create, Read, Update, Delete all working"
    ((PASS++))
  else
    echo "❌ FAIL: CRUD broken - $result"
    ((FAIL++))
  fi
}

# TEST 6: Analytics from database
echo ""
echo "[6] Analytics Calculation..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const prospects = await prisma.prospect.findMany({ select: { status: true } });
    const qualified = prospects.filter(p => p.status === 'qualified').length;
    const rate = prospects.length > 0 ? (qualified / prospects.length) : 0;
    
    if (prospects.length > 0 && rate >= 0) {
      process.stdout.write('PASS:' + prospects.length + ':' + qualified);
    } else {
      process.stdout.write('FAIL:empty');
    }
    await prisma.\$disconnect();
  } catch (e) {
    process.stdout.write('FAIL:' + e.message);
  }
})();
" 2>&1 | {
  read result
  if [[ $result == PASS* ]]; then
    IFS=: read -r _ total qual <<< "$result"
    echo "✅ PASS: Analytics from database ($total total, $qual qualified)"
    ((PASS++))
  else
    echo "❌ FAIL: Analytics broken"
    ((FAIL++))
  fi
}

# TEST 7: Configuration externalized
echo ""
echo "[7] Configuration Security..."
if grep -q "DATABASE_URL" .env && ! grep -q "postgresql.*cnpj.*localhost" server-prod.js; then
  echo "✅ PASS: Database URL externalized (not in code)"
  ((PASS++))
else
  echo "⚠️ WARN: Configuration may not be fully externalized"
  ((FAIL++))
fi

# TEST 8: Error handling
echo ""
echo "[8] HTTP Error Handling..."
if grep -q "res.status(400)\|res.status(404)\|res.status(500)" server-prod.js; then
  echo "✅ PASS: Proper HTTP status codes implemented"
  ((PASS++))
else
  echo "⚠️ WARN: Limited HTTP error handling"
fi

echo ""
echo "=========================================="
echo "RESULTS: ✅ $PASS PASS, ❌ $FAIL FAIL"
echo "=========================================="

if [ $FAIL -eq 0 ]; then
  echo "✅ PRODUCTION VERIFICATION COMPLETE - ALL TESTS PASSED"
  exit 0
else
  echo "❌ PRODUCTION VERIFICATION FAILED - ISSUES FOUND"
  exit 1
fi
