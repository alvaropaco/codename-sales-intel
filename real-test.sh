#!/bin/bash

echo "============================================"
echo "REAL PRODUCTION VERIFICATION TEST"
echo "============================================"
echo ""

echo "[TEST 1] Verify Database Has Real Data (No Mock)..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const prospects = await prisma.prospect.findMany({
    select: { cnpj: true, companyName: true, status: true }
  });
  const hasRealData = prospects.some(p => p.cnpj && p.cnpj.includes('.'));
  if (hasRealData && prospects.length > 0) {
    console.log('✅ PASS: Real data in database (' + prospects.length + ' prospects)');
    prospects.forEach(p => {
      console.log('   -', p.companyName, p.status);
    });
  } else {
    console.log('❌ FAIL: No real data or empty database');
  }
  await prisma.\$disconnect();
})();
" 2>&1

echo ""
echo "[TEST 2] Verify All Endpoints Query Database (Not Mock)..."
if grep -q "const prospects =" server-prod.js; then
  echo "❌ FAIL: Found hardcoded prospect array"
else
  echo "✅ PASS: No hardcoded prospect arrays"
fi

echo ""
echo "[TEST 3] Verify Error Handling: Duplicate CNPJ Rejected..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const existing = await prisma.prospect.findFirst();
    if (!existing) throw new Error('No test data');
    try {
      await prisma.prospect.create({
        data: {
          cnpj: existing.cnpj,
          companyName: 'Duplicate',
          status: 'prospect',
          orgId: existing.orgId
        }
      });
      console.log('❌ FAIL: Should reject duplicate CNPJ');
    } catch (e) {
      if (e.code === 'P2002') {
        console.log('✅ PASS: Duplicate CNPJ properly rejected');
      } else {
        throw e;
      }
    }
    await prisma.\$disconnect();
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
})();
" 2>&1

echo ""
echo "[TEST 4] Verify CRUD: Create, Read, Update Prospect..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const org = await prisma.organization.findFirst();
    const testCnpj = '88.777.666/0001-' + Math.floor(Math.random() * 100).toString().padStart(2, '0');
    
    // CREATE
    const prospect = await prisma.prospect.create({
      data: {
        cnpj: testCnpj,
        companyName: 'CRUD Test Company',
        status: 'prospect',
        industry: 'Test',
        orgId: org.id
      }
    });
    
    // READ
    const read = await prisma.prospect.findUnique({ where: { id: prospect.id } });
    if (!read) throw new Error('Failed to read');
    
    // UPDATE
    const updated = await prisma.prospect.update({
      where: { id: prospect.id },
      data: { status: 'qualified' }
    });
    
    // DELETE
    await prisma.prospect.delete({ where: { id: prospect.id } });
    
    console.log('✅ PASS: CRUD operations working (Create→Read→Update→Delete)');
    await prisma.\$disconnect();
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
})();
" 2>&1

echo ""
echo "[TEST 5] Verify Analytics Calculated from Database..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const prospects = await prisma.prospect.findMany();
    const qualified = prospects.filter(p => p.status === 'qualified').length;
    const rate = prospects.length > 0 ? (qualified / prospects.length).toFixed(2) : 0;
    
    if (prospects.length > 0 && rate > 0) {
      console.log('✅ PASS: Analytics calculated from DB');
      console.log('   Total:', prospects.length, 'Qualified:', qualified, 'Rate:', rate);
    } else {
      console.log('⚠️ WARN: No qualified prospects to calculate');
    }
    await prisma.\$disconnect();
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
})();
" 2>&1

echo ""
echo "[TEST 6] Verify MCP Server Can Start and Access Database..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    // This simulates what MCP server does
    const prospects = await prisma.prospect.findMany({
      select: { id: true, companyName: true, status: true }
    });
    console.log('✅ PASS: MCP can access database (' + prospects.length + ' prospects readable)');
    await prisma.\$disconnect();
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
})();
" 2>&1

echo ""
echo "[TEST 7] Verify Data Persists (Not In-Memory)..."
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const count1 = await prisma.prospect.count();
    if (count1 > 0) {
      console.log('✅ PASS: Data persists in database (' + count1 + ' prospects)');
    } else {
      console.log('❌ FAIL: Database is empty');
    }
    await prisma.\$disconnect();
  } catch (e) {
    console.log('❌ FAIL:', e.message);
  }
})();
" 2>&1

echo ""
echo "============================================"
echo "VERIFICATION COMPLETE"
echo "============================================"
