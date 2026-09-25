/*
 EE Calc — what the player offers. Every stream was checked by hand: HTTPS, plays in Safari, and whether it allows
 cross-origin access (cors: true → the app's volume control works; otherwise the device buttons). Logos are small
 bundled copies (logos/, 128 px WebP), shown only to identify each station. Never use a numbered server of a
 CDN (e.g. NNNNN.live.streamtheworld.com): they rotate; use the provider's redirect endpoint instead.
*/
export const COUNTRIES = [['PT', 'Portugal']];

export const CATALOG = globalThis.__EECALC_MEDIA || {
  radio: [
    { id: 'observador', name: 'Observador', cc: 'PT', logo: 'logos/observador.webp',
      url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/OBSERVADORAAC.aac?dist=web-popup&devicename=aac' },
    { id: 'rfm', name: 'RFM', cc: 'PT', logo: 'logos/rfm.webp', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RFMAAC.aac' },
    { id: 'comercial', name: 'Rádio Comercial', cc: 'PT', logo: 'logos/comercial.webp', url: 'https://stream-hls.bauermedia.pt/comercial.aac/playlist.m3u8' },
  ],
  lofi: [],
  books: [],
};
