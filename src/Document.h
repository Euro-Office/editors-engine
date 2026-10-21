#pragma once

#include <memory>
#include <string>

namespace eo
{
	struct PageSize
	{
		double widthMm = 0;
		double heightMm = 0;
	};

	// A document opened in sdkjs, running in core's doctrenderer (V8).
	//
	// sdkjs is single-threaded: create, use and destroy a Document on one thread,
	// and only one Document per thread.
	class Document
	{
	public:
		// Process-wide setup. runtimeDir holds DoctRenderer.config, the sdkjs bundles
		// and the font index (fonts/AllFonts.js, fonts/font_selection.bin).
		static bool Initialize(const std::wstring& runtimeDir);
		static void Dispose();

		Document();
		~Document();

		// Converts the file to sdkjs' format in tempDir and lays it out
		bool Open(const std::wstring& path, const std::wstring& tempDir);
		void Close();

		// Saves the document with its edits to path, converted by x2t to the format of
		// extension ("docx", "odt", "rtf", "txt", "pdf", ...). Returns 0, the x2t error
		// code or -1 for a format the engine can't write (for example "doc").
		int Save(const std::wstring& path, const std::wstring& extension);

		// Runs JavaScript in the document's context (see engine.js for the editing
		// commands) and returns its result if that is a string
		std::string Execute(const std::wstring& script);

		int GetPageCount();
		PageSize GetPageSize(int page);

		// Draws the area (x, y, width, height) of a page rendered at pageWidth x pageHeight
		// pixels into pixels (width * height * 4 bytes, rows without padding). rgba selects
		// RGBA byte order (Android bitmaps) instead of BGRA.
		bool RenderTile(int page, int pageWidth, int pageHeight,
		                int x, int y, int width, int height,
		                unsigned char* pixels, bool rgba);

	private:
		struct Private;
		std::unique_ptr<Private> m_private;
	};
}
