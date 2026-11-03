/* Major-city dots and labels for the county maps.
   Cities sit in their own layer with pointer-events:none, so taps and hovers fall through to the county underneath.
   Tier 1 shows at the default zoom; tier 2 appears once you zoom in (or on a district map). Labels keep a constant
   on-screen size at any zoom, and labels that would collide are dropped (bigger cities win). */
(function () {
  const C = {
    GA: [['Atlanta', 33.749, -84.388, 1], ['Savannah', 32.081, -81.091, 1], ['Augusta', 33.471, -81.975, 1], ['Columbus', 32.461, -84.988, 1],
      ['Macon', 32.841, -83.632, 1], ['Athens', 33.951, -83.357, 2], ['Albany', 31.578, -84.156, 1], ['Valdosta', 30.833, -83.280, 2],
      ['Rome', 34.257, -85.165, 2], ['Gainesville', 34.298, -83.824, 2], ['Dalton', 34.770, -84.970, 2], ['Brunswick', 31.150, -81.491, 2]],
    NC: [['Charlotte', 35.227, -80.843, 1], ['Raleigh', 35.780, -78.639, 1], ['Greensboro', 36.073, -79.792, 1], ['Durham', 35.994, -78.899, 2],
      ['Winston-Salem', 36.100, -80.244, 2], ['Fayetteville', 35.053, -78.878, 1], ['Wilmington', 34.226, -77.945, 1], ['Asheville', 35.595, -82.551, 1],
      ['Greenville', 35.613, -77.366, 2], ['Hickory', 35.733, -81.341, 2], ['Boone', 36.217, -81.675, 2], ['Jacksonville', 34.754, -77.430, 2],
      ['Rocky Mount', 35.938, -77.790, 2]],
    OH: [['Columbus', 39.961, -82.999, 1], ['Cleveland', 41.499, -81.694, 1], ['Cincinnati', 39.103, -84.512, 1], ['Toledo', 41.654, -83.537, 1],
      ['Dayton', 39.759, -84.192, 1], ['Akron', 41.081, -81.519, 2], ['Youngstown', 41.100, -80.650, 2], ['Canton', 40.799, -81.378, 2],
      ['Lima', 40.742, -84.105, 2], ['Mansfield', 40.758, -82.515, 2], ['Athens', 39.329, -82.101, 2], ['Zanesville', 39.940, -82.013, 2],
      ['Wooster', 40.805, -81.935, 2], ['Ashland', 40.869, -82.318, 2]],
    MI: [['Detroit', 42.331, -83.046, 1], ['Grand Rapids', 42.963, -85.668, 1], ['Lansing', 42.733, -84.555, 1], ['Flint', 43.013, -83.687, 2],
      ['Ann Arbor', 42.281, -83.743, 2], ['Kalamazoo', 42.292, -85.587, 2], ['Traverse City', 44.763, -85.621, 1], ['Marquette', 46.544, -87.395, 1],
      ['Saginaw', 43.419, -83.951, 2], ['Muskegon', 43.234, -86.248, 2], ['Holland', 42.788, -86.109, 2], ['St. Joseph', 42.110, -86.480, 2],
      ['Battle Creek', 42.321, -85.180, 2], ['Sault Ste. Marie', 46.495, -84.345, 2]],
    TX: [['Houston', 29.760, -95.370, 1], ['Dallas', 32.777, -96.797, 1], ['San Antonio', 29.424, -98.494, 1], ['Austin', 30.267, -97.743, 1],
      ['Fort Worth', 32.755, -97.331, 2], ['El Paso', 31.762, -106.485, 1], ['Corpus Christi', 27.801, -97.396, 1], ['McAllen', 26.203, -98.230, 1],
      ['Lubbock', 33.578, -101.855, 1], ['Amarillo', 35.222, -101.831, 1], ['Laredo', 27.530, -99.480, 1], ['Midland', 31.997, -102.078, 1],
      ['Brownsville', 25.901, -97.497, 2], ['Waco', 31.549, -97.147, 2], ['Abilene', 32.449, -99.733, 2], ['Tyler', 32.351, -95.301, 2],
      ['Beaumont', 30.080, -94.127, 2], ['Odessa', 31.846, -102.368, 2], ['San Angelo', 31.464, -100.437, 2], ['Del Rio', 29.362, -100.897, 2],
      ['Eagle Pass', 28.709, -100.499, 2], ['Victoria', 28.805, -97.004, 2], ['Wichita Falls', 33.914, -98.493, 2], ['College Station', 30.628, -96.334, 2],
      ['Uvalde', 29.209, -99.786, 2], ['Kingsville', 27.516, -97.856, 2], ['Alpine', 30.358, -103.661, 2]],
    IA: [['Des Moines', 41.587, -93.625, 1], ['Cedar Rapids', 41.978, -91.666, 1], ['Davenport', 41.524, -90.578, 1], ['Sioux City', 42.500, -96.400, 1],
      ['Iowa City', 41.661, -91.530, 2], ['Waterloo', 42.493, -92.343, 1], ['Dubuque', 42.501, -90.665, 1], ['Council Bluffs', 41.262, -95.861, 1],
      ['Ames', 42.031, -93.620, 2], ['Mason City', 43.154, -93.201, 2], ['Burlington', 40.808, -91.113, 2], ['Ottumwa', 41.020, -92.411, 2],
      ['Fort Dodge', 42.497, -94.168, 2], ['Clinton', 41.844, -90.188, 2], ['Muscatine', 41.425, -91.043, 2]]
  };

  /* draw(layer, proj, st, opts) → update(k)
     layer: d3 selection inside the zoomed group; opts.svg: the <svg> node; opts.light: light theme;
     opts.within: optional array of GeoJSON features — only cities inside them are shown, all tiers at once (district maps). */
  function draw(layer, proj, st, opts) {
    opts = opts || {};
    const vb = (opts.svg.getAttribute('viewBox') || '0 0 900 640').split(/\s+/).map(Number);
    let list = (C[st] || []).map(([name, lat, lon, tier]) => ({ name, tier, p: proj([lon, lat]) }))
      .filter(c => c.p && c.p[0] >= 0 && c.p[1] >= 0 && c.p[0] <= vb[2] && c.p[1] <= vb[3]);
    if (opts.within) {
      list = list.filter(c => opts.within.some(f => d3.geoContains(f, proj.invert(c.p))));
      list.forEach(c => { c.tier = 1; });
    }
    const ink = opts.light ? '#1b2430' : '#f4f7fa', halo = opts.light ? 'rgba(255,255,255,.92)' : 'rgba(10,14,19,.9)';
    const g = layer.append('g').attr('class', 'cities').attr('pointer-events', 'none').style('pointer-events', 'none');
    const sel = g.selectAll('g').data(list).join('g').attr('class', d => 'city t' + d.tier).style('pointer-events', 'none');
    sel.append('circle').attr('r', 3.2).attr('fill', ink).attr('stroke', halo).attr('stroke-width', 1.4);
    sel.append('text').text(d => d.name).attr('x', 5.5).attr('y', 3.6)
      .attr('fill', ink).attr('stroke', halo).attr('stroke-width', 3).attr('stroke-linejoin', 'round').style('paint-order', 'stroke')
      .style('font', '600 11px system-ui,-apple-system,Segoe UI,sans-serif').style('letter-spacing', '.01em');

    let lastK = 1;
    function update(k) {
      if (k == null) k = lastK; lastK = k;
      // keep dots and labels the same size on screen whatever the zoom or the map's rendered width
      const rect = opts.svg.getBoundingClientRect();
      const px = rect.width ? rect.width / vb[2] : 1;           // screen px per viewBox unit
      const s = 1 / (k * Math.max(px, 0.3));
      const placed = [];
      sel.each(function (d) {
        const show0 = d.tier === 1 || k >= 1.8;
        let show = show0;
        if (show) {
          // collision check in screen space
          const x = d.p[0] * k * px, y = d.p[1] * k * px, w = 9 + d.name.length * 6.4, h = 14;
          const box = [x - 4, y - 8, x + w, y + h - 8];
          if (placed.some(b => !(box[2] < b[0] || box[0] > b[2] || box[3] < b[1] || box[1] > b[3]))) show = false;
          else placed.push(box);
        }
        d3.select(this).attr('transform', `translate(${d.p[0]},${d.p[1]}) scale(${s})`).style('display', show ? null : 'none');
      });
    }
    // bigger cities claim their spot first
    sel.sort((a, b) => a.tier - b.tier);
    update(1);
    if (window.ResizeObserver) {
      if (opts.svg._cityRO) opts.svg._cityRO.disconnect();
      opts.svg._cityRO = new ResizeObserver(() => update());
      opts.svg._cityRO.observe(opts.svg);
    }
    return update;
  }

  window.CTCities = { draw, list: C };
})();
