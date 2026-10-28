// Assertions for the engine tests (run.sh runs this before each test, in the same V8 context).
// A test ends with t.done(), whose result run.sh reads: "PASS <count>" or "FAIL <messages>".
var t = (function () {
	var count = 0;
	var failures = [];
	function describe(value) {
		return typeof value === "string" ? JSON.stringify(value) : String(value);
	}
	return {
		// The editor state after the last command
		state: function () { return JSON.parse(eoEngine.getState()); },
		ok: function (name, condition) {
			count++;
			if (!condition)
				failures.push(name);
		},
		eq: function (name, actual, expected) {
			count++;
			if (actual !== expected)
				failures.push(name + ": " + describe(actual) + ", expected " + describe(expected));
		},
		// Runs fn; a thrown exception is a failure
		run: function (name, fn) {
			try {
				fn();
			} catch (e) {
				count++;
				failures.push(name + ": " + e + (e && e.stack ? " " + e.stack.split("\n")[1] : ""));
			}
		},
		// The state's error (an exception in a command) is a failure
		noError: function (name) {
			this.eq(name + " without error", this.state()["error"], null);
		},
		done: function () {
			return failures.length ? "FAIL " + failures.join("; ") : "PASS " + count;
		}
	};
})();

// A click at a point of a page (mm)
function click(page, x, y, clicks) {
	eoEngine.mouse(0, page, x, y, clicks || 1, false, false);
	eoEngine.mouse(2, page, x, y, clicks || 1, false, false);
}

// The text of the document's paragraphs (documents)
function documentText() {
	return Asc.editor.WordControl.m_oLogicDocument.GetText({ "ParaSeparator": "\n" });
}
