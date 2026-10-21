// Engine check on the desktop: opens a document, prints its pages and renders page 1
// once in one piece and once from 256 px tiles, compares both and saves them as PNG.
//
// Usage: eo-render <runtime dir> <document> <output dir> [scale] [script.js...]
//
// Scripts run in sdkjs after opening (e.g. editing commands from engine.js); their
// results are printed.

#include "../src/Document.h"

#include "DesktopEditor/raster/BgraFrame.h"

#include <chrono>
#include <codecvt>
#include <fstream>
#include <sstream>
#include <iostream>
#include <locale>
#include <string>
#include <vector>

namespace
{
	std::wstring ToWide(const std::string& s)
	{
		return std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(s);
	}

	double MillisecondsSince(std::chrono::steady_clock::time_point start)
	{
		return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
	}

	void SavePng(std::vector<unsigned char>& pixels, int width, int height, const std::string& path)
	{
		CBgraFrame frame;
		frame.put_Data(pixels.data());
		frame.put_Width(width);
		frame.put_Height(height);
		frame.put_Stride(4 * width);
		frame.SaveFile(ToWide(path), 4 /* PNG */);
		frame.put_Data(nullptr); // owned by the vector
	}
}

int main(int argc, char* argv[])
{
	if (argc < 4)
	{
		std::cerr << "Usage: eo-render <runtime dir> <document> <output dir> [scale] [script.js | save path ...]" << std::endl;
		return 1;
	}
	const std::string outDir = argv[3];
	const double scale = argc > 4 ? std::stod(argv[4]) : 1.5;

	eo::Document::Initialize(ToWide(argv[1]));
	int exitCode = 0;
	{
		eo::Document document;

		auto start = std::chrono::steady_clock::now();
		if (!document.Open(ToWide(argv[2]), ToWide(outDir + "/tmp")))
		{
			std::cerr << "open failed" << std::endl;
			return 2;
		}
		std::cout << "open + layout: " << MillisecondsSince(start) << " ms" << std::endl;

		for (int i = 5; i < argc; ++i)
		{
			// Other arguments than scripts: save the document there
			const std::string arg = argv[i];
			if (arg.size() < 3 || arg.substr(arg.size() - 3) != ".js")
			{
				start = std::chrono::steady_clock::now();
				int error = document.Save(ToWide(arg), ToWide(arg.substr(arg.find_last_of('.') + 1)));
				std::cout << "save " << arg << " (" << MillisecondsSince(start) << " ms): " << error << std::endl;
				continue;
			}
			std::ifstream file(argv[i]);
			std::stringstream script;
			script << file.rdbuf();
			start = std::chrono::steady_clock::now();
			std::string result = document.Execute(ToWide(script.str()));
			std::cout << argv[i] << " (" << MillisecondsSince(start) << " ms): " << result << std::endl;
		}

		int pageCount = document.GetPageCount();
		std::cout << "pages: " << pageCount << std::endl;
		for (int i = 0; i < pageCount; ++i)
		{
			eo::PageSize size = document.GetPageSize(i);
			std::cout << "  page " << i << ": " << size.widthMm << " x " << size.heightMm << " mm" << std::endl;
		}

		eo::PageSize size = document.GetPageSize(0);
		const int pageWidth = (int)(size.widthMm / 25.4 * 96 * scale + 0.5);
		const int pageHeight = (int)(size.heightMm / 25.4 * 96 * scale + 0.5);

		std::vector<unsigned char> whole(4 * pageWidth * pageHeight);
		start = std::chrono::steady_clock::now();
		document.RenderTile(0, pageWidth, pageHeight, 0, 0, pageWidth, pageHeight, whole.data(), false);
		std::cout << "page 1 in one piece (" << pageWidth << " x " << pageHeight << "): " << MillisecondsSince(start) << " ms" << std::endl;
		SavePng(whole, pageWidth, pageHeight, outDir + "/page1.png");

		const int tileSize = 256;
		std::vector<unsigned char> tiled(4 * pageWidth * pageHeight);
		std::vector<unsigned char> tile(4 * tileSize * tileSize);
		int tiles = 0;
		start = std::chrono::steady_clock::now();
		for (int y = 0; y < pageHeight; y += tileSize)
		{
			for (int x = 0; x < pageWidth; x += tileSize)
			{
				int w = std::min(tileSize, pageWidth - x);
				int h = std::min(tileSize, pageHeight - y);
				if (!document.RenderTile(0, pageWidth, pageHeight, x, y, w, h, tile.data(), false))
				{
					std::cerr << "tile failed at " << x << "," << y << std::endl;
					exitCode = 3;
				}
				for (int row = 0; row < h; ++row)
					std::copy(tile.begin() + 4 * row * w, tile.begin() + 4 * (row * w + w),
					          tiled.begin() + 4 * ((y + row) * pageWidth + x));
				++tiles;
			}
		}
		std::cout << "page 1 from " << tiles << " tiles of " << tileSize << " px: " << MillisecondsSince(start) << " ms" << std::endl;
		SavePng(tiled, pageWidth, pageHeight, outDir + "/page1-tiled.png");

		size_t different = 0;
		for (size_t i = 0; i < whole.size(); i += 4)
		{
			for (int c = 0; c < 3; ++c)
			{
				if (std::abs(whole[i + c] - tiled[i + c]) > 8)
				{
					++different;
					break;
				}
			}
		}
		std::cout << "pixels differing between whole and tiled: " << different << " of " << whole.size() / 4 << std::endl;
	}
	eo::Document::Dispose();
	return exitCode;
}
