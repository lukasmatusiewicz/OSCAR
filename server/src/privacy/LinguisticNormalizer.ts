/**
 * LinguisticNormalizer.ts
 *
 * Local Linguistic Entity Normalizer & Lemmatizer for Contact Names (Nominative Case)
 * and Address / Thoroughfare Casing.
 *
 * Conforms strictly to architecture.md Section 5 and contracts.md.
 * Implements 100% offline, deterministic linguistic transformations with zero network calls.
 */

// Leading conversational or prepositional preambles when captured with names
const PREPOSITIONS_REGEX =
  /^(?:spotkanie z|rozmowa z|z|ze|dla|od|przez|treffen mit|mit|bei|für|von|rendez-vous avec|avec|pour|de|meeting with|with|for|from)(?:\s+|$)/iu;

// Prepositions that might precede standalone city locations
const LOCATION_PREPOSITIONS_REGEX = /^(?:w|we|in|im|at|à|au)\s+/iu;

// Polish mobile-e masculine first names where nominative has 'e' that drops in inflection
const MOBILE_E_NAMES: Record<string, string> = {
  // Instrumental
  frankiem: 'Franek',
  markiem: 'Marek',
  radkiem: 'Radek',
  jankiem: 'Janek',
  bartkiem: 'Bartek',
  tomkiem: 'Tomek',
  wojtkiem: 'Wojtek',
  jackiem: 'Jacek',
  pawłem: 'Paweł',
  kacprem: 'Kacper',
  ryśkiem: 'Rysiek',
  staśkiem: 'Stasiek',
  krzyśkiem: 'Krzysiek',
  maćkiem: 'Maciek',
  aleksandrem: 'Aleksander',
  // Genitive / Accusative
  franka: 'Franek',
  marka: 'Marek',
  radka: 'Radek',
  janka: 'Janek',
  bartka: 'Bartek',
  tomka: 'Tomek',
  wojtka: 'Wojtek',
  jacka: 'Jacek',
  pawła: 'Paweł',
  kacpra: 'Kacper',
  ryśka: 'Rysiek',
  staśka: 'Stasiek',
  krzyśka: 'Krzysiek',
  maćka: 'Maciek',
  // Dative
  frankowi: 'Franek',
  markowi: 'Marek',
  radkowi: 'Radek',
  jankowi: 'Janek',
  bartkowi: 'Bartek',
  tomkowi: 'Tomek',
  wojtkowi: 'Wojtek',
  jackowi: 'Jacek',
  pawłowi: 'Paweł',
  kacprowi: 'Kacper',
};

// Common Polish masculine first names in genitive (-a) to nominative (base consonant)
const MASCULINE_GENITIVE_FIRST_NAMES: Record<string, string> = {
  jana: 'Jan',
  piotra: 'Piotr',
  michała: 'Michał',
  tomasza: 'Tomasz',
  adama: 'Adam',
  krzysztofa: 'Krzysztof',
  marcina: 'Marcin',
  grzegorza: 'Grzegorz',
  wojciecha: 'Wojciech',
  kamila: 'Kamil',
  filipa: 'Filip',
  szymona: 'Szymon',
  łukasza: 'Łukasz',
  mateusza: 'Mateusz',
  jakuba: 'Jakub',
  roberta: 'Robert',
  bartosza: 'Bartosz',
  dariusza: 'Dariusz',
  mariusza: 'Mariusz',
  artura: 'Artur',
  damiana: 'Damian',
  sebastiana: 'Sebastian',
  rafała: 'Rafał',
  karola: 'Karol',
  patryka: 'Patryk',
  dominika: 'Dominik',
  dawida: 'Dawid',
  andrzeja: 'Andrzej',
  macieja: 'Maciej',
  stanisława: 'Stanisław',
  kazika: 'Kazik',
  rysika: 'Rysik',
};

