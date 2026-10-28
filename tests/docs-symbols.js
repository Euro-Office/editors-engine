// document: editors-engine/tests/documents/utf8.txt
// Symbol's and Wingdings' characters (bullets) are drawn with OpenSymbol's glyphs for them, as
// sdkjs' own graphics draw them; core's graphics got the codes as they are (letters)
var drawn = [];
var graphics = new AscCommon.CNativeGraphics();
graphics.Native = {
	"SetFont": function () {},
	"FillText": function (x, y, code) { drawn.push(code); },
	"FillText2": function (x, y, code) { drawn.push(code); },
	"FillTextCode": function (x, y, code) { drawn.push(code); }
};
function draw(name, code) {
	drawn = [];
	graphics.SetFont({ FontFamily: { Name: name, Index: -1 }, FontSize: 11 });
	graphics.FillTextCode(0, 0, code);
	graphics.FillText(0, 0, String.fromCharCode(code));
	return drawn;
}
t.eq("Wingdings' square", draw("Wingdings", 0xA7).join(), [0xE46F, 0xE46F].join());
t.eq("Wingdings' check mark, as a symbol font's code", draw("Wingdings", 0xF0FC).join(), [0xE330, 0xE330].join());
t.eq("Symbol's bullet", draw("Symbol", 0xB7).join(), [0xE12C, 0xE12C].join());
t.eq("other fonts' text", draw("Arial", 0xA7).join(), [0xA7, 0xA7].join());
t.done();
