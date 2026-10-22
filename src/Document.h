#pragma once

#include <memory>
#include <string>

namespace NSFonts
{
	class IApplicationFonts;
}

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

		// Fonts of the engine (for DrawingDocument); null before Initialize
		static NSFonts::IApplicationFonts* GetFonts();

		Document();
		~Document();

		// x2t's result for a file that needs a password (AVS_FILEUTILS_ERROR_CONVERT_PASSWORD)
		static const int ERROR_PASSWORD = 91;

		// Converts the file to sdkjs' format in tempDir and lays it out. An encrypted file
		// needs its password, and is saved with it again. PDFs other than forms of the document
		// editor open in sdkjs' PDF editor (pdf.js) and are saved as PDF only. Returns 0, the x2t error code
		// (ERROR_PASSWORD for a missing or wrong password) or -1.
		int Open(const std::wstring& path, const std::wstring& tempDir, const std::wstring& password = L"");
		void Close();

		// Saves the document with its edits to path, converted by x2t to the format of
		// extension ("docx", "odt", "rtf", "txt", "pptx", "odp", "xlsx", "ods", "csv", "pdf", ...). Returns 0, the x2t error
		// code or -1 for a format the engine can't write (for example "doc").
		int Save(const std::wstring& path, const std::wstring& extension);
		// The same, with the given password instead of the file's ("" for none)
		int SaveWithPassword(const std::wstring& path, const std::wstring& extension, const std::wstring& password);

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

		// Presentations: sdkjs' designs (themes), converted once from their presentations in the
		// runtime's sdkjs/slide/themes/src for the engine's previews("themes") and setTheme.
		// Returns their count.
		int PrepareThemes();

	private:
		int OpenPdf(const std::wstring& path, const std::wstring& tempDir, const std::wstring& password);
		int SavePdf(const std::wstring& path);
		int ExportPdf(const std::wstring& path, const std::wstring& password);
		void ReopenPdf();
		bool ReplacePdfReader(const std::wstring& path);
		int Decrypt(const std::wstring& path, const std::wstring& tempDir, const std::wstring& password, std::wstring& target);

		struct Private;
		std::unique_ptr<Private> m_private;
	};
}
