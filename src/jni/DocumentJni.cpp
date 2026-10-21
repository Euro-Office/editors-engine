// JNI binding of the engine for libeditors (lib.editors.base.engine)

#include "../Document.h"
#include "../DrawingDocument.h"

#include <android/bitmap.h>
#include <jni.h>

#include <codecvt>
#include <locale>
#include <string>
#include <vector>

namespace
{
	std::wstring ToWide(JNIEnv* env, jstring value)
	{
		const char* utf8 = env->GetStringUTFChars(value, nullptr);
		std::wstring result = std::wstring_convert<std::codecvt_utf8<wchar_t>>().from_bytes(utf8);
		env->ReleaseStringUTFChars(value, utf8);
		return result;
	}

	eo::Document* FromHandle(jlong handle)
	{
		return reinterpret_cast<eo::Document*>(handle);
	}

	eo::DrawingDocument* DrawingFromHandle(jlong handle)
	{
		return reinterpret_cast<eo::DrawingDocument*>(handle);
	}

	// Locks an RGBA_8888 bitmap without row padding; null if it isn't one
	void* LockBitmap(JNIEnv* env, jobject bitmap, AndroidBitmapInfo& info)
	{
		void* pixels = nullptr;
		if (AndroidBitmap_getInfo(env, bitmap, &info) != ANDROID_BITMAP_RESULT_SUCCESS ||
		    info.format != ANDROID_BITMAP_FORMAT_RGBA_8888 || info.stride != 4 * info.width ||
		    AndroidBitmap_lockPixels(env, bitmap, &pixels) != ANDROID_BITMAP_RESULT_SUCCESS)
			return nullptr;
		return pixels;
	}
}

