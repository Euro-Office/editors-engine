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

	// A link on a page: a web address (url) or a place in the file (destPage, destY in mm
	// from its top), with its area in mm from the top left
	struct PageLink
	{
		std::string url;
		float x = 0, y = 0, width = 0, height = 0;
		int destPage = -1;
		float destY = 0;
	};

	// An entry of the file's outline (bookmarks): level 1 for the top
	struct OutlineItem
	{
		std::string title;
		int level = 1;
		int page = 0;
		float y = 0;
	};

	// Text marked up on a PDF page: type 8 highlight, 9 underline, 11 strikeout; quads of
	// four corners (top left, top right, bottom left, bottom right) in mm from the page's top left
	struct PdfMarkup
	{
		int page = 0;
		int type = 8;
		float red = 1, green = 1, blue = 0;
		std::vector<float> quads;
		std::wstring author;
	};

	// A picture (PNG) put on a PDF page, such as a drawn signature: its area in mm from the top left
	struct PdfImage
	{
		int page = 0;
		std::wstring path;
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
		// pageWidth x pageHeight pixels, into pixels (width * height * 4 bytes); without
		// annotations and form fields, the page alone (sdkjs' PDF editor draws them)
		bool RenderTile(int page, int pageWidth, int pageHeight,
		                int x, int y, int width, int height,
		                unsigned char* pixels, bool rgba, bool annotations = true);

		PageText GetPageText(int page);
		std::vector<PageLink> GetLinks(int page);
		std::vector<OutlineItem> GetOutline();

		// PDF files: saves the file with the markups (as annotations) and pictures added, as an
		// incremental update, to path. The document is closed then: open the saved file to go on.
		// Returns 0 or an error (-1 not a PDF, -2 can't write).
		int SaveWithChanges(const std::wstring& path, const std::vector<PdfMarkup>& markups, const std::vector<PdfImage>& images);
		// PDF files: saves the file with the changes of sdkjs' PDF editor (its edit commands,
		// as x2t applies them: CHtmlPage.Save's result without "%PDF") to path. Closes the
		// document as SaveWithChanges does. Returns 0 or an error (-1 not a PDF, -2 can't write).
		int SaveWithEditCommands(const std::wstring& path, unsigned char* commands, unsigned int size, const std::wstring& mediaDir);

	private:
		struct Private;
		std::unique_ptr<Private> m_private;
	};
}
