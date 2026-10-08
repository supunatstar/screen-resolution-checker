(() => {
  'use strict';

  // Zoom presets used by Chrome/Edge, Firefox and Safari, merged for snapping.
  const ZOOM_LEVELS = [25, 30, 33, 50, 63, 67, 75, 80, 85, 90, 100, 110, 115, 120, 125, 133, 150, 170, 175, 200, 240, 250, 300, 400, 500];
  const OS_SCALES = [100, 125, 150, 175, 200, 225, 250, 300, 350, 400];
  const REFRESH_RATES = [24, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 300, 360, 480, 500];
  const ASPECTS = [
    ['16:9', 16 / 9], ['16:10', 16 / 10], ['21:9', 2.37], ['32:9', 32 / 9], ['4:3', 4 / 3],
    ['5:4', 5 / 4], ['3:2', 3 / 2], ['1:1', 1], ['18:9', 2], ['19.5:9', 19.5 / 9], ['20:9', 20 / 9],
  ];

  const $ = (id) => document.getElementById(id);
  const mq = (q) => window.matchMedia(q).matches;

  const state = {
    initialDpr: window.devicePixelRatio || 1,
    refreshHz: null,
    refreshMeasurement: null,
    uaHigh: null,
    screenDetails: null,
    monitorPermission: null,
    previous: new Map(),
  };

  // ---------- helpers ----------

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, digits = 0) => (Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : '—');
  const dims = (w, h) => `${fmt(w)} × ${fmt(h)}`;
  const yesNo = (b) => (b ? 'Yes' : 'No');

  function nearest(value, list) {
    return list.reduce((best, x) => (Math.abs(x - value) < Math.abs(best - value) ? x : best), list[0]);
  }

  function snap(value, list, tolerance) {
    const n = nearest(value, list);
    return Math.abs(n - value) / n <= tolerance ? n : Math.round(value);
  }

  function aspectRatio(w, h) {
    if (!w || !h) return '—';
    const portrait = h > w;
    const r = portrait ? h / w : w / h;
    const match = ASPECTS.find(([, v]) => Math.abs(v - r) / v < 0.02);
    if (match) return portrait ? match[0].split(':').reverse().join(':') : match[0];
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    const g = gcd(Math.round(w), Math.round(h));
    return `${Math.round(w) / g}:${Math.round(h) / g}`;
  }

  // ---------- browser / OS ----------

  function detectBrowser() {
    const ua = navigator.userAgent;
    const pick = (re) => (ua.match(re) || [])[1] || '';
    if (/FxiOS/.test(ua)) return { name: 'Firefox (iOS)', version: pick(/FxiOS\/([\d.]+)/), engine: 'webkit' };
    if (/Firefox\//.test(ua)) return { name: 'Firefox', version: pick(/Firefox\/([\d.]+)/), engine: 'gecko' };
    if (/EdgiOS/.test(ua)) return { name: 'Edge (iOS)', version: pick(/EdgiOS\/([\d.]+)/), engine: 'webkit' };
    if (/CriOS/.test(ua)) return { name: 'Chrome (iOS)', version: pick(/CriOS\/([\d.]+)/), engine: 'webkit' };
    if (/Edg\//.test(ua)) return { name: 'Microsoft Edge', version: pick(/Edg\/([\d.]+)/), engine: 'blink' };
    if (/OPR\//.test(ua)) return { name: 'Opera', version: pick(/OPR\/([\d.]+)/), engine: 'blink' };
    if (/SamsungBrowser\//.test(ua)) return { name: 'Samsung Internet', version: pick(/SamsungBrowser\/([\d.]+)/), engine: 'blink' };
    if (/Chrome\//.test(ua)) {
      return { name: navigator.brave ? 'Brave' : 'Google Chrome', version: pick(/Chrome\/([\d.]+)/), engine: 'blink' };
    }
    if (/Safari\//.test(ua)) return { name: 'Safari', version: pick(/Version\/([\d.]+)/), engine: 'webkit' };
    return { name: 'Unknown', version: '', engine: 'unknown' };
  }

  function detectOS() {
    const ua = navigator.userAgent;
    const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    const hi = state.uaHigh;
    if (/Win/i.test(platform) || /Windows/.test(ua)) {
      if (hi && hi.platformVersion) {
        const major = parseInt(hi.platformVersion, 10);
        if (major >= 13) return 'Windows 11';
        if (major > 0) return 'Windows 10';
      }
      return 'Windows';
    }
    if (/Android/.test(ua)) return `Android ${(ua.match(/Android ([\d.]+)/) || [])[1] || ''}`.trim();
    if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1)) return 'iOS / iPadOS';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Mac/i.test(platform)) return hi && hi.platformVersion ? `macOS ${hi.platformVersion}` : 'macOS';
    if (/Linux/i.test(platform)) return 'Linux';
    return platform || 'Unknown';
  }

  async function loadUaDetails() {
    const uaData = navigator.userAgentData;
    if (!uaData || !uaData.getHighEntropyValues) return;
    try {
      // Only what's needed to name the OS and browser version; no device model or hardware details.
      state.uaHigh = await uaData.getHighEntropyValues(['platformVersion', 'fullVersionList']);
      render();
    } catch (e) { /* not available */ }
  }

  // ---------- zoom & scaling ----------

  // Browsers don't expose zoom directly, so it is inferred:
  //  - Chromium/Safari: outerWidth is in screen pixels while innerWidth is in zoomed CSS pixels.
  //  - Firefox: both are zoomed, so devicePixelRatio is split into (OS scaling × zoom).
  function estimateZoom(browser, dpr) {
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));

    if (isMobile) {
      return { zoom: null, method: 'Browser zoom is not detectable on mobile devices.' };
    }

    if (browser.engine === 'gecko') {
      const d = dpr * 100;
      const direct = OS_SCALES.find((s) => Math.abs(s - d) / s < 0.01);
      if (direct) {
        return { zoom: 100, os: direct, estimated: true, method: 'Estimated (Firefox): devicePixelRatio matches a standard display scaling, so zoom is most likely 100%.' };
      }
      let best = null;
      for (const os of OS_SCALES) {
        const z = (d / os) * 100;
        const zs = nearest(z, ZOOM_LEVELS);
        if (Math.abs(zs - z) / zs < 0.015 && (!best || Math.abs(zs - 100) < Math.abs(best.zoom - 100))) best = { zoom: zs, os };
      }
      if (best) {
        return { ...best, estimated: true, method: `Estimated (Firefox): devicePixelRatio ${fmt(dpr, 3)} ≈ ${best.os}% scaling × ${best.zoom}% zoom.` };
      }
      return { zoom: null, os: Math.round(d), method: 'Firefox does not expose enough information to separate zoom from display scaling.' };
    }

    const outer = window.outerWidth;
    const inner = window.innerWidth;
    if (!outer || !inner) return { zoom: null, method: 'Window size unavailable.' };
    const raw = (outer / inner) * 100;
    // outerWidth also includes the window frame (0–32 screen px), so find the zoom preset
    // that leaves a plausible frame width rather than snapping the raw ratio.
    const candidates = ZOOM_LEVELS
      .map((z) => ({ zoom: z, frame: outer - (inner * z) / 100 }))
      .filter((c) => c.frame >= -2 && c.frame <= 32);
    let zoom;
    if (candidates.some((c) => c.zoom === 100)) zoom = 100;
    else if (candidates.length) zoom = candidates.reduce((a, b) => (Math.abs(b.frame - 12) < Math.abs(a.frame - 12) ? b : a)).zoom;
    else zoom = snap(raw, ZOOM_LEVELS, 0.03);
    return {
      zoom,
      raw,
      method: `Window width ${fmt(outer)} px ÷ viewport width ${fmt(inner)} px (allowing for the window frame). Docked DevTools or side panels can skew this.`,
    };
  }

  function computeDisplay(browser) {
    const dpr = window.devicePixelRatio || 1;
    const z = estimateZoom(browser, dpr);
    const sw = screen.width;
    const sh = screen.height;
    let os;
    let physW;
    let physH;

    if (browser.engine === 'blink' && z.zoom) {
      // Chromium: screen.* is in device-independent pixels, unaffected by page zoom.
      os = snap((dpr * 100) / (z.zoom / 100), OS_SCALES, 0.02);
      physW = sw * (os / 100);
      physH = sh * (os / 100);
    } else if (browser.engine === 'gecko') {
      // Firefox: screen.* is in zoomed CSS pixels, so multiplying by DPR gives device pixels.
      os = z.os || Math.round(dpr * 100);
      physW = sw * dpr;
      physH = sh * dpr;
    } else {
      // Safari / mobile: devicePixelRatio does not change with zoom.
      os = Math.round(dpr * 100);
      physW = sw * dpr;
      physH = sh * dpr;
    }

    return { dpr, zoom: z, os, physW: Math.round(physW), physH: Math.round(physH), sw, sh };
  }

  // ---------- refresh rate ----------

  function measureRefreshRate(frames = 90) {
    return new Promise((resolve) => {
      const times = [];
      const tick = (t) => {
        times.push(t);
        if (times.length < frames) requestAnimationFrame(tick);
        else {
          const deltas = times.slice(1).map((t2, i) => t2 - times[i]).sort((a, b) => a - b);
          const median = deltas[Math.floor(deltas.length / 2)];
          resolve(median > 0 ? 1000 / median : null);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  function updateRefreshRate() {
    if (state.refreshMeasurement) return state.refreshMeasurement;
    if (document.hidden) return Promise.resolve();
    state.refreshMeasurement = measureRefreshRate().then((hz) => {
      state.refreshHz = hz ? snap(hz, REFRESH_RATES, 0.04) : null;
      state.refreshMeasurement = null;
    });
    return state.refreshMeasurement;
  }

  // ---------- monitors ----------

  // Exact details need the Window Management API (Chrome/Edge) and the user's permission.
  // Only already-granted permission is used automatically; otherwise the user clicks "Identify all monitors".
  async function initMonitors() {
    if (!('getScreenDetails' in window) || !navigator.permissions) return;
    for (const name of ['window-management', 'window-placement']) {
      try {
        const status = await navigator.permissions.query({ name });
        state.monitorPermission = status.state;
        status.addEventListener('change', () => { state.monitorPermission = status.state; render(); });
        break;
      } catch (e) { /* permission name not recognised by this browser version */ }
    }
    if (state.monitorPermission === 'granted') await loadScreenDetails();
    else render();
  }

  async function loadScreenDetails() {
    try {
      const details = await window.getScreenDetails();
      state.screenDetails = details;
      state.monitorPermission = 'granted';
      details.addEventListener('screenschange', render);
      details.addEventListener('currentscreenchange', () => { render(); updateRefreshRate(); });
    } catch (e) {
      state.monitorPermission = 'denied';
    }
    render();
  }

  function placement(vertical, horizontal) {
    const where = [vertical, horizontal].filter(Boolean).join(' and ');
    return where ? `Secondary, ${where} the primary monitor` : 'Secondary monitor';
  }

  function monitorInfo() {
    const details = state.screenDetails;
    if (details && details.screens.length) {
      const current = details.currentScreen;
      const isCurrent = (s) => s === current || (current && s.left === current.left && s.top === current.top && s.width === current.width && s.height === current.height);
      // Numbered left to right (then top to bottom), matching the arrangement in the OS display settings.
      const list = [...details.screens]
        .sort((a, b) => a.left - b.left || a.top - b.top)
        .map((s, i) => ({
          number: i + 1,
          width: Math.round(s.width * s.devicePixelRatio),
          height: Math.round(s.height * s.devicePixelRatio),
          scaling: Math.round(s.devicePixelRatio * 100),
          left: s.left,
          top: s.top,
          logicalW: s.width,
          logicalH: s.height,
          primary: s.isPrimary,
          internal: s.isInternal,
          current: isCurrent(s),
        }));
      const cur = list.find((m) => m.current) || list[0];
      const p = list.find((m) => m.primary) || list[0];
      const slack = 8;
      let where = 'Primary monitor';
      if (!cur.primary) {
        const v = cur.top + cur.logicalH <= p.top + slack ? 'above' : cur.top >= p.top + p.logicalH - slack ? 'below' : '';
        const h = cur.left + cur.logicalW <= p.left + slack ? 'to the left of' : cur.left >= p.left + p.logicalW - slack ? 'to the right of' : '';
        where = placement(v, h);
      }
      return { multiple: list.length > 1, exact: true, count: list.length, current: cur, primary: cur.primary, placement: where, list };
    }

    // Estimate: the primary monitor sits at the desktop origin (0, 0), so the current screen's
    // work-area origin shows whether this is a secondary monitor and roughly where it is.
    const x = screen.availLeft;
    const y = screen.availTop;
    let multiple = 'isExtended' in screen ? screen.isExtended : null;
    if (typeof x !== 'number' || typeof y !== 'number') return { multiple, exact: false };
    const taskbarX = screen.width - screen.availWidth;
    const taskbarY = screen.height - screen.availHeight;
    const primary = x >= 0 && x <= taskbarX && y >= 0 && y <= taskbarY;
    if (!primary) multiple = true;
    let where = 'Primary monitor';
    if (!primary) {
      const h = x < 0 ? 'to the left of' : x > taskbarX ? 'to the right of' : '';
      const v = h ? '' : y < 0 ? 'above' : y > taskbarY ? 'below' : '';
      where = placement(v, h);
    }
    return { multiple, exact: false, primary, placement: where, x, y };
  }

  function monitorRows(m) {
    if (m.multiple === false) {
      return [
        { label: 'Multiple monitors', value: 'No' },
        { label: "This window's monitor", value: 'Only monitor' },
      ];
    }
    if (!m.multiple) return [{ label: 'Multiple monitors', value: 'Unknown' }];
    const rows = [
      { label: 'Multiple monitors', value: m.exact ? `Yes (${m.count})` : 'Yes' },
      { label: "This window's monitor", value: m.exact ? `Monitor ${m.current.number} of ${m.count}` : m.primary ? 'Primary monitor' : 'Secondary monitor' },
      { label: 'Primary monitor', value: yesNo(m.primary) },
      { label: 'Position', value: m.placement },
    ];
    if (m.exact) {
      rows.push({ label: 'Built-in display', value: yesNo(m.current.internal) });
      rows.push({ label: 'Position on desktop', value: `x ${fmt(m.current.left)}, y ${fmt(m.current.top)}` });
      rows.push({ label: 'Identified by', value: 'Window Management API (exact). Monitors are numbered left to right.' });
    } else {
      rows.push({ label: 'Position on desktop', value: `x ${fmt(m.x)}, y ${fmt(m.y)} (work area)` });
      rows.push({ label: 'Identified by', value: 'Window position (estimated). Click "Identify all monitors" for exact details.' });
    }
    return rows;
  }

  function renderMonitor(m) {
    const el = $('monitor');
    if (!m.multiple) {
      el.hidden = true;
      el.innerHTML = '';
      return;
    }
    el.hidden = false;
    const canAsk = !m.exact && 'getScreenDetails' in window && state.monitorPermission !== 'denied';
    const title = m.exact ? `This window is on Monitor ${m.current.number} of ${m.count}` : `This window is on the ${m.primary ? 'primary' : 'secondary'} monitor`;
    const sub = m.exact
      ? `${m.placement} · ${dims(m.current.width, m.current.height)} at ${m.current.scaling}% · numbered left to right, ★ = primary`
      : `${m.placement} (estimated from window position)`;
    let note = '';
    if (state.monitorPermission === 'denied') note = 'Permission to see all monitors is blocked. Allow "Window management" in this site\'s settings for exact details.';
    else if (canAsk) note = 'Your browser will ask permission to see your display layout.';

    let diagram = '';
    if (m.exact && m.list.length > 1) {
      const minX = Math.min(...m.list.map((s) => s.left));
      const minY = Math.min(...m.list.map((s) => s.top));
      const w = Math.max(...m.list.map((s) => s.left + s.logicalW)) - minX;
      const h = Math.max(...m.list.map((s) => s.top + s.logicalH)) - minY;
      const pct = (v, total) => `${(v / total) * 100}%`;
      diagram = `
        <div class="monitor-map" style="width:${Math.min(260, (64 * w) / h)}px;aspect-ratio:${w} / ${h}" aria-hidden="true">
          ${m.list.map((s) => `
            <div class="monitor-box${s.current ? ' is-current' : ''}" style="left:${pct(s.left - minX, w)};top:${pct(s.top - minY, h)};width:${pct(s.logicalW, w)};height:${pct(s.logicalH, h)}"
              title="Monitor ${s.number}: ${esc(dims(s.width, s.height))}${s.primary ? ' (primary)' : ''}">
              ${s.number}${s.primary ? '<span class="monitor-primary">★</span>' : ''}
            </div>`).join('')}
        </div>`;
    }

    el.innerHTML = `
      <svg class="monitor-icon" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="5" width="26" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.5"/>
        <path d="M11 27h10M16 22v5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <div class="monitor-text">
        <div class="monitor-title${flashClass('monitor', title)}">${esc(title)}</div>
        <div class="muted">${esc(sub)}</div>
        ${note ? `<div class="monitor-note muted">${esc(note)}</div>` : ''}
      </div>
      ${diagram}
      ${canAsk ? '<button type="button" class="btn" data-action="identify-monitors">Identify all monitors</button>' : ''}`;
  }

  // ---------- summary cards ----------

  function zoomBadge(zoom) {
    if (!zoom) return { text: 'Unknown', cls: 'badge-info' };
    if (zoom === 100) return { text: 'Not zoomed', cls: 'badge-ok' };
    return { text: zoom > 100 ? 'Zoomed in' : 'Zoomed out', cls: 'badge-warn' };
  }

  function summaryCards(d) {
    const zoom = d.zoom.zoom;
    return [
      { key: 'h-res', label: 'Screen resolution', value: dims(d.physW, d.physH), sub: `${aspectRatio(d.physW, d.physH)} · ${dims(d.sw, d.sh)} logical` },
      { key: 'h-zoom', label: 'Browser zoom', value: zoom ? `${zoom}%` : '—', badge: zoomBadge(zoom), sub: d.zoom.estimated ? 'Estimated' : zoom ? 'Ctrl + 0 resets to 100%' : 'Not detectable here' },
      { key: 'h-scale', label: 'Display scaling', value: `${d.os}%`, sub: `Device pixel ratio ${fmt(d.dpr, 3)}` },
      { key: 'h-vp', label: 'Browser viewport', value: dims(window.innerWidth, window.innerHeight), sub: `Window ${dims(window.outerWidth, window.outerHeight)}` },
    ];
  }

  // ---------- full report (JSON only) ----------

  function windowOnScreen() {
    const sw = screen.width;
    const sh = screen.height;
    const originX = 'left' in screen ? screen.left : screen.availLeft || 0;
    const originY = 'top' in screen ? screen.top : screen.availTop || 0;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const wx = clamp(window.screenX - originX, 0, sw);
    const wy = clamp(window.screenY - originY, 0, sh);
    const ww = clamp(window.outerWidth, 0, sw - wx);
    const wh = clamp(window.outerHeight, 0, sh - wy);
    return [
      { label: 'Screen size', value: dims(sw, sh) },
      { label: 'Window position on screen', value: `x ${fmt(wx)}, y ${fmt(wy)}` },
      { label: 'Window size', value: dims(window.outerWidth, window.outerHeight) },
      { label: 'Screen covered by window', value: sw && sh ? `${fmt(((ww * wh) / (sw * sh)) * 100)}%` : 'Unknown' },
      { label: 'Maximized', value: yesNo(ww >= screen.availWidth - 2 && wh >= screen.availHeight - 2) },
    ];
  }

  function collect() {
    const browser = detectBrowser();
    const d = computeDisplay(browser);
    const vv = window.visualViewport;
    const de = document.documentElement;
    const orientation = screen.orientation ? `${screen.orientation.type.replace('-primary', '').replace('-secondary', ' (flipped)')}, ${screen.orientation.angle}°` : (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    const gamut = mq('(color-gamut: rec2020)') ? 'Rec. 2020' : mq('(color-gamut: p3)') ? 'Display P3' : mq('(color-gamut: srgb)') ? 'sRGB' : 'Unknown';
    const pointer = mq('(pointer: fine)') ? 'Mouse / trackpad' : mq('(pointer: coarse)') ? 'Touch' : 'None';
    const zoomChanged = Math.abs(d.dpr - state.initialDpr) > 0.001;
    const hi = state.uaHigh;

    let browserVersion = browser.version;
    if (hi && hi.fullVersionList) {
      const brandMap = { 'Google Chrome': 'Google Chrome', 'Microsoft Edge': 'Microsoft Edge', Opera: 'Opera', Brave: 'Brave' };
      const entry = hi.fullVersionList.find((b) => b.brand === brandMap[browser.name]) || hi.fullVersionList.find((b) => b.brand === 'Chromium');
      if (entry) browserVersion = entry.version;
    }

    const zoom = d.zoom.zoom;
    const m = monitorInfo();
    const summary = summaryCards(d).map((c) => ({ label: c.label, value: c.badge ? `${c.value} (${c.badge.text})` : c.value }));
    if (m.multiple) {
      summary.push({
        label: 'Monitor',
        value: m.exact ? `Monitor ${m.current.number} of ${m.count} (${m.placement})` : m.placement,
      });
    }

    const sections = [
      {
        title: 'Summary',
        rows: summary,
      },
      {
        title: 'Monitor',
        rows: monitorRows(m),
      },
      {
        title: 'Display',
        rows: [
          { label: 'Screen resolution', value: dims(d.physW, d.physH) },
          { label: 'Logical resolution', value: dims(d.sw, d.sh) },
          { label: 'Available area', value: dims(screen.availWidth, screen.availHeight) },
          { label: 'Aspect ratio', value: aspectRatio(d.physW, d.physH) },
          { label: 'Display scaling', value: `${d.os}%` },
          { label: 'Refresh rate', value: state.refreshHz ? `${fmt(state.refreshHz)} Hz` : 'Unknown' },
          { label: 'Color depth', value: `${screen.colorDepth}-bit` },
          { label: 'Color gamut', value: gamut },
          { label: 'HDR', value: mq('(dynamic-range: high)') ? 'Supported' : 'Not detected' },
          { label: 'Orientation', value: orientation },
        ],
      },
      {
        title: 'Browser window & zoom',
        rows: [
          { label: 'Browser zoom', value: zoom ? `${zoom}%` : 'Unknown' },
          { label: 'Zoom detection method', value: d.zoom.method },
          { label: 'Device pixel ratio', value: fmt(d.dpr, 4) },
          { label: 'Viewport size', value: dims(window.innerWidth, window.innerHeight) },
          { label: 'Viewport (no scrollbars)', value: dims(de.clientWidth, de.clientHeight) },
          { label: 'Window size', value: dims(window.outerWidth, window.outerHeight) },
          { label: 'Window position', value: `x ${fmt(window.screenX)}, y ${fmt(window.screenY)}` },
          { label: 'Scrollbar width', value: `${fmt(window.innerWidth - de.clientWidth)} px` },
          { label: 'Pinch zoom', value: vv ? `${fmt(vv.scale * 100, 1)}%` : 'Unknown' },
          { label: 'Zoom changed since load', value: zoomChanged ? `Yes (DPR ${fmt(state.initialDpr, 3)} → ${fmt(d.dpr, 3)})` : 'No' },
          { label: 'Page size', value: dims(de.scrollWidth, de.scrollHeight) },
        ],
      },
      {
        title: 'Window on screen',
        rows: windowOnScreen(),
      },
      ...(m.exact && m.multiple ? [{
        title: 'All monitors',
        rows: m.list.map((s) => ({
          label: `Monitor ${s.number}`,
          value: [
            dims(s.width, s.height),
            `${s.scaling}% scaling`,
            `position x ${fmt(s.left)}, y ${fmt(s.top)}`,
            s.primary && 'primary',
            s.internal && 'built-in',
            s.current && 'this window',
          ].filter(Boolean).join(' · '),
        })),
      }] : []),
      {
        // Deliberately excludes anything that could identify or locate a person: no user agent,
        // language, time zone, hardware/GPU details, accessibility settings or page address.
        title: 'Browser & device',
        rows: [
          { label: 'Browser', value: `${browser.name} ${browserVersion}`.trim() },
          { label: 'Rendering engine', value: { blink: 'Blink', gecko: 'Gecko', webkit: 'WebKit' }[browser.engine] || 'Unknown' },
          { label: 'Operating system', value: detectOS() },
          { label: 'Primary input', value: pointer },
        ],
      },
    ];

    return sections;
  }

  // ---------- rendering ----------

  function flashClass(key, value) {
    const prev = state.previous.get(key);
    state.previous.set(key, value);
    return prev !== undefined && prev !== value ? ' changed' : '';
  }

  function render() {
    const d = computeDisplay(detectBrowser());
    $('hero').innerHTML = summaryCards(d).map((c) => `
      <div class="stat">
        <div class="stat-label">${esc(c.label)}${c.badge ? `<span class="badge ${c.badge.cls}">${esc(c.badge.text)}</span>` : ''}</div>
        <div class="stat-value${flashClass(c.key, c.value)}">${esc(c.value)}</div>
        <div class="stat-sub">${esc(c.sub)}</div>
      </div>`).join('');
    renderMonitor(monitorInfo());
  }

  // ---------- export ----------

  function reportJson() {
    const out = { generatedAt: new Date().toISOString() };
    collect().forEach((s) => {
      out[s.title] = Object.fromEntries(s.rows.map((r) => [r.label, r.value]));
    });
    return JSON.stringify(out, null, 2);
  }

  async function downloadJson() {
    // Make sure the refresh rate is included even if the button is clicked right after load.
    if (!state.refreshHz) await Promise.race([updateRefreshRate(), new Promise((r) => setTimeout(r, 2000))]);
    const blob = new Blob([reportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `screen-info-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- live updates ----------

  let frame = 0;
  const scheduleRender = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  };

  // There's no event for every zoom or monitor change, so poll a cheap signature.
  let lastSignature = '';
  let lastScreenKey = '';
  function poll() {
    const sig = [
      window.innerWidth, window.innerHeight, window.outerWidth, window.outerHeight,
      screen.width, screen.height, screen.availLeft, screen.availTop, window.devicePixelRatio,
    ].join('|');
    if (sig !== lastSignature) {
      lastSignature = sig;
      scheduleRender();
    }
    // Moving to another monitor can change the refresh rate.
    const screenKey = [screen.width, screen.height, screen.availLeft, screen.availTop, window.devicePixelRatio].join('|');
    if (lastScreenKey && screenKey !== lastScreenKey) updateRefreshRate();
    lastScreenKey = screenKey;
  }

  window.addEventListener('resize', scheduleRender);
  if (screen.orientation) screen.orientation.addEventListener('change', scheduleRender);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.refreshHz) updateRefreshRate(); });

  $('btn-json').addEventListener('click', downloadJson);
  $('monitor').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="identify-monitors"]')) loadScreenDetails();
  });

  render();
  poll();
  setInterval(poll, 500);
  updateRefreshRate();
  loadUaDetails();
  initMonitors();
})();
