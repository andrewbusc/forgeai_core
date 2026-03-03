#!/bin/bash
set -e

echo "Adversarial Operator Testing"
echo "============================="
echo ""

PASS=0
FAIL=0

check_test() {
  if [ $? -eq 0 ]; then
    echo "✓ $1"
    PASS=$((PASS + 1))
  else
    echo "✗ $1"
    FAIL=$((FAIL + 1))
  fi
  echo ""
}

# Test 1: Doctor command with valid config
echo "Test 1: Doctor command with valid configuration"
npm run doctor > /tmp/doctor-output.txt 2>&1
check_test "Doctor passes with valid config"

# Test 2: Doctor command detects missing DATABASE_URL
echo "Test 2: Doctor detects missing DATABASE_URL"
DATABASE_URL="" npm run doctor > /tmp/doctor-missing-db.txt 2>&1 && exit 1 || exit 0
check_test "Doctor fails with missing DATABASE_URL"

# Test 3: Doctor command detects missing JWT_SECRET
echo "Test 3: Doctor detects missing JWT_SECRET"
JWT_SECRET="" npm run doctor > /tmp/doctor-missing-jwt.txt 2>&1 && exit 1 || exit 0
check_test "Doctor fails with missing JWT_SECRET"

# Test 4: No stack traces in error output
echo "Test 4: Error output contains no stack traces"
if grep -q "at.*\.ts:[0-9]" /tmp/doctor-output.txt; then
  echo "✗ Stack traces found in output"
  FAIL=$((FAIL + 1))
else
  echo "✓ No stack traces in output"
  PASS=$((PASS + 1))
fi
echo ""

# Test 5: No sensitive env vars in logs
echo "Test 5: No sensitive data in logs"
if grep -qi "password\|secret\|key.*=" /tmp/doctor-output.txt; then
  echo "✗ Sensitive data found in logs"
  FAIL=$((FAIL + 1))
else
  echo "✓ No sensitive data in logs"
  PASS=$((PASS + 1))
fi
echo ""

# Test 6: Clear error messages
echo "Test 6: Error messages are clear"
if [ -f /tmp/doctor-missing-db.txt ]; then
  if grep -q "DATABASE_URL" /tmp/doctor-missing-db.txt; then
    echo "✓ Clear error message for missing DATABASE_URL"
    PASS=$((PASS + 1))
  else
    echo "✗ Unclear error message"
    FAIL=$((FAIL + 1))
  fi
else
  echo "✗ No error output captured"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 7: Runtime compatibility check
echo "Test 7: Runtime compatibility validation"
npx tsx -r dotenv/config test-runtime-compatibility.ts > /tmp/runtime-compat.txt 2>&1
check_test "Runtime compatibility check passes"

# Test 8: Schema migration idempotency
echo "Test 8: Schema migration is idempotent"
npx tsx -r dotenv/config test-schema-migration.ts > /tmp/schema-migration-1.txt 2>&1
npx tsx -r dotenv/config test-schema-migration.ts > /tmp/schema-migration-2.txt 2>&1
check_test "Schema migration runs twice without errors"

# Summary
echo "============================="
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "✓ All adversarial tests passed"
  exit 0
else
  echo "✗ Some tests failed"
  exit 1
fi
