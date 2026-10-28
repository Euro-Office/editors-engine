#pragma once

// Spell checking with Hunspell, for one dictionary (the app answers sdkjs' spelling requests with it)

#include <memory>
#include <string>
#include <vector>

class Hunspell;

namespace eo
{
	class Speller
	{
	public:
		// The dictionary's .aff and .dic files; IsLoaded() tells whether they could be read
		Speller(const std::string& affPath, const std::string& dicPath);
		~Speller();

		bool IsLoaded() const;
		// Words in UTF-8
		bool Spell(const std::string& word) const;
		std::vector<std::string> Suggest(const std::string& word) const;
		// A word of the user's dictionary: correct from now on
		void Add(const std::string& word);

	private:
		std::unique_ptr<Hunspell> m_hunspell;
	};
}
