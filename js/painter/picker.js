/* =====================================================================
   Note Painter: color picker (saturation/value square + hue strip), hex
   input, and the left-click mode buttons.
   ===================================================================== */

(function (MG) {
  'use strict';

  const byId = MG.byId;

  let clickMode = 'color';
  let selectedColor = 'fff';
  let hue = 0, sat = 0, val = 1;

  const svCanvas = byId('sv');
  const svCtx = svCanvas.getContext('2d');
  const hueCanvas = byId('hue');
  const hueCtx = hueCanvas.getContext('2d');

  function drawHueStrip() {
    for (let x = 0; x < 208; x++) {
      const [r, g, b] = MG.snapRgb(...MG.hsvToRgb(x / 208 * 360, 1, 1));
      hueCtx.fillStyle = `rgb(${r},${g},${b})`;
      hueCtx.fillRect(x, 0, 1, 16);
    }
    const markerX = hue / 360 * 208;
    hueCtx.fillStyle = '#fff';
    hueCtx.fillRect(markerX - 2, 0, 4, 16);
    hueCtx.fillStyle = '#000';
    hueCtx.fillRect(markerX - 1, 0, 2, 16);
  }

  function drawSatValSquare() {
    const image = svCtx.createImageData(208, 160);
    const pixels = image.data;
    for (let y = 0; y < 160; y++) {
      for (let x = 0; x < 208; x++) {
        const [r, g, b] = MG.snapRgb(...MG.hsvToRgb(hue, x / 208, 1 - y / 160));
        const i = (y * 208 + x) * 4;
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = 255;
      }
    }
    svCtx.putImageData(image, 0, 0);
    const cx = sat * 208, cy = (1 - val) * 160;
    svCtx.strokeStyle = '#fff'; svCtx.lineWidth = 2;
    svCtx.beginPath(); svCtx.arc(cx, cy, 6, 0, 7); svCtx.stroke();
    svCtx.strokeStyle = '#000'; svCtx.lineWidth = 1;
    svCtx.beginPath(); svCtx.arc(cx, cy, 7.5, 0, 7); svCtx.stroke();
  }

  function syncPicker(fromHexBox) {
    selectedColor = MG.pickerToHex3(hue, sat, val);
    byId('sw').style.background = '#' + selectedColor;
    if (!fromHexBox) byId('hex').value = '#' + selectedColor;
    drawSatValSquare();
    drawHueStrip();
  }

  function onHueDrag(e) {
    const rect = hueCanvas.getBoundingClientRect();
    hue = Math.min(359.99, Math.max(0, (e.clientX - rect.left) / rect.width * 360));
    syncPicker();
  }

  function onSatValDrag(e) {
    const rect = svCanvas.getBoundingClientRect();
    sat = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    val = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    syncPicker();
  }

  function setPickerFromHex3(hex3) {
    const [r, g, b] = hex3.split('').map(ch => parseInt(ch + ch, 16));
    [hue, sat, val] = MG.rgbToHsv(r, g, b);
    syncPicker();
  }

  function setClickMode(newMode) {
    clickMode = newMode;
    byId('mColor').classList.toggle('on', newMode == 'color');
    byId('mClose').classList.toggle('on', newMode == 'close');
  }

  function init() {
    hueCanvas.onpointerdown = e => {
      hueCanvas.setPointerCapture(e.pointerId);
      onHueDrag(e);
      hueCanvas.onpointermove = onHueDrag;
    };
    hueCanvas.onpointerup = () => hueCanvas.onpointermove = null;

    svCanvas.onpointerdown = e => {
      svCanvas.setPointerCapture(e.pointerId);
      onSatValDrag(e);
      svCanvas.onpointermove = onSatValDrag;
    };
    svCanvas.onpointerup = () => svCanvas.onpointermove = null;

    byId('hex').oninput = e => {
      const typed = e.target.value.replace('#', '');
      if (/^[0-9a-f]{3}$/i.test(typed)) {
        setPickerFromHex3(typed.toLowerCase());
        byId('hex').value = e.target.value;
      }
    };
    byId('hex').onblur = () => byId('hex').value = '#' + selectedColor;

    byId('mColor').onclick = () => setClickMode('color');
    byId('mClose').onclick = () => setClickMode('close');

    syncPicker();
  }

  MG.picker = {
    init,
    getSelectedColor: () => selectedColor,
    getClickMode: () => clickMode,
    setFromHex3: setPickerFromHex3,
  };

})(window.MG = window.MG || {});
