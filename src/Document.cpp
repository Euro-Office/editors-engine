#include "Document.h"

#include "engine_js.h"

#include "Common/OfficeFileFormats.h"
#include "DesktopEditor/doctrenderer/docbuilder.h"
#include "DesktopEditor/doctrenderer/embed/GraphicsEmbed.h"
#include "DesktopEditor/graphics/pro/Fonts.h"
#include "DesktopEditor/graphics/pro/Image.h"

#include <algorithm>
#include <chrono>
#include <codecvt>
#include <cwctype>
#include <locale>
#include <map>
#include <string>

#ifdef __ANDROID__
#include <android/log.h>
#else
#include <iostream>
#endif

#ifdef __ANDROID__
// x2t built as a library (core's x2tlib, libx2t.so)
extern "C" int X2T_Convert(int argc, char* argv[]);
#endif

using NSDoctRenderer::CDocBuilder;
using NSDoctRenderer::CDocBuilderContext;
using NSDoctRenderer::CDocBuilderContextScope;
using NSDoctRenderer::CDocBuilderValue;

namespace eo
{
	namespace
	{
		// Durations of the steps of opening and saving: logcat (EditorEngine) or stderr
		class Timer
		{
		public:
			void Log(const char* step)
			{
				auto now = std::chrono::steady_clock::now();
				long long ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - m_start).count();
				m_start = now;
#ifdef __ANDROID__
				__android_log_print(ANDROID_LOG_INFO, "EditorEngine", "%s: %lld ms", step, ms);
#else
				std::cerr << step << ": " << ms << " ms" << std::endl;
#endif
			}

		private:
			std::chrono::steady_clock::time_point m_start = std::chrono::steady_clock::now();
		};

		// Fonts shared by all tiles, so drawing a tile doesn't reload the font index
		NSFonts::IApplicationFonts* g_fonts = nullptr;

#ifdef __ANDROID__
		// docbuilder starts the x2t executable to convert; Android apps can't, so run x2t in-process
		int ConvertWithX2t(const wchar_t* paramsPath)
		{
			std::string path = std::wstring_convert<std::codecvt_utf8<wchar_t>>().to_bytes(paramsPath);
			char program[] = "x2t";
			char* argv[] = { program, path.data() };
			return X2T_Convert(2, argv);
		}
#endif

		// Lets doctrenderer draw straight into the engine's pixel buffer
		class TileImage : public CGraphicsAppImage
		{
		public:
			TileImage(unsigned char* pixels, int width, int height, bool rgba, NSImages::IImageFilesCache* imageCache)
				: m_pixels(pixels), m_width(width), m_height(height)
			{
				SetFonts(g_fonts);
				SetImageCache(imageCache);
				SetRgba(rgba);
			}

			unsigned char* GetBits(int& width, int& height) override
			{
				width = m_width;
				height = m_height;
				return m_pixels;
			}

			unsigned char* AllocBits(const int&, const int&) override
			{
				return m_pixels;
			}

