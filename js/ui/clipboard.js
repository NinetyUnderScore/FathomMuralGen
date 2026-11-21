/* =====================================================================
   Copy text to the clipboard and briefly confirm it on the button.
   ===================================================================== */

(function (MG) {
  'use strict';

  async function copyToClipboard(text, button) {
    const originalLabel = button.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const temp = document.createElement('textarea');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
    }
    button.textContent = 'Copied!';
    setTimeout(() => button.textContent = originalLabel, 1000);
  }

  MG.copyToClipboard = copyToClipboard;

})(window.MG = window.MG || {});
