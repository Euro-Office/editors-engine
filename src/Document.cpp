#include "Document.h"
#include "DrawingDocument.h"

#include "engine_js.h"
#include "pdf_js.h"

#include "Common/OfficeFileErrorDescription.h"
#include "Common/OfficeFileFormatDefines.h"
#include "Common/OfficeFileFormats.h"
#include "DesktopEditor/common/Base64.h"
#include "DesktopEditor/common/Directory.h"
#include "DesktopEditor/common/File.h"
#include "DesktopEditor/doctrenderer/docbuilder.h"
#include "DesktopEditor/doctrenderer/drawingfile.h"
#include "DesktopEditor/doctrenderer/embed/DrawingFileEmbed.h"
#include "DesktopEditor/doctrenderer/embed/GraphicsEmbed.h"
#include "DesktopEditor/graphics/pro/Fonts.h"
#include "DesktopEditor/graphics/pro/Image.h"
#include "PdfFile/PdfFile.h"

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <codecvt>
#include <cwchar>
#include <cwctype>
#include <locale>
#include <map>
#include <string>
#include <vector>

#ifdef __ANDROID__
#include <android/log.h>
#else
#include <iostream>
#include <sys/wait.h>
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
		std::wstring g_runtimeDir;

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

		// Runs x2t with a task file, as docbuilder does
		int RunX2t(const std::wstring& paramsPath)
		{
#ifdef __ANDROID__
			return ConvertWithX2t(paramsPath.c_str());
#else
			std::string command = "\"" + std::wstring_convert<std::codecvt_utf8<wchar_t>>().to_bytes(g_runtimeDir + L"/x2t") +
			                      "\" \"" + std::wstring_convert<std::codecvt_utf8<wchar_t>>().to_bytes(paramsPath) + "\"";
			int status = std::system(command.c_str());
			return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
#endif
		}

		// sdkjs' PDF editor reads PDFs through core's PDF reader (drawingfile_native.js), as in
		// x2t: the engine's reader of the file (pdf.js' CreateEmbedObject("CDrawingFileEmbed")).
		// core's readers share global settings that each one creates and deletes, so there is
		// only one, the engine's, which sdkjs doesn't own.
		IOfficeDrawingFile* g_pdfFile = nullptr;

		NSJSBase::CJSEmbedObject* CreateDrawingFileEmbed()
		{
			CDrawingFileEmbed* embed = new CDrawingFileEmbed();
			embed->m_pFile = new CDrawingFile(g_fonts);
			if (g_pdfFile)
				embed->m_pFile->SetInternalFile(g_pdfFile);
			return embed;
		}

		// A string as a JavaScript literal
		std::wstring JsString(const std::wstring& text)
		{
			std::wstring result = L"\"";
			for (wchar_t c : text)
			{
				if (c == L'\\' || c == L'"')
					result += L'\\';
				if (c < 0x20)
				{
					wchar_t escaped[8];
					swprintf(escaped, 8, L"\\u%04x", (unsigned)c);
					result += escaped;
					continue;
				}
				result += c;
			}
			return result + L"\"";
		}

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
				// The pictures of presentation designs ("themeN/media/...", see PrepareThemes)
				SetThemesDirectory(g_runtimeDir + L"/sdkjs/slide/themes");
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

		// The password of an encrypted file, to save it encrypted again
		std::wstring password;
		// A PDF form (ONLYOFFICE's, opened in the document editor) is saved as one again
		bool isPdfForm = false;
		// Plain text: how it was read, to write it the same way again
		TextOptions text;
		// Another PDF, in sdkjs' PDF editor (OpenPdf): sdkjs and the pages read a copy of the
		// file (the app replaces the file when saving), whose pages are drawn by core's reader
		bool isPdf = false;
		std::wstring pdfCopy;
		std::unique_ptr<DrawingDocument> pdfPages;
		// Readers opened since (see ReplacePdfReader)
		int pdfReaders = 0;

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
		g_runtimeDir = runtimeDir;
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
		NSJSBase::CJSContext::AddEmbedCreator("CDrawingFileEmbed", CreateDrawingFileEmbed, true);
		return true;
	}

	NSFonts::IApplicationFonts* Document::GetFonts()
	{
		return g_fonts;
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

	namespace
	{
		std::wstring XmlEscape(const std::wstring& text)
		{
			std::wstring result;
			for (wchar_t c : text)
			{
				switch (c)
				{
				case L'&': result += L"&amp;"; break;
				case L'<': result += L"&lt;"; break;
				case L'>': result += L"&gt;"; break;
				case L'"': result += L"&quot;"; break;
				// docbuilder turns ' in save parameters into quotes
				case L'\'': result += L"&apos;"; break;
				default: result += c;
				}
			}
			return result;
		}
	}

	// To an unencrypted file of the same format in tempDir (target)
	int Document::PrepareThemes()
	{
		// The designs' presentations, in the order of their names ("01_blank.pptx", ...)
		std::wstring dir = g_runtimeDir + L"/sdkjs/slide/themes";
		std::vector<std::wstring> sources;
		for (const std::wstring& file : NSDirectory::GetFiles(dir + L"/src"))
		{
			if (file.size() > 5 && file.compare(file.size() - 5, 5, L".pptx") == 0)
				sources.push_back(file);
		}
		std::sort(sources.begin(), sources.end());

		std::wstring names;
		int count = 0;
		for (const std::wstring& source : sources)
		{
			// As Document Server's allthemesgen: themeN/theme.bin and its pictures in themeN/media
			std::wstring out = dir + L"/theme" + std::to_wstring(count + 1);
			if (!NSFile::CFileBinary::Exists(out + L"/theme.bin"))
			{
				NSDirectory::CreateDirectory(out);
				std::wstring task = L"<?xml version=\"1.0\" encoding=\"utf-8\"?><TaskQueueDataConvert><m_sFileFrom>" + XmlEscape(source) +
					L"</m_sFileFrom><m_sFileTo>" + XmlEscape(out + L"/theme.bin") + L"</m_sFileTo><m_nFormatTo>" +
					std::to_wstring(AVS_OFFICESTUDIO_FILE_CANVAS) + L"</m_nFormatTo><m_bDontSaveAdditional>true</m_bDontSaveAdditional>" +
					L"<m_sFontDir>" + XmlEscape(g_runtimeDir + L"/fonts") + L"</m_sFontDir><m_sAllFontsPath>" +
					XmlEscape(g_runtimeDir + L"/fonts/AllFonts.js") + L"</m_sAllFontsPath></TaskQueueDataConvert>";
				std::wstring taskPath = out + L"/params.xml";
				NSFile::CFileBinary::SaveToFile(taskPath, task, true);
				int result = RunX2t(taskPath);
				NSFile::CFileBinary::Remove(taskPath);
				if (result != 0 || !NSFile::CFileBinary::Exists(out + L"/theme.bin"))
				{
					NSDirectory::DeleteDirectory(out);
					continue;
				}
			}
			std::wstring name = NSFile::GetFileName(source);
			name = name.substr(0, name.size() - 5);
			names += (count ? L"," : L"") + std::wstring(L"\"") + name + L"\"";
			++count;
		}
		Execute(L"eoEngine.setThemes([" + names + L"])");
		return count;
	}

	int Document::Decrypt(const std::wstring& path, const std::wstring& tempDir, const std::wstring& password, std::wstring& target)
	{
		std::wstring extension = path.substr(path.find_last_of(L'.') + 1);
		std::transform(extension.begin(), extension.end(), extension.begin(), ::towlower);
		// Old binary formats are decrypted to their modern ones
		static const std::map<std::wstring, std::pair<std::wstring, int>> formats = {
			{ L"doc", { L"docx", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX } },
			{ L"docx", { L"docx", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX } },
			{ L"docm", { L"docm", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM } },
			{ L"dotx", { L"dotx", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX } },
			{ L"xls", { L"xlsx", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX } },
			{ L"xlsx", { L"xlsx", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX } },
			{ L"xlsm", { L"xlsm", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM } },
			{ L"xltx", { L"xltx", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX } },
			{ L"ppt", { L"pptx", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX } },
			{ L"pptx", { L"pptx", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX } },
			{ L"pptm", { L"pptm", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM } },
			{ L"ppsx", { L"ppsx", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX } },
			{ L"odt", { L"odt", AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT } },
			{ L"ods", { L"ods", AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS } },
			{ L"odp", { L"odp", AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP } }
		};
		auto format = formats.find(extension);
		if (format == formats.end())
			return -1;
		target = tempDir + L"/decrypted." + format->second.first;
		std::wstring task = L"<?xml version=\"1.0\" encoding=\"utf-8\"?><TaskQueueDataConvert><m_sFileFrom>" + XmlEscape(path) +
			L"</m_sFileFrom><m_sFileTo>" + XmlEscape(target) + L"</m_sFileTo><m_nFormatTo>" + std::to_wstring(format->second.second) +
			L"</m_nFormatTo><m_sPassword>" + XmlEscape(password) + L"</m_sPassword><m_sFontDir>" + XmlEscape(g_runtimeDir + L"/fonts") +
			L"</m_sFontDir><m_sAllFontsPath>" + XmlEscape(g_runtimeDir + L"/fonts/AllFonts.js") +
			L"</m_sAllFontsPath><m_bIsNoBase64>true</m_bIsNoBase64><m_sTempDir>" + XmlEscape(tempDir) +
			L"</m_sTempDir></TaskQueueDataConvert>";
		// Before docbuilder, which creates it
		NSDirectory::CreateDirectories(tempDir);
		std::wstring taskPath = tempDir + L"/decrypt.xml";
		NSFile::CFileBinary::SaveToFile(taskPath, task, true);
		int result = RunX2t(taskPath);
		NSFile::CFileBinary::Remove(taskPath);
		return result;
	}

	// x2t's options for plain text, which it can't open without (AVS_FILEUTILS_ERROR_CONVERT_NEED_PARAMS)
	static std::wstring TextParams(const TextOptions& text)
	{
		std::wstring params;
		if (text.encoding >= 0)
			params += L"<m_nCsvTxtEncoding>" + std::to_wstring(text.encoding) + L"</m_nCsvTxtEncoding>";
		if (text.delimiter >= 0)
			params += L"<m_nCsvDelimiter>" + std::to_wstring(text.delimiter) + L"</m_nCsvDelimiter>";
		return params;
	}

	int Document::Open(const std::wstring& path, const std::wstring& tempDir, const std::wstring& password,
	                   const TextOptions& text, const std::wstring& language)
	{
		Close();

		m_private->imageCache = NSImages::NSFilesCache::Create(g_fonts);
		m_private->builder.reset(new CDocBuilder());
		m_private->builder->SetTmpFolder(tempDir.c_str());
		Timer timer;
		// An encrypted file is decrypted first: docbuilder takes the kind of document from the
		// file it opens, which for an encrypted one is an encrypted container
		std::wstring openPath = path;
		if (!password.empty())
		{
			int decrypted = Decrypt(path, tempDir, password, openPath);
			if (decrypted != 0)
			{
				Close();
				return decrypted;
			}
		}
		std::wstring extension = path.substr(path.find_last_of(L'.') + 1);
		std::transform(extension.begin(), extension.end(), extension.begin(), ::towlower);
		if (TextFile::IsTextFormat(extension))
			m_private->text = TextFile::Guess(openPath, extension, language, text);
		int converted = m_private->builder->OpenFile(openPath.c_str(), TextParams(m_private->text).c_str());
		if (openPath != path)
			NSFile::CFileBinary::Remove(openPath);
		// Other PDFs than forms of the document editor: sdkjs' PDF editor
		if (converted != 0 && extension == L"pdf")
			return OpenPdf(path, tempDir, password);
		if (converted != 0)
		{
			Close();
			return converted;
		}
		m_private->password = password;
		m_private->isPdfForm = extension == L"pdf";
		timer.Log("convert (x2t)");

		// The first command creates the V8 context and loads sdkjs with the document.
		// It then stays entered, so results of later commands can be read.
		if (!m_private->Run(L"void 'load sdkjs';"))
		{
			Close();
			return -1;
		}
		timer.Log("load sdkjs and the document");
		m_private->context.reset(new CDocBuilderContext(m_private->builder->GetContext()));
		m_private->scope.reset(new CDocBuilderContextScope(m_private->context->CreateScope()));

		std::wstring engineJs = std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(kEngineJs);
		if (!m_private->Run(engineJs))
		{
			Close();
			return -1;
		}
		timer.Log("layout (engine.js)");
		// For the apps (a choice of others) and the tests
		if (m_private->text.encoding >= 0)
			m_private->Run(L"eoEngine.textOptions = {encoding: " + std::to_wstring(m_private->text.encoding) +
				L", delimiter: " + std::to_wstring(m_private->text.delimiter) + L"};");
		return 0;
	}

	// sdkjs' PDF editor (pdf.js) on core's PDF reader. Its scripts are part of the document
	// editor's, so docbuilder opens a blank document for the context first.
	int Document::OpenPdf(const std::wstring& path, const std::wstring& tempDir, const std::wstring& password)
	{
		Timer timer;
		m_private->builder->CloseFile();
		// sdkjs' reader gets no temporary directory and takes the process's (on Android none to
		// write to); core's readers share where they put the file's embedded fonts, so the pages
		// would lose them too
		NSFile::CFileBinary::SetTempPath(tempDir);
		m_private->pdfCopy = tempDir + L"/original.pdf";
		m_private->pdfPages.reset(new DrawingDocument());
		DrawingDocument::OpenResult opened = NSFile::CFileBinary::Copy(path, m_private->pdfCopy)
			? m_private->pdfPages->Open(m_private->pdfCopy, password, tempDir) : DrawingDocument::Failed;
		if (opened != DrawingDocument::Opened)
		{
			Close();
			return opened == DrawingDocument::NeedsPassword ? ERROR_PASSWORD : -1;
		}
		if (m_private->builder->OpenFile((g_runtimeDir + L"/empty/new.docx").c_str(), L"") != 0 ||
		    !m_private->Run(L"void 'load sdkjs';"))
		{
			Close();
			return -1;
		}
		timer.Log("load sdkjs");
		m_private->context.reset(new CDocBuilderContext(m_private->builder->GetContext()));
		m_private->scope.reset(new CDocBuilderContextScope(m_private->context->CreateScope()));
		m_private->isPdf = true;

		std::string reader;
		if (!NSFile::CFileBinary::ReadAllTextUtf8A(g_runtimeDir + L"/sdkjs/pdf/src/engine/drawingfile_native.js", reader) ||
		    !m_private->Run(std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(reader)) ||
		    !m_private->Run(L"window.eoPdfFile = { path: " + JsString(m_private->pdfCopy) + L", password: " + JsString(password) + L" };"))
		{
			Close();
			return -1;
		}
		std::wstring engineJs = std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(kEngineJs);
		std::wstring pdfJs = std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(kPdfJs);
		g_pdfFile = m_private->pdfPages->File();
		bool started = m_private->Run(engineJs) && m_private->Run(pdfJs);
		g_pdfFile = nullptr;
		if (!started || m_private->RunNumber(L"window.eoPdfError || 0") != 0)
		{
			Close();
			return -1;
		}
		m_private->password = password;
		timer.Log("open the PDF (pdf.js)");
		return 0;
	}

	void Document::Close()
	{
		m_private->isPdf = false;
		m_private->text = TextOptions();
		m_private->scope.reset();
		m_private->context.reset();
		if (m_private->builder)
			m_private->builder->CloseFile();
		m_private->builder.reset();
		// After sdkjs, which reads it
		m_private->pdfPages.reset();
		RELEASEINTERFACE(m_private->imageCache);
	}

	int Document::Save(const std::wstring& path, const std::wstring& extension)
	{
		if (m_private->isPdf)
			return extension == L"pdf" ? SavePdf(path) : -1;
		// PDF and other exports aren't encrypted with the document's password
		bool keepsPassword = extension != L"pdf" && extension != L"txt" && extension != L"csv" && extension != L"html";
		return SaveWithPassword(path, extension, keepsPassword ? m_private->password : L"");
	}

	void Document::SetPassword(const std::wstring& password)
	{
		m_private->password = password;
		m_private->Run(L"eoEngine.passwordChanged = true;");
	}

	int Document::SaveWithPassword(const std::wstring& path, const std::wstring& extension, const std::wstring& password)
	{
		// docbuilder's own extension list is short and falls back to docx
		static const std::map<std::wstring, int> formats = {
			{ L"docx", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX },
			{ L"docm", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCM },
			{ L"dotx", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTX },
			{ L"dotm", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOTM },
			{ L"docxf", AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCXF },
			{ L"oform", AVS_OFFICESTUDIO_FILE_DOCUMENT_OFORM },
			{ L"odt", AVS_OFFICESTUDIO_FILE_DOCUMENT_ODT },
			{ L"ott", AVS_OFFICESTUDIO_FILE_DOCUMENT_OTT },
			{ L"rtf", AVS_OFFICESTUDIO_FILE_DOCUMENT_RTF },
			{ L"txt", AVS_OFFICESTUDIO_FILE_DOCUMENT_TXT },
			{ L"html", AVS_OFFICESTUDIO_FILE_DOCUMENT_HTML },
			{ L"epub", AVS_OFFICESTUDIO_FILE_DOCUMENT_EPUB },
			{ L"fb2", AVS_OFFICESTUDIO_FILE_DOCUMENT_FB2 },
			{ L"pptx", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTX },
			{ L"pptm", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPTM },
			{ L"ppsx", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSX },
			{ L"ppsm", AVS_OFFICESTUDIO_FILE_PRESENTATION_PPSM },
			{ L"potx", AVS_OFFICESTUDIO_FILE_PRESENTATION_POTX },
			{ L"potm", AVS_OFFICESTUDIO_FILE_PRESENTATION_POTM },
			{ L"odp", AVS_OFFICESTUDIO_FILE_PRESENTATION_ODP },
			{ L"otp", AVS_OFFICESTUDIO_FILE_PRESENTATION_OTP },
			{ L"xlsx", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSX },
			{ L"xlsm", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLSM },
			{ L"xltx", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTX },
			{ L"xltm", AVS_OFFICESTUDIO_FILE_SPREADSHEET_XLTM },
			{ L"ods", AVS_OFFICESTUDIO_FILE_SPREADSHEET_ODS },
			{ L"ots", AVS_OFFICESTUDIO_FILE_SPREADSHEET_OTS },
			{ L"csv", AVS_OFFICESTUDIO_FILE_SPREADSHEET_CSV },
			{ L"pdf", AVS_OFFICESTUDIO_FILE_CROSSPLATFORM_PDF }
		};
		std::wstring key = extension;
		std::transform(key.begin(), key.end(), key.begin(), ::towlower);
		auto format = formats.find(key);
		if (!m_private->builder || format == formats.end())
			return -1;
		if (key == L"pdf")
			return ExportPdf(path, password);
		int formatType = format->second;
		m_private->Run(L"eoEngine.beforeSave();");
		std::wstring params = password.empty() ? L"" : L"<m_sSavePassword>" + XmlEscape(password) + L"</m_sSavePassword>";
		// A csv saved as csv keeps its encoding and delimiter. x2t writes txt in UTF-8 (with a byte
		// order mark) whatever its encoding, other csv in UTF-8 with commas.
		if (key == L"csv" && m_private->text.delimiter >= 0)
			params += TextParams(m_private->text);
		int error = m_private->builder->SaveFile(formatType, path.c_str(), params.empty() ? nullptr : params.c_str());
		m_private->Run(std::wstring(L"eoEngine.afterSave(") + (error == 0 ? L"true" : L"false") + L");");
		return error;
	}

	// PDFs of documents, spreadsheets and presentations, as x2t writes them: sdkjs draws the pages
	// into drawing commands (eoEngine.pdfCommands), core's PDF writer turns them into the file. Not
	// through x2t: its renderer reads DoctRenderer.config from the program's directory, which on
	// Android is the system's (so it runs without sdkjs and fails). A PDF form carries the
	// document (docx) to edit it again, as x2t's doct_bin2pdfoform.
	int Document::ExportPdf(const std::wstring& path, const std::wstring& password)
	{
		Timer timer;
		m_private->Run(L"eoEngine.beforeSave();");
		// Next to docbuilder's file (Editor.bin), whose pictures are in media/
		std::wstring imagesDir = std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(Execute(L"eoEngine.getImagesDirectory()"));
		std::wstring fileDir = NSFile::GetDirectoryName(imagesDir);
		std::wstring commandsPath = fileDir + L"/pdf.bin";
		std::wstring metaPath = fileDir + L"/meta.docx";
		int error = -1;
		if (!m_private->isPdfForm || m_private->builder->SaveFile(AVS_OFFICESTUDIO_FILE_DOCUMENT_DOCX, metaPath.c_str()) == 0)
		{
			JSSmart<NSJSBase::CJSContext> context = NSJSBase::CJSContext::GetCurrent();
			JSSmart<NSJSBase::CJSTryCatch> tryCatch = context->GetExceptions();
			JSSmart<NSJSBase::CJSValue> result = context->runScript("eoEngine.pdfCommands()", tryCatch);
			NSFile::CFileBinary file;
			if (!tryCatch->Check() && result->isTypedArray() && file.CreateFileW(commandsPath))
			{
				JSSmart<NSJSBase::CJSTypedArray> array = result->toTypedArray();
				NSJSBase::CJSDataBuffer commands = array->getData();
				file.WriteFile(commands.Data, (DWORD)std::min<size_t>((size_t)array->getCount(), commands.Len));
				file.CloseFile();
				timer.Log("pdf: sdkjs' pages");

				CPdfFile pdf(g_fonts);
				pdf.CreatePdf();
				pdf.SetTempDirectory(fileDir);
				if (!password.empty())
					pdf.SetPassword(password);
				if (m_private->isPdfForm)
				{
					BYTE* meta = nullptr;
					DWORD metaLength = 0;
					if (NSFile::CFileBinary::ReadAllBytes(metaPath, &meta, metaLength))
						pdf.AddMetaData(NSFile::CUtf8Converter::GetUnicodeFromCharPtr(g_format_oform_pdf_meta_tag, (LONG)strlen(g_format_oform_pdf_meta_tag)), meta, metaLength);
					RELEASEARRAYOBJECTS(meta);
				}
				CConvertFromBinParams params;
				params.m_sMediaDirectory = fileDir;
				params.m_sThemesDirectory = g_runtimeDir + L"/sdkjs/slide/themes";
				error = pdf.OnlineWordToPdfFromBinary(commandsPath, path, &params) == S_OK ? 0 : AVS_FILEUTILS_ERROR_CONVERT;
				timer.Log("pdf: write");
			}
		}
		NSFile::CFileBinary::Remove(commandsPath);
		NSFile::CFileBinary::Remove(metaPath);
		m_private->Run(std::wstring(L"eoEngine.afterSave(") + (error == 0 ? L"true" : L"false") + L");");
		return error;
	}

	// sdkjs' changes (eoEngine.savePdf: CHtmlPage.Save's edit commands) applied to a copy of the
	// file, as x2t applies them
	int Document::SavePdf(const std::wstring& path)
	{
		Timer timer;
		m_private->Run(L"eoEngine.beforeSave();");
		JSSmart<NSJSBase::CJSContext> context = NSJSBase::CJSContext::GetCurrent();
		JSSmart<NSJSBase::CJSTryCatch> tryCatch = context->GetExceptions();
		JSSmart<NSJSBase::CJSValue> result = context->runScript("eoEngine.savePdf()", tryCatch);
		int error = -1;
		if (!tryCatch->Check() && result->isTypedArray())
		{
			JSSmart<NSJSBase::CJSTypedArray> array = result->toTypedArray();
			NSJSBase::CJSDataBuffer commands = array->getData();
			// The array's own length: its buffer may be larger, and zeros after the commands
			// would make core read empty commands without end
			size_t length = std::min<size_t>((size_t)array->getCount(), commands.Len);
			timer.Log("save: sdkjs' changes");
			// After the "%PDF" signature
			if (length >= 4 && m_private->pdfPages)
			{
				// Pictures by their names in the images directory: core looks for them in
				// <media dir>/media, the images directory being docbuilder's <file dir>/media
				std::wstring imagesDir = std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(Execute(L"eoEngine.getImagesDirectory()"));
				std::wstring mediaDir = NSFile::GetDirectoryName(imagesDir);
				// With the engine's reader (one at a time, see g_pdfFile), which is closed then:
				// the file is opened again for sdkjs and the pages
				error = m_private->pdfPages->SaveWithEditCommands(path, commands.Data + 4, (unsigned int)(length - 4), mediaDir);
				if (!ReplacePdfReader(m_private->pdfCopy) && error == 0)
					error = -1;
				timer.Log("save: write the PDF");
			}
			if (commands.IsExternalize)
				commands.Free();
		}
		m_private->Run(std::wstring(L"eoEngine.afterSave(") + (error == 0 ? L"true" : L"false") + L");");
		return error;
	}

	std::string Document::Execute(const std::wstring& script)
	{
		CDocBuilderValue result;
		bool done = m_private->Run(script, &result);
		std::string text = done && result.IsString()
			? std::wstring_convert<std::codecvt_utf8<wchar_t>>().to_bytes(result.ToString().c_str()) : std::string();
		// What the scripts ask of the engine after a command
		int requests = (int)m_private->RunNumber(L"(window.eoPdfReopen ? 1 : 0) + (window.eoImages ? 2 : 0)");
		if (requests & 2)
			WriteImages();
		if (m_private->isPdf && (requests & 1))
			ReopenPdf();
		return text;
	}

	// Pictures sdkjs has as data URLs (pdf.js' sendImgUrls: of pages made editable; textures and
	// patterns), written to the images directory under the names engine.js' imageFile gave them
	void Document::WriteImages()
	{
		CDocBuilderValue imagesDir;
		if (!m_private->Run(L"eoEngine.getImagesDirectory()", &imagesDir) || !imagesDir.IsString())
			return;
		std::wstring dir = imagesDir.ToString().c_str();
		for (;;)
		{
			CDocBuilderValue image;
			if (!m_private->Run(L"eoEngine.takeImage()", &image) || !image.IsString())
				return;
			// The name, then the picture in base64
			std::wstring text = image.ToString().c_str();
			size_t separator = text.find(L'\n');
			if (separator == std::wstring::npos)
				return;
			std::string base64(text.begin() + separator + 1, text.end());
			int length = NSBase64::Base64DecodeGetRequiredLength((int)base64.size());
			std::vector<BYTE> data(length);
			NSFile::CFileBinary file;
			if (NSBase64::Base64Decode(base64.c_str(), (int)base64.size(), data.data(), &length) &&
			    file.CreateFileW(dir + L"/" + text.substr(0, separator)))
			{
				file.WriteFile(data.data(), (DWORD)length);
				file.CloseFile();
			}
		}
	}

	// Co-editing opens the server's file (pdf.js asks for it, eoPdfReopen): the engine's reader
	// of the old one goes first (core's readers share global settings, which each one deletes),
	// then sdkjs opens the new one (eoEngine.pdfReopened)
	void Document::ReopenPdf()
	{
		CDocBuilderValue request;
		if (!m_private->Run(L"window.eoPdfReopen || ''", &request) || !request.IsString())
			return;
		std::wstring path = request.ToString().c_str();
		if (path.empty())
			return;
		m_private->Run(L"window.eoPdfReopen = null;");
		bool opened = ReplacePdfReader(path);
		m_private->Run(L"eoEngine.pdfReopened(" + (opened ? JsString(path) : std::wstring(L"null")) + L");");
	}

	// The engine's reader on path, also for sdkjs (CDrawingFileEmbed): the old one goes first
	bool Document::ReplacePdfReader(const std::wstring& path)
	{
		m_private->pdfPages.reset();
		// A temporary directory of its own: core keeps the fonts it extracted there by their
		// paths, and the new reader would write other ones to the same paths
		std::wstring tempDir = NSFile::GetDirectoryName(m_private->pdfCopy) + L"/reader" + std::to_wstring(++m_private->pdfReaders);
		NSDirectory::CreateDirectory(tempDir);
		std::unique_ptr<DrawingDocument> pages(new DrawingDocument());
		if (pages->Open(path, m_private->password, tempDir) != DrawingDocument::Opened)
			return false;
		m_private->pdfPages = std::move(pages);
		JSSmart<NSJSBase::CJSValue> embed = NSJSBase::CJSContext::GetCurrent()->GetGlobal()->get("g_native_drawing_file");
		CDrawingFileEmbed* drawingFile = embed->isObject() ? dynamic_cast<CDrawingFileEmbed*>(embed->toObject()->getNative()) : nullptr;
		if (drawingFile && drawingFile->m_pFile)
			drawingFile->m_pFile->SetInternalFile(m_private->pdfPages->File());
		return true;
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

	// Attaches the pixel buffer to the graphics object sdkjs will draw into (eoEngine.tile, after
	// beginTile; the document's context stays entered, see Open)
	bool Document::AttachTile(unsigned char* pixels, int width, int height, bool rgba)
	{
		JSSmart<NSJSBase::CJSContext> context = NSJSBase::CJSContext::GetCurrent();
		JSSmart<NSJSBase::CJSValue> native = context->GetGlobal()->get("eoEngine")->toObject()
			->get("tile")->toObject()->get("Native");
		CGraphicsEmbed* graphics = native->isObject()
			? dynamic_cast<CGraphicsEmbed*>(native->toObject()->getNative())
			: nullptr;
		if (!graphics)
			return false;
		graphics->SetAppImage(new TileImage(pixels, width, height, rgba, m_private->imageCache));
		return true;
	}

	bool Document::RenderTile(int page, int pageWidth, int pageHeight,
	                          int x, int y, int width, int height,
	                          unsigned char* pixels, bool rgba)
	{
		// PDFs: the page from the file (if it has one there); sdkjs draws its objects into a
		// buffer of their own (doctrenderer's graphics clear the buffer to transparent white),
		// which goes over the page
		std::vector<unsigned char> objects;
		unsigned char* target = pixels;
		if (m_private->isPdf)
		{
			int origin = (int)m_private->RunNumber(L"eoEngine.pageOrigin(" + std::to_wstring(page) + L")");
			if (origin < 0 || !m_private->pdfPages->RenderTile(origin, pageWidth, pageHeight, x, y, width, height, pixels, rgba, false))
				memset(pixels, 0xFF, (size_t)width * height * 4);
			objects.resize((size_t)width * height * 4);
			target = objects.data();
		}
		if (!m_private->Run(L"eoEngine.beginTile();") || !AttachTile(target, width, height, rgba))
			return false;

		std::wstring draw = L"eoEngine.drawTile(" +
			std::to_wstring(page) + L", " + std::to_wstring(pageWidth) + L", " + std::to_wstring(pageHeight) + L", " +
			std::to_wstring(x) + L", " + std::to_wstring(y) + L", " + std::to_wstring(width) + L", " + std::to_wstring(height) + L");";
		bool drawn = m_private->Run(draw);
		// Textures and patterns the tile has for the first time become files (engine.js' imageFile),
		// which the graphics draw from: once they are written, the tile is drawn again
		if (drawn && m_private->RunNumber(L"window.eoImages ? 1 : 0") == 1)
		{
			WriteImages();
			drawn = m_private->Run(L"eoEngine.beginTile();") && AttachTile(target, width, height, rgba) && m_private->Run(draw);
		}
		// The objects over the page, by their opacity (the byte order is the same in both)
		for (size_t i = 0; i < objects.size(); i += 4)
		{
			unsigned int alpha = objects[i + 3];
			if (alpha == 0)
				continue;
			for (size_t c = 0; c < 3; ++c)
				pixels[i + c] = (unsigned char)((objects[i + c] * alpha + pixels[i + c] * (255 - alpha) + 127) / 255);
		}
		return drawn;
	}
}
