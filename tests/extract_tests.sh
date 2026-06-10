#!/bin/bash
FILE=$1
echo "=== TESTS WITH NOTES ASSERTIONS in $FILE ==="
echo ""
grep -n 'it("' "$FILE" | while read line; do
  linenum=$(echo "$line" | cut -d: -f1)
  testname=$(echo "$line" | sed 's/.*it("//' | sed 's/".*//')
  # Check if this test block has .notes in next ~30 lines
  nextlines=$((linenum + 30))
  sed -n "${linenum},$nextlines p" "$FILE" | grep -q "\.notes" && echo "$testname"
done
