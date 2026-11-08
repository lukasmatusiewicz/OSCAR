import { describe, it, expect } from 'vitest';
import {
  normalizePersonToNominative,
  normalizeAddressCasing,
} from '../../src/utils/linguisticNormalizer';

describe('linguisticNormalizer (Client Unit Tests)', () => {
  describe('normalizePersonToNominative', () => {
    it('returns empty string for null, undefined, empty, or whitespace-only inputs', () => {
      expect(normalizePersonToNominative('')).toBe('');
      expect(normalizePersonToNominative('   ')).toBe('');
      expect(normalizePersonToNominative(null as unknown as string)).toBe('');
      expect(normalizePersonToNominative(undefined as unknown as string)).toBe('');
    });

    it('preserves PII tokens without modification', () => {
      expect(normalizePersonToNominative('[PERSON_1]')).toBe('[PERSON_1]');
      expect(normalizePersonToNominative('[PERSON_42]')).toBe('[PERSON_42]');
    });

    it('strips leading prepositions across languages', () => {
      expect(normalizePersonToNominative('spotkanie z Beatą Kozidrak')).toBe('Beata Kozidrak');
      expect(normalizePersonToNominative('rozmowa z Janem Kowalskim')).toBe('Jan Kowalski');
      expect(normalizePersonToNominative('treffen mit Hans Müller')).toBe('Hans Müller');
      expect(normalizePersonToNominative('rendez-vous avec Jean Dupont')).toBe('Jean Dupont');
      expect(normalizePersonToNominative('meeting with John Doe')).toBe('John Doe');
      expect(normalizePersonToNominative('for Alice Smith')).toBe('Alice Smith');
    });

    it('canonicalizes honorifics and title-cases names', () => {
      expect(normalizePersonToNominative('dr jan kowalski')).toBe('dr Jan Kowalski');
      expect(normalizePersonToNominative('prof. piotr nowak')).toBe('prof. Piotr Nowak');
      expect(normalizePersonToNominative('pan tomasz')).toBe('Pan Tomasz');
      expect(normalizePersonToNominative('pani beata')).toBe('Pani Beata');
      expect(normalizePersonToNominative('herr schmidt')).toBe('Herr Schmidt');
      expect(normalizePersonToNominative('frau müller')).toBe('Frau Müller');
      expect(normalizePersonToNominative('mme dubois')).toBe('Mme Dubois');
    });

    it('lemmatizes Polish mobile-e names from instrumental, genitive, and accusative', () => {
      expect(normalizePersonToNominative('z Frankiem')).toBe('Franek');
      expect(normalizePersonToNominative('z Markiem')).toBe('Marek');
      expect(normalizePersonToNominative('Pawłem')).toBe('Paweł');
      expect(normalizePersonToNominative('Aleksandrem')).toBe('Aleksander');
      expect(normalizePersonToNominative('Franka')).toBe('Franek');
      expect(normalizePersonToNominative('Marka')).toBe('Marek');
      expect(normalizePersonToNominative('Pawła')).toBe('Paweł');
      expect(normalizePersonToNominative('Kacpra')).toBe('Kacper');
    });

    it('lemmatizes feminine names and surnames across cases (Biernik, Narzędnik, Dopełniacz)', () => {
      expect(normalizePersonToNominative('Beatą Kozidrak')).toBe('Beata Kozidrak');
      expect(normalizePersonToNominative('Anną Nowak')).toBe('Anna Nowak');
      expect(normalizePersonToNominative('Katarzyną Kowalską')).toBe('Katarzyna Kowalska');
      expect(normalizePersonToNominative('Katarzyny Kowalskiej')).toBe('Katarzyna Kowalska');
      expect(normalizePersonToNominative('Marią Wiśniewską')).toBe('Maria Wiśniewska');
    });

    it('lemmatizes masculine names and surnames across cases', () => {
      expect(normalizePersonToNominative('Janem Kowalskim')).toBe('Jan Kowalski');
      expect(normalizePersonToNominative('Piotrem Nowakiem')).toBe('Piotr Nowak');
      expect(normalizePersonToNominative('Kazikiem Bąkiem')).toBe('Kazik Bąk');
      expect(normalizePersonToNominative('Tomaszem Wiśniewskim')).toBe('Tomasz Wiśniewski');
    });

    it('handles hyphenated names correctly', () => {
      expect(normalizePersonToNominative('Anną Nowak-Kowalską')).toBe('Anna Nowak-Kowalska');
      expect(normalizePersonToNominative('Jean-Luc')).toBe('Jean-Luc');
    });

    it('preserves casing and title-cases particles in person names', () => {
      expect(normalizePersonToNominative('Ludwig van Beethoven')).toBe('Ludwig Van Beethoven');
      expect(normalizePersonToNominative('Otto von Bismarck')).toBe('Otto Von Bismarck');
    });
  });

  describe('normalizeAddressCasing', () => {
    it('returns empty string for null, undefined, empty, or whitespace-only inputs', () => {
      expect(normalizeAddressCasing('')).toBe('');
      expect(normalizeAddressCasing('   ')).toBe('');
      expect(normalizeAddressCasing(null as unknown as string)).toBe('');
      expect(normalizeAddressCasing(undefined as unknown as string)).toBe('');
    });

    it('preserves PII tokens without modification', () => {
      expect(normalizeAddressCasing('[ADDRESS_1]')).toBe('[ADDRESS_1]');
      expect(normalizeAddressCasing('[ADDRESS_99]')).toBe('[ADDRESS_99]');
    });

    it('normalizes standalone cities with and without prepositions', () => {
      expect(normalizeAddressCasing('w warszawie')).toBe('Warszawa');
      expect(normalizeAddressCasing('in berlin')).toBe('Berlin');
      expect(normalizeAddressCasing('à paris')).toBe('Paris');
      expect(normalizeAddressCasing('krakowie')).toBe('Kraków');
      expect(normalizeAddressCasing('wrocławiu')).toBe('Wrocław');
      expect(normalizeAddressCasing('london')).toBe('London');
    });

    it('preserves lowercase thoroughfare prefixes (ul., al., pl., rue, avenue, boulevard, etc.)', () => {
      expect(normalizeAddressCasing('ul. marszałkowska 10')).toBe('ul. Marszałkowska 10');
      expect(normalizeAddressCasing('al. jerozolimskie 45')).toBe('al. Jerozolimskie 45');
      expect(normalizeAddressCasing('pl. konstytucji 3')).toBe('pl. Konstytucji 3');
      expect(normalizeAddressCasing('rue de rivoli 15')).toBe('rue de Rivoli 15');
      expect(normalizeAddressCasing('avenue des champs-élysées')).toBe('avenue des Champs-Élysées');
      expect(normalizeAddressCasing('boulevard saint-germain')).toBe('boulevard Saint-Germain');
    });

    it('preserves lowercase thoroughfare particles (de, d, von, van, del, della, etc.)', () => {
      expect(normalizeAddressCasing('rue du faubourg saint-honoré')).toBe('rue du Faubourg Saint-Honoré');
    });

    it('uppercases building number letter suffixes including with trailing punctuation', () => {
      expect(normalizeAddressCasing('baker street 221b')).toBe('Baker Street 221B');
      expect(normalizeAddressCasing('ul. marszałkowska 10a,')).toBe('ul. Marszałkowska 10A,');
      expect(normalizeAddressCasing('flower lane 5c.')).toBe('Flower Lane 5C.');
    });

    it('handles German compound street names and hyphenated thoroughfares', () => {
      expect(normalizeAddressCasing('hamburgerstr. 123')).toBe('Hamburgerstr. 123');
      expect(normalizeAddressCasing('friedrichstraße 42')).toBe('Friedrichstraße 42');
    });

    it('normalizes standalone city words with trailing punctuation', () => {
      expect(normalizeAddressCasing('london,')).toBe('London,');
      expect(normalizeAddressCasing('berlin.')).toBe('Berlin.');
    });
  });
});
