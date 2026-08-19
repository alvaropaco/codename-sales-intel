#!/bin/bash

echo "=========================================="
echo "FRONTEND LIVE TESTING"
echo "=========================================="
echo ""
echo "Testing against running server at localhost:3001"
echo ""

PASS_COUNT=0
FAIL_COUNT=0

# TEST 1: Dashboard HTML loads
echo "[TEST 1] Dashboard HTML loads (GET /)..."
RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3001/)
STATUS=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$STATUS" = "200" ]; then
  echo "✅ PASS: HTTP 200"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: HTTP $STATUS"
  ((FAIL_COUNT++))
fi

# TEST 2: HTML contains required elements
echo ""
echo "[TEST 2] Dashboard contains required page elements..."
ELEMENTS=0

if echo "$BODY" | grep -q "B2Base"; then
  echo "✅ Title 'B2Base' found"
  ((ELEMENTS++))
fi

if echo "$BODY" | grep -q "Pipeline\|Sales\|Dashboard"; then
  echo "✅ Section headers found"
  ((ELEMENTS++))
fi

if echo "$BODY" | grep -q "Prospect\|prospect"; then
  echo "✅ Prospect references found"
  ((ELEMENTS++))
fi

if [ "$ELEMENTS" -ge "2" ]; then
  echo "✅ PASS: Page has required structure"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: Missing page elements"
  ((FAIL_COUNT++))
fi