// Common Polish feminine first names in genitive (-y / -i) to nominative (-a)
const FEMININE_GENITIVE_FIRST_NAMES: Record<string, string> = {
  anny: 'Anna',
  hanny: 'Hanna',
  katarzyny: 'Katarzyna',
  marty: 'Marta',
  moniki: 'Monika',
  agnieszki: 'Agnieszka',
  ewy: 'Ewa',
  magdaleny: 'Magdalena',
  joanny: 'Joanna',
  natalii: 'Natalia',
  karoliny: 'Karolina',
  zofii: 'Zofia',
  marii: 'Maria',
  doroty: 'Dorota',
  barbary: 'Barbara',
  beaty: 'Beata',
  alicji: 'Alicja',
  pauliny: 'Paulina',
  justyny: 'Justyna',
  izabeli: 'Izabela',
  julii: 'Julia',
  weroniki: 'Weronika',
  patrycji: 'Patrycja',
  dominiki: 'Dominika',
  kingi: 'Kinga',
  sylwii: 'Sylwia',
  kamili: 'Kamila',
  oli: 'Ola',
  kasi: 'Kasia',
  basi: 'Basia',
  magdy: 'Magda',
  gosi: 'Gosia',
  ani: 'Ania',
  asi: 'Asia',
  zuzanny: 'Zuzanna',
  mai: 'Maja',
  oliwii: 'Oliwia',
  leny: 'Lena',
  wiktorii: 'Wiktoria',
  gabrieli: 'Gabriela',
  laury: 'Laura',
  antoniny: 'Antonina',
  poli: 'Pola',
  klaudii: 'Klaudia',
  igi: 'Iga',
  heleny: 'Helena',
  aleksandry: 'Aleksandra',
};

// Canonical standalone city lookup for nominative case normalization
const CITY_CANONICAL_MAP: Record<string, string> = {
  warszawa: 'Warszawa',
  warszawie: 'Warszawa',
  warszawy: 'Warszawa',
  warszawą: 'Warszawa',
  kraków: 'Kraków',
  krakow: 'Kraków',
  krakowie: 'Kraków',
  krakowa: 'Kraków',
  krakowem: 'Kraków',
  wrocław: 'Wrocław',
  wroclaw: 'Wrocław',
  wrocławiu: 'Wrocław',
  poznań: 'Poznań',
  poznan: 'Poznań',
  poznaniu: 'Poznań',
  gdańsk: 'Gdańsk',
  gdansk: 'Gdańsk',
  gdańsku: 'Gdańsk',
  łódź: 'Łódź',
  lodz: 'Łódź',
  łodzi: 'Łódź',
  katowice: 'Katowice',
  katowicach: 'Katowice',
  lublin: 'Lublin',
  lublinie: 'Lublin',
  szczecin: 'Szczecin',
  szczecinie: 'Szczecin',
  berlin: 'Berlin',
  berlinie: 'Berlin',
  paris: 'Paris',
  paryż: 'Paris',
  paryżu: 'Paris',
  'new york': 'New York',
  'nowy jork': 'New York',
  'nowym jorku': 'New York',
  london: 'London',
  londyn: 'London',
  londynie: 'London',
  vienna: 'Vienna',
  wiedeń: 'Vienna',
  wiedniu: 'Vienna',
  wien: 'Vienna',
  zurich: 'Zurich',
  zürich: 'Zurich',
  zurych: 'Zurich',
  zurychu: 'Zurich',
  tokyo: 'Tokyo',
  tokio: 'Tokyo',
  rome: 'Rome',
  roma: 'Rome',
  rzym: 'Rome',
  rzymie: 'Rome',
  madrid: 'Madrid',
  madryt: 'Madrid',
  madrycie: 'Madrid',
  munich: 'Munich',
  münchen: 'München',
  monachium: 'Munich',
  hamburg: 'Hamburg',
  hamburgu: 'Hamburg',
  frankfurt: 'Frankfurt',
  frankfurcie: 'Frankfurt',
  kassel: 'Kassel',
};

// Street prefixes that should remain lowercase
const LOWERCASE_PREFIXES = new Set([
  'ul.',
  'ul',
  'al.',
  'al',
  'pl.',
  'pl',
  'plac',
  'os.',
  'os',
  'rondo',
  'aleja',
  'aleje',
  'rue',
  'boulevard',
  'bd.',
  'bd',
  'avenue',
  'av.',
  'av',
]);

// Particles inside addresses that should remain lowercase
const LOWERCASE_PARTICLES = new Set([
  'de',
  'du',
  'des',
  "d'",
  'la',
  'le',
  'les',
  'am',
  'an',
  'im',
  'in',
  'von',
  'van',
  'der',
  'dem',
  'den',
  'del',
  'della',
  'di',
]);

/**
 * Capitalizes a word conforming to title-casing rules.
 * Handles uppercase acronyms vs lowercase words.
 */
