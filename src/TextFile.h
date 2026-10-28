#pragma once

#include <string>

namespace eo
{
	// How x2t reads a plain-text file (txt, csv): its encoding, an index in core's
	// UnicodeConverter_Encodings.h (46 is UTF-8), and for csv its delimiter (x2t's TCsvDelimiter).
	// -1: not known.
	struct TextOptions
	{
		int encoding = -1;
		int delimiter = -1;
	};

	namespace TextFile
	{
		const int UTF8 = 46;
		const int UTF16LE = 48;
		const int UTF16BE = 49;
		const int UTF32LE = 50;
		const int UTF32BE = 51;
		const int WINDOWS_1252 = 44;

		const int TAB = 1;
		const int SEMICOLON = 2;
		const int COMMA = 4;

		// Whether x2t needs text options to open a file with this extension (lower case)
		bool IsTextFormat(const std::wstring& extension);

		// Fills what given leaves open (-1) from the start of the file: a byte order mark, UTF-16
		// without one or valid UTF-8; otherwise the legacy (ANSI) encoding of language ("ru",
		// "zh-TW", ...; Windows-1252 for others), as Windows' editors read such files. csv's
		// delimiter is the one of tab, semicolon and comma its lines have the same number of
		// times (outside of quotes), tsv's tab.
		TextOptions Guess(const std::wstring& path, const std::wstring& extension, const std::wstring& language, TextOptions given);
	}
}