		private:
			unsigned char* m_pixels;
			int m_width;
			int m_height;
		};
	}

	struct Document::Private
	{
		std::unique_ptr<CDocBuilder> builder;
		std::unique_ptr<CDocBuilderContext> context;
		std::unique_ptr<CDocBuilderContextScope> scope;

		// Decoded images and metafiles, so tiles don't decode them again
		NSImages::IImageFilesCache* imageCache = nullptr;

		bool Run(const std::wstring& script, CDocBuilderValue* result = nullptr)
		{
			return builder && builder->ExecuteCommand(script.c_str(), result);
		}

		double RunNumber(const std::wstring& script)
		{
			CDocBuilderValue result;
			if (!Run(script, &result))
				return 0;
			return result.ToDouble();
		}
	};

	bool Document::Initialize(const std::wstring& runtimeDir)
	{
		Timer timer;
		CDocBuilder::Initialize(runtimeDir.c_str());
#ifdef __ANDROID__
		CDocBuilder::SetX2tConverter(&ConvertWithX2t);
#endif
		timer.Log("start V8");
		if (!g_fonts)
		{
			g_fonts = NSFonts::NSApplication::Create();
			g_fonts->InitializeFromFolder(runtimeDir + L"/fonts");
		}
		timer.Log("load the font index");
		return true;
	}

	void Document::Dispose()
	{
		RELEASEINTERFACE(g_fonts);
		CDocBuilder::Dispose();
	}

	Document::Document() : m_private(new Private())
	{
	}

	Document::~Document()
	{
		Close();
	}

	bool Document::Open(const std::wstring& path, const std::wstring& tempDir)
	{
		Close();

		m_private->imageCache = NSImages::NSFilesCache::Create(g_fonts);
		m_private->builder.reset(new CDocBuilder());
		m_private->builder->SetTmpFolder(tempDir.c_str());
		Timer timer;
		if (m_private->builder->OpenFile(path.c_str(), L"") != 0)
		{
			Close();
			return false;
		}
		timer.Log("convert (x2t)");

		// The first command creates the V8 context and loads sdkjs with the document.
		// It then stays entered, so results of later commands can be read.
		if (!m_private->Run(L"void 'load sdkjs';"))
		{
			Close();
			return false;
		}
		timer.Log("load sdkjs and the document");
		m_private->context.reset(new CDocBuilderContext(m_private->builder->GetContext()));
		m_private->scope.reset(new CDocBuilderContextScope(m_private->context->CreateScope()));

		std::wstring engineJs = std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(kEngineJs);
		if (!m_private->Run(engineJs))
		{
			Close();
			return false;
		}
		timer.Log("layout (engine.js)");
		return true;
	}

	void Document::Close()
	{
		m_private->scope.reset();
		m_private->context.reset();
		if (m_private->builder)
			m_private->builder->CloseFile();
		m_private->builder.reset();
		RELEASEINTERFACE(m_private->imageCache);
	}

	int Document::Save(const std::wstring& path, const std::wstring& extension)
	{
		// docbuilder's own extension list is short and falls back to docx
		static const std::map<std::wstring, int> formats = {
			{ L"docx", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX },
			{ L"docm", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM },
			{ L"dotx", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX },
			{ L"dotm", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM },
			{ L"odt", AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT },
			{ L"ott", AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT },
			{ L"rtf", AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF },
			{ L"txt", AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT },
			{ L"html", AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML },
			{ L"epub", AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB },
			{ L"fb2", AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2 },
			{ L"pdf", AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF }
		};
		std::wstring key = extension;
		std::transform(key.begin(), key.end(), key.begin(), ::towlower);
		auto format = formats.find(key);
		if (!m_private->builder || format == formats.end())
			return -1;
		m_private->Run(L"eoEngine.beforeSave();");
		int error = m_private->builder->SaveFile(format->second, path.c_str());
		m_private->Run(std::wstring(L"eoEngine.afterSave(") + (error == 0 ? L"true" : L"false") + L");");
		return error;
	}

	std::string Document::Execute(const std::wstring& script)
	{
		CDocBuilderValue result;
		if (!m_private->Run(script, &result) || !result.IsString())
			return std::string();
		return std::wstring_convert<std::codecvt_utf8<wchar_t>>().to_bytes(result.ToString().c_str());
	}

	int Document::GetPageCount()
	{
		return (int)m_private->RunNumber(L"eoEngine.getPageCount()");
	}

	PageSize Document::GetPageSize(int page)
	{
		PageSize size;
		size.widthMm = m_private->RunNumber(L"eoEngine.getPageWidth(" + std::to_wstring(page) + L")");
		size.heightMm = m_private->RunNumber(L"eoEngine.getPageHeight(" + std::to_wstring(page) + L")");
		return size;
	}

	bool Document::RenderTile(int page, int pageWidth, int pageHeight,
	                          int x, int y, int width, int height,
	                          unsigned char* pixels, bool rgba)
	{
		if (!m_private->Run(L"eoEngine.beginTile();"))
			return false;

		// Attach the pixel buffer to the graphics object sdkjs will draw into
		// (the document's context stays entered, see Open)
		JSSmart<NSJSBase::CJSContext> context = NSJSBase::CJSContext::GetCurrent();
		JSSmart<NSJSBase::CJSValue> native = context->GetGlobal()->get("eoEngine")->toObject()
			->get("tile")->toObject()->get("Native");
		CGraphicsEmbed* graphics = native->isObject()
			? dynamic_cast<CGraphicsEmbed*>(native->toObject()->getNative())
			: nullptr;
		if (!graphics)
			return false;
		graphics->SetAppImage(new TileImage(pixels, width, height, rgba, m_private->imageCache));

		return m_private->Run(L"eoEngine.drawTile(" +
			std::to_wstring(page) + L", " + std::to_wstring(pageWidth) + L", " + std::to_wstring(pageHeight) + L", " +
			std::to_wstring(x) + L", " + std::to_wstring(y) + L", " + std::to_wstring(width) + L", " + std::to_wstring(height) + L");");
	}
}
