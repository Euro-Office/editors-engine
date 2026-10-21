#pragma once

#include "Document.h"

#include <memory>
#include <string>
#include <vector>

namespace eo
{
	// The text of a page in reading order, with a box (left, top, right, bottom, in mm from
	// the top left) for each UTF-16 unit. Spaces and line breaks between the drawn
	// characters are added, with empty boxes.
	struct PageText
	{
		std::u16string text;
		std::vector<float> boxes;
	};

	// A web address found in a page's text, with its area in mm from the top left
	struct PageLink
	{
		std::string url;
		float x = 0, y = 0, width = 0, height = 0;
	};

	// A PDF, XPS or DjVu file, drawn by core's file readers (no sdkjs). Uses the fonts of
	// Document::Initialize. Not thread-safe: use it on one thread.
	class DrawingDocument
	{
	public:
		enum OpenResult
		{
			Opened = 0,
			Failed = 1,
			NeedsPassword = 2
		};

		DrawingDocument();
		~DrawingDocument();

		OpenResult Open(const std::wstring& path, const std::wstring& password, const std::wstring& tempDir);
		void Close();

		int GetPageCount();
		PageSize GetPageSize(int page);

		// As Document::RenderTile: the area (x, y, width, height) of a page rendered at
		// pageWidth x pageHeight pixels, into pixels (width * height * 4 bytes)
		bool RenderTile(int page, int pageWidth, int pageHeight,
		                int x, int y, int width, int height,
		                unsigned char* pixels, bool rgba);

		PageText GetPageText(int page);
		std::vector<PageLink> GetLinks(int page);

	private:
		struct Private;
		std::unique_ptr<Private> m_private;
	};
}
