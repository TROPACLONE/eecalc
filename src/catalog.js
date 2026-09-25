/*
 EE Calc — what the player offers. Every stream was checked by hand: HTTPS, answers with audio in a format Safari
 plays (MP3, AAC or HLS), and whether it allows cross-origin access (cors: true → the app's volume control works;
 cors: false → it opens directly at once, with the device buttons for volume). Logos are small
 bundled copies (logos/, 128 px WebP), shown only to identify each station. Never use a numbered server of a
 CDN (e.g. NNNNN.live.streamtheworld.com): they rotate; use the provider's redirect endpoint instead.
 Last checked 2026-09-25: every stream answered with audio, and cors: true only where every hop of the redirect
 chain sends Access-Control-Allow-Origin (also for Origin: null, which browsers send after a cross-origin redirect).
*/
export const COUNTRIES = [['PT', 'Portugal'], ['ES', 'Spain'], ['FR', 'France'], ['DE', 'Germany'], ['GB', 'United Kingdom'],
  ['IT', 'Italy'], ['US', 'United States'], ['BR', 'Brazil'], ['JP', 'Japan']];

const STW = 'https://playerservices.streamtheworld.com/api/livestream-redirect/';

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
    { id: 'dronezone', name: 'Drone Zone', note: 'SomaFM · ambient', logo: 'logos/dronezone.webp', cors: false, url: 'https://ice.somafm.com/dronezone-128-mp3' },
    { id: 'chillhop', name: 'Chillhop', note: 'FluxFM · lofi beats', logo: 'logos/chillhop.webp', cors: false, url: 'https://streams.fluxfm.de/Chillhop/mp3-128/streams.fluxfm.de/' },
    { id: 'lautfm', name: 'Lofi', note: 'laut.fm · lofi hip hop', logo: 'logos/lautfm.webp', cors: false, url: 'https://stream.laut.fm/lofi' },
    { id: 'rpmellow', name: 'Mellow Mix', note: 'Radio Paradise · mellow', logo: 'logos/rpmellow.webp', cors: false, url: 'https://stream.radioparadise.com/mellow-128' },
  ],
  // LibriVox recordings on archive.org (public domain), among the most downloaded
  books: [
    { id: 'pride_and_prejudice_librivox', title: 'Pride and Prejudice', author: 'Jane Austen' },
    { id: 'adventures_holmes', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle' },
    { id: 'art_of_war_librivox', title: 'The Art of War', author: 'Sun Tzu' },
    { id: 'alice_in_wonderland_librivox', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' },
    { id: 'dracula_librivox', title: 'Dracula', author: 'Bram Stoker' },
    { id: 'frankenstein_shelley', title: 'Frankenstein', author: 'Mary Shelley' },
    { id: 'count_monte_cristo_0711_librivox', title: 'The Count of Monte Cristo', author: 'Alexandre Dumas' },
    { id: 'moby_dick_librivox', title: 'Moby Dick', author: 'Herman Melville' },
    { id: 'tale_two_cities_librivox', title: 'A Tale of Two Cities', author: 'Charles Dickens' },
    { id: 'tom_sawyer_librivox', title: 'The Adventures of Tom Sawyer', author: 'Mark Twain' },
    { id: 'huck_finn_librivox', title: 'Adventures of Huckleberry Finn', author: 'Mark Twain' },
    { id: 'treasure_island_ap_librivox', title: 'Treasure Island', author: 'Robert Louis Stevenson' },
    { id: 'peter_pan_0707_librivox', title: 'Peter Pan', author: 'J. M. Barrie' },
    { id: 'secret_garden_librivox', title: 'The Secret Garden', author: 'Frances Hodgson Burnett' },
    { id: 'contos_1802_librivox', title: 'Contos', author: 'Eça de Queirós' },
  ],
};