extern "C"
{
	JNIEXPORT jboolean JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeInitialize(JNIEnv* env, jobject, jstring runtimeDir)
	{
		return eo::Document::Initialize(ToWide(env, runtimeDir)) ? JNI_TRUE : JNI_FALSE;
	}

	JNIEXPORT jlong JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeCreateDocument(JNIEnv*, jobject)
	{
		return reinterpret_cast<jlong>(new eo::Document());
	}

	JNIEXPORT void JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeDestroyDocument(JNIEnv*, jobject, jlong handle)
	{
		delete FromHandle(handle);
	}

	// 0, the x2t error code (eo::Document::ERROR_PASSWORD) or -1
	JNIEXPORT jint JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeOpen(JNIEnv* env, jobject, jlong handle, jstring path, jstring tempDir,
	                                                    jstring password)
	{
		return FromHandle(handle)->Open(ToWide(env, path), ToWide(env, tempDir), ToWide(env, password));
	}

	// 0, the x2t error code or -1 for a format the engine can't write
	JNIEXPORT jint JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeSave(JNIEnv* env, jobject, jlong handle, jstring path, jstring extension)
	{
		return FromHandle(handle)->Save(ToWide(env, path), ToWide(env, extension));
	}

	// UTF-8 bytes (NewStringUTF would need "modified" UTF-8)
	JNIEXPORT jbyteArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeExecute(JNIEnv* env, jobject, jlong handle, jstring script)
	{
		std::string result = FromHandle(handle)->Execute(ToWide(env, script));
		jbyteArray bytes = env->NewByteArray((jsize)result.size());
		env->SetByteArrayRegion(bytes, 0, (jsize)result.size(), reinterpret_cast<const jbyte*>(result.data()));
		return bytes;
	}

	JNIEXPORT jint JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeGetPageCount(JNIEnv*, jobject, jlong handle)
	{
		return FromHandle(handle)->GetPageCount();
	}

	// [width, height] in mm
	JNIEXPORT jdoubleArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeGetPageSize(JNIEnv* env, jobject, jlong handle, jint page)
	{
		eo::PageSize size = FromHandle(handle)->GetPageSize(page);
		jdouble values[] = { size.widthMm, size.heightMm };
		jdoubleArray result = env->NewDoubleArray(2);
		env->SetDoubleArrayRegion(result, 0, 2, values);
		return result;
	}

	// Draws the area at (x, y) of a page rendered at pageWidth x pageHeight pixels into
	// an ARGB_8888 bitmap, whose size is the size of the area
	JNIEXPORT jboolean JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeRenderTile(JNIEnv* env, jobject, jlong handle, jint page,
	                                                          jint pageWidth, jint pageHeight, jint x, jint y,
	                                                          jobject bitmap)
	{
		AndroidBitmapInfo info;
		void* pixels = LockBitmap(env, bitmap, info);
		if (!pixels)
			return JNI_FALSE;

		bool rendered = FromHandle(handle)->RenderTile(page, pageWidth, pageHeight, x, y,
		                                               (int)info.width, (int)info.height,
		                                               static_cast<unsigned char*>(pixels), true);
		AndroidBitmap_unlockPixels(env, bitmap);
		return rendered ? JNI_TRUE : JNI_FALSE;
	}

	// PDF, XPS and DjVu (lib.editors.base.engine.NativeEngine, NativeDrawingDocument)

	JNIEXPORT jlong JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeCreateDrawingDocument(JNIEnv*, jobject)
	{
		return reinterpret_cast<jlong>(new eo::DrawingDocument());
	}

	JNIEXPORT void JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeDestroyDrawingDocument(JNIEnv*, jobject, jlong handle)
	{
		delete DrawingFromHandle(handle);
	}

	// eo::DrawingDocument::OpenResult
	JNIEXPORT jint JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeOpenDrawing(JNIEnv* env, jobject, jlong handle, jstring path,
	                                                           jstring password, jstring tempDir)
	{
		return DrawingFromHandle(handle)->Open(ToWide(env, path), ToWide(env, password), ToWide(env, tempDir));
	}

	JNIEXPORT jint JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeGetDrawingPageCount(JNIEnv*, jobject, jlong handle)
	{
		return DrawingFromHandle(handle)->GetPageCount();
	}

	JNIEXPORT jdoubleArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeGetDrawingPageSize(JNIEnv* env, jobject, jlong handle, jint page)
	{
		eo::PageSize size = DrawingFromHandle(handle)->GetPageSize(page);
		jdouble values[] = { size.widthMm, size.heightMm };
		jdoubleArray result = env->NewDoubleArray(2);
		env->SetDoubleArrayRegion(result, 0, 2, values);
		return result;
	}

	JNIEXPORT jboolean JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeRenderDrawingTile(JNIEnv* env, jobject, jlong handle, jint page,
	                                                                 jint pageWidth, jint pageHeight, jint x, jint y,
	                                                                 jobject bitmap)
	{
		AndroidBitmapInfo info;
		void* pixels = LockBitmap(env, bitmap, info);
		if (!pixels)
			return JNI_FALSE;
		bool rendered = DrawingFromHandle(handle)->RenderTile(page, pageWidth, pageHeight, x, y,
		                                                      (int)info.width, (int)info.height,
		                                                      static_cast<unsigned char*>(pixels), true);
		AndroidBitmap_unlockPixels(env, bitmap);
		return rendered ? JNI_TRUE : JNI_FALSE;
	}

	// [text, boxes] (eo::PageText)
	JNIEXPORT jobjectArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeGetDrawingPageText(JNIEnv* env, jobject, jlong handle, jint page)
	{
		eo::PageText text = DrawingFromHandle(handle)->GetPageText(page);
		jobjectArray result = env->NewObjectArray(2, env->FindClass("java/lang/Object"), nullptr);
		env->SetObjectArrayElement(result, 0, env->NewString(reinterpret_cast<const jchar*>(text.text.data()), (jsize)text.text.size()));
		jfloatArray boxes = env->NewFloatArray((jsize)text.boxes.size());
		env->SetFloatArrayRegion(boxes, 0, (jsize)text.boxes.size(), text.boxes.data());
		env->SetObjectArrayElement(result, 1, boxes);
		return result;
	}

	// [addresses, (x, y, width, height, destination page, destination y) per link] (eo::PageLink)
	JNIEXPORT jobjectArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeGetDrawingLinks(JNIEnv* env, jobject, jlong handle, jint page)
	{
		std::vector<eo::PageLink> links = DrawingFromHandle(handle)->GetLinks(page);
		jobjectArray urls = env->NewObjectArray((jsize)links.size(), env->FindClass("java/lang/String"), nullptr);
		std::vector<float> values;
		for (size_t i = 0; i < links.size(); ++i)
		{
			env->SetObjectArrayElement(urls, (jsize)i, env->NewStringUTF(links[i].url.c_str()));
			values.insert(values.end(), { links[i].x, links[i].y, links[i].width, links[i].height, (float)links[i].destPage, links[i].destY });
		}
		jfloatArray areas = env->NewFloatArray((jsize)values.size());
		env->SetFloatArrayRegion(areas, 0, (jsize)values.size(), values.data());
		jobjectArray result = env->NewObjectArray(2, env->FindClass("java/lang/Object"), nullptr);
		env->SetObjectArrayElement(result, 0, urls);
		env->SetObjectArrayElement(result, 1, areas);
		return result;
	}

	// [titles, (level, page, y) per entry] (eo::OutlineItem)
	JNIEXPORT jobjectArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeGetDrawingOutline(JNIEnv* env, jobject, jlong handle)
	{
		std::vector<eo::OutlineItem> outline = DrawingFromHandle(handle)->GetOutline();
		jobjectArray titles = env->NewObjectArray((jsize)outline.size(), env->FindClass("java/lang/String"), nullptr);
		std::vector<float> values;
		for (size_t i = 0; i < outline.size(); ++i)
		{
			// Titles are UTF-8 from the file; invalid bytes would abort NewStringUTF
			std::u16string title = std::wstring_convert<std::codecvt_utf8_utf16<char16_t>, char16_t>("?", u"?").from_bytes(outline[i].title);
			env->SetObjectArrayElement(titles, (jsize)i, env->NewString(reinterpret_cast<const jchar*>(title.data()), (jsize)title.size()));
			values.insert(values.end(), { (float)outline[i].level, (float)outline[i].page, outline[i].y });
		}
		jfloatArray numbers = env->NewFloatArray((jsize)values.size());
		env->SetFloatArrayRegion(numbers, 0, (jsize)values.size(), values.data());
		jobjectArray result = env->NewObjectArray(2, env->FindClass("java/lang/Object"), nullptr);
		env->SetObjectArrayElement(result, 0, titles);
		env->SetObjectArrayElement(result, 1, numbers);
		return result;
	}

	// Markups: (page, type, quad count) per markup in markupInts, colors (3 per markup) and
	// quads (8 per quad) in markupFloats; images: page per image, paths, (x, y, width, height)
	// per image. 0 or an error (eo::DrawingDocument::SaveWithChanges); the document is closed then.
	JNIEXPORT jint JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeSaveDrawingWithChanges(JNIEnv* env, jobject, jlong handle, jstring path,
	                                                                     jintArray markupInts, jfloatArray markupFloats, jstring author,
	                                                                     jintArray imagePages, jobjectArray imagePaths, jfloatArray imageAreas)
	{
		std::vector<eo::PdfMarkup> markups;
		jsize intCount = env->GetArrayLength(markupInts);
		std::vector<jint> ints(intCount);
		env->GetIntArrayRegion(markupInts, 0, intCount, ints.data());
		jsize floatCount = env->GetArrayLength(markupFloats);
		std::vector<jfloat> floats(floatCount);
		env->GetFloatArrayRegion(markupFloats, 0, floatCount, floats.data());
		std::wstring authorName = ToWide(env, author);
		size_t next = 0;
		for (jsize i = 0; i + 2 < intCount; i += 3)
		{
			eo::PdfMarkup markup;
			markup.page = ints[i];
			markup.type = ints[i + 1];
			int quads = ints[i + 2];
			if (next + 3 + 8 * quads > floats.size())
				break;
			markup.red = floats[next];
			markup.green = floats[next + 1];
			markup.blue = floats[next + 2];
			markup.quads.assign(floats.begin() + next + 3, floats.begin() + next + 3 + 8 * quads);
			markup.author = authorName;
			next += 3 + 8 * quads;
			markups.push_back(markup);
		}

		std::vector<eo::PdfImage> images;
		jsize imageCount = env->GetArrayLength(imagePages);
		std::vector<jint> pages(imageCount);
		env->GetIntArrayRegion(imagePages, 0, imageCount, pages.data());
		std::vector<jfloat> areas(4 * imageCount);
		env->GetFloatArrayRegion(imageAreas, 0, 4 * imageCount, areas.data());
		for (jsize i = 0; i < imageCount; ++i)
		{
			jstring imagePath = (jstring)env->GetObjectArrayElement(imagePaths, i);
			images.push_back({ pages[i], ToWide(env, imagePath), areas[4 * i], areas[4 * i + 1], areas[4 * i + 2], areas[4 * i + 3] });
		}
		return DrawingFromHandle(handle)->SaveWithChanges(ToWide(env, path), markups, images);
	}
}
