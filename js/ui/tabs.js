/* =====================================================================
   Top-level tab switching.

   Each nav button declares its page with data-tab="<name>", matching the
   id of the page element ("tab-<name>").
   ===================================================================== */

(function (MG) {
  'use strict';

  function showTab(tabName, button) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    MG.byId('tab-' + tabName).classList.add('active');
    button.classList.add('active');
  }

  function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => showTab(btn.dataset.tab, btn));
    });
  }

  MG.showTab = showTab;
  MG.bindTabs = bindTabs;

})(window.MG = window.MG || {});
