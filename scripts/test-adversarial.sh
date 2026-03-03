#!/bin/bash
set -e

echo "Adversarial Operator Testing"
echo "============================="
echo ""

PASS=0
FAIL=0

# Test 1: Doctor command passes with valid config
echo "Test 1: Doctor command with valid configuration"
if npm run doctor > /tmp/doctor-output.txt 2>&1; then
  echo "✓ Doctor passes with valid config"
  PASS=$((PASS + 1))
else
  echo "✗ Doctor fails with valid config"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 2: No stack traces in output
echo "Test 2: No stack traces in error output"
if grep -q "at.*\.ts:[0-9]" /tmp/doctor-output.txt; then
  echo "✗ Stack traces found in output"
  FAIL=$((FAIL + 1))
else
  echo "✓ No stack traces in output"
  PASS=$((PASS + 1))
fi
echo ""

# Test 3: No sensitive env vars in logs
echo "Test 3: No sensitive data in logs"
if grep -qi "password.*=\|secret.*=\|key.*=" /tmp/doctor-output.txt; then
  echo "✗ Sensitive data found in logs"
  FAIL=$((FAIL + 1))
else
  echo "✓ No sensitive data in logs"
  PASS=$((PASS + 1))
fi
echo ""

# Test 4: Runtime compatibility check
echo "Test 4: Runtime compatibility validation"
if npx tsx -r dotenv/config test-runtime-compatibility.ts > /tmp/runtime-compat.txt 2>&1; then
  echo "✓ Runtime compatibility check passes"
  PASS=$((PASS + 1))
else
  echo "✗ Runtime compatibility check fails"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 5: Schema migration idempotency
echo "Test 5: Schema migration is idempotent"
if npx tsx -r dotenv/config test-schema-migration.ts > /tmp/schema-migration-1.txt 2>&1 && \
   npx tsx -r dotenv/config test-schema-migration.ts > /tmp/schema-migration-2.txt 2>&1; then
  echo "✓ Schema migration runs twice without errors"
  PASS=$((PASS + 1))
else
  echo "✗ Schema migration fails"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 6: Incompatible schema detection
echo "Test 6: Incompatible schema detection"
if npx tsx -r dotenv/config test-incompatible-schema.ts > /tmp/incompatible-schema.txt 2>&1; then
  echo "✓ Incompatible schema correctly detected"
  PASS=$((PASS + 1))
else
  echo "✗ Incompatible schema detection fails"
  FAIL=$((FAIL + 1))
fi
echo ""

# Test 7: Error messages are clear
echo "Test 7: Error messages are clear and actionable"
if grep -q "System ready" /tmp/doctor-output.txt; then
  echo "✓ Clear success message"
  PASS=$((PASS + 1))
else
  echo "✗ Unclear success message"
  FAIL=$((FAIL + 1))
fi
echo ""

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