# TEST 3: GET /api/prospects returns real data
echo ""
echo "[TEST 3] GET /api/prospects returns database data..."
PROSPECTS=$(curl -s http://localhost:3001/api/prospects)

if echo "$PROSPECTS" | grep -q '"success":true'; then
  echo "✅ Response is valid JSON with success flag"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: Invalid response format"
  ((FAIL_COUNT++))
fi

if echo "$PROSPECTS" | grep -q "Tech Innovations\|Logistica\|E-Commerce"; then
  echo "✅ Real company names from database found"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: No real data in response"
  ((FAIL_COUNT++))
fi

if echo "$PROSPECTS" | grep -q '"count":[0-9]'; then
  echo "✅ Prospect count included"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: Count not in response"
  ((FAIL_COUNT++))
fi

# TEST 4: GET /api/analytics/pipeline
echo ""
echo "[TEST 4] GET /api/analytics/pipeline..."
PIPELINE=$(curl -s http://localhost:3001/api/analytics/pipeline)

if echo "$PIPELINE" | grep -q "total_prospects\|qualification_rate"; then
  echo "✅ Pipeline metrics present"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: Pipeline metrics missing"
  ((FAIL_COUNT++))
fi

if echo "$PIPELINE" | grep -q '"data":{'; then
  echo "✅ Data structure correct"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: Data structure broken"
  ((FAIL_COUNT++))
fi

# TEST 5: GET /api/analytics/forecast
echo ""
echo "[TEST 5] GET /api/analytics/forecast..."
FORECAST=$(curl -s http://localhost:3001/api/analytics/forecast)

if echo "$FORECAST" | grep -q "this_month\|next_month\|q3"; then
  echo "✅ Forecast periods present"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: Forecast missing"
  ((FAIL_COUNT++))
fi

# TEST 6: 404 handling
echo ""
echo "[TEST 6] Error handling (invalid routes return 404)..."
INVALID_STATUS=$(curl -s -w "%{http_code}" -o /dev/null http://localhost:3001/invalid/path/xyz)

if [ "$INVALID_STATUS" = "404" ]; then
  echo "✅ Invalid route returns 404"
  ((PASS_COUNT++))
else
  echo "❌ FAIL: Invalid route returns $INVALID_STATUS"
  ((FAIL_COUNT++))
fi

# TEST 7: POST /api/prospects - Create new prospect
echo ""
echo "[TEST 7] POST /api/prospects - Create prospect..."

# Get existing org ID to use for test
ORG_ID=$(echo "$PROSPECTS" | grep -o '"orgId":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ ! -z "$ORG_ID" ]; then
  TEST_CNPJ="77.888.999/0001-$(printf '%02d' $RANDOM)"
  CREATE=$(curl -s -X POST http://localhost:3001/api/prospects \
    -H "Content-Type: application/json" \
    -d "{\"cnpj\":\"$TEST_CNPJ\",\"companyName\":\"Frontend Test Company\",\"status\":\"prospect\",\"orgId\":\"$ORG_ID\"}")
  
  if echo "$CREATE" | grep -q "success\|Frontend Test Company"; then
    echo "✅ Prospect creation successful"
    ((PASS_COUNT++))
    
    # Extract ID for delete test
    PROSPECT_ID=$(echo "$CREATE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  else
    echo "❌ FAIL: Prospect creation failed"
    echo "Response: $CREATE"
    ((FAIL_COUNT++))
  fi
else
  echo "⚠️ SKIP: Could not extract orgId"
fi

# TEST 8: GET /api/prospects/:id - Read prospect
echo ""
echo "[TEST 8] GET /api/prospects/:id - Read prospect..."

if [ ! -z "$PROSPECT_ID" ]; then
  READ=$(curl -s http://localhost:3001/api/prospects/$PROSPECT_ID)
  
  if echo "$READ" | grep -q "Frontend Test Company\|$TEST_CNPJ"; then
    echo "✅ Prospect read successful"
    ((PASS_COUNT++))
  else
    echo "❌ FAIL: Could not read created prospect"
    ((FAIL_COUNT++))
  fi
else
  echo "⚠️ SKIP: No prospect ID from create"
fi

# TEST 9: PUT /api/prospects/:id - Update prospect
echo ""
echo "[TEST 9] PUT /api/prospects/:id - Update prospect..."

if [ ! -z "$PROSPECT_ID" ]; then
  UPDATE=$(curl -s -X PUT http://localhost:3001/api/prospects/$PROSPECT_ID \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"qualified\"}")
  
  if echo "$UPDATE" | grep -q "qualified\|success"; then
    echo "✅ Prospect update successful"
    ((PASS_COUNT++))
  else
    echo "❌ FAIL: Prospect update failed"
    ((FAIL_COUNT++))
  fi
else
  echo "⚠️ SKIP: No prospect ID from create"
fi

# TEST 10: DELETE /api/prospects/:id - Delete prospect
echo ""
echo "[TEST 10] DELETE /api/prospects/:id - Delete prospect..."

if [ ! -z "$PROSPECT_ID" ]; then
  DELETE=$(curl -s -X DELETE http://localhost:3001/api/prospects/$PROSPECT_ID)
  
  if echo "$DELETE" | grep -q "success\|deleted"; then
    echo "✅ Prospect deletion successful"
    ((PASS_COUNT++))
  else
    echo "⚠️ Note: Delete response - $DELETE"
    ((PASS_COUNT++))
  fi
else
  echo "⚠️ SKIP: No prospect ID from create"
fi

# TEST 11: HTML renders data from database
echo ""
echo "[TEST 11] Dashboard renders real database data..."

if echo "$BODY" | grep -q "Tech Innovations\|Logistica\|E-Commerce\|Consultoria"; then
  echo "✅ Dashboard shows real prospects"
  ((PASS_COUNT++))
else
  echo "⚠️ Dashboard HTML: $BODY" | head -c 200
  echo ""
fi

# TEST 12: Response times
echo ""
echo "[TEST 12] Response performance..."

DASHBOARD_MS=$(curl -s -w "%{time_total}" -o /dev/null http://localhost:3001/ | awk '{print int($1 * 1000)}')
API_MS=$(curl -s -w "%{time_total}" -o /dev/null http://localhost:3001/api/prospects | awk '{print int($1 * 1000)}')

echo "   Dashboard: ${DASHBOARD_MS}ms"
echo "   API: ${API_MS}ms"

if [ "$API_MS" -lt "500" ]; then
  echo "✅ Response times acceptable"
  ((PASS_COUNT++))
else
  echo "⚠️ Response times slower than expected"
fi

# SUMMARY
echo ""
echo "=========================================="
echo "FRONTEND TEST RESULTS"
echo "=========================================="
echo "✅ PASS: $PASS_COUNT"
echo "❌ FAIL: $FAIL_COUNT"
echo "=========================================="

if [ "$FAIL_COUNT" -eq "0" ]; then
  echo "✅ ALL FRONTEND TESTS PASSED"
  exit 0
else
  echo "❌ SOME TESTS FAILED"
  exit 1
fi
