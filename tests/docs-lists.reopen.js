// The file docs-lists.js saved: its last paragraph in the multilevel list preset 1
eoEngine.keyDown(35, false, true); // Ctrl+End
var presets = JSON.parse(eoEngine.getListPresets());
t.eq("multilevel preset", presets.multilevel, 1);
// Its first level is the single level preset 3 ("1." on the right)
t.eq("and its first level", presets.numbers, 3);
t.eq("a numbered list", t.state().format.List, 1);
t.done();
