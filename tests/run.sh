#!/bin/sh
# Engine regression tests: runs each test script on its document with eo-render and reads its
# result ("PASS <count>" or "FAIL <messages>", see lib.js). Run from the MobileEditors root:
#
#   editors-engine/tests/run.sh <eo-render> <runtime dir> [test.js ...]
#
# A test names its document (relative to the MobileEditors root) in a "// document:" line. With a
# "// save:" line the document is saved after the test and opened again for <test>.reopen.js.
# Output files go to $OUT_DIR (build/work/engine-tests).
set -u

EO_RENDER=$1
RUNTIME=$2
shift 2
TESTS_DIR=$(dirname "$0")
OUT_DIR="${OUT_DIR:-build/work/engine-tests}"
mkdir -p "$OUT_DIR"
[ $# -gt 0 ] || set -- "$TESTS_DIR"/*.js

passed=0
failed=0

# check <name> <script> <document> [save path]: runs one script and reports its result
check() {
    name=$1 script=$2 document=$3
    shift 3
    mkdir -p "$OUT_DIR/$name"
    output=$("$EO_RENDER" "$RUNTIME" "$document" "$OUT_DIR/$name" 0.5 "$TESTS_DIR/lib.js" "$script" "$@" 2>&1)
    result=$(printf '%s\n' "$output" | grep -F "$script (" | sed 's/^[^:]*): //')
    case "$result" in
        PASS*)
            echo "ok   $name ($result)"
            passed=$((passed + 1))
            ;;
        *)
            echo "FAIL $name: ${result:-no result}"
            # The engine's own output helps with exceptions thrown outside of t.run
            printf '%s\n' "$output" | grep -iE "error|exception" | head -5 | sed 's/^/     /'
            failed=$((failed + 1))
            ;;
    esac
}

for test in "$@"; do
    name=$(basename "$test" .js)
    case "$name" in lib | *.reopen) continue ;; esac
    document=$(sed -n 's#^// document: ##p' "$test")
    save=$(sed -n 's#^// save: ##p' "$test")
    if [ -z "$document" ]; then
        echo "FAIL $name: no \"// document:\" line"
        failed=$((failed + 1))
        continue
    fi
    if [ -n "$save" ]; then
        rm -f "$OUT_DIR/$save"
        check "$name" "$test" "$document" "$OUT_DIR/$save"
        reopen="$TESTS_DIR/$name.reopen.js"
        [ -f "$reopen" ] && check "$name.reopen" "$reopen" "$OUT_DIR/$save"
    else
        check "$name" "$test" "$document"
    fi
done

echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
