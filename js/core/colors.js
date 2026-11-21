/* =====================================================================
   Color helpers.

   Colors are stored as 3-digit hex strings ("f80" = #ff8800) because that
   is the shortest form that fits in a Fathom paper. All conversions are
   quantized to the 4-bit-per-channel palette Fathom uses (multiples of 17).
   ===================================================================== */

(function (MG) {
  'use strict';

  function hsvToRgb(h, s, v) {
    const channel = n => {
      const k = (n + h / 60) % 6;
      return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [channel(5), channel(3), channel(1)].map(x => x * 255);
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    let h = 0;
    if (delta) {
      if (max == r)      h = ((g - b) / delta) % 6;
      else if (max == g) h = (b - r) / delta + 2;
      else               h = (r - g) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max ? delta / max : 0, max];
  }

  const snapTo4Bit = x => Math.round(x / 17) * 17;
  const snapRgb = (r, g, b) => [r, g, b].map(snapTo4Bit);

  const pickerToHex3 = (h, s, v) =>
    hsvToRgb(h, s, v).map(x => Math.round(x / 17).toString(16)).join('');

  // Convert "f80" -> "#ff8800". Falls back to black for null/undefined.
  const hex3ToCss = hex3 =>
    hex3 ? '#' + hex3.split('').map(ch => ch + ch).join('') : '#000';

  // Wrap a color in the single quotes used inside the font tag: '#f80'
  const quoteColor = hex3 => "'#" + hex3 + "'";

  const quantizeChannel = v => Math.round(v / 17) * 17;

  const rgbToHex3 = rgb => rgb.map(v => (v / 17).toString(16)).join('');

  MG.hsvToRgb = hsvToRgb;
  MG.rgbToHsv = rgbToHsv;
  MG.snapTo4Bit = snapTo4Bit;
  MG.snapRgb = snapRgb;
  MG.pickerToHex3 = pickerToHex3;
  MG.hex3ToCss = hex3ToCss;
  MG.quoteColor = quoteColor;
  MG.quantizeChannel = quantizeChannel;
  MG.rgbToHex3 = rgbToHex3;

})(window.MG = window.MG || {});
