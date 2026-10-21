#include "DrawingDocument.h"

#include "DesktopEditor/common/File.h"
#include "DesktopEditor/graphics/pro/Graphics.h"
#include "DesktopEditor/raster/BgraFrame.h"
#include "DjVuFile/DjVu.h"
#include "PdfFile/PdfFile.h"
#include "XpsFile/XpsFile.h"

#include <cstring>

namespace eo
{
	namespace
	{
		// CPdfFile::GetError() when the file needs a password
		const int PDF_ERROR_PASSWORD = 4;

		enum class Format { Unknown, Pdf, Xps, DjVu };

		// By the first bytes, like CDrawingFile::DetectFormat
		Format DetectFormat(const std::wstring& path)
		{
			NSFile::CFileBinary file;
			if (!file.OpenFile(path))
				return Format::Unknown;
			BYTE header[1024] = {};
			DWORD read = 0;
			file.ReadFile(header, sizeof(header), read);
			file.CloseFile();

			std::string start(reinterpret_cast<char*>(header), read);
			if (start.find("%PDF") != std::string::npos)
				return Format::Pdf;
			if (start.compare(0, 8, "AT&TFORM") == 0)
				return Format::DjVu;
			// XPS files are ZIP packages
			if (read >= 4 && header[0] == 'P' && header[1] == 'K')
				return Format::Xps;
			return Format::Unknown;
		}
	}

	struct DrawingDocument::Private
	{
		std::unique_ptr<IOfficeDrawingFile> file;
		Format format = Format::Unknown;
		NSFonts::IFontManager* fontManager = nullptr;
	};

	DrawingDocument::DrawingDocument() : m_private(new Private()) {}

	DrawingDocument::~DrawingDocument()
	{
		Close();
	}

	DrawingDocument::OpenResult DrawingDocument::Open(const std::wstring& path, const std::wstring& password, const std::wstring& tempDir)
	{
		Close();
		NSFonts::IApplicationFonts* fonts = Document::GetFonts();
		if (!fonts)
			return Failed;

		Format format = DetectFormat(path);
		IOfficeDrawingFile* file = nullptr;
		switch (format)
		{
		case Format::Pdf: file = new CPdfFile(fonts); break;
		case Format::Xps: file = new CXpsFile(fonts); break;
		case Format::DjVu: file = new CDjVuFile(fonts); break;
		default: return Failed;
		}
		m_private->file.reset(file);
		file->SetTempDirectory(tempDir);

		const wchar_t* passwordValue = password.empty() ? nullptr : password.c_str();
		if (!file->LoadFromFile(path, L"", passwordValue, passwordValue))
		{
			bool needsPassword = format == Format::Pdf && static_cast<CPdfFile*>(file)->GetError() == PDF_ERROR_PASSWORD;
			Close();
			return needsPassword ? NeedsPassword : Failed;
		}
		m_private->format = format;

		m_private->fontManager = fonts->GenerateFontManager();
		NSFonts::IFontsCache* fontCache = NSFonts::NSFontCache::Create();
		fontCache->SetStreams(fonts->GetStreams());
		fontCache->SetCacheSize(8);
		m_private->fontManager->SetOwnerCache(fontCache);
		return Opened;
	}

	void DrawingDocument::Close()
	{
		m_private->file.reset();
		m_private->format = Format::Unknown;
		RELEASEINTERFACE(m_private->fontManager);
	}

	int DrawingDocument::GetPageCount()
	{
		return m_private->file ? m_private->file->GetPagesCount() : 0;
	}

	PageSize DrawingDocument::GetPageSize(int page)
	{
		PageSize size;
		if (!m_private->file)
			return size;
		double width = 0, height = 0, dpiX = 96, dpiY = 96;
		m_private->file->GetPageInfo(page, &width, &height, &dpiX, &dpiY);
		// PDF: points at 72 dpi; DjVu: pixels at the page's dpi; XPS: mm, reported as 25.4 dpi
		size.widthMm = width * 25.4 / dpiX;
		size.heightMm = height * 25.4 / dpiY;
		return size;
	}

	bool DrawingDocument::RenderTile(int page, int pageWidth, int pageHeight,
	                                 int x, int y, int width, int height,
	                                 unsigned char* pixels, bool rgba)
	{
		if (!m_private->file || page < 0 || page >= GetPageCount())
			return false;

		// White paper
		memset(pixels, 0xFF, (size_t)width * height * 4);

		CBgraFrame frame;
		frame.put_Data(pixels);
		frame.put_Width(width);
		frame.put_Height(height);
		frame.put_Stride(4 * width);

		NSGraphics::IGraphicsRenderer* renderer = NSGraphics::Create();
		renderer->SetFontManager(m_private->fontManager);
		renderer->CreateFromBgraFrame(&frame);
		renderer->SetSwapRGB(rgba);

		// The page's size in the renderer's units, as core's IOfficeDrawingFile::ConvertToPixels
		// passes it; scaled so that the tile is the given part of the page
		double pageW = 0, pageH = 0, dpiX = 96, dpiY = 96;
		m_private->file->GetPageInfo(page, &pageW, &pageH, &dpiX, &dpiY);
		if (m_private->format == Format::Pdf)
		{
			pageW *= 25.4 / dpiX;
			pageH *= 25.4 / dpiY;
		}
		renderer->put_Width(pageW * width / pageWidth);
		renderer->put_Height(pageH * height / pageHeight);
		renderer->SetCoordTransformOffset(-x, -y);

		bool stop = false;
		m_private->file->DrawPageOnRenderer(renderer, page, &stop);

		RELEASEOBJECT(renderer);
		// The pixels belong to the caller
		frame.put_Data(nullptr);
		return true;
	}
}
