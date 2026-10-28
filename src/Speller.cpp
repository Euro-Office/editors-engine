#include "Speller.h"

#include <hunspell.hxx>

#include <fstream>

namespace eo
{
	Speller::Speller(const std::string& affPath, const std::string& dicPath)
	{
		// Hunspell doesn't report missing files
		if (!std::ifstream(affPath).good() || !std::ifstream(dicPath).good())
			return;
		m_hunspell = std::make_unique<Hunspell>(affPath.c_str(), dicPath.c_str());
		// Words come in UTF-8; the dictionaries of the dictionaries repository are all UTF-8
		if (m_hunspell->get_dict_encoding() != "UTF-8")
			m_hunspell.reset();
	}

	Speller::~Speller() = default;

	bool Speller::IsLoaded() const
	{
		return m_hunspell != nullptr;
	}

	bool Speller::Spell(const std::string& word) const
	{
		return !m_hunspell || m_hunspell->spell(word);
	}

	std::vector<std::string> Speller::Suggest(const std::string& word) const
	{
		if (!m_hunspell)
			return {};
		return m_hunspell->suggest(word);
	}

	void Speller::Add(const std::string& word)
	{
		if (m_hunspell)
			m_hunspell->add(word);
	}
}
