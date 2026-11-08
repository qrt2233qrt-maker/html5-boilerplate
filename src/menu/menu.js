// Draws a menu page from the MENU object defined in each HTML file.
// You should not need to edit this file to change items or prices.
/* global MENU */
(function () {
  const fmt = (n) =>
    n == null || n === '' ? '—' : Number(n).toLocaleString('en-US');
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );

  function priceCell(it) {
    if (it.prices) {
      return it.prices
        .map((p) => '<span class="price">' + fmt(p) + '</span>')
        .join('');
    }
    return '<span class="price">' + fmt(it.price) + '</span>';
  }

  function item(it, sec, i) {
    if (it.heading) return '<h3 class="subhead">' + esc(it.heading) + '</h3>';
    const sizes = MENU.sizes || ['وسط', 'كبير'];
    const num = sec.numbered ? '<span class="num">' + (i + 1) + '</span>' : '';
    const star = it.star ? '<span class="star">★</span>' : '';
    const latin = it.latin
      ? '<span class="latin">' + esc(it.latin) + '</span>'
      : '';
    const note = it.note ? '<p class="note">' + esc(it.note) + '</p>' : '';
    const img = it.image
      ? '<img class="photo" src="' + esc(it.image) + '" alt="">'
      : '';
    const sized = it.medium != null || it.large != null;
    const sizeLine = sized
      ? '<div class="sizes"><span><small>' +
        esc(sizes[0]) +
        '</small> <b>' +
        fmt(it.medium) +
        '</b></span>' +
        '<span><small>' +
        esc(sizes[1]) +
        '</small> <b>' +
        fmt(it.large) +
        '</b></span></div>'
      : '';
    const body =
      '<div class="row">' +
      num +
      '<span class="name">' +
      star +
      esc(it.name) +
      '</span>' +
      (sized ? '' : '<span class="dots"></span>' + priceCell(it)) +
      '</div>' +
      latin +
      note +
      sizeLine;
    return (
      '<div class="item' +
      (img ? ' has-photo' : '') +
      '">' +
      (img ? img + '<div class="item-body">' + body + '</div>' : body) +
      '</div>'
    );
  }

  function section(sec) {
    let n = 0;
    const head = sec.priceHeaders
      ? '<div class="row price-head"><span class="name"></span><span class="dots none"></span>' +
        sec.priceHeaders
          .map((h) => '<span class="price">' + esc(h) + '</span>')
          .join('') +
        '</div>'
      : '';
    return (
      '<div class="sec"><h2>' +
      esc(sec.title) +
      ' <small>' +
      esc(sec.latin || '') +
      '</small></h2>' +
      head +
      sec.items.map((it) => item(it, sec, it.heading ? n : n++)).join('') +
      '</div>'
    );
  }

  const $ = (id) => document.getElementById(id);
  $('title').textContent = MENU.title;
  $('subtitle').textContent = MENU.subtitle;
  $('phone').textContent = MENU.phone;
  $('address').textContent = MENU.address;
  $('currency').textContent = MENU.note || 'الأسعار بالدينار العراقي';
  const cols = $('cols');
  if (MENU.columnWidths) cols.style.setProperty('--cols', MENU.columnWidths);
  cols.innerHTML = MENU.columns
    .map((col) => '<div class="col">' + col.map(section).join('') + '</div>')
    .join('');
})();
