import { describe, it, expect } from 'vitest';
import {
  normalizePersonToNominative,
  normalizeAddressCasing,
} from '../../src/privacy/LinguisticNormalizer.js';

describe('LinguisticNormalizer Suite', () => {
  describe('normalizePersonToNominative', () => {
    describe('Polish instrumental declensions', () => {
      it('converts Frankiem Kimono to Franek Kimono', () => {
        expect(normalizePersonToNominative('Frankiem Kimono')).toBe('Franek Kimono');
      });

      it('strips leading preposition and converts z Anną Nowak to Anna Nowak', () => {
        expect(normalizePersonToNominative('z Anną Nowak')).toBe('Anna Nowak');
      });

      it('converts Michałem Wiśniewskim to Michał Wiśniewski', () => {
        expect(normalizePersonToNominative('Michałem Wiśniewskim')).toBe('Michał Wiśniewski');
      });

      it('converts Kazikiem Bąkiem to Kazik Bąk', () => {
        expect(normalizePersonToNominative('Kazikiem Bąkiem')).toBe('Kazik Bąk');
      });

      it('converts Tomaszem Kamińskim to Tomasz Kamiński', () => {
        expect(normalizePersonToNominative('Tomaszem Kamińskim')).toBe('Tomasz Kamiński');
      });

      it('preserves lowercase dr honorific and converts dr Janem Kowalskim to dr Jan Kowalski', () => {
        expect(normalizePersonToNominative('dr Janem Kowalskim')).toBe('dr Jan Kowalski');
      });

      it('handles all mobile-e diminutive names in instrumental case', () => {
        expect(normalizePersonToNominative('Markiem')).toBe('Marek');
        expect(normalizePersonToNominative('Radkiem')).toBe('Radek');
        expect(normalizePersonToNominative('Jankiem')).toBe('Janek');
        expect(normalizePersonToNominative('Bartkiem')).toBe('Bartek');
        expect(normalizePersonToNominative('Tomkiem')).toBe('Tomek');
        expect(normalizePersonToNominative('Wojtkiem')).toBe('Wojtek');
        expect(normalizePersonToNominative('Jackiem')).toBe('Jacek');
        expect(normalizePersonToNominative('Pawłem')).toBe('Paweł');
      });

      it('handles base consonant stems in instrumental case', () => {
        expect(normalizePersonToNominative('Adamem')).toBe('Adam');
        expect(normalizePersonToNominative('Krzysztofem')).toBe('Krzysztof');
        expect(normalizePersonToNominative('Marcinem')).toBe('Marcin');
        expect(normalizePersonToNominative('Grzegorzem')).toBe('Grzegorz');
        expect(normalizePersonToNominative('Wojciechem')).toBe('Wojciech');
        expect(normalizePersonToNominative('Kamilem')).toBe('Kamil');
        expect(normalizePersonToNominative('Filipem')).toBe('Filip');
        expect(normalizePersonToNominative('Szymonem')).toBe('Szymon');
        expect(normalizePersonToNominative('Piotrem')).toBe('Piotr');
      });

      it('handles feminine instrumental -ą to -a', () => {
        expect(normalizePersonToNominative('Hanną')).toBe('Hanna');
        expect(normalizePersonToNominative('Katarzyną')).toBe('Katarzyna');
        expect(normalizePersonToNominative('Martą')).toBe('Marta');
        expect(normalizePersonToNominative('Moniką')).toBe('Monika');
        expect(normalizePersonToNominative('Agnieszką')).toBe('Agnieszka');
        expect(normalizePersonToNominative('Kowalską')).toBe('Kowalska');
        expect(normalizePersonToNominative('Nowicką')).toBe('Nowicka');
      });
    });

    describe('Polish genitive and accusative declensions', () => {
      it('converts Jana Kowalskiego to Jan Kowalski', () => {
        expect(normalizePersonToNominative('Jana Kowalskiego')).toBe('Jan Kowalski');
      });

      it('converts Anny Nowak to Anna Nowak', () => {
        expect(normalizePersonToNominative('Anny Nowak')).toBe('Anna Nowak');
      });

      it('converts other masculine genitive names and surnames', () => {
        expect(normalizePersonToNominative('Piotra Nowickiego')).toBe('Piotr Nowicki');
        expect(normalizePersonToNominative('Michała Kamińskiego')).toBe('Michał Kamiński');
        expect(normalizePersonToNominative('Czarnego')).toBe('Czarny');
        expect(normalizePersonToNominative('Franka')).toBe('Franek');
        expect(normalizePersonToNominative('Marka')).toBe('Marek');
        expect(normalizePersonToNominative('Kazika')).toBe('Kazik');
        expect(normalizePersonToNominative('Nowaka')).toBe('Nowak');
      });

      it('converts other feminine genitive names and surnames', () => {
        expect(normalizePersonToNominative('Hanny')).toBe('Hanna');
        expect(normalizePersonToNominative('Katarzyny')).toBe('Katarzyna');
        expect(normalizePersonToNominative('Kowalskiej')).toBe('Kowalska');
        expect(normalizePersonToNominative('Nowickiej')).toBe('Nowicka');
        expect(normalizePersonToNominative('Czarnej')).toBe('Czarna');
      });

      it('handles hyphenated names cleanly', () => {
        expect(normalizePersonToNominative('Nowak-Kowalską')).toBe('Nowak-Kowalska');
        expect(normalizePersonToNominative('jean-luc picard')).toBe('Jean-Luc Picard');
      });

      it('handles masculine words ending in -giem', () => {
        expect(normalizePersonToNominative('Śmigiem')).toBe('Śmig');
      });
    });

    describe('Lowercase names across languages & Title-Casing', () => {
      it('title-cases lowercase names', () => {
        expect(normalizePersonToNominative('john doe')).toBe('John Doe');
        expect(normalizePersonToNominative('hans müller')).toBe('Hans Müller');
        expect(normalizePersonToNominative('pierre dupont')).toBe('Pierre Dupont');
      });

      it('simultaneously lemmatizes and title-cases lowercase Polish names', () => {
        expect(normalizePersonToNominative('frankiem kimono')).toBe('Franek Kimono');
        expect(normalizePersonToNominative('kazikiem bąkiem')).toBe('Kazik Bąk');
        expect(normalizePersonToNominative('dr janem kowalskim')).toBe('dr Jan Kowalski');
      });

      it('preserves honorifics across multiple languages', () => {
        expect(normalizePersonToNominative('prof. michałem wiśniewskim')).toBe('prof. Michał Wiśniewski');
        expect(normalizePersonToNominative('mec. tomaszem kamińskim')).toBe('mec. Tomasz Kamiński');
        expect(normalizePersonToNominative('pan jan kowalski')).toBe('Pan Jan Kowalski');
        expect(normalizePersonToNominative('pani anna nowak')).toBe('Pani Anna Nowak');
        expect(normalizePersonToNominative('herr hans müller')).toBe('Herr Hans Müller');
        expect(normalizePersonToNominative('frau anna schmidt')).toBe('Frau Anna Schmidt');
        expect(normalizePersonToNominative('mr. john doe')).toBe('Mr. John Doe');
      });

      it('strips varied leading prepositions across languages', () => {
        expect(normalizePersonToNominative('spotkanie z janem kowalskim')).toBe('Jan Kowalski');
        expect(normalizePersonToNominative('rozmowa z anną nowak')).toBe('Anna Nowak');
        expect(normalizePersonToNominative('treffen mit hans müller')).toBe('Hans Müller');
        expect(normalizePersonToNominative('meeting with john doe')).toBe('John Doe');
        expect(normalizePersonToNominative('rendez-vous avec pierre dupont')).toBe('Pierre Dupont');
        expect(normalizePersonToNominative('dla kazika bąka')).toBe('Kazik Bąk');
        expect(normalizePersonToNominative('od marka kowalskiego')).toBe('Marek Kowalski');
      });

      it('preserves PII tokens without modification', () => {
        expect(normalizePersonToNominative('[PERSON_1]')).toBe('[PERSON_1]');
        expect(normalizePersonToNominative('[PERSON_99]')).toBe('[PERSON_99]');
      });

      it('handles empty, whitespace, or preposition-only inputs gracefully', () => {
        expect(normalizePersonToNominative('')).toBe('');
        expect(normalizePersonToNominative('   ')).toBe('');
        expect(normalizePersonToNominative('spotkanie z ')).toBe('');
        expect(normalizePersonToNominative('with ')).toBe('');
        expect(normalizePersonToNominative(null as unknown as string)).toBe('');
      });
    });
  });

  describe('normalizeAddressCasing', () => {
    describe('Polish thoroughfares', () => {
      it('capitalizes street names while preserving lowercase prefixes', () => {
        expect(normalizeAddressCasing('ul. marszałkowska 10')).toBe('ul. Marszałkowska 10');
        expect(normalizeAddressCasing('al. jerozolimskie 5')).toBe('al. Jerozolimskie 5');
        expect(normalizeAddressCasing('plac zbawiciela 1')).toBe('plac Zbawiciela 1');
      });
    });

    describe('German compound streets with abbreviations', () => {
      it('capitalizes German street compounds and abbreviations', () => {
        expect(normalizeAddressCasing('hamburgerstr. 123')).toBe('Hamburgerstr. 123');
        expect(normalizeAddressCasing('berlinerstr. 123')).toBe('Berlinerstr. 123');
        expect(normalizeAddressCasing('friedrichstraße 42')).toBe('Friedrichstraße 42');
        expect(normalizeAddressCasing('hauptstr. 5')).toBe('Hauptstr. 5');
      });
    });

    describe('French thoroughfares', () => {
      it('capitalizes French thoroughfares and preserves lowercase particles', () => {
        expect(normalizeAddressCasing('rue de rivoli 15')).toBe('rue de Rivoli 15');
        expect(normalizeAddressCasing('boulevard saint-germain 15')).toBe('boulevard Saint-Germain 15');
      });
    });

    describe('English addresses', () => {
      it('capitalizes English street names and building number letter suffixes', () => {
        expect(normalizeAddressCasing('baker street 221b')).toBe('Baker Street 221B');
        expect(normalizeAddressCasing('10 downing street')).toBe('10 Downing Street');
      });
    });

    describe('Standalone city names', () => {
      it('normalizes standalone inflected city names to nominative canonical casing', () => {
        expect(normalizeAddressCasing('warszawie')).toBe('Warszawa');
        expect(normalizeAddressCasing('krakowie')).toBe('Kraków');
        expect(normalizeAddressCasing('berlin')).toBe('Berlin');
        expect(normalizeAddressCasing('paris')).toBe('Paris');
        expect(normalizeAddressCasing('new york')).toBe('New York');
      });

      it('handles standalone cities with leading prepositions', () => {
        expect(normalizeAddressCasing('w warszawie')).toBe('Warszawa');
        expect(normalizeAddressCasing('in berlin')).toBe('Berlin');
      });
    });

    describe('Edge cases and tokens', () => {
      it('preserves address tokens unmodified', () => {
        expect(normalizeAddressCasing('[ADDRESS_1]')).toBe('[ADDRESS_1]');
      });

      it('normalizes street addresses with trailing cities', () => {
        expect(normalizeAddressCasing('baker street 221b, london')).toBe('Baker Street 221B, London');
      });

      it('handles empty or whitespace strings', () => {
        expect(normalizeAddressCasing('')).toBe('');
        expect(normalizeAddressCasing('   ')).toBe('');
        expect(normalizeAddressCasing(null as unknown as string)).toBe('');
      });
    });
  });
});
