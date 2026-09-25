/*
 EE Calc — what the player offers. Every stream was checked by hand: HTTPS, answers with audio in a format Safari
 plays (MP3, AAC or HLS), and whether it allows cross-origin access (cors: true → the app's volume control works;
 cors: false → it opens directly at once, with the device buttons for volume). Logos are small
 bundled copies (logos/, 128 px WebP), shown only to identify each station. Never use a numbered server of a
 CDN (e.g. NNNNN.live.streamtheworld.com): they rotate; use the provider's redirect endpoint instead.
 Last checked 2026-09-25: every stream answered with audio, and cors: true only where every hop of the redirect
 chain sends Access-Control-Allow-Origin (also for Origin: null, which browsers send after a cross-origin redirect).
 HLS streams (.m3u8) play directly whatever cors says: WebKit can't route HLS through Web Audio.
*/
export const COUNTRIES = [['PT', 'Portugal'], ['ES', 'Spain'], ['FR', 'France'], ['DE', 'Germany'], ['GB', 'United Kingdom'],
  ['IT', 'Italy'], ['US', 'United States'], ['BR', 'Brazil'], ['JP', 'Japan']];

const STW = 'https://playerservices.streamtheworld.com/api/livestream-redirect/';
/** Audiobook categories: [key, chip label, heading]. */
export const BOOK_GROUPS = [['classics', 'Classics', 'Classics'], ['adventure', 'Adventure', 'Adventure, mystery and science fiction'],
  ['science', 'Science', 'Science and engineering'], ['philosophy', 'Philosophy', 'Philosophy and strategy'], ['pt', 'Português', 'Em português']];

