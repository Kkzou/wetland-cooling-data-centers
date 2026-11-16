// Star: v0.1 keeps stars in the visitor's browser only. v0.2 replaces this with a
// signed-in, server-counted star (see docs/ROADMAP.md).
(function () {
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || '[]'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return []; } }
  document.querySelectorAll('button.star').forEach(function (b) {
    var id = b.getAttribute('data-star'), set = store('wanwu.stars');
    function paint(on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.textContent = on ? '★ Starred' : '☆ Star'; }
    paint(set.indexOf(id) >= 0);
    b.addEventListener('click', function () {
      var s = store('wanwu.stars'), i = s.indexOf(id);
      if (i >= 0) s.splice(i, 1); else s.push(id);
      store('wanwu.stars', s); paint(i < 0);
    });
  });
  document.querySelectorAll('input[data-filter]').forEach(function (inp) {
    var items = document.querySelectorAll(inp.getAttribute('data-filter'));
    inp.addEventListener('input', function () {
      var q = inp.value.trim().toLowerCase();
      items.forEach(function (c) { c.style.display = !q || (c.getAttribute('data-search') || '').indexOf(q) >= 0 ? '' : 'none'; });
    });
  });
})();