function titleCaseWord(word: string): string {
  if (!word) return word;
  if (word === word.toUpperCase() && word.length > 1) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const CANONICAL_HONORIFICS: Record<string, string> = {
  dr: 'dr',
  'dr.': 'Dr.',
  prof: 'prof.',
  'prof.': 'prof.',
  mec: 'mec.',
  'mec.': 'mec.',
  pan: 'Pan',
  panem: 'Pan',
  pana: 'Pan',
  pani: 'Pani',
  panią: 'Pani',
  herr: 'Herr',
  herrn: 'Herr',
  frau: 'Frau',
  'm.': 'M.',
  mme: 'Mme',
  'mme.': 'Mme.',
  mr: 'Mr.',
  'mr.': 'Mr.',
  ms: 'Ms.',
  'ms.': 'Ms.',
  mrs: 'Mrs.',
  'mrs.': 'Mrs.',
};

/**
 * Lemmatizes an individual name segment to its nominative form.
 */
function lemmatizeNamePart(part: string): string {
  const lower = part.toLowerCase();

  // 1. Check honorifics
  if (CANONICAL_HONORIFICS[lower]) {
    return CANONICAL_HONORIFICS[lower];
  }

  // 2. Check mobile-e names
  if (MOBILE_E_NAMES[lower]) {
    return MOBILE_E_NAMES[lower];
  }

  // 3. Check masculine genitive first names and common masculine nouns
  if (MASCULINE_GENITIVE_FIRST_NAMES[lower]) {
    return MASCULINE_GENITIVE_FIRST_NAMES[lower];
  }

  // Masculine genitive nouns/surnames in -a (e.g. Bąka -> Bąk, Nowaka -> Nowak, Wójcika -> Wójcik)
  if (/(?:[ąay]|(?<!mon|domin|weron)i)ka$/iu.test(lower) && lower.length > 3) {
    return titleCaseWord(lower.slice(0, -1));
  }

  // 4. Check feminine genitive first names
  if (FEMININE_GENITIVE_FIRST_NAMES[lower]) {
    return FEMININE_GENITIVE_FIRST_NAMES[lower];
  }

  // 5. Genitive surnames and adjectives:
  // -skiego -> -ski, -ckiego -> -cki, -zkiego -> -zki, -ńskiego -> -ński, -nego -> -ny
  if (/(?:[s|c|z|ń]kiego|nego)$/iu.test(lower)) {
    if (lower.endsWith('nego')) return titleCaseWord(lower.slice(0, -3) + 'y');
    return titleCaseWord(lower.slice(0, -4) + 'i');
  }

  // Feminine genitive surnames / adjectives: -skiej -> -ska, -ckiej -> -cka, -zkiej -> -zka, -ńskiej -> -ńska, -nej -> -na
  if (/(?:[s|c|z|ń]kiej|nej)$/iu.test(lower)) {
    if (lower.endsWith('nej')) return titleCaseWord(lower.slice(0, -2) + 'a');
    return titleCaseWord(lower.slice(0, -3) + 'a');
  }

  // 6. Masculine instrumental surnames and adjectives:
  // -skim -> -ski, -ckim -> -cki, -zkim -> -zki, -ńskim -> -ński, -nym -> -ny
  if (/(?:[s|c|z|ń]k|n)[iy]m$/iu.test(lower)) {
    return titleCaseWord(lower.slice(0, -1));
  }

  // 7. Masculine diminutives and nouns in -kiem / -giem:
  // -kiem -> -k (e.g. Kazikiem -> Kazik, Rysikiem -> Rysik, Bąkiem -> Bąk)
  if (/kiem$/iu.test(lower) && lower.length > 4) {
    return titleCaseWord(lower.slice(0, -3));
  }
  if (/giem$/iu.test(lower) && lower.length > 4) {
    return titleCaseWord(lower.slice(0, -3));
  }

  // 8. Mobile-e root: Pawłem -> Paweł, Piotrem -> Piotr
  if (lower === 'pawłem') return 'Paweł';
  if (lower === 'piotrem') return 'Piotr';

  // 9. Base consonant stems with instrumental -em:
  // Base consonants: [ł|m|n|r|s|z|sz|cz|rz|ch|k|p|t|b|w|f|g|d] + em -> strip -em
  if (
    /(?:[bcdfghjklłmnprstvwzżźśńć]|sz|cz|rz|ch)em$/iu.test(lower) &&
    lower.length >= 4 &&
    !lower.endsWith('oem') &&
    !lower.endsWith('item')
  ) {
    return titleCaseWord(lower.slice(0, -2));
  }

  // 10. Feminine instrumental -ą -> -a (e.g. Anną -> Anna, Hanną -> Hanna, Katarzyną -> Katarzyna, Kowalską -> Kowalska)
  if (lower.endsWith('ą') && lower.length >= 3) {
    return titleCaseWord(lower.slice(0, -1) + 'a');
  }

  // 11. Default fallback: apply title casing to the part
  return titleCaseWord(part);
}

/**
 * Normalizes a person's name to the nominative case and applies consistent title-casing.
 *
 * Strips leading conversational prepositions (e.g. "spotkanie z", "treffen mit", "with"),
 * preserves canonical honorifics (e.g. "dr", "prof.", "Pan", "Herr"),
 * lemmatizes Slavic inflections (instrumental, genitive, accusative, dative -> nominative),
 * and capitalizes each constituent name part.
 *
 * @param name Raw person name string captured from memo or extraction.
 * @returns Clean, nominative title-cased person name.
 */
export function normalizePersonToNominative(name: string): string {
  if (!name || typeof name !== 'string') {
    return '';
  }

  let cleaned = name.trim();
  if (cleaned.length === 0) {
    return '';
  }

  // If input is an unmodified PII token, preserve it as-is
  if (/^\[[A-Z_]+_\d+\]$/.test(cleaned)) {
    return cleaned;
  }

  // Strip leading prepositions iteratively
  while (PREPOSITIONS_REGEX.test(cleaned)) {
    cleaned = cleaned.replace(PREPOSITIONS_REGEX, '').trim();
  }

  if (cleaned.length === 0) {
    return '';
  }

  // Process word tokens
  const words = cleaned.split(/\s+/);
  const normalizedWords = words.map((word) => {
    // Handle hyphenated names (e.g., Nowak-Kowalska, Jean-Luc)
    if (word.includes('-') && !word.startsWith('-') && !word.endsWith('-')) {
      const parts = word.split('-');
      return parts.map(lemmatizeNamePart).join('-');
    }
    return lemmatizeNamePart(word);
  });

  return normalizedWords.join(' ');
}

/**
 * Normalizes an address or location string, applying proper capitalization to street names,
 * thoroughfares, building suffixes, and city names while preserving standard lowercase prefixes.
 *
 * Examples:
 * - "ul. marszałkowska 10" -> "ul. Marszałkowska 10"
 * - "hamburgerstr. 123" -> "Hamburgerstr. 123"
 * - "rue de rivoli 15" -> "rue de Rivoli 15"
 * - "baker street 221b" -> "Baker Street 221B"
 * - "warszawie" -> "Warszawa"
 *
 * @param address Raw address or location string.
 * @returns Clean, properly cased address.
 */
export function normalizeAddressCasing(address: string): string {
  if (!address || typeof address !== 'string') {
    return '';
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return '';
  }

  // Preserve PII tokens unmodified
  if (/^\[[A-Z_]+_\d+\]$/.test(trimmed)) {
    return trimmed;
  }

  // Check standalone city names (with optional leading prepositions e.g. "w warszawie", "in berlin")
  const strippedCityCandidate = trimmed.replace(LOCATION_PREPOSITIONS_REGEX, '').trim().toLowerCase();
  if (CITY_CANONICAL_MAP[strippedCityCandidate]) {
    return CITY_CANONICAL_MAP[strippedCityCandidate];
  }

  // Process thoroughfare words
  const words = trimmed.split(/\s+/);
  const normalizedWords = words.map((word, index) => {
    const lower = word.toLowerCase();

    // Preserve lowercase street prefixes at the beginning or after numbers / commas
    if (
      LOWERCASE_PREFIXES.has(lower) &&
      (index === 0 || /^\d+[a-zA-Z]?[.,;]?$/.test(words[index - 1]) || words[index - 1].endsWith(','))
    ) {
      return lower;
    }

    // Preserve lowercase particles inside thoroughfares
    if (index > 0 && LOWERCASE_PARTICLES.has(lower)) {
      return lower;
    }

    // Uppercase building number letter suffix (e.g. 221b -> 221B, 10a -> 10A, 221b, -> 221B,)
    const buildingNumberMatch = word.match(/^(\d+)([a-zA-Z])([.,;]?)$/);
    if (buildingNumberMatch) {
      return `${buildingNumberMatch[1]}${buildingNumberMatch[2].toUpperCase()}${buildingNumberMatch[3]}`;
    }

    // If word is pure number or punctuation, preserve
    if (/^\d+[.,;]?$/.test(word)) {
      return word;
    }

    // Standalone city word at the end (e.g. "London,", "Warszawa")
    const cleanWord = lower.replace(/[.,;]$/, '');
    const trailingPunctuation = word.match(/[.,;]$/)?.[0] ?? '';
    if (CITY_CANONICAL_MAP[cleanWord]) {
      return CITY_CANONICAL_MAP[cleanWord] + trailingPunctuation;
    }

    // Handle hyphenated thoroughfares (e.g. Saint-Germain)
    if (word.includes('-') && !word.startsWith('-') && !word.endsWith('-')) {
      const parts = word.split('-');
      return parts.map(titleCaseWord).join('-');
    }

    // Standard title-casing
    return titleCaseWord(word);
  });

  return normalizedWords.join(' ');
}
