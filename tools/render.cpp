// Engine check on the desktop: opens a document, prints its pages and renders page 1
// once in one piece and once from 256 px tiles, compares both and saves them as PNG.
//
// Usage: eo-render <runtime dir> <document> <output dir> [scale] [script.js | save path ...]
//
// Scripts run in sdkjs after opening (e.g. editing commands from engine.js); their
// results are printed. Other paths save the document there. PDF, XPS and DjVu files are
// drawn by core's readers instead (password in EO_PASSWORD).

#include "../src/Document.h"
#include "../src/DrawingDocument.h"

#include "DesktopEditor/raster/BgraFrame.h"

#include <chrono>
#include <cstdlib>
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

	// Prints the pages and renders page 1 whole and from tiles; returns the exit code
	template <class AnyDocument>
	int CheckRendering(AnyDocument& document, double scale, const std::string& outDir)
	{
		int exitCode = 0;
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
	auto start = std::chrono::steady_clock::now();
	document.RenderTile(0, pageWidth, pageHeight, 0, 0, pageWidth, pageHeight, whole.data(), false);
	std::cout << "page 1 in one piece (" << pageWidth << " x " << pageHeight << "): " << MillisecondsSince(start) << " ms" << std::endl;
	SavePng(whole, pageWidth, pageHeight, outDir + "/page1.png");
	// EO_ALL_PAGES=1: every page as page<n>.png
	if (getenv("EO_ALL_PAGES"))
	{
		for (int i = 1; i < pageCount; ++i)
		{
			eo::PageSize other = document.GetPageSize(i);
			const int w = (int)(other.widthMm / 25.4 * 96 * scale + 0.5);
			const int h = (int)(other.heightMm / 25.4 * 96 * scale + 0.5);
			std::vector<unsigned char> pixels(4 * w * h);
			document.RenderTile(i, w, h, 0, 0, w, h, pixels.data(), false);
			SavePng(pixels, w, h, outDir + "/page" + std::to_string(i + 1) + ".png");
		}
	}

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
		return exitCode;
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

	// PDF, XPS and DjVu: drawn by core's readers
	const std::string path = argv[2];
	const std::string extension = path.substr(path.find_last_of('.') + 1);
	if (extension == "pdf" || extension == "xps" || extension == "djvu")
	{
		eo::DrawingDocument document;
		auto start = std::chrono::steady_clock::now();
		const char* password = getenv("EO_PASSWORD");
		eo::DrawingDocument::OpenResult result = document.Open(ToWide(path), password ? ToWide(password) : L"", ToWide(outDir));
		if (result != eo::DrawingDocument::Opened)
		{
			std::cerr << (result == eo::DrawingDocument::NeedsPassword ? "needs a password" : "open failed") << std::endl;
			return 2;
		}
		std::cout << "open: " << MillisecondsSince(start) << " ms" << std::endl;
		// EO_TEXT=<page>: the page's text, the boxes of its first characters and its links
		if (const char* textPage = getenv("EO_TEXT"))
		{
			int page = std::atoi(textPage);
			start = std::chrono::steady_clock::now();
			eo::PageText text = document.GetPageText(page);
			std::cout << "text of page " << page + 1 << " (" << MillisecondsSince(start) << " ms, "
			          << text.text.size() << " units):" << std::endl
			          << std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>().to_bytes(text.text) << std::endl;
			std::ofstream boxes(outDir + "/boxes.txt");
			for (float value : text.boxes)
				boxes << value << "\n";
			for (size_t i = 0; i < std::min<size_t>(text.text.size(), 12); ++i)
				std::cout << "  box " << i << ": " << text.boxes[4 * i] << ", " << text.boxes[4 * i + 1] << ", "
				          << text.boxes[4 * i + 2] << ", " << text.boxes[4 * i + 3] << std::endl;
			for (const eo::PageLink& link : document.GetLinks(page))
				std::cout << "  link " << link.url << " page " << link.destPage << " y " << link.destY << " at " << link.x << ", " << link.y
				          << " (" << link.width << " x " << link.height << ")" << std::endl;
			std::vector<eo::OutlineItem> outline = document.GetOutline();
			std::cout << "outline: " << outline.size() << " entries" << std::endl;
			for (size_t i = 0; i < std::min<size_t>(outline.size(), 8); ++i)
				std::cout << "  " << std::string(2 * outline[i].level, ' ') << outline[i].title << " -> page " << outline[i].page + 1
				          << " y " << outline[i].y << std::endl;
		}
		// EO_PDF_EDIT=<path>: saves the PDF with a highlight on page 1's first line, an
		// underline on its second and EO_PDF_IMAGE (a PNG) at 120, 250 mm, 50 x 20 mm
		if (const char* editPath = getenv("EO_PDF_EDIT"))
		{
			eo::PageText text = document.GetPageText(0);
			std::vector<eo::PdfMarkup> markups;
			auto lineQuad = [&](size_t from, size_t to, int type)
			{
				eo::PdfMarkup markup;
				markup.page = 0;
				markup.type = type;
				markup.author = L"eo-render";
				float left = text.boxes[4 * from], top = text.boxes[4 * from + 1];
				float right = text.boxes[4 * to + 2], bottom = text.boxes[4 * to + 3];
				markup.quads = { left, top, right, top, left, bottom, right, bottom };
				if (type == 9) { markup.red = 0; markup.green = 0; markup.blue = 1; }
				markups.push_back(markup);
			};
			size_t firstBreak = text.text.find(u'\n');
			size_t secondBreak = text.text.find(u'\n', firstBreak + 1);
			if (getenv("EO_PDF_NO_MARKUPS"))
				firstBreak = secondBreak = std::u16string::npos;
			if (firstBreak != std::u16string::npos && firstBreak > 0)
				lineQuad(0, firstBreak - 1, 8);
			if (secondBreak != std::u16string::npos && firstBreak != std::u16string::npos)
				lineQuad(firstBreak + 1, secondBreak - 1, 9);
			std::vector<eo::PdfImage> images;
			if (const char* image = getenv("EO_PDF_IMAGE"))
				images.push_back({ 0, ToWide(image), 120, 250, 50, 20 });
			int saved = document.SaveWithChanges(ToWide(editPath), markups, images);
			std::cout << "saved with " << markups.size() << " markups: " << saved << std::endl;
			eo::Document::Dispose();
			return saved;
		}
		int exitCode = CheckRendering(document, scale, outDir);
		document.Close();
		eo::Document::Dispose();
		return exitCode;
	}
	int exitCode = 0;
	{
		eo::Document document;

		auto start = std::chrono::steady_clock::now();
		const char* password = getenv("EO_PASSWORD");
		int opened = document.Open(ToWide(argv[2]), ToWide(outDir + "/tmp"), password ? ToWide(password) : L"");
		if (opened != 0)
		{
			std::cerr << (opened == eo::Document::ERROR_PASSWORD ? "needs a password" : "open failed") << " (" << opened << ")" << std::endl;
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
				// EO_SAVE_PASSWORD: saved encrypted with it
				const char* savePassword = getenv("EO_SAVE_PASSWORD");
				std::wstring extension = ToWide(arg.substr(arg.find_last_of('.') + 1));
				int error = savePassword ? document.SaveWithPassword(ToWide(arg), extension, ToWide(savePassword))
				                         : document.Save(ToWide(arg), extension);
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

		exitCode = CheckRendering(document, scale, outDir);
	}
	eo::Document::Dispose();
	return exitCode;
}
