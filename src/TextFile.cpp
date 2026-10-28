#include "TextFile.h"

#include "DesktopEditor/common/File.h"

#include <algorithm>
#include <map>
#include <vector>

namespace eo
{
	namespace TextFile
	{
		namespace
		{
			// What is read of a file to guess from
			const DWORD SAMPLE_SIZE = 1 << 20;
			// Records of a csv compared for its delimiter
			const size_t SAMPLE_RECORDS = 20;

			// Valid UTF-8; a sequence cut off by the end of a sample (truncated) counts as valid
			bool IsUtf8(const std::vector<unsigned char>& bytes, bool truncated)
			{
				size_t i = 0, size = bytes.size();
				while (i < size)
				{
					unsigned char c = bytes[i];
					size_t length = c < 0x80 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 0;
					// Overlong two-byte forms (C0, C1) and code points above U+10FFFF (F5..)
					if (length == 0 || c == 0xC0 || c == 0xC1 || c > 0xF4)
						return false;
					if (i + length > size)
						return truncated;
					for (size_t k = 1; k < length; ++k)
						if ((bytes[i + k] & 0xC0) != 0x80)
							return false;
					i += length;
				}
				return true;
			}

			// UTF-16 without a byte order mark: text in Latin scripts has every other byte zero
			int Utf16ByZeros(const std::vector<unsigned char>& bytes)
			{
				size_t pairs = std::min<size_t>(bytes.size(), 4096) / 2;
				if (pairs < 2)
					return -1;
				size_t evenZeros = 0, oddZeros = 0;
				for (size_t i = 0; i < pairs; ++i)
				{
					evenZeros += bytes[2 * i] == 0;
					oddZeros += bytes[2 * i + 1] == 0;
				}
				if (oddZeros * 10 >= pairs * 4 && evenZeros * 20 < pairs)
					return UTF16LE;
				if (evenZeros * 10 >= pairs * 4 && oddZeros * 20 < pairs)
					return UTF16BE;
				return -1;
			}

			// Windows' ANSI code page of a language
			int LegacyEncoding(const std::wstring& language)
			{
				std::wstring code = language.substr(0, language.find_first_of(L"-_"));
				if (code == L"zh")
				{
					// Traditional Chinese: Taiwan, Hong Kong, Macao and the script tag
					bool traditional = language.find(L"TW") != std::wstring::npos || language.find(L"HK") != std::wstring::npos ||
						language.find(L"MO") != std::wstring::npos || language.find(L"Hant") != std::wstring::npos;
					return traditional ? 17 : 18;
				}
				static const std::map<std::wstring, int> encodings = {
					{ L"ar", 2 }, { L"fa", 2 }, { L"ur", 2 },
					{ L"lt", 6 }, { L"lv", 6 }, { L"et", 6 },
					{ L"ru", 14 }, { L"uk", 14 }, { L"be", 14 }, { L"bg", 14 }, { L"sr", 14 }, { L"mk", 14 }, { L"kk", 14 },
					{ L"pl", 16 }, { L"cs", 16 }, { L"sk", 16 }, { L"hu", 16 }, { L"hr", 16 }, { L"sl", 16 }, { L"ro", 16 },
					{ L"bs", 16 }, { L"sq", 16 },
					{ L"el", 23 },
					{ L"he", 26 }, { L"iw", 26 },
					{ L"ja", 27 },
					{ L"ko", 28 },
					{ L"th", 32 },
					{ L"tr", 36 }, { L"az", 36 },
					{ L"vi", 45 }
				};
				auto encoding = encodings.find(code);
				return encoding == encodings.end() ? WINDOWS_1252 : encoding->second;
			}

