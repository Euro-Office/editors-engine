#pragma once

#include "Document.h"

#include <memory>
#include <string>

namespace eo
{
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

	private:
		struct Private;
		std::unique_ptr<Private> m_private;
	};
}