export const CATALOG = globalThis.__EECALC_MEDIA || {
  radio: [
    { id: 'observador', name: 'Observador', cc: 'PT', logo: 'logos/observador.webp', cors: true, url: `${STW}OBSERVADORAAC.aac?dist=web-popup&devicename=aac` },
    { id: 'rfm', name: 'RFM', cc: 'PT', logo: 'logos/rfm.webp', cors: true, url: `${STW}RFMAAC.aac` },
    { id: 'comercial', name: 'Rádio Comercial', cc: 'PT', logo: 'logos/comercial.webp', cors: true, url: 'https://stream-hls.bauermedia.pt/comercial.aac/playlist.m3u8' },

    { id: 'ser', name: 'Cadena SER', cc: 'ES', logo: 'logos/ser.webp', cors: true, url: `${STW}CADENASERAAC.aac` },
    { id: 'los40', name: 'LOS40', cc: 'ES', logo: 'logos/los40.webp', cors: true, url: `${STW}LOS40AAC.aac` },
    { id: 'dial', name: 'Cadena Dial', cc: 'ES', logo: 'logos/dial.webp', cors: true, url: `${STW}CADENADIAL.mp3` },

    { id: 'franceinter', name: 'France Inter', cc: 'FR', logo: 'logos/franceinter.webp', cors: true, url: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3' },
    { id: 'fip', name: 'FIP', cc: 'FR', logo: 'logos/fip.webp', cors: true, url: 'https://icecast.radiofrance.fr/fip-midfi.mp3' },
    { id: 'franceculture', name: 'France Culture', cc: 'FR', logo: 'logos/franceculture.webp', cors: true, url: 'https://icecast.radiofrance.fr/franceculture-midfi.mp3' },

    { id: 'antenne', name: 'Antenne Bayern', cc: 'DE', logo: 'logos/antenne.webp', cors: true, url: 'https://stream.antenne.de/antenne/stream/mp3' },
    { id: 'bayern3', name: 'Bayern 3', cc: 'DE', logo: 'logos/bayern3.webp', cors: false, url: 'https://dispatcher.rndfnk.com/br/br3/live/mp3/mid' },
    { id: '1live', name: '1LIVE', cc: 'DE', logo: 'logos/1live.webp', cors: false, url: 'https://wdr-1live-live.icecastssl.wdr.de/wdr/1live/live/mp3/128/stream.mp3' },

    { id: 'bbcws', name: 'BBC World Service', cc: 'GB', logo: 'logos/bbcws.webp', cors: false, url: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service' },
    { id: 'classicfm', name: 'Classic FM', cc: 'GB', logo: 'logos/classicfm.webp', cors: true, url: 'https://media-ice.musicradio.com/ClassicFMMP3' },
    { id: 'capital', name: 'Capital', cc: 'GB', logo: 'logos/capital.webp', cors: true, url: 'https://media-ice.musicradio.com/CapitalMP3' },

    { id: 'rai1', name: 'Rai Radio 1', cc: 'IT', logo: 'logos/rai1.webp', cors: false, url: 'https://icestreaming.rai.it/1.mp3' },
    { id: 'rtl1025', name: 'RTL 102.5', cc: 'IT', logo: 'logos/rtl1025.webp', cors: false, url: 'https://streamingv2.shoutcast.com/rtl-1025' },
    { id: 'radio105', name: 'Radio 105', cc: 'IT', logo: 'logos/radio105.webp', cors: false, url: 'https://icy.unitedradio.it/Radio105.mp3' },

    { id: 'npr', name: 'NPR', cc: 'US', logo: 'logos/npr.webp', cors: false, url: 'https://npr-ice.streamguys1.com/live.mp3' },
    { id: 'wnyc', name: 'WNYC', cc: 'US', logo: 'logos/wnyc.webp', cors: false, url: 'https://fm939.wnyc.org/wnycfm' },
    { id: 'kexp', name: 'KEXP', cc: 'US', logo: 'logos/kexp.webp', cors: false, url: 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3' },

    { id: 'cbn', name: 'CBN', cc: 'BR', logo: 'logos/cbn.webp', cors: true, url: `${STW}CBN_SPAAC.aac` },
    { id: 'globo', name: 'Rádio Globo', cc: 'BR', logo: 'logos/globo.webp', cors: true, url: `${STW}RADIO_GLOBO_RJAAC.aac` },
    { id: 'bandnews', name: 'BandNews FM', cc: 'BR', logo: 'logos/bandnews.webp', cors: true, url: `${STW}BANDNEWSFM_SPAAC.aac` },

    { id: 'nhkworld', name: 'NHK World Radio Japan', cc: 'JP', logo: 'logos/nhkworld.webp', cors: true, url: 'https://masterpl.hls.nhkworld.jp/hls/r1/live/master.m3u8' },
    { id: 'shonan', name: 'Shonan Beach FM', cc: 'JP', logo: 'logos/shonan.webp', cors: false, url: 'https://shonanbeachfm.out.airtime.pro/shonanbeachfm_a' },
    { id: 'ottava', name: 'OTTAVA', cc: 'JP', logo: 'logos/ottava.webp', cors: false, url: 'https://ottava2.out.airtime.pro/ottava2_a' },
  ],
  lofi: [
    { id: 'groovesalad', name: 'Groove Salad', note: 'SomaFM · ambient downtempo', logo: 'logos/groovesalad.webp', cors: false, url: 'https://ice.somafm.com/groovesalad-128-mp3' },
    { id: 'fluid', name: 'Fluid', note: 'SomaFM · instrumental hip hop', logo: 'logos/fluid.webp', cors: false, url: 'https://ice.somafm.com/fluid-128-mp3' },
    { id: 'chillhop', name: 'Chillhop', note: 'FluxFM · lofi beats', logo: 'logos/chillhop.webp', cors: true, url: 'https://streams.fluxfm.de/Chillhop/mp3-128/streams.fluxfm.de/' },
    { id: 'ilovechillhop', name: 'I Love Chillhop', note: 'ILoveRadio · chillhop', logo: 'logos/ilovechillhop.webp', cors: true, url: 'https://streams.ilovemusic.de/iloveradio17.mp3' },
    { id: 'lautfm', name: 'Lofi', note: 'laut.fm · lofi hip hop', logo: 'logos/lautfm.webp', cors: false, url: 'https://stream.laut.fm/lofi' },
    { id: 'rmstudy', name: 'Study', note: 'RauteMusik · study beats', logo: 'logos/rmstudy.webp', cors: false, url: 'https://study-high.rautemusik.fm/' },
    { id: 'fluxchillout', name: 'Chillout', note: 'FluxFM · chillout', logo: 'logos/fluxchillout.webp', cors: true, url: 'https://streams.fluxfm.de/chillout/mp3-128/streams.fluxfm.de/' },
    { id: 'smoothchill', name: 'Smooth Chill', note: 'Smooth · chillout', logo: 'logos/smoothchill.webp', cors: true, url: 'https://media-ssl.musicradio.com/ChillMP3' },
    { id: 'rpmellow', name: 'Mellow Mix', note: 'Radio Paradise · mellow', logo: 'logos/rpmellow.webp', cors: false, url: 'https://stream.radioparadise.com/mellow-128' },
    { id: 'chillsynth', name: 'Chillsynth', note: 'Nightride FM · chill synthwave', logo: 'logos/chillsynth.webp', cors: true, url: 'https://stream.nightride.fm/chillsynth.mp3' },
    { id: 'plaza', name: 'Nightwave Plaza', note: 'Vaporwave', logo: 'logos/plaza.webp', cors: true, url: 'https://radio.plaza.one/mp3' },
    { id: 'deepspaceone', name: 'Deep Space One', note: 'SomaFM · deep ambient', logo: 'logos/deepspaceone.webp', cors: false, url: 'https://ice.somafm.com/deepspaceone-128-mp3' },
    { id: 'spacestation', name: 'Space Station Soma', note: 'SomaFM · ambient electronica', logo: 'logos/spacestation.webp', cors: false, url: 'https://ice.somafm.com/spacestation-128-mp3' },
    { id: 'dronezone', name: 'Drone Zone', note: 'SomaFM · ambient', logo: 'logos/dronezone.webp', cors: false, url: 'https://ice.somafm.com/dronezone-128-mp3' },
  ],
  // LibriVox recordings on archive.org (public domain), each checked: chapters in order with their lengths, and the
  // first MP3 answering with Access-Control-Allow-Origin: *. g: the category (BOOK_GROUPS).
  books: [
    { g: 'classics', id: 'pride_and_prejudice_librivox', title: 'Pride and Prejudice', author: 'Jane Austen' },
    { g: 'classics', id: 'great_expectations_mfs_0812_librivox', title: 'Great Expectations', author: 'Charles Dickens' },
    { g: 'classics', id: 'tale_two_cities_librivox', title: 'A Tale of Two Cities', author: 'Charles Dickens' },
    { g: 'classics', id: 'crime_and_punishment_0902_librivox', title: 'Crime and Punishment', author: 'Fyodor Dostoyevsky' },
    { g: 'classics', id: 'count_monte_cristo_0711_librivox', title: 'The Count of Monte Cristo', author: 'Alexandre Dumas' },
    { g: 'classics', id: 'moby_dick_librivox', title: 'Moby Dick', author: 'Herman Melville' },
    { g: 'classics', id: 'little_women_0711_librivox', title: 'Little Women', author: 'Louisa May Alcott' },
    { g: 'classics', id: 'dorian_gray_librivox', title: 'The Picture of Dorian Gray', author: 'Oscar Wilde' },
    { g: 'classics', id: 'metamorphosis_librivox', title: 'The Metamorphosis', author: 'Franz Kafka' },
    { g: 'classics', id: 'tom_sawyer_librivox', title: 'The Adventures of Tom Sawyer', author: 'Mark Twain' },
    { g: 'classics', id: 'huck_finn_librivox', title: 'Adventures of Huckleberry Finn', author: 'Mark Twain' },
    { g: 'classics', id: 'alice_in_wonderland_librivox', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' },
    { g: 'classics', id: 'peter_pan_0707_librivox', title: 'Peter Pan', author: 'J. M. Barrie' },
    { g: 'classics', id: 'secret_garden_librivox', title: 'The Secret Garden', author: 'Frances Hodgson Burnett' },
    { g: 'classics', id: 'jungle_book_mh_0808_librivox', title: 'The Jungle Book', author: 'Rudyard Kipling' },

    { g: 'adventure', id: 'adventures_holmes', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle' },
    { g: 'adventure', id: 'hound_baskervilles_librivox', title: 'The Hound of the Baskervilles', author: 'Arthur Conan Doyle' },
    { g: 'adventure', id: 'dracula_librivox', title: 'Dracula', author: 'Bram Stoker' },
    { g: 'adventure', id: 'frankenstein_shelley', title: 'Frankenstein', author: 'Mary Shelley' },
    { g: 'adventure', id: 'jekyll_and_hyde_librivox', title: 'The Strange Case of Dr Jekyll and Mr Hyde', author: 'Robert Louis Stevenson' },
    { g: 'adventure', id: 'treasure_island_ap_librivox', title: 'Treasure Island', author: 'Robert Louis Stevenson' },
    { g: 'adventure', id: '20000_leagues_under_the_seas_librivox', title: 'Twenty Thousand Leagues Under the Sea', author: 'Jules Verne' },
    { g: 'adventure', id: 'around_the_world_in_eighty_days_0908_librivox', title: 'Around the World in Eighty Days', author: 'Jules Verne' },
    { g: 'adventure', id: 'journey_centre_earth_1108_librivox', title: 'Journey to the Centre of the Earth', author: 'Jules Verne' },
    { g: 'adventure', id: 'war_worlds_solo_librivox', title: 'The War of the Worlds', author: 'H. G. Wells' },
    { g: 'adventure', id: 'time_machine_0805_librivox', title: 'The Time Machine', author: 'H. G. Wells' },
    { g: 'adventure', id: 'call_of_the_wild', title: 'The Call of the Wild', author: 'Jack London' },

    { g: 'science', id: 'my_inventions_1812_librivox', title: 'My Inventions and Other Works', author: 'Nikola Tesla' },
    { g: 'science', id: 'relativity_librivox', title: 'Relativity: The Special and General Theory', author: 'Albert Einstein' },
    { g: 'science', id: 'chemical_history_candle_ava_librivox', title: 'The Chemical History of a Candle', author: 'Michael Faraday' },
    { g: 'science', id: 'on_the_various_forces_of_nature_2108_librivox', title: 'On the Various Forces of Nature', author: 'Michael Faraday' },
    { g: 'science', id: 'story_electricity_rg_librivox', title: 'The Story of Electricity', author: 'John Munro' },
    { g: 'science', id: 'romance_modern_electricity_2208_librivox', title: 'The Romance of Modern Electricity', author: 'Charles R. Gibson' },
    { g: 'science', id: 'science_and_hypothesis_librivox', title: 'Science and Hypothesis', author: 'Henri Poincaré' },
    { g: 'science', id: 'origin_species_librivox', title: 'On the Origin of Species', author: 'Charles Darwin' },
    { g: 'science', id: 'franklin_autobio_gg_librivox', title: 'The Autobiography of Benjamin Franklin', author: 'Benjamin Franklin' },
    { g: 'science', id: 'flatland_rg_librivox', title: 'Flatland: A Romance of Many Dimensions', author: 'Edwin A. Abbott' },

    { g: 'philosophy', id: 'art_of_war_librivox', title: 'The Art of War', author: 'Sun Tzu' },
    { g: 'philosophy', id: 'meditations_0708_librivox', title: 'Meditations', author: 'Marcus Aurelius' },
    { g: 'philosophy', id: 'of_the_shortness_of_life_1102_librivox', title: 'Of the Shortness of Life', author: 'Seneca' },
    { g: 'philosophy', id: 'prince_librivox', title: 'The Prince', author: 'Niccolò Machiavelli' },
    { g: 'philosophy', id: 'platos_republic_0902_librivox1', title: 'The Republic', author: 'Plato' },
    { g: 'philosophy', id: 'walden_librivox', title: 'Walden', author: 'Henry David Thoreau' },
    { g: 'philosophy', id: 'wealth_nations01_se', title: 'The Wealth of Nations, Book 1', author: 'Adam Smith' },

    { g: 'pt', id: 'os_lusiadas_0908_librivox', title: 'Os Lusíadas', author: 'Luís Vaz de Camões' },
    { g: 'pt', id: 'sonetos_camoes_amor_0910_librivox', title: 'Sonetos: Poemas de Amor', author: 'Luís Vaz de Camões' },
    { g: 'pt', id: 'amor_de_perdicao_1408_librivox', title: 'Amor de Perdição', author: 'Camilo Castelo Branco' },
    { g: 'pt', id: 'contos_1802_librivox', title: 'Contos', author: 'Eça de Queirós' },
    { g: 'pt', id: 'contos_phantasticos_1904_librivox', title: 'Contos Phantasticos', author: 'Teófilo Braga' },
    { g: 'pt', id: 'dom_casmurro_2102_librivox', title: 'Dom Casmurro', author: 'Machado de Assis' },
    { g: 'pt', id: 'memoriaspostumas_debrascubas_1912_librivox', title: 'Memórias Póstumas de Brás Cubas', author: 'Machado de Assis' },
    { g: 'pt', id: 'o_alienista_0904_librivox', title: 'O Alienista', author: 'Machado de Assis' },
  ],
};