			// The sample as characters, enough to find ASCII delimiters, quotes and line ends
			std::vector<unsigned int> CodeUnits(const std::vector<unsigned char>& bytes, int encoding)
			{
				std::vector<unsigned int> units;
				size_t width = encoding == UTF16LE || encoding == UTF16BE ? 2 : encoding == UTF32LE || encoding == UTF32BE ? 4 : 1;
				bool bigEndian = encoding == UTF16BE || encoding == UTF32BE;
				units.reserve(bytes.size() / width);
				for (size_t i = 0; i + width <= bytes.size(); i += width)
				{
					unsigned int unit = 0;
					for (size_t k = 0; k < width; ++k)
						unit |= (unsigned int)bytes[i + k] << (8 * (bigEndian ? width - 1 - k : k));
					units.push_back(unit);
				}
				return units;
			}

			int GuessDelimiter(const std::vector<unsigned int>& text, bool truncated)
			{
				const unsigned int candidates[] = { '\t', ';', ',' };
				const int delimiters[] = { TAB, SEMICOLON, COMMA };
				// Each record's number of each candidate, outside of quotes
				std::vector<std::vector<size_t>> records;
				std::vector<size_t> counts(3, 0);
				bool quoted = false, empty = true;
				for (unsigned int c : text)
				{
					if (c == '"')
						quoted = !quoted;
					if (!quoted && c == '\n')
					{
						if (!empty)
							records.push_back(counts);
						if (records.size() == SAMPLE_RECORDS)
							break;
						counts.assign(3, 0);
						empty = true;
						continue;
					}
					if (c != '\r')
						empty = false;
					for (size_t k = 0; k < 3; ++k)
						counts[k] += !quoted && c == candidates[k];
				}
				// The last record of a cut-off sample may be cut off too
				if (!empty && !truncated && records.size() < SAMPLE_RECORDS)
					records.push_back(counts);

				int best = -1;
				size_t bestCount = 0, bestTotal = 0;
				int mostOften = COMMA;
				for (size_t k = 0; k < 3; ++k)
				{
					size_t total = 0;
					bool same = !records.empty() && records[0][k] > 0;
					for (const auto& record : records)
					{
						total += record[k];
						same = same && record[k] == records[0][k];
					}
					if (same && records[0][k] > bestCount)
					{
						best = delimiters[k];
						bestCount = records[0][k];
					}
					if (total > bestTotal)
					{
						mostOften = delimiters[k];
						bestTotal = total;
					}
				}
				return best >= 0 ? best : mostOften;
			}
		}

		bool IsTextFormat(const std::wstring& extension)
		{
			return extension == L"txt" || extension == L"csv" || extension == L"tsv";
		}

		TextOptions Guess(const std::wstring& path, const std::wstring& extension, const std::wstring& language, TextOptions given)
		{
			TextOptions options = given;
			bool needsDelimiter = extension != L"txt";
			if (options.encoding >= 0 && (options.delimiter >= 0 || !needsDelimiter))
				return options;

			std::vector<unsigned char> bytes;
			bool truncated = false;
			NSFile::CFileBinary file;
			if (file.OpenFile(path))
			{
				truncated = file.GetFileSize() > SAMPLE_SIZE;
				bytes.resize(std::min<long>(file.GetFileSize(), SAMPLE_SIZE));
				DWORD read = 0;
				if (!bytes.empty())
					file.ReadFile(bytes.data(), (DWORD)bytes.size(), read);
				bytes.resize(read);
				file.CloseFile();
			}

			if (options.encoding < 0)
			{
				size_t size = bytes.size();
				if (size >= 4 && bytes[0] == 0xFF && bytes[1] == 0xFE && bytes[2] == 0 && bytes[3] == 0)
					options.encoding = UTF32LE;
				else if (size >= 4 && bytes[0] == 0 && bytes[1] == 0 && bytes[2] == 0xFE && bytes[3] == 0xFF)
					options.encoding = UTF32BE;
				else if (size >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
					options.encoding = UTF16LE;
				else if (size >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
					options.encoding = UTF16BE;
				else if ((options.encoding = Utf16ByZeros(bytes)) < 0)
					options.encoding = IsUtf8(bytes, truncated) ? UTF8 : LegacyEncoding(language);
			}

			if (options.delimiter < 0 && needsDelimiter)
				options.delimiter = extension == L"tsv" ? TAB : GuessDelimiter(CodeUnits(bytes, options.encoding), truncated);
			return options;
		}
	}
}
