// JNI binding of the spell checker for libeditors (lib.editors.base.engine.NativeEngine)

#include "../Speller.h"

#include <jni.h>

#include <string>
#include <vector>

namespace
{
	// Java strings are UTF-16; Hunspell takes UTF-8 (GetStringUTFChars would give modified UTF-8)
	std::string ToUtf8(JNIEnv* env, jstring value)
	{
		const jsize length = env->GetStringLength(value);
		const jchar* chars = env->GetStringChars(value, nullptr);
		std::string result;
		for (jsize i = 0; i < length; ++i)
		{
			uint32_t code = chars[i];
			if (code >= 0xD800 && code <= 0xDBFF && i + 1 < length && chars[i + 1] >= 0xDC00 && chars[i + 1] <= 0xDFFF)
				code = 0x10000 + ((code - 0xD800) << 10) + (chars[++i] - 0xDC00);
			if (code < 0x80)
			{
				result += static_cast<char>(code);
			}
			else if (code < 0x800)
			{
				result += static_cast<char>(0xC0 | (code >> 6));
				result += static_cast<char>(0x80 | (code & 0x3F));
			}
			else if (code < 0x10000)
			{
				result += static_cast<char>(0xE0 | (code >> 12));
				result += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
				result += static_cast<char>(0x80 | (code & 0x3F));
			}
			else
			{
				result += static_cast<char>(0xF0 | (code >> 18));
				result += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
				result += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
				result += static_cast<char>(0x80 | (code & 0x3F));
			}
		}
		env->ReleaseStringChars(value, chars);
		return result;
	}

	// UTF-8 from Hunspell to a Java string, via UTF-16
	jstring FromUtf8(JNIEnv* env, const std::string& value)
	{
		std::u16string utf16;
		for (size_t i = 0; i < value.size();)
		{
			const unsigned char lead = value[i];
			uint32_t code = lead;
			int extra = lead >= 0xF0 ? 3 : lead >= 0xE0 ? 2 : lead >= 0xC0 ? 1 : 0;
			if (extra)
				code = lead & (0x3F >> extra);
			for (int k = 1; k <= extra && i + k < value.size(); ++k)
				code = (code << 6) | (static_cast<unsigned char>(value[i + k]) & 0x3F);
			i += extra + 1;
			if (code >= 0x10000)
			{
				code -= 0x10000;
				utf16 += static_cast<char16_t>(0xD800 + (code >> 10));
				utf16 += static_cast<char16_t>(0xDC00 + (code & 0x3FF));
			}
			else
			{
				utf16 += static_cast<char16_t>(code);
			}
		}
		return env->NewString(reinterpret_cast<const jchar*>(utf16.data()), static_cast<jsize>(utf16.size()));
	}

	eo::Speller* FromHandle(jlong handle)
	{
		return reinterpret_cast<eo::Speller*>(handle);
	}
}

extern "C"
{
	// 0 if the dictionary can't be read
	JNIEXPORT jlong JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeCreateSpeller(JNIEnv* env, jobject, jstring affPath, jstring dicPath)
	{
		auto* speller = new eo::Speller(ToUtf8(env, affPath), ToUtf8(env, dicPath));
		if (!speller->IsLoaded())
		{
			delete speller;
			return 0;
		}
		return reinterpret_cast<jlong>(speller);
	}

	JNIEXPORT void JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeDestroySpeller(JNIEnv*, jobject, jlong handle)
	{
		delete FromHandle(handle);
	}

	JNIEXPORT jbooleanArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeSpell(JNIEnv* env, jobject, jlong handle, jobjectArray words)
	{
		const jsize count = env->GetArrayLength(words);
		std::vector<jboolean> correct(count);
		for (jsize i = 0; i < count; ++i)
		{
			auto word = static_cast<jstring>(env->GetObjectArrayElement(words, i));
			correct[i] = FromHandle(handle)->Spell(ToUtf8(env, word)) ? JNI_TRUE : JNI_FALSE;
			env->DeleteLocalRef(word);
		}
		jbooleanArray result = env->NewBooleanArray(count);
		env->SetBooleanArrayRegion(result, 0, count, correct.data());
		return result;
	}

	JNIEXPORT jobjectArray JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeSuggest(JNIEnv* env, jobject, jlong handle, jstring word)
	{
		const std::vector<std::string> suggestions = FromHandle(handle)->Suggest(ToUtf8(env, word));
		jobjectArray result = env->NewObjectArray(static_cast<jsize>(suggestions.size()), env->FindClass("java/lang/String"), nullptr);
		for (size_t i = 0; i < suggestions.size(); ++i)
		{
			jstring suggestion = FromUtf8(env, suggestions[i]);
			env->SetObjectArrayElement(result, static_cast<jsize>(i), suggestion);
			env->DeleteLocalRef(suggestion);
		}
		return result;
	}

	JNIEXPORT void JNICALL
	Java_lib_editors_base_engine_NativeEngine_nativeAddWord(JNIEnv* env, jobject, jlong handle, jstring word)
	{
		FromHandle(handle)->Add(ToUtf8(env, word));
	}
}
