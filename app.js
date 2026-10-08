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
    measuringRefresh: false,
    uaHigh: null,
    monitors: null,
    previous: new Map(),
    lastReport: null,
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
      state.uaHigh = await uaData.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList']);
      render();
    } catch (e) { /* not available */ }
  }

  function detectGpu() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const raw = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 3060"
      let name = raw;
      const angle = raw.match(/^ANGLE \((.*)\)$/);
      if (angle) {
        const parts = angle[1].split(',');
        name = (parts[1] || parts[0]).trim();
      }
      name = name.replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/\s*Direct3D.*$/i, '').trim();
      return { name: name || raw, raw };
    } catch (e) {
      return null;
    }
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

  async function updateRefreshRate() {
    if (state.measuringRefresh || document.hidden) return;
    state.measuringRefresh = true;
    $('btn-refresh').disabled = true;
    const hz = await measureRefreshRate();
    state.refreshHz = hz ? snap(hz, REFRESH_RATES, 0.04) : null;
    state.measuringRefresh = false;
    $('btn-refresh').disabled = false;
    render();
  }

  // ---------- monitors ----------

  async function detectMonitors() {
    if (!('getScreenDetails' in window)) {
      toast('Listing all monitors is only supported in Chrome and Edge on desktop.');
      return;
    }
    try {
      const details = await window.getScreenDetails();
      const read = () => {
        state.monitors = details.screens.map((s) => ({
          label: s.label || '',
          width: s.width,
          height: s.height,
          dpr: s.devicePixelRatio,
          left: s.left,
          top: s.top,
          primary: s.isPrimary,
          internal: s.isInternal,
          current: s === details.currentScreen,
        }));
        render();
      };
      read();
      details.addEventListener('screenschange', read);
      details.addEventListener('currentscreenchange', read);
      toast(`Found ${details.screens.length} monitor${details.screens.length === 1 ? '' : 's'}.`);
    } catch (e) {
      toast('Permission to read monitor details was denied.');
    }
  }

  // ---------- data collection ----------

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

    const gpu = state.gpu === undefined ? (state.gpu = detectGpu()) : state.gpu;
    const zoom = d.zoom.zoom;

    const sections = [
      {
        title: 'Display',
        rows: [
          { label: 'Screen resolution', value: dims(d.physW, d.physH), hint: d.os !== 100 ? `${dims(d.sw, d.sh)} logical pixels × ${d.os}% scaling` : 'Device pixels' },
          { label: 'Logical resolution', value: dims(d.sw, d.sh), hint: 'What websites see as screen.width × screen.height (CSS pixels)' },
          { label: 'Available area', value: dims(screen.availWidth, screen.availHeight), hint: 'Screen minus taskbar / dock / menu bar' },
          { label: 'Aspect ratio', value: aspectRatio(d.physW, d.physH) },
          { label: 'Display scaling', value: `${d.os}%`, hint: 'OS-level scaling (Windows "Scale" / macOS HiDPI)' },
          { label: 'Refresh rate', value: state.refreshHz ? `${fmt(state.refreshHz)} Hz` : state.measuringRefresh ? 'Measuring…' : '—', hint: 'Measured from browser frame timing' },
          { label: 'Color depth', value: `${screen.colorDepth}-bit` },
          { label: 'Color gamut', value: gamut },
          { label: 'HDR', value: mq('(dynamic-range: high)') ? 'Supported' : 'Not detected' },
          { label: 'Orientation', value: orientation },
          { label: 'Multiple monitors', value: 'isExtended' in screen ? yesNo(screen.isExtended) : 'Unknown' },
        ],
      },
      {
        title: 'Browser window & zoom',
        rows: [
          { label: 'Browser zoom', value: zoom ? `${zoom}%` : 'Unknown', hint: d.zoom.method },
          { label: 'Device pixel ratio', value: fmt(d.dpr, 4), hint: 'Display scaling × browser zoom' },
          { label: 'Viewport size', value: dims(window.innerWidth, window.innerHeight), hint: 'window.innerWidth × innerHeight, including scrollbars' },
          { label: 'Viewport (no scrollbars)', value: dims(de.clientWidth, de.clientHeight), hint: 'What CSS media queries use' },
          { label: 'Window size', value: dims(window.outerWidth, window.outerHeight), hint: 'Whole browser window including tabs and toolbars' },
          { label: 'Window position', value: `x ${fmt(window.screenX)}, y ${fmt(window.screenY)}` },
          { label: 'Scrollbar width', value: `${fmt(window.innerWidth - de.clientWidth)} px` },
          { label: 'Pinch zoom', value: vv ? `${fmt(vv.scale * 100, 1)}%` : 'Unknown', hint: vv && vv.scale !== 1 ? `Visible area ${dims(vv.width, vv.height)}` : undefined },
          { label: 'Zoom changed since load', value: zoomChanged ? `Yes (DPR ${fmt(state.initialDpr, 3)} → ${fmt(d.dpr, 3)})` : 'No' },
          { label: 'Page size', value: dims(de.scrollWidth, de.scrollHeight) },
        ],
      },
      {
        title: 'System & browser',
        rows: [
          { label: 'Browser', value: `${browser.name} ${browserVersion}`.trim() },
          { label: 'Rendering engine', value: { blink: 'Blink', gecko: 'Gecko', webkit: 'WebKit' }[browser.engine] || 'Unknown' },
          { label: 'Operating system', value: detectOS() },
          { label: 'Architecture', value: hi && hi.architecture ? `${hi.architecture}${hi.bitness ? ` ${hi.bitness}-bit` : ''}` : 'Unknown' },
          { label: 'Device model', value: hi && hi.model ? hi.model : undefined },
          { label: 'CPU threads', value: navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'Unknown' },
          { label: 'Memory', value: navigator.deviceMemory ? `${navigator.deviceMemory} GB or more` : 'Unknown', hint: navigator.deviceMemory ? 'Browsers cap this value at 8 GB' : undefined },
          { label: 'Graphics', value: gpu ? gpu.name : 'Unknown', hint: gpu && gpu.raw !== gpu.name ? gpu.raw : undefined },
          { label: 'Touch points', value: String(navigator.maxTouchPoints || 0) },
          { label: 'Primary input', value: pointer },
          { label: 'Language', value: navigator.language || 'Unknown' },
          { label: 'Time zone', value: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown' },
          { label: 'Cookies enabled', value: yesNo(navigator.cookieEnabled) },
          { label: 'User agent', value: navigator.userAgent, wide: true },
        ],
      },
      {
        title: 'Preferences',
        rows: [
          { label: 'Color scheme', value: mq('(prefers-color-scheme: dark)') ? 'Dark' : 'Light' },
          { label: 'Reduced motion', value: mq('(prefers-reduced-motion: reduce)') ? 'On' : 'Off' },
          { label: 'Contrast', value: mq('(prefers-contrast: more)') ? 'More' : mq('(prefers-contrast: less)') ? 'Less' : 'Default' },
          { label: 'Forced colors', value: mq('(forced-colors: active)') ? 'Active (high contrast)' : 'Off' },
        ],
      },
    ];

    if (state.monitors) {
      sections.splice(1, 0, {
        title: `Connected monitors (${state.monitors.length})`,
        rows: state.monitors.map((m, i) => {
          const tags = [m.primary && 'primary', m.internal && 'built-in', m.current && 'this window'].filter(Boolean);
          return {
            label: `${m.label || `Monitor ${i + 1}`}${tags.length ? ` (${tags.join(', ')})` : ''}`,
            value: dims(Math.round(m.width * m.dpr), Math.round(m.height * m.dpr)),
            hint: `${dims(m.width, m.height)} logical at ${fmt(m.dpr * 100)}% scaling · position ${fmt(m.left)}, ${fmt(m.top)}`,
          };
        }),
      });
    }

    sections.forEach((s) => { s.rows = s.rows.filter((r) => r.value !== undefined); });

    return { browser, d, sections };
  }

  // ---------- rendering ----------

  function flashClass(key, value) {
    const prev = state.previous.get(key);
    state.previous.set(key, value);
    return prev !== undefined && prev !== value ? ' changed' : '';
  }

  function zoomBadge(zoom) {
    if (!zoom) return '<span class="badge badge-info">Unknown</span>';
    if (zoom === 100) return '<span class="badge badge-ok">Not zoomed</span>';
    return zoom > 100 ? '<span class="badge badge-warn">Zoomed in</span>' : '<span class="badge badge-warn">Zoomed out</span>';
  }

  function renderHero({ d }) {
    const zoom = d.zoom.zoom;
    const cards = [
      { key: 'h-res', label: 'Screen resolution', value: dims(d.physW, d.physH), sub: `${aspectRatio(d.physW, d.physH)} · ${dims(d.sw, d.sh)} logical` },
      { key: 'h-zoom', label: 'Browser zoom', value: zoom ? `${zoom}%` : '—', badge: zoomBadge(zoom), sub: d.zoom.estimated ? 'Estimated' : zoom ? 'Ctrl + 0 resets to 100%' : 'Not detectable here' },
      { key: 'h-scale', label: 'Display scaling', value: `${d.os}%`, sub: `Device pixel ratio ${fmt(d.dpr, 3)}` },
      { key: 'h-vp', label: 'Browser viewport', value: dims(window.innerWidth, window.innerHeight), sub: `Window ${dims(window.outerWidth, window.outerHeight)}` },
    ];
    $('hero').innerHTML = cards.map((c) => `
      <div class="stat">
        <div class="stat-label">${esc(c.label)}${c.badge || ''}</div>
        <div class="stat-value${flashClass(c.key, c.value)}">${esc(c.value)}</div>
        <div class="stat-sub">${esc(c.sub)}</div>
      </div>`).join('');
  }

  function renderSections({ sections }) {
    $('sections').innerHTML = sections.map((s) => `
      <section class="card">
        <h2>${esc(s.title)}</h2>
        <dl class="rows">
          ${s.rows.map((r) => `
            <div class="row${r.wide ? ' row-wide' : ''}">
              <dt>${esc(r.label)}</dt>
              <dd class="${flashClass(`${s.title}/${r.label}`, r.value)}">${esc(r.value)}</dd>
              ${r.hint ? `<div class="hint">${esc(r.hint)}</div>` : ''}
            </div>`).join('')}
        </dl>
      </section>`).join('');
  }

  function renderViz() {
    const sw = screen.width;
    const sh = screen.height;
    if (!sw || !sh) return;
    const originX = 'left' in screen ? screen.left : screen.availLeft || 0;
    const originY = 'top' in screen ? screen.top : screen.availTop || 0;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const pct = (v, total) => `${(v / total) * 100}%`;

    const wx = clamp(window.screenX - originX, 0, sw);
    const wy = clamp(window.screenY - originY, 0, sh);
    const ww = clamp(window.outerWidth, 0, sw - wx);
    const wh = clamp(window.outerHeight, 0, sh - wy);
    const ax = clamp((screen.availLeft || 0) - originX, 0, sw);
    const ay = clamp((screen.availTop || 0) - originY, 0, sh);

    $('viz').innerHTML = `
      <div class="viz-screen" style="aspect-ratio:${sw} / ${sh}">
        <div class="viz-avail" style="left:${pct(ax, sw)};top:${pct(ay, sh)};width:${pct(screen.availWidth, sw)};height:${pct(screen.availHeight, sh)}"></div>
        <div class="viz-window" style="left:${pct(wx, sw)};top:${pct(wy, sh)};width:${pct(ww, sw)};height:${pct(wh, sh)}">
          <span>${esc(dims(window.outerWidth, window.outerHeight))}</span>
        </div>
        <span class="viz-screen-label">${esc(dims(sw, sh))}</span>
      </div>
      <div class="viz-caption">Window covers ${fmt(((ww * wh) / (sw * sh)) * 100)}% of the screen</div>`;
  }

  function render() {
    const data = collect();
    state.lastReport = data;
    renderHero(data);
    renderSections(data);
    renderViz();
  }

  // ---------- export ----------

  function reportText() {
    const { sections } = state.lastReport || collect();
    const lines = [`Screen Resolution Checker report — ${new Date().toLocaleString()}`, location.href, ''];
    sections.forEach((s) => {
      lines.push(s.title.toUpperCase());
      s.rows.forEach((r) => lines.push(`  ${r.label}: ${r.value}`));
      lines.push('');
    });
    return lines.join('\n');
  }

  function reportJson() {
    const { sections } = state.lastReport || collect();
    const out = { generatedAt: new Date().toISOString() };
    sections.forEach((s) => {
      out[s.title] = Object.fromEntries(s.rows.map((r) => [r.label, r.value]));
    });
    return JSON.stringify(out, null, 2);
  }

  async function copyReport() {
    const text = reportText();
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast('Report copied to clipboard.');
  }

  function downloadJson() {
    const blob = new Blob([reportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `screen-info-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- live updates ----------

  let frame = 0;
  const scheduleRender = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  };

  // There's no event for window moves or every media change, so poll a cheap signature.
  let lastSignature = '';
  let lastScreenKey = '';
  function poll() {
    const vv = window.visualViewport;
    const sig = [
      window.innerWidth, window.innerHeight, window.outerWidth, window.outerHeight, window.screenX, window.screenY,
      screen.width, screen.height, screen.availWidth, screen.availHeight, window.devicePixelRatio,
      vv ? vv.scale : 1, mq('(prefers-color-scheme: dark)'), mq('(dynamic-range: high)'),
    ].join('|');
    if (sig !== lastSignature) {
      lastSignature = sig;
      scheduleRender();
    }
    // Moving to another monitor can change the refresh rate.
    const screenKey = [screen.width, screen.height, window.devicePixelRatio].join('|');
    if (lastScreenKey && screenKey !== lastScreenKey) updateRefreshRate();
    lastScreenKey = screenKey;
  }

  window.addEventListener('resize', scheduleRender);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleRender);
  if (screen.orientation) screen.orientation.addEventListener('change', scheduleRender);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.refreshHz) updateRefreshRate(); });

  $('btn-copy').addEventListener('click', copyReport);
  $('btn-json').addEventListener('click', downloadJson);
  $('btn-refresh').addEventListener('click', updateRefreshRate);
  $('btn-monitors').addEventListener('click', detectMonitors);

  render();
  poll();
  setInterval(poll, 500);
  updateRefreshRate();
  loadUaDetails();
})();
