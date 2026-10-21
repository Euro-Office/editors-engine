#include "DrawingDocument.h"

#include "DesktopEditor/common/File.h"
#include "DesktopEditor/graphics/pro/Graphics.h"
#include "DesktopEditor/raster/BgraFrame.h"
#include "DjVuFile/DjVu.h"
#include "PdfFile/PdfFile.h"
#include "XpsFile/XpsFile.h"

#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstdlib>
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

		// Collects the characters a file draws, in page mm from the top left (a renderer
		// that draws nothing else)
		class TextCollector : public IRenderer
		{
		public:
			struct Glyph
			{
				std::u16string text;
				// Baseline start and end, and the font height
				double x1, y1, x2, y2, size;
			};
			std::vector<Glyph> glyphs;

			TextCollector(double widthMm, double heightMm) : m_width(widthMm), m_height(heightMm) {}

			HRESULT get_Type(LONG* type) override { *type = c_nHtmlRendrererText; return S_OK; }
			HRESULT NewPage() override { return S_OK; }
			HRESULT get_Height(double* height) override { *height = m_height; return S_OK; }
			HRESULT put_Height(const double& height) override { m_height = height; return S_OK; }
			HRESULT get_Width(double* width) override { *width = m_width; return S_OK; }
			HRESULT put_Width(const double& width) override { m_width = width; return S_OK; }
			HRESULT get_DpiX(double* dpi) override { *dpi = 96; return S_OK; }
			HRESULT get_DpiY(double* dpi) override { *dpi = 96; return S_OK; }
			HRESULT get_FontSize(double* size) override { *size = m_fontSize; return S_OK; }
			HRESULT put_FontSize(const double& size) override { m_fontSize = size; return S_OK; }

			HRESULT CommandDrawTextCHAR(const LONG& c, const double& x, const double& y, const double& w, const double& h) override
			{
				Add(std::wstring(1, (wchar_t)c), x, y, w);
				return S_OK;
			}
			HRESULT CommandDrawText(const std::wstring& text, const double& x, const double& y, const double& w, const double& h) override
			{
				Add(text, x, y, w);
				return S_OK;
			}
			HRESULT CommandDrawTextExCHAR(const LONG& c, const LONG& gid, const double& x, const double& y, const double& w, const double& h) override
			{
				Add(std::wstring(1, (wchar_t)c), x, y, w);
				return S_OK;
			}
			HRESULT CommandDrawTextEx(const std::wstring& text, const unsigned int* gids, const unsigned int gidsCount, const double& x, const double& y, const double& w, const double& h) override
			{
				Add(text, x, y, w);
				return S_OK;
			}

			HRESULT SetTransform(const double& m1, const double& m2, const double& m3, const double& m4, const double& m5, const double& m6) override
			{
				m_matrix[0] = m1; m_matrix[1] = m2; m_matrix[2] = m3; m_matrix[3] = m4; m_matrix[4] = m5; m_matrix[5] = m6;
				return S_OK;
			}
			HRESULT GetTransform(double* a, double* b, double* c, double* d, double* e, double* f) override
			{
				*a = m_matrix[0]; *b = m_matrix[1]; *c = m_matrix[2]; *d = m_matrix[3]; *e = m_matrix[4]; *f = m_matrix[5];
				return S_OK;
			}
			HRESULT ResetTransform() override
			{
				SetTransform(1, 0, 0, 1, 0, 0);
				return S_OK;
			}

			// Nothing else is collected
			HRESULT get_PenColor(LONG* lColor) override { *lColor = 0; return S_OK; }
			HRESULT put_PenColor(const LONG& lColor) override { return S_OK; }
			HRESULT get_PenAlpha(LONG* lAlpha) override { *lAlpha = 0; return S_OK; }
			HRESULT put_PenAlpha(const LONG& lAlpha) override { return S_OK; }
			HRESULT get_PenSize(double* dSize) override { *dSize = 0; return S_OK; }
			HRESULT put_PenSize(const double& dSize) override { return S_OK; }
			HRESULT get_PenDashStyle(BYTE* val) override { *val = 0; return S_OK; }
			HRESULT put_PenDashStyle(const BYTE& val) override { return S_OK; }
			HRESULT get_PenLineStartCap(BYTE* val) override { *val = 0; return S_OK; }
			HRESULT put_PenLineStartCap(const BYTE& val) override { return S_OK; }
			HRESULT get_PenLineEndCap(BYTE* val) override { *val = 0; return S_OK; }
			HRESULT put_PenLineEndCap(const BYTE& val) override { return S_OK; }
			HRESULT get_PenLineJoin(BYTE* val) override { *val = 0; return S_OK; }
			HRESULT put_PenLineJoin(const BYTE& val) override { return S_OK; }
			HRESULT get_PenDashOffset(double* dOffset) override { *dOffset = 0; return S_OK; }
			HRESULT put_PenDashOffset(const double& dOffset) override { return S_OK; }
			HRESULT get_PenAlign(LONG* lAlign) override { *lAlign = 0; return S_OK; }
			HRESULT put_PenAlign(const LONG& lAlign) override { return S_OK; }
			HRESULT get_PenMiterLimit(double* dOffset) override { *dOffset = 0; return S_OK; }
			HRESULT put_PenMiterLimit(const double& dOffset) override { return S_OK; }
			HRESULT PenDashPattern(double* pPattern, LONG lCount) override { return S_OK; }
			HRESULT get_BrushType(LONG* lType) override { *lType = 0; return S_OK; }
			HRESULT put_BrushType(const LONG& lType) override { return S_OK; }
			HRESULT get_BrushColor1(LONG* lColor) override { *lColor = 0; return S_OK; }
			HRESULT put_BrushColor1(const LONG& lColor) override { return S_OK; }
			HRESULT get_BrushAlpha1(LONG* lAlpha) override { *lAlpha = 0; return S_OK; }
			HRESULT put_BrushAlpha1(const LONG& lAlpha) override { return S_OK; }
			HRESULT get_BrushColor2(LONG* lColor) override { *lColor = 0; return S_OK; }
			HRESULT put_BrushColor2(const LONG& lColor) override { return S_OK; }
			HRESULT get_BrushAlpha2(LONG* lAlpha) override { *lAlpha = 0; return S_OK; }
			HRESULT put_BrushAlpha2(const LONG& lAlpha) override { return S_OK; }
			HRESULT get_BrushTexturePath(std::wstring* bsPath) override { bsPath->clear(); return S_OK; }
			HRESULT put_BrushTexturePath(const std::wstring& bsPath) override { return S_OK; }
			HRESULT get_BrushTextureImage(Aggplus::CImage** pImage) override { *pImage = nullptr; return S_OK; }
			HRESULT put_BrushTextureImage(Aggplus::CImage* pImage) override { return S_OK; }
			HRESULT get_BrushTextureMode(LONG* lMode) override { *lMode = 0; return S_OK; }
			HRESULT put_BrushTextureMode(const LONG& lMode) override { return S_OK; }
			HRESULT get_BrushTextureAlpha(LONG* lTxAlpha) override { *lTxAlpha = 0; return S_OK; }
			HRESULT put_BrushTextureAlpha(const LONG& lTxAlpha) override { return S_OK; }
			HRESULT get_BrushTransform(Aggplus::CMatrix& oMatrix) override { return S_OK; }
			HRESULT put_BrushTransform(const Aggplus::CMatrix& oMatrix) override { return S_OK; }
			HRESULT get_BrushLinearAngle(double* dAngle) override { *dAngle = 0; return S_OK; }
			HRESULT put_BrushLinearAngle(const double& dAngle) override { return S_OK; }
			HRESULT BrushRect(const INT& val, const double& left, const double& top, const double& width, const double& height) override { return S_OK; }
			HRESULT BrushBounds(const double& left, const double& top, const double& width, const double& height) override { return S_OK; }
			HRESULT put_BrushGradientColors(LONG* lColors, double* pPositions, LONG nCount) override { return S_OK; }
			HRESULT get_FontName(std::wstring* bsName) override { bsName->clear(); return S_OK; }
			HRESULT put_FontName(const std::wstring& bsName) override { return S_OK; }
			HRESULT get_FontPath(std::wstring* bsName) override { bsName->clear(); return S_OK; }
			HRESULT put_FontPath(const std::wstring& bsName) override { return S_OK; }
			HRESULT get_FontStyle(LONG* lStyle) override { *lStyle = 0; return S_OK; }
			HRESULT put_FontStyle(const LONG& lStyle) override { return S_OK; }
			HRESULT get_FontStringGID(INT* bGID) override { *bGID = 0; return S_OK; }
			HRESULT put_FontStringGID(const INT& bGID) override { return S_OK; }
			HRESULT get_FontCharSpace(double* dSpace) override { *dSpace = 0; return S_OK; }
			HRESULT put_FontCharSpace(const double& dSpace) override { return S_OK; }
			HRESULT get_FontFaceIndex(int* lFaceIndex) override { *lFaceIndex = 0; return S_OK; }
			HRESULT put_FontFaceIndex(const int& lFaceIndex) override { return S_OK; }
			HRESULT BeginCommand(const DWORD& lType) override { return S_OK; }
			HRESULT EndCommand(const DWORD& lType) override { return S_OK; }
			HRESULT PathCommandMoveTo(const double& x, const double& y) override { return S_OK; }
			HRESULT PathCommandLineTo(const double& x, const double& y) override { return S_OK; }
			HRESULT PathCommandLinesTo(double* points, const int& count) override { return S_OK; }
			HRESULT PathCommandCurveTo(const double& x1, const double& y1, const double& x2, const double& y2, const double& x3, const double& y3) override { return S_OK; }
			HRESULT PathCommandCurvesTo(double* points, const int& count) override { return S_OK; }
			HRESULT PathCommandArcTo(const double& x, const double& y, const double& w, const double& h, const double& startAngle, const double& sweepAngle) override { return S_OK; }
			HRESULT PathCommandClose() override { return S_OK; }
			HRESULT PathCommandEnd() override { return S_OK; }
			HRESULT DrawPath(const LONG& nType) override { return S_OK; }
			HRESULT PathCommandStart() override { return S_OK; }
			HRESULT PathCommandGetCurrentPoint(double* x, double* y) override { return S_OK; }
			HRESULT PathCommandTextCHAR(const LONG& c, const double& x, const double& y, const double& w, const double& h) override { return S_OK; }
			HRESULT PathCommandText(const std::wstring& bsText, const double& x, const double& y, const double& w, const double& h) override { return S_OK; }
			HRESULT PathCommandTextExCHAR(const LONG& c, const LONG& gid, const double& x, const double& y, const double& w, const double& h) override { return S_OK; }
			HRESULT PathCommandTextEx(const std::wstring& sText, const unsigned int* pGids, const unsigned int nGidsCount, const double& x, const double& y, const double& w, const double& h) override { return S_OK; }
			HRESULT DrawImage(IGrObject* pImage, const double& x, const double& y, const double& w, const double& h) override { return S_OK; }
			HRESULT DrawImageFromFile(const std::wstring&, const double& x, const double& y, const double& w, const double& h, const BYTE& lAlpha) override { return S_OK; }
			HRESULT get_ClipMode(LONG* plMode) override { *plMode = 0; return S_OK; }
			HRESULT put_ClipMode(const LONG& lMode) override { return S_OK; }
			HRESULT CommandLong(const LONG& lType, const LONG& lCommand) override { return S_OK; }
			HRESULT CommandDouble(const LONG& lType, const double& dCommand) override { return S_OK; }
			HRESULT CommandString(const LONG& lType, const std::wstring& sCommand) override { return S_OK; }

		private:
			double m_width, m_height;
			double m_fontSize = 10;
			double m_matrix[6] = { 1, 0, 0, 1, 0, 0 };

			void Add(const std::wstring& text, double x, double y, double width)
			{
				if (text.empty() || (text.size() == 1 && (text[0] == 0 || text[0] == 0xFFFF)))
					return;
				const double* m = m_matrix;
				Glyph glyph;
				for (wchar_t c : text)
				{
					// UTF-32 (wchar_t on Linux and Android) to UTF-16
					if (c >= 0x10000)
					{
						glyph.text += (char16_t)(0xD800 + ((c - 0x10000) >> 10));
						glyph.text += (char16_t)(0xDC00 + ((c - 0x10000) & 0x3FF));
					}
					else
					{
						glyph.text += (char16_t)c;
					}
				}
				glyph.x1 = m[0] * x + m[2] * y + m[4];
				glyph.y1 = m[1] * x + m[3] * y + m[5];
				glyph.x2 = m[0] * (x + width) + m[2] * y + m[4];
				glyph.y2 = m[1] * (x + width) + m[3] * y + m[5];
				// Points to mm, scaled as the text's vertical axis
				glyph.size = m_fontSize * 25.4 / 72 * std::sqrt(m[2] * m[2] + m[3] * m[3]);
				glyphs.push_back(glyph);
			}
		};

		void Append(PageText& page, const std::u16string& text, float left, float top, float right, float bottom)
		{
			page.text += text;
			for (size_t i = 0; i < text.size(); ++i)
				page.boxes.insert(page.boxes.end(), { left, top, right, bottom });
		}

		unsigned int ReadInt(const BYTE*& data)
		{
			unsigned int value;
			memcpy(&value, data, 4);
			data += 4;
			return value;
		}

		const float MM_PER_POINT = 25.4f / 72;

		// Reads core's NSWasm::CData buffers (serialize.h): ints, doubles stored as int * 100
		// (AddDouble) or * 10000 (WriteDouble), bytes and UTF-8 strings after their length.
		// Reading past the end stops it (ok is false then).
		struct WasmReader
		{
			const BYTE* current;
			const BYTE* end;
			bool ok = true;

			bool Has(size_t size)
			{
				if (!ok || current + size > end)
					ok = false;
				return ok;
			}
			int Int()
			{
				if (!Has(4))
					return 0;
				int value;
				memcpy(&value, current, 4);
				current += 4;
				return value;
			}
			BYTE Byte()
			{
				if (!Has(1))
					return 0;
				return *current++;
			}
			double Double100() { return Int() / 100.0; }
			double Double10000() { return Int() / 10000.0; }
			std::string String()
			{
				int length = Int();
				if (length < 0 || !Has((size_t)length))
					return std::string();
				std::string value(reinterpret_cast<const char*>(current), length);
				current += length;
				return value;
			}
			void Doubles100(int count) { for (int i = 0; i < count && ok; ++i) Int(); }
			void Doubles10000(int count) { Doubles100(count); }
			void List100() { Doubles100(Int()); }
			void List10000() { Doubles10000(Int()); }
		};

		// An action (CAction*::ToWASM in core's PdfAnnot.cpp); the first one sets the link's target
		void ReadAction(WasmReader& in, int page, int pageCount, PageLink& link)
		{
			BYTE type = in.Byte();
			bool first = link.url.empty() && link.destPage < 0;
			switch (type)
			{
			case 1: // GoTo
			{
				int destPage = in.Int();
				BYTE kind = in.Byte();
				double top = 0;
				// XYZ, FitH, FitV, FitBH, FitBV: left, top, zoom by flags; FitR: a rectangle
				if (kind == 0 || kind == 2 || kind == 3 || kind == 6 || kind == 7)
				{
					int flags = in.Int();
					double values[3] = { 0, 0, 0 };
					for (int i = 0; i < 3; ++i)
						if (flags & (1 << i))
							values[i] = in.Double100();
					top = kind == 2 || kind == 6 ? values[0] : values[1];
				}
				else if (kind == 4)
				{
					in.Double100();
					top = in.Double100();
					in.Double100();
					in.Double100();
				}
				if (first)
				{
					link.destPage = destPage;
					link.destY = (float)(top * MM_PER_POINT);
				}
				break;
			}
			case 6: // URI
			{
				std::string uri = in.String();
				if (first)
					link.url = uri;
				break;
			}
			case 10: // Named: next, previous, first or last page
			{
				std::string name = in.String();
				if (first)
				{
					if (name == "NextPage")
						link.destPage = std::min(page + 1, pageCount - 1);
					else if (name == "PrevPage")
						link.destPage = std::max(page - 1, 0);
					else if (name == "FirstPage")
						link.destPage = 0;
					else if (name == "LastPage")
						link.destPage = pageCount - 1;
				}
				break;
			}
			case 14: // JavaScript
				in.String();
				break;
			case 9: // Hide
			{
				in.Byte();
				int count = in.Int();
				for (int i = 0; i < count && in.ok; ++i)
					in.String();
				break;
			}
			case 12: // ResetForm
			{
				in.Int();
				int count = in.Int();
				for (int i = 0; i < count && in.ok; ++i)
					in.String();
				break;
			}
			default:
				in.ok = false;
				return;
			}
			if (in.Byte())
				ReadAction(in, page, pageCount, link);
		}

		// The fields of all annotations (CAnnot::ToWASM); returns the rectangle in points
		void ReadAnnot(WasmReader& in, double rect[4])
		{
			in.Int(); // reference
			in.Int(); // flags
			in.Int(); // page
			for (int i = 0; i < 4; ++i)
				rect[i] = in.Double10000();
			int flags = in.Int();
			if (flags & (1 << 0))
				in.String();
			if (flags & (1 << 1))
				in.String();
			if (flags & (1 << 2))
			{
				in.Byte();
				in.Double100();
			}
			if (flags & (1 << 3))
				in.List10000();
			if (flags & (1 << 4))
			{
				// Dashed borders (written as 2) have a dash pattern
				BYTE border = in.Byte();
				in.Double100();
				if (border == 2)
					in.List100();
			}
			if (flags & (1 << 5))
				in.String();
			if (flags & (1 << 7))
				in.String();
			if (flags & (1 << 9))
				in.String();
		}

		// The fields of markup annotations (CAnnotMarkup::ToWASM); returns their flags
		int ReadMarkup(WasmReader& in, double rect[4])
		{
			ReadAnnot(in, rect);
			int flags = in.Int();
			if (flags & (1 << 0))
				in.Int();
			if (flags & (1 << 1))
				in.String();
			if (flags & (1 << 2))
				in.Double100();
			if (flags & (1 << 3))
			{
				int count = in.Int();
				for (int i = 0; i < count && in.ok; ++i)
				{
					in.Byte();
					int fontFlags = in.Int();
					if (fontFlags & (1 << 5))
						in.Double100();
					if (fontFlags & (1 << 6))
						in.String();
					in.Double100();
					in.Doubles10000(3);
					in.String();
					in.String();
				}
			}
			if (flags & (1 << 4))
				in.String();
			if (flags & (1 << 5))
				in.Int();
			if (flags & (1 << 6))
				in.Byte();
			if (flags & (1 << 7))
				in.String();
			return flags;
		}

		// Link annotations of a page from core's GetAnnots (PdfReader.cpp, PdfAnnot.cpp ToWASM).
		// Its records have no lengths, so every kind it writes is read to get past it.
		std::vector<PageLink> ReadLinkAnnots(const BYTE* data, int page, int pageCount)
		{
			std::vector<PageLink> links;
			WasmReader in{ data, data + 4 };
			in.end = data + (unsigned int)in.Int();
			int count = in.Int();
			for (int i = 0; i < count && in.ok; ++i)
			{
				BYTE type = in.Byte();
				double rect[4] = { 0, 0, 0, 0 };
				int flags = 0;
				switch (type)
				{
				case 1: // Link
				{
					ReadAnnot(in, rect);
					PageLink link;
					flags = in.Int();
					if (flags & (1 << 0))
						ReadAction(in, page, pageCount, link);
					if (flags & (1 << 1))
						ReadAction(in, page, pageCount, link);
					if (flags & (1 << 2))
						in.Byte();
					if (flags & (1 << 3))
						in.List100();
					if (in.ok && (!link.url.empty() || link.destPage >= 0))
					{
						link.x = (float)(std::min(rect[0], rect[2]) * MM_PER_POINT);
						link.y = (float)(std::min(rect[1], rect[3]) * MM_PER_POINT);
						link.width = (float)(std::fabs(rect[2] - rect[0]) * MM_PER_POINT);
						link.height = (float)(std::fabs(rect[3] - rect[1]) * MM_PER_POINT);
						links.push_back(link);
					}
					break;
				}
				case 0: // Text
					flags = ReadMarkup(in, rect);
					for (int bit = 16; bit <= 18; ++bit)
						if (flags & (1 << bit))
							in.Byte();
					break;
				case 2: // FreeText
					flags = ReadMarkup(in, rect);
					in.Byte();
					in.Int();
					if (flags & (1 << 15))
						in.Doubles100(4);
					if (flags & (1 << 16))
						in.List100();
					if (flags & (1 << 17))
						in.String();
					if (flags & (1 << 18))
						in.Byte();
					if (flags & (1 << 20))
						in.Byte();
					if (flags & (1 << 21))
						in.List10000();
					break;
				case 3: // Line
					flags = ReadMarkup(in, rect);
					in.Doubles100(4);
					if (flags & (1 << 15))
					{
						in.Byte();
						in.Byte();
					}
					if (flags & (1 << 16))
						in.List10000();
					if (flags & (1 << 17))
						in.Double100();
					if (flags & (1 << 18))
						in.Double100();
					if (flags & (1 << 20))
						in.Byte();
					if (flags & (1 << 21))
						in.Double100();
					if (flags & (1 << 22))
						in.Byte();
					if (flags & (1 << 23))
						in.Doubles100(2);
					break;
				case 4: // Square
				case 5: // Circle
					flags = ReadMarkup(in, rect);
					if (flags & (1 << 15))
						in.Doubles100(4);
					if (flags & (1 << 16))
						in.List10000();
					break;
				case 6: // Polygon
				case 7: // PolyLine
					flags = ReadMarkup(in, rect);
					in.List100();
					if (flags & (1 << 15))
					{
						in.Byte();
						in.Byte();
					}
					if (flags & (1 << 16))
						in.List10000();
					if (flags & (1 << 20))
						in.Byte();
					break;
				case 8: // Highlight, Underline, Squiggly, StrikeOut
				case 9:
				case 10:
				case 11:
					ReadMarkup(in, rect);
					in.List100();
					break;
				case 12: // Stamp
					ReadMarkup(in, rect);
					in.String();
					in.Doubles10000(9);
					break;
				case 13: // Caret
					flags = ReadMarkup(in, rect);
					if (flags & (1 << 15))
						in.Doubles100(4);
					if (flags & (1 << 16))
						in.Byte();
					break;
				case 14: // Ink
				{
					ReadMarkup(in, rect);
					int paths = in.Int();
					for (int p = 0; p < paths && in.ok; ++p)
						in.List100();
					break;
				}
				case 25: // Redact
					flags = ReadMarkup(in, rect);
					if (flags & (1 << 15))
						in.List100();
					if (flags & (1 << 16))
						in.List10000();
					if (flags & (1 << 17))
						in.String();
					if (flags & (1 << 19))
						in.Byte();
					if (flags & (1 << 20))
					{
						in.List10000();
						in.Double100();
						in.String();
						in.String();
						in.Int();
					}
					break;
				default:
					// A kind this doesn't know: the rest can't be read
					in.ok = false;
					break;
				}
			}
			return links;
		}
	}

	struct DrawingDocument::Private
	{
		std::unique_ptr<IOfficeDrawingFile> file;
		Format format = Format::Unknown;
		NSFonts::IFontManager* fontManager = nullptr;
		std::wstring path;
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
		m_private->path = path;

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

	PageText DrawingDocument::GetPageText(int page)
	{
		PageText result;
		if (!m_private->file || page < 0 || page >= GetPageCount())
			return result;
		PageSize size = GetPageSize(page);
		TextCollector collector(size.widthMm, size.heightMm);
		bool stop = false;
		m_private->file->DrawPageOnRenderer(&collector, page, &stop);

		// Characters in drawing order; a jump back or to another line starts a new line, a gap
		// a new word
		const std::vector<TextCollector::Glyph>& glyphs = collector.glyphs;
		for (size_t i = 0; i < glyphs.size(); ++i)
		{
			const TextCollector::Glyph& glyph = glyphs[i];
			double left = std::min(glyph.x1, glyph.x2);
			double right = std::max(glyph.x1, glyph.x2);
			// Without a width (XPS), up to the next character on the line
			if (right - left < 0.01)
			{
				right = left + glyph.size * 0.5;
				if (i + 1 < glyphs.size() && std::fabs(glyphs[i + 1].y1 - glyph.y1) < glyph.size * 0.3 &&
				    glyphs[i + 1].x1 > left && glyphs[i + 1].x1 < left + glyph.size * 2)
					right = glyphs[i + 1].x1;
			}
			if (i > 0)
			{
				const TextCollector::Glyph& previous = glyphs[i - 1];
				float lastRight = result.boxes.empty() ? (float)left : result.boxes[result.boxes.size() - 2];
				float lastTop = result.boxes.empty() ? 0 : result.boxes[result.boxes.size() - 3];
				float lastBottom = result.boxes.empty() ? 0 : result.boxes[result.boxes.size() - 1];
				double lineHeight = std::max(glyph.size, previous.size);
				if (std::fabs(glyph.y1 - previous.y1) > lineHeight * 0.5 || left < lastRight - lineHeight)
					Append(result, u"\n", lastRight, lastTop, lastRight, lastBottom);
				else if (left - lastRight > lineHeight * 0.2 && glyph.text != u" " && previous.text != u" ")
					Append(result, u" ", lastRight, lastTop, (float)left, lastBottom);
			}
			Append(result, glyph.text, (float)left, (float)(glyph.y1 - glyph.size * 0.8),
			       (float)right, (float)(glyph.y1 + glyph.size * 0.2));
		}
		return result;
	}

	std::vector<PageLink> DrawingDocument::GetLinks(int page)
	{
		std::vector<PageLink> result;
		if (m_private->format != Format::Pdf || page < 0 || page >= GetPageCount())
			return result;
		// Link annotations: places in the file and web addresses
		if (BYTE* annots = static_cast<CPdfFile*>(m_private->file.get())->GetAnnots(page))
		{
			result = ReadLinkAnnots(annots, page, GetPageCount());
			free(annots);
		}
		size_t annotLinks = result.size();
		// Web addresses written in the text (not where a link annotation is)
		BYTE* data = m_private->file->GetLinks(page);
		if (!data)
			return result;
		// NSWasm::CPageLink: the length, then per link the URL (length and UTF-8), the
		// destination and the area, as hundredths of points from the top left
		const BYTE* current = data;
		const BYTE* end = data + ReadInt(current);
		while (current + 4 <= end)
		{
			PageLink link;
			unsigned int length = ReadInt(current);
			if (current + length + 20 > end)
				break;
			// Web addresses are ASCII; anything else would not be valid UTF-8 for Java
			for (unsigned int i = 0; i < length; ++i)
				link.url += current[i] < 0x80 && current[i] >= 0x20 ? (char)current[i] : '?';
			current += length;
			ReadInt(current);
			const float mmPerUnit = 25.4f / 72 / 100;
			link.x = (int)ReadInt(current) * mmPerUnit;
			link.y = (int)ReadInt(current) * mmPerUnit;
			link.width = (int)ReadInt(current) * mmPerUnit;
			link.height = (int)ReadInt(current) * mmPerUnit;
			bool covered = false;
			for (size_t i = 0; i < annotLinks; ++i)
			{
				const PageLink& other = result[i];
				covered = covered || (link.x < other.x + other.width && other.x < link.x + link.width &&
				                      link.y < other.y + other.height && other.y < link.y + link.height);
			}
			if (!covered)
				result.push_back(link);
		}
		free(data);
		return result;
	}

	std::vector<OutlineItem> DrawingDocument::GetOutline()
	{
		std::vector<OutlineItem> result;
		if (!m_private->file)
			return result;
		BYTE* data = m_private->file->GetStructure();
		if (!data)
			return result;
		// [length] then per entry: page, level, distance from the page's top (points * 100), title
		WasmReader in{ data, data + 4 };
		in.end = data + (unsigned int)in.Int();
		while (in.ok && in.current < in.end)
		{
			OutlineItem item;
			item.page = in.Int();
			item.level = in.Int();
			item.y = (float)(in.Double100() * MM_PER_POINT);
			item.title = in.String();
			if (in.ok)
				result.push_back(item);
		}
		free(data);
		return result;
	}

	namespace
	{
		// Writes the format of NSOnlineOfficeBinToPdf::CBufferReader (MetafileToRendererReader.h):
		// little-endian ints, doubles as int * 100000, strings as UTF-16 after their length
		struct BinWriter
		{
			std::vector<BYTE> data;

			void Byte(BYTE value) { data.push_back(value); }
			void Int(int value)
			{
				BYTE bytes[4];
				memcpy(bytes, &value, 4);
				data.insert(data.end(), bytes, bytes + 4);
			}
			void Double(double value) { Int((int)std::lround(value * 100000)); }
			void String(const std::wstring& text)
			{
				std::u16string utf16;
				for (wchar_t c : text)
				{
					if (c >= 0x10000)
					{
						utf16 += (char16_t)(0xD800 + ((c - 0x10000) >> 10));
						utf16 += (char16_t)(0xDC00 + ((c - 0x10000) & 0x3FF));
					}
					else
					{
						utf16 += (char16_t)c;
					}
				}
				unsigned short length = (unsigned short)utf16.size();
				data.push_back(length & 0xFF);
				data.push_back(length >> 8);
				for (char16_t c : utf16)
				{
					data.push_back(c & 0xFF);
					data.push_back(c >> 8);
				}
			}
			void SetInt(size_t position, int value) { memcpy(&data[position], &value, 4); }
		};

		const double POINTS_PER_MM = 72 / 25.4;

		// Whether the PDF's last cross-reference (startxref) is where it says: an incremental
		// update has to point to it. Files with wrong offsets are read by rebuilding it, and
		// are saved as new files then.
		bool HasValidXref(const std::wstring& path)
		{
			NSFile::CFileBinary file;
			if (!file.OpenFile(path))
				return false;
			long size = file.GetFileSize();
			long tail = std::min<long>(size, 1024);
			std::string end(tail, '\0');
			DWORD read = 0;
			file.SeekFile(size - tail);
			file.ReadFile(reinterpret_cast<BYTE*>(&end[0]), (DWORD)tail, read);
			size_t keyword = end.rfind("startxref");
			if (keyword == std::string::npos)
				return false;
			long offset = std::strtol(end.c_str() + keyword + 9, nullptr, 10);
			if (offset <= 0 || offset >= size)
				return false;
			// A cross-reference table ("xref") or stream ("n g obj")
			std::string start(32, '\0');
			file.SeekFile(offset);
			file.ReadFile(reinterpret_cast<BYTE*>(&start[0]), 32, read);
			file.CloseFile();
			start.resize(read);
			if (start.compare(0, 4, "xref") == 0)
				return true;
			size_t i = 0;
			while (i < start.size() && isdigit((unsigned char)start[i])) ++i;
			return i > 0 && start.find(" obj") != std::string::npos;
		}

		// One EditPage record of AddBinToPdf (OnlineOfficeBinToPdf.cpp) with an annotation
		// (ctAnnotField, read by CAnnotFieldInfo::Read in AnnotField.cpp)
		void WriteMarkup(BinWriter& out, const PdfMarkup& markup, int id)
		{
			if (markup.quads.size() < 8)
				return;
			double left = 1e9, top = 1e9, right = -1e9, bottom = -1e9;
			for (size_t i = 0; i + 1 < markup.quads.size(); i += 2)
			{
				left = std::min(left, (double)markup.quads[i]);
				right = std::max(right, (double)markup.quads[i]);
				top = std::min(top, (double)markup.quads[i + 1]);
				bottom = std::max(bottom, (double)markup.quads[i + 1]);
			}
			size_t record = out.data.size();
			out.Int(0); // length of the record
			out.Byte(0); // EditPage
			out.Int(markup.page);

			out.Byte(164); // ctAnnotField
			size_t command = out.data.size();
			out.Int(0); // length of the command, with this int
			out.Byte((BYTE)markup.type);
			out.Int(id);
			out.Int(4); // flags: print
			out.Int(markup.page);
			out.Double(left * POINTS_PER_MM);
			out.Double(top * POINTS_PER_MM);
			out.Double(right * POINTS_PER_MM);
			out.Double(bottom * POINTS_PER_MM);
			out.Int(1 << 3); // the color
			out.Int(3);
			out.Double(markup.red);
			out.Double(markup.green);
			out.Double(markup.blue);
			// Markup: author and opacity (highlights let the text show)
			out.Int((1 << 1) | (1 << 2));
			out.String(markup.author);
			out.Double(markup.type == 8 ? 0.5 : 1.0);
			out.Int((int)markup.quads.size());
			for (float value : markup.quads)
				out.Double(value * POINTS_PER_MM);
			out.SetInt(command, (int)(out.data.size() - command));
			out.SetInt(record, (int)(out.data.size() - record));
		}
	}

	int DrawingDocument::SaveWithChanges(const std::wstring& path, const std::vector<PdfMarkup>& markups, const std::vector<PdfImage>& images)
	{
		if (m_private->format != Format::Pdf)
			return -1;
		CPdfFile* pdf = static_cast<CPdfFile*>(m_private->file.get());
		if (!pdf->EditPdf(path))
			return -2;
		if (!HasValidXref(m_private->path))
			pdf->SetEditType(1);
		if (!markups.empty())
		{
			BinWriter out;
			int id = pdf->GetMaxRefID() + 1;
			for (const PdfMarkup& markup : markups)
				WriteMarkup(out, markup, id++);
			CConvertFromBinParams params;
			if (!out.data.empty())
				pdf->AddToPdfFromBinary(out.data.data(), (unsigned int)out.data.size(), &params);
		}
		for (const PdfImage& image : images)
		{
			if (!pdf->EditPage(image.page))
				continue;
			pdf->DrawImageFromFile(image.path, image.x, image.y, image.width, image.height);
		}
		pdf->Close();
		Close();
		return NSFile::CFileBinary::Exists(path) ? 0 : -2;
	}
}
