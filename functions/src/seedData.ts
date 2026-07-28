/**
 * Starter aihepankki (luku 6): "ylläpidä vähintään 30 valmiin
 * nostalgiakysymyksen ja 20 historia-aiheen pankkia." This file seeds a
 * first batch; run `npm run seed -w functions` to load it into Firestore,
 * and keep growing it toward the guide's 30/20 targets (luku 13:
 * neljännesvuosittainen ylläpito).
 */
export const NOSTALGIA_BANK: string[] = [
  'Muistatko oman P-päiväsi? Millainen fiilis oli hiustenleikkuun jälkeen?',
  'Ensimmäinen tupailta — mikä siitä on jäänyt parhaiten mieleen?',
  'Mikä oli oma saapumiseräsi ja joukko-osastosi? (ei tarkkoja tietoja, vain fiilis)',
  'Millainen oli oma ryhmänjohtaja tai kouluttaja, jota ei unohda?',
  'Muistatko ensimmäisen jotoksen? Mikä siinä oli yllättävää?',
  'Mikä ruoka jäi armeija-ajalta parhaiten mieleen — hyvässä tai pahassa?',
  'Millainen oli oma sotilasvala? Kuka oli paikalla?',
  'Mikä oli paras hetki loppusodassa?',
  'Kotiutumispäivä — helpotus vai haikeus, kumpi voitti?',
  'Millainen oli oma tupa ja ketä siellä asui?',
  'Mikä varuste jäi elämään lempinimellä?',
  'Muistatko ensimmäisen kertausharjoituksen siviilistä palattuasi?',
  'Mikä oli hankalin harjoitus, jonka muistat yhä hymyillen?',
  'Millainen oli AUK- tai RUK-valinta omalla kohdallasi?',
  'Mitä opit intissä, jota käytät edelleen siviilissä?',
];

export const HISTORY_BANK: string[] = [
  'Talvisodan Taipaleenjoen taistelut — miksi ne olivat niin ratkaisevia?',
  'Mannerheim-linjan rakentaminen: mitä se kertoo sotilaallisesta ennakoinnista?',
  'Suomalaisen jääkäriliikkeen synty 1900-luvun alussa.',
  'Ruotsin ja Suomen puolustusyhteistyön historia 1800-luvulta nykypäivään.',
  'Continuation-sodan Ilomantsin taistelu ja motti-taktiikka.',
  'Pohjoismainen puolustusdoktriinin kehitys kylmän sodan aikana.',
  'Simo Häyhä ja talvisodan tarkka-ampujaperinne.',
  'Suomen ilmatorjunnan kehitys toisesta maailmansodasta nykyaikaan.',
  'Norjan vuoriston sotilashistoria ja pohjoinen puolustusyhteistyö.',
  'Tuntematon sotilas -teoksen vaikutus suomalaiseen sotilaskulttuuriin.',
];
