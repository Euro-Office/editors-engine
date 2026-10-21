// JNI binding of the engine for libeditors (lib.editors.base.engine)

#include "../Document.h"
#include "../DrawingDocument.h"

#include <android/bitmap.h>
#include <jni.h>

#include <codecvt>
#include <locale>
#include <string>

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

	JNIEXPORT jboolean JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeOpen(JNIEnv* env, jobject, jlong handle, jstring path, jstring tempDir)
	{
		return FromHandle(handle)->Open(ToWide(env, path), ToWide(env, tempDir)) ? JNI_TRUE : JNI_FALSE;
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
}
