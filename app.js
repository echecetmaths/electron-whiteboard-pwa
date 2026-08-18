(() => {
'use strict';

const PALETTE = ['#1a1a1a', '#e03131', '#FF8A1F', '#6DC82A', '#57B3FE', '#9c36b5', '#ffffff'];
const NOTE_PALETTE = ['#fff59d', '#ffcc80', '#a5d6a7', '#90caf9', '#ce93d8', '#ef9a9a'];
const HANDLE_PX = 6;
const HIT_TOL_PX = 8;
// Every 15° — matches every tick mark drawn on the trig circle, so no tick is ever left unlabeled.
const ANGLE_MARKS = [
  { deg: 0, label: '0°', rad: '0' },
  { deg: 15, label: '15°', rad: 'π/12' },
  { deg: 30, label: '30°', rad: 'π/6' },
  { deg: 45, label: '45°', rad: 'π/4' },
  { deg: 60, label: '60°', rad: 'π/3' },
  { deg: 75, label: '75°', rad: '5π/12' },
  { deg: 90, label: '90°', rad: 'π/2' },
  { deg: 105, label: '105°', rad: '7π/12' },
  { deg: 120, label: '120°', rad: '2π/3' },
  { deg: 135, label: '135°', rad: '3π/4' },
  { deg: 150, label: '150°', rad: '5π/6' },
  { deg: 165, label: '165°', rad: '11π/12' },
  { deg: 180, label: '180°', rad: 'π' },
  { deg: 195, label: '195°', rad: '13π/12' },
  { deg: 210, label: '210°', rad: '7π/6' },
  { deg: 225, label: '225°', rad: '5π/4' },
  { deg: 240, label: '240°', rad: '4π/3' },
  { deg: 255, label: '255°', rad: '17π/12' },
  { deg: 270, label: '270°', rad: '3π/2' },
  { deg: 285, label: '285°', rad: '19π/12' },
  { deg: 300, label: '300°', rad: '5π/3' },
  { deg: 315, label: '315°', rad: '7π/4' },
  { deg: 330, label: '330°', rad: '11π/6' },
  { deg: 345, label: '345°', rad: '23π/12' }
];
const A4_PAGE_W = 794; // 210mm at 96dpi
const A4_PAGE_H = 1123; // 297mm at 96dpi
const A4_SUPERSAMPLE = 2;
const PDF_BAND_H = Math.round(A4_PAGE_W * 186 / 1237); // header/footer band height at full page width

// ---------- State ----------
const state = {
  boardId: null,
  boardName: 'Tableau sans titre',
  objects: [],
  selection: [],
  tool: 'pen',
  color: PALETTE[0],
  strokeWidth: 4,
  lastShapeTool: 'rect',
  lastSelectTool: 'select', // 'select' | 'lasso'
  showGrid: true,
  viewport: { panX: 0, panY: 0, zoom: 1 },
  theme: 'light',
  colorMode: 'jour', // 'nuit' | 'jour' | 'physique' | 'chimie' | 'biologie'
  pageMode: 'off', // 'off' | 'vertical' | 'horizontal' | 'plus'
  pageBoxes: [], // [{id, x, y}] world-anchored A4_PAGE_W x A4_PAGE_H rects
  settings: null
};

const history = { undo: [], redo: [] };
let drag = null; // active pointer interaction
let drawingObj = null; // in-progress shape/stroke
let editingEl = null; // active overlay editor {el, obj}
let imageCache = new Map();
let saveTimer = null;
let spaceHeld = false;
let boardsCache = [];
let boardSelectMode = false;
let selectedBoardIds = new Set();

// ---------- DOM ----------
const canvas = document.getElementById('board-canvas');
const mainCtx = canvas.getContext('2d');
// Reassignable: while a pen/highlighter stroke is in progress, this is briefly pointed at an
// offscreen canvas so the existing draw* functions (which all read this module-level binding)
// can render the static "everything except the live stroke" snapshot once per stroke instead of
// on every pointermove — see prepareStrokeStaticLayer()/renderDuringStroke() below.
let ctx = mainCtx;
const wrap = document.getElementById('canvas-wrap');
const overlay = document.getElementById('overlay-layer');
const selToolbar = document.getElementById('selection-toolbar');
const boardTitleInput = document.getElementById('board-title');
const zoomLevelEl = document.getElementById('zoom-level');
const saveStatusEl = document.getElementById('save-status');
const imageInput = document.getElementById('image-input');
const sidebar = document.getElementById('sidebar');
const boardListEl = document.getElementById('board-list');
const toolFlyoutEl = document.getElementById('tool-flyout');
const customCursorEl = document.getElementById('custom-cursor');
const cursorBadgeEl = document.getElementById('cursor-badge');
const toolbarStarsEl = document.getElementById('toolbar-stars');
// Captured once at startup, before the app's own loading splash removes itself from the DOM
// (see hideSplash()) — reused later to show the same spinning-comet loading indicator inside
// other UI (the payment portal), even though the original splash element is long gone by then.
const splashOrbitTemplate = document.querySelector('#splash-screen .splash-orbit');

const RISING_STAR_DEFS = [
  { x: -0.06, size: 20, peak: 0.85, delay: 0, dur: 4.2 },
  { x: 0.01, size: 13, peak: 0.55, delay: 0.8, dur: 3.6 },
  { x: 0.08, size: 17, peak: 0.75, delay: 1.6, dur: 4.6 },
  { x: 0.16, size: 12, peak: 0.5, delay: 2.4, dur: 3.9 },
  { x: 0.24, size: 18, peak: 0.7, delay: 0.4, dur: 4.4 },
  { x: 0.32, size: 11, peak: 0.45, delay: 3.0, dur: 3.7 },
  { x: 0.41, size: 19, peak: 0.8, delay: 1.2, dur: 4.5 },
  { x: 0.5, size: 12, peak: 0.5, delay: 2.0, dur: 3.8 },
  { x: 0.59, size: 17, peak: 0.7, delay: 0.6, dur: 4.3 },
  { x: 0.68, size: 13, peak: 0.55, delay: 2.8, dur: 4.0 },
  { x: 0.76, size: 20, peak: 0.85, delay: 1.4, dur: 4.7 },
  { x: 0.84, size: 12, peak: 0.5, delay: 3.4, dur: 3.6 },
  { x: 0.92, size: 18, peak: 0.75, delay: 0.2, dur: 4.4 },
  { x: 1.0, size: 13, peak: 0.55, delay: 2.2, dur: 3.9 },
  { x: 1.06, size: 16, peak: 0.65, delay: 1.8, dur: 4.1 }
];

function buildRisingStars(containerEl, starClass) {
  containerEl.innerHTML = RISING_STAR_DEFS.map(s => `
    <svg class="${starClass}" viewBox="0 0 24 24" style="left:${s.x * 100}%;width:${s.size}px;height:${s.size}px;--peak-op:${s.peak};animation-delay:${s.delay}s;animation-duration:${s.dur}s;">
      <path d="M12 2l1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8z"/>
    </svg>`).join('');
}

function buildToolbarStars() {
  buildRisingStars(toolbarStarsEl, 'toolbar-star');
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function hexToRgba(hex, alpha) {
  const m = hex.replace('#', '');
  const r = parseInt(m.substring(0, 2), 16) || 0;
  const g = parseInt(m.substring(2, 4), 16) || 0;
  const b = parseInt(m.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------- Canvas sizing ----------
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  render();
}
new ResizeObserver(resizeCanvas).observe(wrap);

// ---------- Coordinate transforms ----------
function screenToWorld(sx, sy) {
  return {
    x: (sx - state.viewport.panX) / state.viewport.zoom,
    y: (sy - state.viewport.panY) / state.viewport.zoom
  };
}
function worldToScreen(wx, wy) {
  return {
    x: wx * state.viewport.zoom + state.viewport.panX,
    y: wy * state.viewport.zoom + state.viewport.panY
  };
}
function getPointerPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ---------- Bounding boxes ----------
function getObjBBox(obj) {
  switch (obj.type) {
    case 'stroke': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of obj.points) {
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
      const pad = obj.width / 2;
      return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    case 'line':
    case 'arrow': {
      const minX = Math.min(obj.x1, obj.x2), maxX = Math.max(obj.x1, obj.x2);
      const minY = Math.min(obj.y1, obj.y2), maxY = Math.max(obj.y1, obj.y2);
      const pad = obj.width / 2 + 2;
      return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
    }
    default:
      return { x: obj.x, y: obj.y, w: obj.w, h: obj.h };
  }
}

function getObjectsBBox(objects) {
  if (!objects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of objects) {
    const b = getObjBBox(obj);
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ---------- Text wrapping ----------
// wrapText() calls measureText() once per word, which adds up fast once a board has several
// pages of text — render() runs on nearly every pointer move, so without caching, every text
// and note object gets fully re-wrapped every single frame even when nothing about it changed.
// Cache per-object (by reference, so it never leaks into saved boards or undo snapshots) and
// only recompute when the text/width/font that actually determines the wrap has changed.
const wrapCache = new WeakMap();
function getWrappedLines(context, obj, maxWidth, fontSize) {
  const cached = wrapCache.get(obj);
  if (cached && cached.text === obj.text && cached.maxWidth === maxWidth && cached.fontSize === fontSize) {
    return cached.lines;
  }
  const lines = wrapText(context, obj.text, maxWidth);
  wrapCache.set(obj, { text: obj.text, maxWidth, fontSize, lines });
  return lines;
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  const paragraphs = (text || '').split('\n');
  for (const para of paragraphs) {
    if (para === '') { lines.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word;
      if (context.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    }
    lines.push(cur);
  }
  return lines;
}

// ---------- Drawing ----------
function strokeStyleForObj(obj) {
  ctx.strokeStyle = obj.color;
  ctx.lineWidth = obj.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawArrowHead(x1, y1, x2, y2, width) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const len = Math.max(10, width * 3);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - len * Math.cos(angle - Math.PI / 7), y2 - len * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(x2 - len * Math.cos(angle + Math.PI / 7), y2 - len * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
}

function drawSmallArrowAt(c, x, y, angle) {
  const len = 9;
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.beginPath();
  c.moveTo(0, 0); c.lineTo(-len, -len * 0.5);
  c.moveTo(0, 0); c.lineTo(-len, len * 0.5);
  c.stroke();
  c.restore();
}

function drawAxisLabel(c, tipX, tipY, dx, dy, text) {
  c.save();
  c.font = '600 14px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  c.fillStyle = c.strokeStyle;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, tipX + dx * 15, tipY + dy * 15);
  c.restore();
}

function drawGraduatedAxis(c, cx, cy, dx, dy, len, tickCount, tickLen, showNumbers) {
  const ex = cx + dx * len, ey = cy + dy * len;
  c.beginPath();
  c.moveTo(cx - dx * len, cy - dy * len);
  c.lineTo(ex, ey);
  c.stroke();
  drawSmallArrowAt(c, ex, ey, Math.atan2(dy, dx));
  const px = -dy, py = dx;
  const half = Math.max(1, Math.round(tickCount / 2));
  c.beginPath();
  for (let i = -half; i <= half; i++) {
    if (i === 0 || Math.abs(i) === half) continue;
    const t = i / half;
    const tx = cx + dx * len * t, ty = cy + dy * len * t;
    c.moveTo(tx - px * tickLen, ty - py * tickLen);
    c.lineTo(tx + px * tickLen, ty + py * tickLen);
  }
  c.stroke();
  if (showNumbers) {
    c.save();
    c.font = '11px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    c.fillStyle = c.strokeStyle;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const labelOff = tickLen * 2.4;
    for (let i = 1; i < half; i++) {
      const t = i / half;
      let tx = cx + dx * len * t, ty = cy + dy * len * t;
      c.fillText(String(i), tx + px * labelOff, ty + py * labelOff);
      tx = cx - dx * len * t; ty = cy - dy * len * t;
      c.fillText(String(i), tx + px * labelOff, ty + py * labelOff);
    }
    c.restore();
  }
}

function drawAxes2D(c, obj) {
  const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
  c.strokeStyle = obj.color; c.lineWidth = 1.5; c.lineCap = 'round'; c.lineJoin = 'round';
  const ticks = obj.tickCount || 20;
  const showNumbers = !!obj.showNumbers;
  drawGraduatedAxis(c, cx, cy, 1, 0, obj.w / 2, ticks, 5, showNumbers);
  drawGraduatedAxis(c, cx, cy, 0, -1, obj.h / 2, ticks, 5, showNumbers);
  drawAxisLabel(c, cx + obj.w / 2, cy, 1, 0, 'x');
  drawAxisLabel(c, cx, cy - obj.h / 2, 0, -1, 'y');
}

function drawAxes3D(c, obj) {
  const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
  c.strokeStyle = obj.color; c.lineWidth = 1.5; c.lineCap = 'round'; c.lineJoin = 'round';
  const len = Math.min(obj.w, obj.h) / 2;
  const ticks = obj.tickCount || 20;
  const showNumbers = !!obj.showNumbers;
  const zAngle = -210 * Math.PI / 180;
  const zdx = Math.cos(zAngle), zdy = Math.sin(zAngle);
  drawGraduatedAxis(c, cx, cy, 1, 0, len, ticks, 4, showNumbers);
  drawGraduatedAxis(c, cx, cy, 0, -1, len, ticks, 4, showNumbers);
  drawGraduatedAxis(c, cx, cy, zdx, zdy, len * 0.85, ticks, 4, showNumbers);
  drawAxisLabel(c, cx + len, cy, 1, 0, 'x');
  drawAxisLabel(c, cx, cy - len, 0, -1, 'y');
  drawAxisLabel(c, cx + zdx * len * 0.85, cy + zdy * len * 0.85, zdx, zdy, 'z');
}

function drawTrigCircle(c, obj) {
  const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
  const r = Math.min(Math.abs(obj.w), Math.abs(obj.h)) / 2;
  c.strokeStyle = obj.color; c.lineWidth = 1.5; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.stroke();
  const ext = r * 1.15;
  c.beginPath();
  c.moveTo(cx - ext, cy); c.lineTo(cx + ext, cy);
  c.moveTo(cx, cy + ext); c.lineTo(cx, cy - ext);
  c.stroke();
  drawSmallArrowAt(c, cx + ext, cy, 0);
  drawSmallArrowAt(c, cx, cy - ext, -Math.PI / 2);
  drawAxisLabel(c, cx + ext, cy, 1, 0, 'x');
  drawAxisLabel(c, cx, cy - ext, 0, -1, 'y');
  // Negate the sine term throughout: canvas y grows downward, so this is what makes
  // increasing degrees sweep counterclockwise (the standard mathematical direction).
  const tickLen = r * 0.06;
  c.beginPath();
  for (let deg = 0; deg < 360; deg += 15) {
    const a = deg * Math.PI / 180;
    c.moveTo(cx + Math.cos(a) * (r - tickLen), cy - Math.sin(a) * (r - tickLen));
    c.lineTo(cx + Math.cos(a) * (r + tickLen), cy - Math.sin(a) * (r + tickLen));
  }
  c.stroke();
  if (obj.showAngles) {
    c.save();
    c.font = '11px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    c.fillStyle = c.strokeStyle;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const labelR = r * 1.3;
    for (const m of ANGLE_MARKS) {
      const a = m.deg * Math.PI / 180;
      const text = obj.angleUnit === 'rad' ? m.rad : m.label;
      c.fillText(text, cx + Math.cos(a) * labelR, cy - Math.sin(a) * labelR);
    }
    c.restore();
  }
}

function tracePointsSmooth(c, points) {
  c.moveTo(points[0].x, points[0].y);
  if (points.length === 2) {
    c.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    c.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const n = points.length;
  c.quadraticCurveTo(points[n - 2].x, points[n - 2].y, points[n - 1].x, points[n - 1].y);
}

function drawObject(obj) {
  ctx.save();
  switch (obj.type) {
    case 'stroke': {
      if (!obj.points.length) break;
      strokeStyleForObj(obj);
      if (obj.tool === 'highlighter') { ctx.globalAlpha = 0.35; ctx.lineWidth = obj.width * 2.2; }
      if (obj.points.length === 1) {
        ctx.beginPath();
        ctx.arc(obj.points[0].x, obj.points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fill();
        break;
      }
      ctx.beginPath();
      tracePointsSmooth(ctx, obj.points);
      ctx.stroke();
      break;
    }
    case 'line':
      strokeStyleForObj(obj);
      ctx.beginPath(); ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke();
      break;
    case 'arrow':
      strokeStyleForObj(obj);
      ctx.beginPath(); ctx.moveTo(obj.x1, obj.y1); ctx.lineTo(obj.x2, obj.y2); ctx.stroke();
      drawArrowHead(obj.x1, obj.y1, obj.x2, obj.y2, obj.width);
      break;
    case 'rect':
      strokeStyleForObj(obj);
      if (obj.filled) { ctx.fillStyle = obj.color; ctx.fillRect(obj.x, obj.y, obj.w, obj.h); }
      else ctx.strokeRect(obj.x, obj.y, obj.w, obj.h);
      break;
    case 'ellipse':
      strokeStyleForObj(obj);
      ctx.beginPath();
      ctx.ellipse(obj.x + obj.w / 2, obj.y + obj.h / 2, Math.abs(obj.w / 2), Math.abs(obj.h / 2), 0, 0, Math.PI * 2);
      if (obj.filled) { ctx.fillStyle = obj.color; ctx.fill(); }
      else ctx.stroke();
      break;
    case 'axes2d':
      drawAxes2D(ctx, obj);
      break;
    case 'axes3d':
      drawAxes3D(ctx, obj);
      break;
    case 'trigcircle':
      drawTrigCircle(ctx, obj);
      break;
    case 'text': {
      ctx.fillStyle = obj.color;
      ctx.font = `${obj.fontSize}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textBaseline = 'top';
      const lines = getWrappedLines(ctx, obj, obj.w, obj.fontSize);
      const lh = obj.fontSize * 1.3;
      lines.forEach((line, i) => ctx.fillText(line, obj.x, obj.y + i * lh));
      break;
    }
    case 'note': {
      const r = 8;
      ctx.fillStyle = obj.color;
      ctx.beginPath();
      ctx.moveTo(obj.x + r, obj.y);
      ctx.arcTo(obj.x + obj.w, obj.y, obj.x + obj.w, obj.y + obj.h, r);
      ctx.arcTo(obj.x + obj.w, obj.y + obj.h, obj.x, obj.y + obj.h, r);
      ctx.arcTo(obj.x, obj.y + obj.h, obj.x, obj.y, r);
      ctx.arcTo(obj.x, obj.y, obj.x + obj.w, obj.y, r);
      ctx.closePath();
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `15px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      ctx.textBaseline = 'top';
      const pad = 12;
      const lines = getWrappedLines(ctx, obj, obj.w - pad * 2, 15);
      const lh = 15 * 1.3;
      lines.forEach((line, i) => ctx.fillText(line, obj.x + pad, obj.y + pad + i * lh));
      break;
    }
    case 'image': {
      let img = imageCache.get(obj.id);
      if (!img) {
        img = new Image();
        img.src = obj.src;
        img.onload = () => render();
        imageCache.set(obj.id, img);
      }
      if (img.complete && img.naturalWidth) ctx.drawImage(img, obj.x, obj.y, obj.w, obj.h);
      break;
    }
    case 'file':
      drawFileCard(ctx, obj);
      break;
  }
  ctx.restore();
}

let gridColorCache = '#d7d7dc';
let accentColorCache = '#2a2a2a';
let panelColorCache = '#ffffff';
let borderColorCache = '#e2e2e6';
let textColorCache = '#1c1c1e';
function updateGridColorCache() {
  const cs = getComputedStyle(document.documentElement);
  gridColorCache = cs.getPropertyValue('--dot').trim() || '#d7d7dc';
  accentColorCache = cs.getPropertyValue('--accent').trim() || '#2a2a2a';
  panelColorCache = cs.getPropertyValue('--panel').trim() || '#ffffff';
  borderColorCache = cs.getPropertyValue('--border').trim() || '#e2e2e6';
  textColorCache = cs.getPropertyValue('--text').trim() || '#1c1c1e';
}

function drawFileCard(c, obj) {
  const r = 10;
  c.save();
  c.fillStyle = panelColorCache;
  c.strokeStyle = borderColorCache;
  c.lineWidth = 1.5;
  c.shadowColor = 'rgba(0,0,0,0.18)';
  c.shadowBlur = 10;
  c.shadowOffsetY = 3;
  c.beginPath();
  c.moveTo(obj.x + r, obj.y);
  c.arcTo(obj.x + obj.w, obj.y, obj.x + obj.w, obj.y + obj.h, r);
  c.arcTo(obj.x + obj.w, obj.y + obj.h, obj.x, obj.y + obj.h, r);
  c.arcTo(obj.x, obj.y + obj.h, obj.x, obj.y, r);
  c.arcTo(obj.x, obj.y, obj.x + obj.w, obj.y, r);
  c.closePath();
  c.fill();
  c.shadowColor = 'transparent';
  c.stroke();

  const cx = obj.x + obj.w / 2;
  const iconTop = obj.y + obj.h * 0.16;
  const iconW = obj.w * 0.46, iconH = obj.h * 0.5;
  const ix = cx - iconW / 2, iy = iconTop;
  const fold = iconW * 0.28;
  c.fillStyle = '#e0405a';
  c.beginPath();
  c.moveTo(ix, iy);
  c.lineTo(ix + iconW - fold, iy);
  c.lineTo(ix + iconW, iy + fold);
  c.lineTo(ix + iconW, iy + iconH);
  c.lineTo(ix, iy + iconH);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath();
  c.moveTo(ix + iconW - fold, iy);
  c.lineTo(ix + iconW - fold, iy + fold);
  c.lineTo(ix + iconW, iy + fold);
  c.closePath();
  c.fill();

  c.fillStyle = '#ffffff';
  c.font = `700 ${Math.round(iconW * 0.24)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('PDF', ix + iconW / 2, iy + iconH * 0.62);

  c.fillStyle = textColorCache;
  c.font = `13px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  const label = (obj.name || 'document').length > 20 ? obj.name.slice(0, 18) + '…' : (obj.name || 'document');
  c.fillText(label, cx, iy + iconH + 12, obj.w - 16);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.restore();
}

function drawGrid() {
  if (!state.showGrid) return;
  const { panX, panY, zoom } = state.viewport;
  const steps = [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240];
  let step = steps[0];
  for (const s of steps) { if (s * zoom >= 24) { step = s; break; } step = s; }
  const w = wrap.clientWidth, h = wrap.clientHeight;
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(w, h);
  const startX = Math.floor(topLeft.x / step) * step;
  const startY = Math.floor(topLeft.y / step) * step;
  ctx.fillStyle = gridColorCache;
  for (let x = startX; x <= bottomRight.x; x += step) {
    for (let y = startY; y <= bottomRight.y; y += step) {
      const s = worldToScreen(x, y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Auto-extends pageBoxes to always cover the content/viewport with one spare
// page, for the auto-flowing 'vertical'/'horizontal' modes. Appends only from
// the last existing box, so manually dragged boxes are never touched.
// 'plus' mode is fully manual and never auto-extended.
function ensureAutoPageBoxes() {
  const mode = state.pageMode;
  if (mode !== 'vertical' && mode !== 'horizontal') return;
  const boxes = state.pageBoxes;
  if (!boxes.length) boxes.push({ id: uid(), x: 0, y: 0 });
  const bbox = getObjectsBBox(state.objects);
  if (mode === 'vertical') {
    const contentBottom = bbox ? bbox.y + bbox.h : 0;
    const viewBottom = screenToWorld(0, wrap.clientHeight).y;
    const needed = Math.max(contentBottom, viewBottom);
    let last = boxes[boxes.length - 1];
    while (last.y + A4_PAGE_H < needed + A4_PAGE_H) {
      last = { id: uid(), x: 0, y: last.y + A4_PAGE_H };
      boxes.push(last);
    }
  } else {
    const contentRight = bbox ? bbox.x + bbox.w : 0;
    const viewRight = screenToWorld(wrap.clientWidth, 0).x;
    const needed = Math.max(contentRight, viewRight);
    let last = boxes[boxes.length - 1];
    while (last.x + A4_PAGE_W < needed + A4_PAGE_W) {
      last = { id: uid(), x: last.x + A4_PAGE_W, y: 0 };
      boxes.push(last);
    }
  }
}

// Where the "+" add-page affordance sits in 'plus' mode: right after the last
// existing page box (vertically stacked), or at the origin if there are none yet.
function nextPlusBoxPos() {
  const boxes = state.pageBoxes;
  if (!boxes.length) return { x: 0, y: 0 };
  const last = boxes[boxes.length - 1];
  return { x: last.x, y: last.y + A4_PAGE_H + 40 };
}

const PAGE_BORDER_HIT_TOL = 10;
function hitPageBoxBorder(world) {
  const tol = PAGE_BORDER_HIT_TOL / state.viewport.zoom;
  for (let i = state.pageBoxes.length - 1; i >= 0; i--) {
    const b = state.pageBoxes[i];
    const inYRange = world.y > b.y - tol && world.y < b.y + A4_PAGE_H + tol;
    const inXRange = world.x > b.x - tol && world.x < b.x + A4_PAGE_W + tol;
    const nearLeft = inYRange && Math.abs(world.x - b.x) < tol;
    const nearRight = inYRange && Math.abs(world.x - (b.x + A4_PAGE_W)) < tol;
    const nearTop = inXRange && Math.abs(world.y - b.y) < tol;
    const nearBottom = inXRange && Math.abs(world.y - (b.y + A4_PAGE_H)) < tol;
    if (nearLeft || nearRight || nearTop || nearBottom) return i;
  }
  return null;
}

function hitPlusMarker(world) {
  if (state.pageMode !== 'plus') return false;
  const pos = nextPlusBoxPos();
  return world.x >= pos.x && world.x <= pos.x + A4_PAGE_W && world.y >= pos.y && world.y <= pos.y + A4_PAGE_H;
}

function drawPageOverlay() {
  ensureAutoPageBoxes();
  const zoom = state.viewport.zoom;
  const boxes = state.pageBoxes;
  ctx.save();
  ctx.strokeStyle = accentColorCache;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([8 / zoom, 6 / zoom]);
  for (const b of boxes) ctx.strokeRect(b.x, b.y, A4_PAGE_W, A4_PAGE_H);
  ctx.setLineDash([]);
  const r = 16 / zoom;
  ctx.font = `600 ${13 / zoom}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  boxes.forEach((b, i) => {
    const cx = b.x + r + 6 / zoom, cy = b.y + r + 6 / zoom;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = accentColorCache;
    ctx.fill();
    ctx.fillStyle = panelColorCache;
    ctx.fillText(String(i + 1), cx, cy + 1 / zoom);
  });
  if (state.pageMode === 'plus') {
    const pos = nextPlusBoxPos();
    ctx.setLineDash([8 / zoom, 6 / zoom]);
    ctx.globalAlpha = 0.6;
    ctx.strokeRect(pos.x, pos.y, A4_PAGE_W, A4_PAGE_H);
    ctx.setLineDash([]);
    const cx = pos.x + A4_PAGE_W / 2, cy = pos.y + A4_PAGE_H / 2;
    const armLen = 20 / zoom;
    ctx.lineWidth = 3 / zoom;
    ctx.beginPath();
    ctx.moveTo(cx - armLen, cy);
    ctx.lineTo(cx + armLen, cy);
    ctx.moveTo(cx, cy - armLen);
    ctx.lineTo(cx, cy + armLen);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawSelectionOverlay() {
  if (!state.selection.length) return;
  const zoom = state.viewport.zoom;
  ctx.save();
  ctx.strokeStyle = accentColorCache;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  for (const obj of state.selection) {
    const b = getObjBBox(obj);
    ctx.strokeRect(b.x - 4 / zoom, b.y - 4 / zoom, b.w + 8 / zoom, b.h + 8 / zoom);
  }
  ctx.setLineDash([]);
  if (state.selection.length === 1) {
    const obj = state.selection[0];
    const handles = getHandles(obj);
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5 / zoom;
    const hs = HANDLE_PX / zoom;
    for (const h of handles) {
      ctx.beginPath();
      ctx.rect(h.x - hs / 2, h.y - hs / 2, hs, hs);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function getHandles(obj) {
  if (obj.type === 'line' || obj.type === 'arrow') {
    return [
      { name: 'p1', x: obj.x1, y: obj.y1 },
      { name: 'p2', x: obj.x2, y: obj.y2 }
    ];
  }
  const b = getObjBBox(obj);
  return [
    { name: 'nw', x: b.x, y: b.y },
    { name: 'ne', x: b.x + b.w, y: b.y },
    { name: 'sw', x: b.x, y: b.y + b.h },
    { name: 'se', x: b.x + b.w, y: b.y + b.h }
  ];
}

// Viewport culling: a board with several pages of content has most of it off-screen at any
// given time, and drawObject() re-runs for every object on every render — which fires on
// nearly every pointer move, including while actively drawing with the pen. Skipping objects
// whose bbox doesn't intersect the visible area (plus a small margin so nothing pops in/out
// right at the edge) keeps that cost proportional to what's on screen, not the whole board.
function getVisibleWorldRect() {
  const margin = 150 / state.viewport.zoom;
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(wrap.clientWidth, wrap.clientHeight);
  return {
    x: topLeft.x - margin,
    y: topLeft.y - margin,
    w: (bottomRight.x - topLeft.x) + margin * 2,
    h: (bottomRight.y - topLeft.y) + margin * 2
  };
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  drawGrid();
  ctx.save();
  ctx.translate(state.viewport.panX, state.viewport.panY);
  ctx.scale(state.viewport.zoom, state.viewport.zoom);
  if (state.pageMode !== 'off') drawPageOverlay();
  const visibleRect = getVisibleWorldRect();
  for (const obj of state.objects) {
    if (!bboxIntersects(getObjBBox(obj), visibleRect)) continue;
    drawObject(obj);
  }
  if (drawingObj) drawObject(drawingObj);
  drawSelectionOverlay();
  ctx.restore();
  updateSelectionToolbarPos();
  zoomLevelEl.textContent = Math.round(state.viewport.zoom * 100) + '%';
}

// ---------- Fast path for an in-progress pen/highlighter stroke ----------
// Re-running the full render() (grid + every visible object) on every pointermove while writing
// is what caused the lag on boards with several pages of dense text — none of that static
// content actually changes while a stroke is being drawn, only the growing line does. So at the
// moment a stroke starts, everything else is snapshotted once onto an offscreen canvas; each
// pointermove during that stroke then just blits the snapshot (cheap, independent of how many
// objects are on the board) and draws the live stroke on top of it.
let strokeStaticCanvas = null;
let strokeStaticCtx = null;

function prepareStrokeStaticLayer() {
  if (!strokeStaticCanvas) strokeStaticCanvas = document.createElement('canvas');
  if (strokeStaticCanvas.width !== canvas.width || strokeStaticCanvas.height !== canvas.height) {
    strokeStaticCanvas.width = canvas.width;
    strokeStaticCanvas.height = canvas.height;
    strokeStaticCtx = strokeStaticCanvas.getContext('2d');
  }
  const liveObj = drawingObj;
  drawingObj = null; // the in-progress stroke must not be baked into the static snapshot
  ctx = strokeStaticCtx;
  render();
  ctx = mainCtx;
  drawingObj = liveObj;
}

function renderDuringStroke() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(strokeStaticCanvas, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.save();
  ctx.translate(state.viewport.panX, state.viewport.panY);
  ctx.scale(state.viewport.zoom, state.viewport.zoom);
  if (drawingObj) {
    // Once part of the stroke has been baked into the static snapshot (see
    // maybeBakeStrokeProgress below), only the still-live tail needs to be traced here —
    // otherwise this would keep re-tracing the whole growing stroke on every single frame.
    const bakedUpTo = (drag && drag.mode === 'draw-stroke') ? drag.bakedUpTo : 0;
    const obj = bakedUpTo > 0 ? { ...drawingObj, points: drawingObj.points.slice(bakedUpTo) } : drawingObj;
    drawObject(obj);
  }
  ctx.restore();
}

// A freehand stroke is re-traced from its very first point on every single frame while it grows
// (tracePointsSmooth has no notion of "what's new"), so a long, fast, continuous stroke gets
// quadratically slower the longer it gets — this is what made writing feel laggy specifically on
// long strokes. Every STROKE_BAKE_CHUNK points, the older portion is painted once onto the static
// snapshot canvas (permanently "baked in", like the rest of the board) and dropped from the live
// tail, so the live trace cost stays bounded no matter how long the stroke grows. STROKE_LIVE_TAIL
// points are always left un-baked so the curve has the context it needs to stay smooth.
const STROKE_BAKE_CHUNK = 40;
const STROKE_LIVE_TAIL = 2;

function maybeBakeStrokeProgress() {
  if (!drag || drag.mode !== 'draw-stroke' || !drawingObj) return;
  const pts = drawingObj.points;
  const bakeTo = pts.length - STROKE_LIVE_TAIL;
  if (bakeTo - drag.bakedUpTo < STROKE_BAKE_CHUNK) return;
  const segment = pts.slice(drag.bakedUpTo, bakeTo + 1);
  const savedCtx = ctx;
  ctx = strokeStaticCtx;
  ctx.save();
  ctx.translate(state.viewport.panX, state.viewport.panY);
  ctx.scale(state.viewport.zoom, state.viewport.zoom);
  drawObject({ ...drawingObj, points: segment });
  ctx.restore();
  ctx = savedCtx;
  drag.bakedUpTo = bakeTo;
}

// Holding the pen still for 600ms while drawing snaps the stroke-so-far into a straight line
// (a quick way to draw a ruler-straight line without switching to the Line tool). Snapping it
// instantly looked like the ink briefly "teleporting" backward before jumping to the straight
// shape, so the transition is animated instead — each existing point eases toward its position
// on the final straight line over ~180ms rather than jumping there in one frame.
function armHoldTimer() {
  if (drag && drag.holdTimerId) clearTimeout(drag.holdTimerId);
  if (!drag) return;
  drag.holdTimerId = setTimeout(() => {
    // Once a stroke is long enough to have been baked (see maybeBakeStrokeProgress), its earlier
    // portion is already permanently painted into the static snapshot — straightening could only
    // still move the live tail, not that baked-in part, so the result would look broken. Realistically
    // nobody holds still mid-paragraph wanting the whole thing to become a straight line anyway.
    if (drag && drag.mode === 'draw-stroke' && drawingObj && !drag.straightened && !drag.animating && !drag.bakedUpTo) {
      startStraightenAnimation();
    }
  }, 600);
}

function startStraightenAnimation() {
  const origPoints = drawingObj.points.slice();
  const startPoint = drag.startPoint;
  const endPoint = origPoints[origPoints.length - 1];
  const lastIndex = origPoints.length - 1;
  const duration = 180;
  const t0 = performance.now();
  drag.animating = true;
  drag.pendingEnd = null;

  function step(now) {
    if (!drag || drag.mode !== 'draw-stroke' || !drawingObj) return; // stroke ended mid-animation
    const t = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    drawingObj.points = origPoints.map((p, i) => {
      const frac = lastIndex > 0 ? i / lastIndex : 0;
      const tx = startPoint.x + (endPoint.x - startPoint.x) * frac;
      const ty = startPoint.y + (endPoint.y - startPoint.y) * frac;
      return { x: p.x + (tx - p.x) * eased, y: p.y + (ty - p.y) * eased };
    });
    renderDuringStroke();
    if (t < 1) {
      drag.animFrameId = requestAnimationFrame(step);
    } else {
      drag.animating = false;
      drag.straightened = true;
      drawingObj.points = [startPoint, drag.pendingEnd || endPoint];
      renderDuringStroke();
    }
  }
  drag.animFrameId = requestAnimationFrame(step);
}

// ---------- Hit testing ----------
function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * dx, cy = a.y + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

function hitObject(obj, pos, tol) {
  switch (obj.type) {
    case 'stroke': {
      for (let i = 0; i < obj.points.length - 1; i++) {
        if (distToSegment(pos, obj.points[i], obj.points[i + 1]) <= tol + obj.width / 2) return true;
      }
      if (obj.points.length === 1) return Math.hypot(pos.x - obj.points[0].x, pos.y - obj.points[0].y) <= tol + obj.width / 2;
      return false;
    }
    case 'line':
    case 'arrow':
      return distToSegment(pos, { x: obj.x1, y: obj.y1 }, { x: obj.x2, y: obj.y2 }) <= tol + obj.width / 2;
    case 'rect': {
      const b = getObjBBox(obj);
      if (obj.filled) {
        return pos.x >= b.x - tol && pos.x <= b.x + b.w + tol && pos.y >= b.y - tol && pos.y <= b.y + b.h + tol;
      }
      const inner = tol + obj.width / 2;
      const outerHit = pos.x >= b.x - inner && pos.x <= b.x + b.w + inner && pos.y >= b.y - inner && pos.y <= b.y + b.h + inner;
      if (!outerHit) return false;
      const innerHit = pos.x >= b.x + inner && pos.x <= b.x + b.w - inner && pos.y >= b.y + inner && pos.y <= b.y + b.h - inner;
      return !innerHit;
    }
    case 'ellipse': {
      const cx = obj.x + obj.w / 2, cy = obj.y + obj.h / 2;
      if (obj.filled) {
        const rxF = Math.abs(obj.w / 2) + tol, ryF = Math.abs(obj.h / 2) + tol;
        if (rxF <= 0 || ryF <= 0) return false;
        const nxF = (pos.x - cx) / rxF, nyF = (pos.y - cy) / ryF;
        return nxF * nxF + nyF * nyF <= 1;
      }
      const rx = Math.abs(obj.w / 2) + tol, ry = Math.abs(obj.h / 2) + tol;
      if (rx <= 0 || ry <= 0) return false;
      const nx = (pos.x - cx) / rx, ny = (pos.y - cy) / ry;
      const dist = nx * nx + ny * ny;
      const rx2 = Math.abs(obj.w / 2) - tol, ry2 = Math.abs(obj.h / 2) - tol;
      const nx2 = (pos.x - cx) / Math.max(rx2, 0.01), ny2 = (pos.y - cy) / Math.max(ry2, 0.01);
      const dist2 = nx2 * nx2 + ny2 * ny2;
      return dist <= 1 && dist2 >= 1;
    }
    case 'note':
    case 'image':
    case 'file':
    case 'axes2d':
    case 'axes3d':
    case 'trigcircle':
    case 'text': {
      const b = getObjBBox(obj);
      return pos.x >= b.x - tol && pos.x <= b.x + b.w + tol && pos.y >= b.y - tol && pos.y <= b.y + b.h + tol;
    }
  }
  return false;
}

function getObjectAt(pos) {
  const tol = HIT_TOL_PX / state.viewport.zoom;
  for (let i = state.objects.length - 1; i >= 0; i--) {
    if (hitObject(state.objects[i], pos, tol)) return state.objects[i];
  }
  return null;
}

function bboxIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// ---------- History ----------
// pushHistory() runs synchronously right as a stroke/shape starts (so undo captures the
// "before" state) — on a board with many pages of content, JSON.stringify-ing the whole
// object graph on every single stroke start was the actual cause of the stutter right at that
// moment. structuredClone() is a native deep-clone (no text ser/deserialize round trip) and
// is noticeably cheaper for the same object graph.
function pushHistory() {
  history.undo.push(structuredClone({ objects: state.objects, pageBoxes: state.pageBoxes }));
  if (history.undo.length > 100) history.undo.shift();
  history.redo = [];
}

// A pure addition (new stroke/shape/text/note) never mutates anything already on the board —
// undo/redo for it only needs to remember which single object to remove/restore. Deep-cloning
// the entire board via pushHistory() on every stroke start was the dominant remaining cost
// behind the stutter felt right as a new stroke begins on a text-heavy board.
function pushAddHistory(id) {
  history.undo.push({ addId: id });
  if (history.undo.length > 100) history.undo.shift();
  history.redo = [];
}

function undo() {
  if (!history.undo.length) return;
  closeEditor(true);
  const entry = history.undo.pop();
  if (entry.addId != null) {
    const idx = state.objects.findIndex(o => o.id === entry.addId);
    const removed = idx >= 0 ? state.objects.splice(idx, 1)[0] : null;
    history.redo.push({ addId: entry.addId, addObj: removed });
  } else {
    history.redo.push(structuredClone({ objects: state.objects, pageBoxes: state.pageBoxes }));
    state.objects = entry.objects;
    state.pageBoxes = entry.pageBoxes || [];
  }
  state.selection = [];
  render(); scheduleSave();
}
function redo() {
  if (!history.redo.length) return;
  closeEditor(true);
  const entry = history.redo.pop();
  if (entry.addId != null) {
    if (entry.addObj) state.objects.push(entry.addObj);
    history.undo.push({ addId: entry.addId });
  } else {
    history.undo.push(structuredClone({ objects: state.objects, pageBoxes: state.pageBoxes }));
    state.objects = entry.objects;
    state.pageBoxes = entry.pageBoxes || [];
  }
  state.selection = [];
  render(); scheduleSave();
}

// ---------- Tool UI (Whiteboard-style pill + contextual flyouts) ----------
const PEN_PRESETS = [
  { color: '#1a1a1a', tool: 'pen' },
  { color: '#e03131', tool: 'pen' },
  { color: '#FF8A1F', tool: 'pen' },
  { color: '#6DC82A', tool: 'pen' },
  { color: '#57B3FE', tool: 'pen' },
  { color: '#9c36b5', tool: 'pen' },
  { color: '#ffffff', tool: 'pen' }
];
const SHAPE_PRESETS = [
  { type: 'rect', label: 'Rectangle' },
  { type: 'ellipse', label: 'Ellipse' },
  { type: 'line', label: 'Ligne' },
  { type: 'arrow', label: 'Flèche' }
];
const SVG_ICONS = {
  eraser: '<path d="M16 3l5 5-9.5 9.5H6L2.5 14 12 4.5 16 3z"/><path d="M6 17.5H21"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M19 5h-6M19 5v6"/>',
  axes2d: '<path d="M4 20h17M4 20V3"/><path d="M21 20l-2.9 1.4M21 20l-2.9-1.4"/><path d="M4 3l1.3 2.9M4 3l-1.4 2.9"/>',
  axes3d: '<path d="M12 16h10M12 16V4M12 16L2.5 10.5"/><path d="M22 16l-2.9 1.3M22 16l-2.9-1.4"/><path d="M12 4l1.3 2.9M12 4l-1.4 2.9"/><path d="M2.5 10.5l3.2 .3M2.5 10.5l1.8 2.6"/>',
  trigcircle: '<circle cx="12" cy="12" r="8"/><path d="M12 2v20M2 12h20"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><rect x="7.3" y="4.5" width="9.4" height="4" rx="0.6"/><rect x="7.3" y="11.8" width="2.2" height="2.2" rx="0.4"/><rect x="10.9" y="11.8" width="2.2" height="2.2" rx="0.4"/><rect x="14.5" y="11.8" width="2.2" height="2.2" rx="0.4"/><rect x="7.3" y="15.8" width="2.2" height="2.2" rx="0.4"/><rect x="10.9" y="15.8" width="2.2" height="2.2" rx="0.4"/><rect x="14.5" y="15.8" width="2.2" height="2.2" rx="0.4"/>',
  selectArrow: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="currentColor"/>',
  lassoArrow: '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.3 2"/>',
  text: '<path d="M5 6h14M12 6v13"/>',
  note: '<path d="M4 4h16v11l-5 5H4V4z"/><path d="M15 20v-5h5"/>'
};

let activeFlyout = null; // 'pen' | 'shapes' | null

function setTool(tool) {
  if (state.tool === 'text' || state.tool === 'note') closeEditor(true);
  state.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
    const match = b.dataset.tool === tool || (b.dataset.tool === 'select' && tool === 'lasso');
    b.classList.toggle('active', match);
  });
  const penBtn = document.querySelector('.tool-btn[data-tool="pen"]');
  if (penBtn) penBtn.style.color = (tool === 'pen') ? state.color : '';
  applyToolCursor();
  closeFlyout();
  clearSelection();
}

function closeFlyout() {
  activeFlyout = null;
  toolFlyoutEl.classList.remove('visible');
  toolFlyoutEl.innerHTML = '';
}

function openFlyout(kind) {
  activeFlyout = kind;
  toolFlyoutEl.innerHTML = '';
  toolFlyoutEl.classList.add('visible');
  if (kind === 'pen') buildPenFlyout();
  else if (kind === 'shapes') buildShapesFlyout();
  else if (kind === 'maths') buildMathsFlyout();
  else if (kind === 'select') buildSelectFlyout();
}

function svgIcon(name) {
  const span = document.createElement('span');
  span.className = 'flyout-shape-icon-wrap';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.classList.add('flyout-shape-icon');
  svg.innerHTML = SVG_ICONS[name] || '';
  span.appendChild(svg);
  return span;
}

function mkDot(color) {
  const d = document.createElement('span');
  d.className = 'flyout-dot';
  d.style.color = color;
  return d;
}

function mkSep() {
  const s = document.createElement('span');
  s.className = 'flyout-sep';
  return s;
}

function mkFlyoutBtn(content, opts = {}) {
  const b = document.createElement('button');
  b.className = 'flyout-btn' + (opts.active ? ' active' : '') + (opts.filled ? ' flyout-btn-filled' : '');
  if (opts.title) b.title = opts.title;
  if (typeof content === 'string') b.textContent = content;
  else b.appendChild(content);
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

function mkWidthSelect() {
  const sel = document.createElement('select');
  sel.className = 'flyout-width-select';
  [[2, 'Fin'], [4, 'Moyen'], [8, 'Épais'], [16, 'Très épais']].forEach(([v, label]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = label;
    if (v === state.strokeWidth) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { state.strokeWidth = parseInt(sel.value, 10); updateCursorScale(); updateEraserRing(null); });
  return sel;
}

function buildPenFlyout() {
  const row = document.createElement('div');
  row.className = 'flyout-row';
  PEN_PRESETS.forEach(p => {
    row.appendChild(mkFlyoutBtn(mkDot(p.color), {
      active: state.tool === p.tool && state.color === p.color,
      title: 'Stylo',
      onClick: () => { state.color = p.color; setTool(p.tool); openFlyout('pen'); }
    }));
  });
  row.appendChild(mkSep());
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = state.color;
  colorInput.title = 'Couleur personnalisée';
  colorInput.className = 'flyout-color-input';
  colorInput.addEventListener('input', () => applyCustomColor(colorInput.value));
  row.appendChild(colorInput);
  row.appendChild(mkWidthSelect());
  row.appendChild(mkSep());
  row.appendChild(mkFlyoutBtn(svgIcon('eraser'), { active: state.tool === 'eraser', title: 'Gomme (V)', onClick: () => { setTool('eraser'); openFlyout('pen'); } }));
  row.appendChild(mkFlyoutBtn(svgIcon('eraser'), { active: state.tool === 'eraser_partial', title: 'Gomme partielle', filled: true, onClick: () => { setTool('eraser_partial'); openFlyout('pen'); } }));
  row.appendChild(mkFlyoutBtn('✕', { title: 'Fermer', onClick: closeFlyout }));
  toolFlyoutEl.appendChild(row);
}

function applyCustomColor(c) {
  state.color = c;
  const penBtn = document.querySelector('.tool-btn[data-tool="pen"]');
  if (penBtn && state.tool === 'pen') penBtn.style.color = c;
  customCursorEl.style.color = c;
  applyColorToSelection(c);
}

function buildSelectFlyout() {
  const row = document.createElement('div');
  row.className = 'flyout-row';
  row.appendChild(mkFlyoutBtn(svgIcon('selectArrow'), {
    active: state.tool === 'select',
    title: 'Sélection',
    onClick: () => { state.lastSelectTool = 'select'; setTool('select'); openFlyout('select'); }
  }));
  row.appendChild(mkFlyoutBtn(svgIcon('lassoArrow'), {
    active: state.tool === 'lasso',
    title: 'Sélection lasso',
    onClick: () => { state.lastSelectTool = 'lasso'; setTool('lasso'); openFlyout('select'); }
  }));
  toolFlyoutEl.appendChild(row);
}

function buildShapesFlyout() {
  const row = document.createElement('div');
  row.className = 'flyout-row';
  SHAPE_PRESETS.forEach(s => {
    row.appendChild(mkFlyoutBtn(svgIcon(s.type), {
      active: state.tool === s.type,
      title: s.label,
      onClick: () => { state.lastShapeTool = s.type; setTool(s.type); openFlyout('shapes'); }
    }));
  });
  row.appendChild(mkSep());
  PALETTE.forEach(c => {
    row.appendChild(mkFlyoutBtn(mkDot(c), {
      active: state.color === c,
      onClick: () => { state.color = c; applyColorToSelection(c); openFlyout('shapes'); }
    }));
  });
  row.appendChild(mkSep());
  row.appendChild(mkWidthSelect());
  row.appendChild(mkFlyoutBtn('✕', { title: 'Fermer', onClick: closeFlyout }));
  toolFlyoutEl.appendChild(row);
}

function mkLabelBtn(label, opts) {
  const b = mkFlyoutBtn(label, opts);
  b.classList.add('flyout-btn-label');
  return b;
}

function buildMathsFlyout() {
  const row = document.createElement('div');
  row.className = 'flyout-row';
  row.appendChild(mkFlyoutBtn(svgIcon('calculator'), {
    active: calcOpen,
    title: 'Calculatrice scientifique',
    onClick: () => { toggleCalc(); closeFlyout(); }
  }));
  row.appendChild(mkSep());
  row.appendChild(mkFlyoutBtn(svgIcon('axes2d'), {
    title: 'Placer un repère orthogonal xy gradué',
    onClick: () => { insertAxes2D(); }
  }));
  row.appendChild(mkFlyoutBtn(svgIcon('axes3d'), {
    title: 'Placer un repère orthogonal xyz gradué',
    onClick: () => { insertAxes3D(); }
  }));
  row.appendChild(mkFlyoutBtn(svgIcon('trigcircle'), {
    title: 'Placer un cercle trigonométrique gradué',
    onClick: () => { insertTrigCircle(); }
  }));
  row.appendChild(mkFlyoutBtn('✕', { title: 'Fermer', onClick: closeFlyout }));
  toolFlyoutEl.appendChild(row);
}

function mathObjectColor() {
  return state.theme === 'dark' ? '#ffffff' : state.color;
}

function insertAxes2D() {
  pushHistory();
  const center = screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
  const w = 320, h = 320;
  const obj = { id: uid(), type: 'axes2d', x: center.x - w / 2, y: center.y - h / 2, w, h, color: mathObjectColor(), tickCount: 20, showNumbers: false };
  state.objects.push(obj);
  setTool('select');
  state.selection = [obj];
  render(); scheduleSave();
}

function insertAxes3D() {
  pushHistory();
  const center = screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
  const w = 340, h = 340;
  const obj = { id: uid(), type: 'axes3d', x: center.x - w / 2, y: center.y - h / 2, w, h, color: mathObjectColor(), tickCount: 20, showNumbers: false };
  state.objects.push(obj);
  setTool('select');
  state.selection = [obj];
  render(); scheduleSave();
}

function insertTrigCircle() {
  pushHistory();
  const center = screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
  const size = 300;
  const obj = { id: uid(), type: 'trigcircle', x: center.x - size / 2, y: center.y - size / 2, w: size, h: size, color: mathObjectColor(), showAngles: false, angleUnit: 'deg' };
  state.objects.push(obj);
  setTool('select');
  state.selection = [obj];
  render(); scheduleSave();
}

// ---------- Scientific calculator ----------
// Self-contained expression evaluator (tokenizer + recursive-descent parser).
// Supports numeric expressions only (no variables/solving), matching a
// scientific calculator's scope rather than a full symbolic engine.
const MATH_FUNCS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'ln', 'log', 'log2', 'exp',
  'abs', 'floor', 'ceil', 'round'
]);
const MATH_CONSTS = { pi: Math.PI, 'π': Math.PI, e: Math.E };

function mathTokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push({ type: 'num', value: parseFloat(expr.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[a-zA-Zπ]/.test(c)) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9π]/.test(expr[j])) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '×') { tokens.push({ type: 'op', value: '*' }); i++; continue; }
    if (c === '÷') { tokens.push({ type: 'op', value: '/' }); i++; continue; }
    if ('+-*/^%(),!'.includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue; }
    throw new Error('Caractère invalide : ' + c);
  }
  return tokens;
}

function mathInsertImplicitMul(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    out.push(t);
    const next = tokens[i + 1];
    if (!next) continue;
    const curEndsValue = t.type === 'num' || t.type === 'ident' || (t.type === 'op' && t.value === ')');
    const nextStartsValue = next.type === 'num' || next.type === 'ident' || (next.type === 'op' && next.value === '(');
    if (curEndsValue && nextStartsValue) {
      if (t.type === 'ident' && next.type === 'op' && next.value === '(' && MATH_FUNCS.has(t.value.toLowerCase())) continue;
      out.push({ type: 'op', value: '*' });
    }
  }
  return out;
}

function mathParse(tokens, degMode) {
  let pos = 0;
  const peek = () => tokens[pos];
  const consume = (val) => {
    if (peek() && peek().value === val) { pos++; return true; }
    return false;
  };
  const expect = (val) => {
    if (!consume(val)) throw new Error(`Attendu "${val}"`);
  };

  function parseExpr() {
    let v = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = tokens[pos++].value;
      const rhs = parseTerm();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm() {
    let v = parseUnary();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/')) {
      const op = tokens[pos++].value;
      const rhs = parseUnary();
      if (op === '*') v *= rhs;
      else v /= rhs;
    }
    return v;
  }
  function parseUnary() {
    if (peek() && peek().value === '-') { pos++; return -parseUnary(); }
    if (peek() && peek().value === '+') { pos++; return parseUnary(); }
    return parsePower();
  }
  function parsePower() {
    const base = parsePostfix();
    if (peek() && peek().value === '^') {
      pos++;
      const exp = parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }
  function parsePostfix() {
    let v = parsePrimary();
    while (peek() && (peek().value === '!' || peek().value === '%')) {
      const op = tokens[pos++].value;
      v = op === '!' ? mathFactorial(v) : v / 100;
    }
    return v;
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error('Expression incomplète');
    if (t.type === 'num') { pos++; return t.value; }
    if (t.value === '(') {
      pos++;
      const v = parseExpr();
      expect(')');
      return v;
    }
    if (t.type === 'ident') {
      pos++;
      const name = t.value.toLowerCase();
      if (peek() && peek().value === '(') {
        pos++;
        const args = [parseExpr()];
        while (consume(',')) args.push(parseExpr());
        expect(')');
        return mathCallFunc(name, args, degMode);
      }
      if (name in MATH_CONSTS) return MATH_CONSTS[name];
      throw new Error('Inconnu : ' + t.value);
    }
    throw new Error('Expression invalide');
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error('Caractères en trop');
  return result;
}

function mathFactorial(n) {
  if (n < 0 || Math.floor(n) !== n) throw new Error('Factorielle invalide');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function mathCallFunc(name, args, degMode) {
  const x = args[0];
  const toRad = (v) => degMode ? v * Math.PI / 180 : v;
  const toDeg = (v) => degMode ? v * 180 / Math.PI : v;
  switch (name) {
    case 'sin': return Math.sin(toRad(x));
    case 'cos': return Math.cos(toRad(x));
    case 'tan': return Math.tan(toRad(x));
    case 'asin': return toDeg(Math.asin(x));
    case 'acos': return toDeg(Math.acos(x));
    case 'atan': return toDeg(Math.atan(x));
    case 'sinh': return Math.sinh(x);
    case 'cosh': return Math.cosh(x);
    case 'tanh': return Math.tanh(x);
    case 'sqrt': return Math.sqrt(x);
    case 'cbrt': return Math.cbrt(x);
    case 'ln': return Math.log(x);
    case 'log': return Math.log10(x);
    case 'log2': return Math.log2(x);
    case 'exp': return Math.exp(x);
    case 'abs': return Math.abs(x);
    case 'floor': return Math.floor(x);
    case 'ceil': return Math.ceil(x);
    case 'round': return Math.round(x);
    default: throw new Error('Fonction inconnue : ' + name);
  }
}

function evaluateMathExpression(expr, degMode) {
  const tokens = mathInsertImplicitMul(mathTokenize(expr));
  return mathParse(tokens, degMode);
}

let calcOpen = false;
let calcDegMode = true;
const calcPanelEl = document.getElementById('calc-panel');
const calcInputEl = document.getElementById('calc-input');
const calcResultEl = document.getElementById('calc-result');
const calcButtonsEl = document.getElementById('calc-buttons');
const calcModeToggleEl = document.getElementById('calc-mode-toggle');
const calcStarsEl = document.getElementById('calc-stars');

const CALC_BUTTON_ROWS = [
  ['(', ')', 'C', '⌫', '%'],
  ['sin', 'cos', 'tan', '^', '√'],
  ['asin', 'acos', 'atan', 'ln', 'log'],
  ['7', '8', '9', '/', 'π'],
  ['4', '5', '6', '*', 'e'],
  ['1', '2', '3', '-', '!'],
  ['0', '.', '=', '+']
];

function buildCalcButtons() {
  calcButtonsEl.innerHTML = '';
  CALC_BUTTON_ROWS.forEach(row => {
    row.forEach(label => {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (label === '=') btn.classList.add('calc-eq');
      btn.addEventListener('click', () => calcButtonPress(label));
      calcButtonsEl.appendChild(btn);
    });
  });
}

function calcButtonPress(label) {
  if (label === 'C') { calcInputEl.value = ''; calcResultEl.textContent = ''; calcResultEl.classList.remove('error'); calcInputEl.focus(); return; }
  if (label === '⌫') { calcInputEl.value = calcInputEl.value.slice(0, -1); calcInputEl.focus(); return; }
  if (label === '=') { calcEvaluate(); return; }
  const insertMap = { '√': 'sqrt(' };
  const needsParen = MATH_FUNCS.has(label);
  const toInsert = insertMap[label] || (needsParen ? label + '(' : label);
  calcInputEl.value += toInsert;
  calcInputEl.focus();
}

function calcEvaluate() {
  const expr = calcInputEl.value.trim();
  if (!expr) return;
  try {
    const result = evaluateMathExpression(expr, calcDegMode);
    const rounded = Math.round(result * 1e10) / 1e10;
    calcResultEl.textContent = '= ' + rounded;
    calcResultEl.classList.remove('error');
  } catch (err) {
    calcResultEl.textContent = 'Erreur : ' + err.message;
    calcResultEl.classList.add('error');
  }
}

function toggleCalc(forceShow) {
  calcOpen = typeof forceShow === 'boolean' ? forceShow : !calcOpen;
  calcPanelEl.classList.toggle('hidden', !calcOpen);
  calcStarsEl.classList.toggle('visible', calcOpen);
  if (calcOpen) {
    if (!calcButtonsEl.childElementCount) buildCalcButtons();
    if (!calcStarsEl.childElementCount) buildRisingStars(calcStarsEl, 'calc-star');
    setTimeout(() => calcInputEl.focus(), 0);
  }
}

calcInputEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') { e.preventDefault(); calcEvaluate(); }
  if (e.key === 'Escape') { e.preventDefault(); toggleCalc(false); }
});
document.getElementById('calc-close').addEventListener('click', () => toggleCalc(false));
calcModeToggleEl.addEventListener('click', () => {
  calcDegMode = !calcDegMode;
  calcModeToggleEl.textContent = calcDegMode ? 'DEG' : 'RAD';
  calcModeToggleEl.classList.toggle('active', !calcDegMode);
});

document.querySelectorAll('#bottom-toolbar .tool-btn[data-flyout]').forEach(btn => {
  btn.addEventListener('click', () => {
    const kind = btn.dataset.flyout;
    const wasOpen = activeFlyout === kind;
    if (kind === 'maths') {
      closeFlyout();
      if (!wasOpen) openFlyout(kind);
      return;
    }
    const tool = kind === 'shapes' ? state.lastShapeTool : kind === 'select' ? state.lastSelectTool : btn.dataset.tool;
    setTool(tool);
    if (!wasOpen) openFlyout(kind);
  });
});

document.querySelectorAll('#bottom-toolbar .tool-btn[data-tool]:not([data-flyout])').forEach(btn => {
  btn.addEventListener('click', () => setTool(btn.dataset.tool));
});

document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);

const gridBtn = document.getElementById('btn-grid');
gridBtn.classList.toggle('active', state.showGrid);
gridBtn.addEventListener('click', () => {
  state.showGrid = !state.showGrid;
  gridBtn.classList.toggle('active', state.showGrid);
  render();
});

document.getElementById('btn-insert').addEventListener('click', () => {
  pendingImagePos = null;
  imageInput.click();
});

function applyColorToSelection(c) {
  if (!state.selection.length) return;
  pushHistory();
  for (const obj of state.selection) obj.color = c;
  render(); scheduleSave();
}

// ---------- Pointer interaction ----------
let pendingImagePos = null;

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('dblclick', onDblClick);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

function svgCursorUrl(svgBody, hx, hy) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24">${svgBody}</svg>`;
  const b64 = btoa(unescape(encodeURIComponent(svg)));
  return `url(data:image/svg+xml;base64,${b64}) ${hx} ${hy}, auto`;
}
const SELECT_CURSOR = svgCursorUrl(
  '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="#1a1a1a" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>',
  3, 3
);
// Same arrow as SELECT_CURSOR but dashed-outline/hollow, matching the lasso flyout icon — the
// white base stroke keeps it readable on dark backgrounds, the dark dashed stroke on top gives
// the "empty center" look on light ones.
const LASSO_CURSOR = svgCursorUrl(
  '<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="none" stroke="#ffffff" stroke-width="3" stroke-linejoin="round"/><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="none" stroke="#1a1a1a" stroke-width="1.4" stroke-dasharray="2.2 2" stroke-linejoin="round"/>',
  3, 3
);
const HAND_CURSOR = svgCursorUrl(
  '<path d="M8 12V5a1.5 1.5 0 0 1 3 0v5M11 10V3.5a1.5 1.5 0 0 1 3 0V10m3 0V5a1.5 1.5 0 0 1 3 0v9c0 3.5-2 7-6 7s-6-2-8-5l-1.5-3c-.5-1 0-2 1-2.2.7-.15 1.3.1 1.8.7L8 13" fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 12V5a1.5 1.5 0 0 1 3 0v5M11 10V3.5a1.5 1.5 0 0 1 3 0V10m3 0V5a1.5 1.5 0 0 1 3 0v9c0 3.5-2 7-6 7s-6-2-8-5l-1.5-3c-.5-1 0-2 1-2.2.7-.15 1.3.1 1.8.7L8 13" fill="none" stroke="#1a1a1a" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  12, 8
);

let mouseOverCanvas = false;
// Tracked on every pointermove so paste (Ctrl+V) can drop the new object under the cursor
// instead of at a fixed offset or the viewport center — falls back to viewport center only
// when the mouse has never been over the canvas (e.g. paste right after launch).
let lastMouseScreenPos = null;
function getPasteWorldPos() {
  return lastMouseScreenPos
    ? screenToWorld(lastMouseScreenPos.x, lastMouseScreenPos.y)
    : screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
}
function updateCustomCursorVisibility() {
  // select/lasso/hand all use a native OS cursor (instant, no lag) — the custom dot is a JS-
  // positioned element for the other tools and must never show alongside those, or it renders
  // as a second cursor visibly trailing behind the real one.
  const useDot = state.tool !== 'select' && state.tool !== 'lasso' && state.tool !== 'hand';
  customCursorEl.classList.toggle('visible', useDot && mouseOverCanvas);
}
function applyToolCursor() {
  if (state.tool === 'lasso') canvas.style.cursor = LASSO_CURSOR;
  else if (state.tool === 'select') canvas.style.cursor = SELECT_CURSOR;
  else if (state.tool === 'hand') canvas.style.cursor = HAND_CURSOR;
  else canvas.style.cursor = 'none';
  updateCustomCursorVisibility();
  updateCursorScale();
  updateCursorBadge();
  updateEraserRing(null);
}

// Shows a small badge at the bottom-right of the custom dot cursor for tools that place a
// specific kind of object, so it's clear at a glance what clicking will create.
const CURSOR_BADGE_TOOLS = ['note', 'text', 'rect', 'ellipse'];
function updateCursorBadge() {
  if (CURSOR_BADGE_TOOLS.includes(state.tool)) {
    cursorBadgeEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG_ICONS[state.tool]}</svg>`;
    cursorBadgeEl.classList.add('visible');
  } else {
    cursorBadgeEl.classList.remove('visible');
  }
}

const eraserRingEl = document.getElementById('eraser-ring');
function isEraserActive(e) {
  return state.tool === 'eraser' || state.tool === 'eraser_partial' || !!(e && isPenEraserActive(e));
}
function currentEraserRadiusPx(e) {
  if (state.tool === 'eraser_partial' && !(e && isPenEraserActive(e))) {
    return Math.max(8, state.strokeWidth * 2);
  }
  return 12;
}
function updateEraserRing(e) {
  const active = isEraserActive(e);
  eraserRingEl.style.display = active ? 'block' : 'none';
  if (active) {
    const d = currentEraserRadiusPx(e) * 2;
    eraserRingEl.style.width = d + 'px';
    eraserRingEl.style.height = d + 'px';
  }
}

function updateCursorScale() {
  const scale = state.tool === 'pen' ? Math.sqrt(state.strokeWidth / 4) : 1;
  customCursorEl.style.setProperty('--cs', scale);
}

canvas.addEventListener('pointermove', (e) => {
  const pos = getPointerPos(e);
  lastMouseScreenPos = pos;
  customCursorEl.style.left = pos.x + 'px';
  customCursorEl.style.top = pos.y + 'px';
  customCursorEl.style.color = state.color;
  updateEraserRing(e);
});
canvas.addEventListener('pointerenter', () => { mouseOverCanvas = true; updateCustomCursorVisibility(); });
canvas.addEventListener('pointerleave', () => { mouseOverCanvas = false; updateCustomCursorVisibility(); });

function isPenEraserActive(e) {
  return e.pointerType === 'pen' && (e.buttons & 32) === 32;
}

function applyMoveDragAt(world) {
  const dx = world.x - drag.startWorld.x, dy = world.y - drag.startWorld.y;
  state.selection.forEach((obj, i) => {
    const orig = drag.origPositions[i];
    applyTranslate(obj, orig, dx, dy);
  });
}

function applyPageDragAt(world) {
  const dx = world.x - drag.startWorld.x, dy = world.y - drag.startWorld.y;
  const box = state.pageBoxes[drag.index];
  box.x = drag.orig.x + dx;
  box.y = drag.orig.y + dy;
}

// ---------- Edge auto-scroll while dragging ----------
// While moving an object or a page border, panning the viewport when the pointer nears the
// edge of the canvas lets the user drag things further than the visible area without having
// to stop, pan manually, and resume the drag.
let lastPointerScreen = null;
let edgeScrollActive = false;
const EDGE_SCROLL_MARGIN = 44;
const EDGE_SCROLL_SPEED = 16;

function edgeScrollVector(pos) {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  let vx = 0, vy = 0;
  if (pos.x < EDGE_SCROLL_MARGIN) vx = EDGE_SCROLL_SPEED * (1 - pos.x / EDGE_SCROLL_MARGIN);
  else if (pos.x > w - EDGE_SCROLL_MARGIN) vx = -EDGE_SCROLL_SPEED * (1 - (w - pos.x) / EDGE_SCROLL_MARGIN);
  if (pos.y < EDGE_SCROLL_MARGIN) vy = EDGE_SCROLL_SPEED * (1 - pos.y / EDGE_SCROLL_MARGIN);
  else if (pos.y > h - EDGE_SCROLL_MARGIN) vy = -EDGE_SCROLL_SPEED * (1 - (h - pos.y) / EDGE_SCROLL_MARGIN);
  return { vx, vy };
}

function startEdgeScrollLoop() {
  if (edgeScrollActive) return;
  edgeScrollActive = true;
  const tick = () => {
    if (!drag || (drag.mode !== 'move' && drag.mode !== 'page-drag') || !lastPointerScreen) {
      edgeScrollActive = false;
      return;
    }
    const { vx, vy } = edgeScrollVector(lastPointerScreen);
    if (vx !== 0 || vy !== 0) {
      state.viewport.panX += vx;
      state.viewport.panY += vy;
      const world = screenToWorld(lastPointerScreen.x, lastPointerScreen.y);
      if (drag.mode === 'move') applyMoveDragAt(world);
      else applyPageDragAt(world);
      render();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function onPointerDown(e) {
  if (editingEl) { closeEditor(true); }
  canvas.setPointerCapture(e.pointerId);
  const pos = getPointerPos(e);
  const world = screenToWorld(pos.x, pos.y);
  const effectiveTool = (spaceHeld || e.button === 1) ? 'hand' : (isPenEraserActive(e) ? 'eraser' : state.tool);

  if (effectiveTool === 'hand') {
    drag = { mode: 'pan', startScreen: pos, startPan: { ...state.viewport } };
    return;
  }

  if ((effectiveTool === 'select' || effectiveTool === 'lasso') && state.pageMode !== 'off') {
    if (hitPlusMarker(world)) {
      const pos = nextPlusBoxPos();
      pushHistory();
      state.pageBoxes.push({ id: uid(), x: pos.x, y: pos.y });
      render();
      scheduleSave();
      return;
    }
    const boxIdx = hitPageBoxBorder(world);
    if (boxIdx != null) {
      const box = state.pageBoxes[boxIdx];
      pushHistory();
      drag = { mode: 'page-drag', index: boxIdx, startWorld: world, orig: { x: box.x, y: box.y } };
      startEdgeScrollLoop();
      return;
    }
  }

  if (effectiveTool === 'select' || effectiveTool === 'lasso') {
    if (effectiveTool === 'select' && state.selection.length === 1) {
      const handle = hitHandle(state.selection[0], world);
      if (handle) {
        pushHistory();
        drag = { mode: 'resize', obj: state.selection[0], handle: handle.name, orig: JSON.parse(JSON.stringify(state.selection[0])) };
        return;
      }
    }
    const hit = getObjectAt(world);
    if (hit) {
      if (e.ctrlKey || e.metaKey) {
        const idx = state.selection.indexOf(hit);
        if (idx >= 0) state.selection.splice(idx, 1); else state.selection.push(hit);
      } else if (!state.selection.includes(hit)) {
        state.selection = [hit];
      }
      pushHistory();
      drag = {
        mode: 'move', startWorld: world,
        origPositions: state.selection.map(o => JSON.parse(JSON.stringify(o)))
      };
      startEdgeScrollLoop();
      render();
    } else {
      if (!(e.ctrlKey || e.metaKey)) clearSelection();
      if (effectiveTool === 'lasso') {
        drag = { mode: 'lasso', points: [world] };
      } else {
        drag = { mode: 'rubberband', startWorld: world, rect: { x: world.x, y: world.y, w: 0, h: 0 } };
      }
    }
    return;
  }

  if (effectiveTool === 'eraser') {
    drag = { mode: 'erase' };
    eraseAt(world);
    return;
  }

  if (effectiveTool === 'eraser_partial') {
    drag = { mode: 'erase-partial' };
    partialEraseAt(world);
    return;
  }

  if (effectiveTool === 'pen' || effectiveTool === 'highlighter') {
    drawingObj = { id: uid(), type: 'stroke', tool: effectiveTool, points: [world], color: state.color, width: state.strokeWidth };
    drag = { mode: 'draw-stroke', startPoint: world, bakedUpTo: 0 };
    prepareStrokeStaticLayer();
    renderDuringStroke();
    armHoldTimer();
    return;
  }

  if (['line', 'arrow', 'rect', 'ellipse'].includes(effectiveTool)) {
    if (effectiveTool === 'line' || effectiveTool === 'arrow') {
      drawingObj = { id: uid(), type: effectiveTool, x1: world.x, y1: world.y, x2: world.x, y2: world.y, color: state.color, width: state.strokeWidth };
    } else {
      drawingObj = { id: uid(), type: effectiveTool, x: world.x, y: world.y, w: 0, h: 0, color: state.color, width: state.strokeWidth };
    }
    drag = { mode: 'draw-shape', start: world };
    render();
    return;
  }

  if (effectiveTool === 'text') {
    setTool('select');
    const obj = { id: uid(), type: 'text', x: world.x, y: world.y, w: 240, h: 40, text: '', color: state.color, fontSize: 20 };
    state.objects.push(obj);
    pushAddHistory(obj.id);
    state.selection = [obj];
    openTextEditor(obj, true);
    return;
  }

  if (effectiveTool === 'note') {
    setTool('select');
    const obj = { id: uid(), type: 'note', x: world.x - 110, y: world.y - 80, w: 220, h: 160, text: '', color: NOTE_PALETTE[0] };
    state.objects.push(obj);
    pushAddHistory(obj.id);
    state.selection = [obj];
    openNoteEditor(obj, true);
    return;
  }
}

function hitHandle(obj, world) {
  const tol = 10 / state.viewport.zoom;
  for (const h of getHandles(obj)) {
    if (Math.hypot(world.x - h.x, world.y - h.y) <= tol) return h;
  }
  return null;
}

function onPointerMove(e) {
  const pos = getPointerPos(e);
  const world = screenToWorld(pos.x, pos.y);

  if (!drag) return;
  if (drag.mode === 'move' || drag.mode === 'page-drag') lastPointerScreen = pos;

  if (drag.mode === 'page-drag') {
    applyPageDragAt(world);
    render();
    return;
  }

  if (drag.mode === 'pan') {
    const dx = pos.x - drag.startScreen.x, dy = pos.y - drag.startScreen.y;
    state.viewport.panX = drag.startPan.panX + dx;
    state.viewport.panY = drag.startPan.panY + dy;
    render();
    return;
  }

  if (drag.mode === 'draw-stroke') {
    if (drag.animating) { drag.pendingEnd = world; return; }
    if (drag.straightened) {
      drawingObj.points = [drag.startPoint, world];
      renderDuringStroke();
      return;
    }
    const pts = drawingObj.points;
    const last = pts[pts.length - 1];
    if (Math.hypot(world.x - last.x, world.y - last.y) > 1.5 / state.viewport.zoom) {
      pts.push(world);
      armHoldTimer();
      maybeBakeStrokeProgress();
    }
    renderDuringStroke();
    return;
  }

  if (drag.mode === 'draw-shape') {
    const s = drag.start;
    if (drawingObj.type === 'line' || drawingObj.type === 'arrow') {
      drawingObj.x2 = world.x; drawingObj.y2 = world.y;
      if (e.shiftKey) {
        const dx = world.x - s.x, dy = world.y - s.y;
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(dx, dy);
        drawingObj.x2 = s.x + Math.cos(angle) * len;
        drawingObj.y2 = s.y + Math.sin(angle) * len;
      }
    } else {
      drawingObj.x = Math.min(s.x, world.x);
      drawingObj.y = Math.min(s.y, world.y);
      drawingObj.w = Math.abs(world.x - s.x);
      drawingObj.h = Math.abs(world.y - s.y);
    }
    render();
    return;
  }

  if (drag.mode === 'erase') {
    eraseAt(world);
    return;
  }

  if (drag.mode === 'erase-partial') {
    partialEraseAt(world);
    return;
  }

  if (drag.mode === 'move') {
    applyMoveDragAt(world);
    render();
    return;
  }

  if (drag.mode === 'resize') {
    applyResize(drag.obj, drag.orig, drag.handle, world, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    render();
    return;
  }

  if (drag.mode === 'rubberband') {
    drag.rect = {
      x: Math.min(drag.startWorld.x, world.x),
      y: Math.min(drag.startWorld.y, world.y),
      w: Math.abs(world.x - drag.startWorld.x),
      h: Math.abs(world.y - drag.startWorld.y)
    };
    render();
    drawRubberband(drag.rect);
    return;
  }

  if (drag.mode === 'lasso') {
    const last = drag.points[drag.points.length - 1];
    if (Math.hypot(world.x - last.x, world.y - last.y) > 1.5 / state.viewport.zoom) {
      drag.points.push(world);
    }
    render();
    drawLasso(drag.points);
    return;
  }
}

function drawRubberband(rect) {
  ctx.save();
  ctx.translate(state.viewport.panX, state.viewport.panY);
  ctx.scale(state.viewport.zoom, state.viewport.zoom);
  ctx.strokeStyle = accentColorCache;
  ctx.fillStyle = hexToRgba(accentColorCache, 0.1);
  ctx.lineWidth = 1 / state.viewport.zoom;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawLasso(points) {
  if (points.length < 2) return;
  ctx.save();
  ctx.translate(state.viewport.panX, state.viewport.panY);
  ctx.scale(state.viewport.zoom, state.viewport.zoom);
  ctx.strokeStyle = accentColorCache;
  ctx.fillStyle = hexToRgba(accentColorCache, 0.1);
  ctx.lineWidth = 1.5 / state.viewport.zoom;
  ctx.setLineDash([6 / state.viewport.zoom, 5 / state.viewport.zoom]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Standard ray-casting point-in-polygon test, used to resolve lasso selection.
function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function applyTranslate(obj, orig, dx, dy) {
  if (obj.type === 'stroke') {
    obj.points = orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
  } else if (obj.type === 'line' || obj.type === 'arrow') {
    obj.x1 = orig.x1 + dx; obj.y1 = orig.y1 + dy;
    obj.x2 = orig.x2 + dx; obj.y2 = orig.y2 + dy;
  } else {
    obj.x = orig.x + dx; obj.y = orig.y + dy;
  }
}

function applyResize(obj, orig, handle, world, mods) {
  if (obj.type === 'line' || obj.type === 'arrow') {
    if (handle === 'p1') { obj.x1 = world.x; obj.y1 = world.y; }
    else { obj.x2 = world.x; obj.y2 = world.y; }
    return;
  }
  let x = orig.x, y = orig.y, w = orig.w, h = orig.h;
  const right = orig.x + orig.w, bottom = orig.y + orig.h;
  if (handle === 'nw') { x = world.x; y = world.y; w = right - x; h = bottom - y; }
  if (handle === 'ne') { y = world.y; w = world.x - orig.x; h = bottom - y; }
  if (handle === 'sw') { x = world.x; w = right - x; h = world.y - orig.y; }
  if (handle === 'se') { w = world.x - orig.x; h = world.y - orig.y; }

  if (mods && (mods.shift || mods.ctrl)) {
    const origW = orig.w || 1, origH = orig.h || 1;
    const scaleW = Math.abs(w) / Math.abs(origW);
    const scaleH = Math.abs(h) / Math.abs(origH);
    const scale = Math.max(scaleW, scaleH);
    const targetW = Math.abs(origW) * scale;
    const targetH = mods.shift ? targetW : Math.abs(origH) * scale;
    w = (w < 0 ? -1 : 1) * targetW;
    h = (h < 0 ? -1 : 1) * targetH;
    if (handle === 'nw') { x = right - w; y = bottom - h; }
    else if (handle === 'ne') { x = orig.x; y = bottom - h; }
    else if (handle === 'sw') { x = right - w; y = orig.y; }
    else { x = orig.x; y = orig.y; }
  }

  const minSize = 10;
  if (Math.abs(w) < minSize) w = w < 0 ? -minSize : minSize;
  if (Math.abs(h) < minSize) h = h < 0 ? -minSize : minSize;
  if (w < 0) { x = x + w; w = -w; }
  if (h < 0) { y = y + h; h = -h; }
  obj.x = x; obj.y = y; obj.w = w; obj.h = h;

  if (obj.type === 'text') {
    const scaleRatio = Math.sqrt((w / orig.w) * (h / orig.h));
    obj.fontSize = Math.max(8, Math.round((orig.fontSize || 20) * scaleRatio));
  }
}

const ERASER_PROTECTED_TYPES = new Set(['image', 'text', 'axes2d', 'axes3d', 'trigcircle']);

function eraseAt(world) {
  const tol = 12 / state.viewport.zoom;
  const toRemove = state.objects.filter(o => !ERASER_PROTECTED_TYPES.has(o.type) && hitObject(o, world, tol));
  if (toRemove.length) {
    if (drag && !drag.historyPushed) { pushHistory(); drag.historyPushed = true; }
    const set = new Set(toRemove);
    state.objects = state.objects.filter(o => !set.has(o));
    render(); scheduleSave();
  }
}

function segmentCircleIntersections(a, b, center, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - center.x, fy = a.y - center.y;
  const qa = dx * dx + dy * dy;
  if (qa === 0) return [];
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - r * r;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const t1 = (-qb - sq) / (2 * qa);
  const t2 = (-qb + sq) / (2 * qa);
  return [t1, t2].filter(t => t > 0 && t < 1).sort((x, y) => x - y);
}

function partialEraseAt(world) {
  const radius = Math.max(8, state.strokeWidth * 2) / state.viewport.zoom;
  const isOutside = (p) => Math.hypot(p.x - world.x, p.y - world.y) > radius;
  let changed = false;
  const nextObjects = [];
  for (const obj of state.objects) {
    if (obj.type !== 'stroke') { nextObjects.push(obj); continue; }
    const pts = obj.points;
    if (pts.length === 1) {
      if (isOutside(pts[0])) nextObjects.push(obj); else changed = true;
      continue;
    }
    // Expand the polyline with exact points where it crosses the eraser circle boundary
    const expanded = [{ p: pts[0], out: isOutside(pts[0]) }];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      for (const t of segmentCircleIntersections(a, b, world, radius)) {
        expanded.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, out: true });
      }
      expanded.push({ p: b, out: isOutside(b) });
    }
    if (expanded.every(e => e.out)) { nextObjects.push(obj); continue; }
    changed = true;
    let run = [];
    const commitRun = () => { if (run.length >= 2) nextObjects.push({ ...obj, id: uid(), points: run }); run = []; };
    for (const e of expanded) {
      if (e.out) run.push(e.p);
      else commitRun();
    }
    commitRun();
  }
  if (changed) {
    if (drag && !drag.historyPushed) { pushHistory(); drag.historyPushed = true; }
    state.objects = nextObjects;
    if (state.selection.length) state.selection = state.selection.filter(o => state.objects.includes(o));
    render(); scheduleSave();
  }
}

function onPointerUp(e) {
  if (!drag) return;
  if (drag.mode === 'draw-stroke') {
    if (drag.holdTimerId) clearTimeout(drag.holdTimerId);
    if (drag.animFrameId) cancelAnimationFrame(drag.animFrameId);
    if (drawingObj && drawingObj.points.length > 0) {
      state.objects.push(drawingObj);
      pushAddHistory(drawingObj.id);
    }
    drawingObj = null;
    scheduleSave();
  } else if (drag.mode === 'draw-shape') {
    const bbox = getObjBBox(drawingObj);
    const size = Math.hypot(bbox.w, bbox.h);
    if (size > 3 / state.viewport.zoom) {
      state.objects.push(drawingObj);
      pushAddHistory(drawingObj.id);
      setTool('select');
      state.selection = [drawingObj];
    }
    drawingObj = null;
    scheduleSave();
  } else if (drag.mode === 'erase' || drag.mode === 'erase-partial') {
    scheduleSave();
  } else if (drag.mode === 'move' || drag.mode === 'resize' || drag.mode === 'page-drag') {
    scheduleSave();
  } else if (drag.mode === 'rubberband') {
    const rect = drag.rect;
    if (rect.w > 1 || rect.h > 1) {
      const found = state.objects.filter(o => bboxIntersects(getObjBBox(o), rect));
      state.selection = (e.ctrlKey || e.metaKey) ? Array.from(new Set([...state.selection, ...found])) : found;
    }
    render();
  } else if (drag.mode === 'lasso') {
    const poly = drag.points;
    if (poly.length > 2) {
      const found = state.objects.filter(o => {
        const b = getObjBBox(o);
        return pointInPolygon({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, poly);
      });
      state.selection = (e.ctrlKey || e.metaKey) ? Array.from(new Set([...state.selection, ...found])) : found;
    }
    render();
  }
  drag = null;
  render();
}

function onDblClick(e) {
  const pos = getPointerPos(e);
  const world = screenToWorld(pos.x, pos.y);
  const hit = getObjectAt(world);
  if (hit && hit.type === 'text') { setTool('select'); state.selection = [hit]; openTextEditor(hit, false); }
  else if (hit && hit.type === 'note') { setTool('select'); state.selection = [hit]; openNoteEditor(hit, false); }
  else if (hit && hit.type === 'file') { window.api.openFile(hit.src, hit.name); }
}

function onWheel(e) {
  e.preventDefault();
  const pos = getPointerPos(e);
  if (e.ctrlKey || e.metaKey) {
    zoomAtLinear(pos, -e.deltaY * 0.0006);
  } else if (e.shiftKey) {
    state.viewport.panX -= (e.deltaX !== 0 ? e.deltaX : e.deltaY);
    render();
  } else {
    state.viewport.panX -= e.deltaX;
    state.viewport.panY -= e.deltaY;
    render();
  }
}

function zoomAt(screenPos, factor) {
  const before = screenToWorld(screenPos.x, screenPos.y);
  let newZoom = state.viewport.zoom * factor;
  newZoom = Math.min(8, Math.max(0.05, newZoom));
  state.viewport.zoom = newZoom;
  const after = worldToScreen(before.x, before.y);
  state.viewport.panX += screenPos.x - after.x;
  state.viewport.panY += screenPos.y - after.y;
  render();
}

function zoomAtLinear(screenPos, deltaZoom) {
  const before = screenToWorld(screenPos.x, screenPos.y);
  let newZoom = state.viewport.zoom + deltaZoom;
  newZoom = Math.min(8, Math.max(0.05, newZoom));
  state.viewport.zoom = newZoom;
  const after = worldToScreen(before.x, before.y);
  state.viewport.panX += screenPos.x - after.x;
  state.viewport.panY += screenPos.y - after.y;
  render();
}

document.getElementById('btn-zoom-in').addEventListener('click', () => zoomAt({ x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }, 1.2));
document.getElementById('btn-zoom-out').addEventListener('click', () => zoomAt({ x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 }, 1 / 1.2));
document.getElementById('btn-zoom-fit').addEventListener('click', fitToContent);

function fitToContent() {
  const bbox = getObjectsBBox(state.objects);
  if (!bbox) { state.viewport = { panX: wrap.clientWidth / 2, panY: wrap.clientHeight / 2, zoom: 1 }; render(); return; }
  const pad = 60;
  const zoomX = wrap.clientWidth / (bbox.w + pad * 2);
  const zoomY = wrap.clientHeight / (bbox.h + pad * 2);
  const zoom = Math.min(2, Math.min(zoomX, zoomY));
  state.viewport.zoom = zoom;
  const cx = bbox.x + bbox.w / 2, cy = bbox.y + bbox.h / 2;
  state.viewport.panX = wrap.clientWidth / 2 - cx * zoom;
  state.viewport.panY = wrap.clientHeight / 2 - cy * zoom;
  render();
}

// ---------- Selection & clipboard ----------
function clearSelection() { state.selection = []; render(); }

function deleteSelection() {
  if (!state.selection.length) return;
  pushHistory();
  const set = new Set(state.selection);
  state.objects = state.objects.filter(o => !set.has(o));
  state.selection = [];
  render(); scheduleSave();
}

function cloneObjectsOffset(objects, off) {
  return objects.map(o => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = uid();
    if (c.type === 'stroke') c.points = c.points.map(p => ({ x: p.x + off, y: p.y + off }));
    else if (c.type === 'line' || c.type === 'arrow') { c.x1 += off; c.y1 += off; c.x2 += off; c.y2 += off; }
    else { c.x += off; c.y += off; }
    return c;
  });
}

// Like cloneObjectsOffset, but translates the whole group so its bounding-box center lands
// exactly on targetCenter — used by paste so pasted content appears under the cursor rather
// than nudged from wherever it was originally copied.
function cloneObjectsTo(objects, targetCenter) {
  const bbox = getObjectsBBox(objects);
  const dx = targetCenter.x - (bbox.x + bbox.w / 2);
  const dy = targetCenter.y - (bbox.y + bbox.h / 2);
  return objects.map(o => {
    const c = JSON.parse(JSON.stringify(o));
    c.id = uid();
    if (c.type === 'stroke') c.points = c.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    else if (c.type === 'line' || c.type === 'arrow') { c.x1 += dx; c.y1 += dy; c.x2 += dx; c.y2 += dy; }
    else { c.x += dx; c.y += dy; }
    return c;
  });
}

function duplicateSelection() {
  if (!state.selection.length) return;
  pushHistory();
  const copies = cloneObjectsOffset(state.selection, 16 / state.viewport.zoom);
  state.objects.push(...copies);
  state.selection = copies;
  render(); scheduleSave();
}

// ---------- Copy / paste (internal objects + external text/image) ----------
function isEditableFocus() {
  if (editingEl) return true;
  const ae = document.activeElement;
  return !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));
}

document.addEventListener('copy', (e) => {
  if (isEditableFocus()) return;
  if (!state.selection.length) return;
  e.preventDefault();
  const payload = JSON.stringify({ __electronWhiteboardClip: true, objects: state.selection });
  e.clipboardData.setData('text/plain', payload);
});

document.addEventListener('paste', (e) => {
  if (isEditableFocus()) return;
  const items = e.clipboardData && e.clipboardData.items;
  if (items) {
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const pos = getPasteWorldPos();
        const reader = new FileReader();
        reader.onload = () => insertImageObject(reader.result, pos);
        reader.readAsDataURL(file);
        return;
      }
    }
  }
  const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
  if (!text) return;
  e.preventDefault();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { /* not internal clip JSON */ }
  if (parsed && parsed.__electronWhiteboardClip && Array.isArray(parsed.objects) && parsed.objects.length) {
    pushHistory();
    const copies = cloneObjectsTo(parsed.objects, getPasteWorldPos());
    state.objects.push(...copies);
    setTool('select');
    state.selection = copies;
    render(); scheduleSave();
    return;
  }
  if (text.trim()) {
    pushHistory();
    const center = getPasteWorldPos();
    const obj = { id: uid(), type: 'text', x: center.x - 120, y: center.y - 20, w: 240, h: 40, text, color: state.color, fontSize: 20 };
    state.objects.push(obj);
    setTool('select');
    state.selection = [obj];
    render(); scheduleSave();
  }
});

// ---------- Selection toolbar ----------
function updateSelectionToolbarPos() {
  if (!state.selection.length || drag) { selToolbar.classList.remove('visible'); return; }
  const bbox = getObjectsBBox(state.selection);
  const topLeft = worldToScreen(bbox.x, bbox.y);
  const topRight = worldToScreen(bbox.x + bbox.w, bbox.y);
  const cx = (topLeft.x + topRight.x) / 2;
  selToolbar.style.left = Math.max(4, cx - 90) + 'px';
  selToolbar.style.top = Math.max(4, topLeft.y - 44) + 'px';
  selToolbar.classList.add('visible');
}

function buildSelectionToolbar() {
  selToolbar.innerHTML = '';
  const palette = (state.selection[0] && state.selection[0].type === 'note') ? NOTE_PALETTE : PALETTE;
  palette.forEach(c => {
    const b = document.createElement('button');
    b.className = 'sel-color-btn';
    b.style.color = c;
    b.textContent = '●';
    b.title = 'Couleur';
    b.addEventListener('click', () => { pushHistory(); state.selection.forEach(o => o.color = c); render(); scheduleSave(); });
    selToolbar.appendChild(b);
  });
  if (state.selection.length === 1 && ['rect', 'ellipse'].includes(state.selection[0].type)) {
    const obj = state.selection[0];
    const fillBtn = document.createElement('button');
    fillBtn.textContent = obj.filled ? '●' : '○';
    fillBtn.title = obj.filled ? 'Passer en contour' : 'Passer en rempli';
    fillBtn.addEventListener('click', () => {
      pushHistory();
      obj.filled = !obj.filled;
      render(); scheduleSave();
      buildSelectionToolbar();
    });
    selToolbar.appendChild(fillBtn);
  }

  if (state.selection.length === 1 && ['axes2d', 'axes3d'].includes(state.selection[0].type)) {
    const obj = state.selection[0];
    if (obj.tickCount == null) obj.tickCount = 20;
    const applyTicks = (n) => {
      pushHistory();
      obj.tickCount = Math.max(2, Math.min(60, Math.round(n / 2) * 2));
      numInput.value = obj.tickCount;
      render(); scheduleSave();
    };
    const stepper = document.createElement('div');
    stepper.className = 'sel-stepper';
    const minus = document.createElement('button');
    minus.textContent = '−'; minus.title = 'Moins de graduations';
    minus.addEventListener('click', () => applyTicks(obj.tickCount - 2));
    const numInput = document.createElement('input');
    numInput.type = 'number'; numInput.className = 'sel-tick-input';
    numInput.min = '2'; numInput.max = '60'; numInput.step = '2';
    numInput.value = obj.tickCount;
    numInput.title = 'Nombre de graduations par axe';
    numInput.addEventListener('change', () => applyTicks(parseInt(numInput.value, 10) || 20));
    const plus = document.createElement('button');
    plus.textContent = '+'; plus.title = 'Plus de graduations';
    plus.addEventListener('click', () => applyTicks(obj.tickCount + 2));
    stepper.appendChild(minus); stepper.appendChild(numInput); stepper.appendChild(plus);
    selToolbar.appendChild(stepper);

    const numBtn = document.createElement('button');
    numBtn.textContent = '123';
    numBtn.title = obj.showNumbers ? 'Cacher les nombres' : 'Afficher les nombres';
    numBtn.classList.toggle('active', !!obj.showNumbers);
    numBtn.addEventListener('click', () => {
      pushHistory();
      obj.showNumbers = !obj.showNumbers;
      render(); scheduleSave();
      buildSelectionToolbar();
    });
    selToolbar.appendChild(numBtn);
  }

  if (state.selection.length === 1 && state.selection[0].type === 'trigcircle') {
    const obj = state.selection[0];
    const mkUnitBtn = (label, unit, title) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.classList.toggle('active', !!obj.showAngles && obj.angleUnit === unit);
      b.addEventListener('click', () => {
        pushHistory();
        if (obj.showAngles && obj.angleUnit === unit) obj.showAngles = false;
        else { obj.showAngles = true; obj.angleUnit = unit; }
        render(); scheduleSave();
        buildSelectionToolbar();
      });
      return b;
    };
    selToolbar.appendChild(mkUnitBtn('°', 'deg', 'Afficher les angles en degrés'));
    selToolbar.appendChild(mkUnitBtn('rad', 'rad', 'Afficher les angles en radians'));
  }

  const sep = document.createElement('span');
  sep.className = 'flyout-sep';
  selToolbar.appendChild(sep);

  const layerBtns = [
    ['⇩', 'Arrière-plan', 'back'],
    ['↓', 'Descendre d\'un plan', 'backward'],
    ['↑', 'Monter d\'un plan', 'forward'],
    ['⇧', 'Premier plan', 'front']
  ];
  layerBtns.forEach(([label, title, kind]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => reorderSelection(kind));
    selToolbar.appendChild(b);
  });

  const sep2 = document.createElement('span');
  sep2.className = 'flyout-sep';
  selToolbar.appendChild(sep2);

  const dup = document.createElement('button'); dup.textContent = '⧉'; dup.title = 'Dupliquer (Ctrl+D)';
  dup.addEventListener('click', duplicateSelection);
  const del = document.createElement('button'); del.textContent = '🗑'; del.title = 'Supprimer';
  del.addEventListener('click', deleteSelection);
  selToolbar.appendChild(dup);
  selToolbar.appendChild(del);
}

function reorderSelection(kind) {
  if (!state.selection.length) return;
  pushHistory();
  const sel = new Set(state.selection);
  if (kind === 'front') {
    const rest = state.objects.filter(o => !sel.has(o));
    const selected = state.objects.filter(o => sel.has(o));
    state.objects = [...rest, ...selected];
  } else if (kind === 'back') {
    const rest = state.objects.filter(o => !sel.has(o));
    const selected = state.objects.filter(o => sel.has(o));
    state.objects = [...selected, ...rest];
  } else if (kind === 'forward') {
    for (let i = state.objects.length - 2; i >= 0; i--) {
      if (sel.has(state.objects[i]) && !sel.has(state.objects[i + 1])) {
        const tmp = state.objects[i]; state.objects[i] = state.objects[i + 1]; state.objects[i + 1] = tmp;
      }
    }
  } else if (kind === 'backward') {
    for (let i = 1; i < state.objects.length; i++) {
      if (sel.has(state.objects[i]) && !sel.has(state.objects[i - 1])) {
        const tmp = state.objects[i]; state.objects[i] = state.objects[i - 1]; state.objects[i - 1] = tmp;
      }
    }
  }
  render(); scheduleSave();
}

// rebuild toolbar buttons whenever selection changes materially
let lastSelSig = '';
function refreshSelectionToolbarIfNeeded() {
  const sig = state.selection.map(o => o.id).join(',') + (state.selection[0] ? state.selection[0].type : '');
  if (sig !== lastSelSig) { lastSelSig = sig; buildSelectionToolbar(); }
}
setInterval(refreshSelectionToolbarIfNeeded, 150);

// ---------- Text / note overlay editors ----------
function closeEditor(commit) {
  if (!editingEl) return;
  const { el, obj, isNote } = editingEl;
  editingEl = null; // clear first: removing a focused el fires a synchronous blur that re-enters this function
  if (commit) {
    obj.text = isNote ? el.value : el.innerText.replace(/\n$/, '');
    if (!isNote) {
      obj.h = Math.max(30, el.scrollHeight / state.viewport.zoom);
    }
    if (!isNote && !obj.text.trim() && document.body.contains(el)) {
      state.objects = state.objects.filter(o => o !== obj);
      state.selection = state.selection.filter(o => o !== obj);
    }
  }
  if (el.parentNode) el.parentNode.removeChild(el);
  render(); scheduleSave();
}

function positionOverlayEl(el, obj) {
  const s = worldToScreen(obj.x, obj.y);
  el.style.left = s.x + 'px';
  el.style.top = s.y + 'px';
  el.style.width = (obj.w * state.viewport.zoom) + 'px';
  el.style.minHeight = (obj.h * state.viewport.zoom) + 'px';
}

function openTextEditor(obj, focus) {
  const el = document.createElement('div');
  el.className = 'overlay-editable';
  el.contentEditable = 'true';
  el.style.fontSize = (obj.fontSize * state.viewport.zoom) + 'px';
  el.style.color = obj.color;
  el.style.lineHeight = '1.3';
  el.innerText = obj.text;
  positionOverlayEl(el, obj);
  overlay.appendChild(el);
  editingEl = { el, obj, isNote: false };
  el.addEventListener('blur', () => closeEditor(true));
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); }
  });
  if (focus) { setTimeout(() => el.focus(), 0); }
  render();
}

function openNoteEditor(obj, focus) {
  const el = document.createElement('textarea');
  el.className = 'overlay-editable note-editable';
  el.style.background = obj.color;
  el.style.fontSize = (15 * state.viewport.zoom) + 'px';
  el.style.color = '#1a1a1a';
  el.style.resize = 'none';
  el.value = obj.text;
  positionOverlayEl(el, obj);
  el.style.height = (obj.h * state.viewport.zoom) + 'px';
  overlay.appendChild(el);
  editingEl = { el, obj, isNote: true };
  el.addEventListener('blur', () => closeEditor(true));
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); }
  });
  if (focus) { setTimeout(() => el.focus(), 0); }
  render();
}

// ---------- Image insert ----------
function insertImageObject(dataUrl, atWorldPos) {
  const img = new Image();
  img.onload = () => {
    pushHistory();
    const maxDim = 360;
    let w = img.naturalWidth, h = img.naturalHeight;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    w *= scale; h *= scale;
    const center = atWorldPos || screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
    const obj = { id: uid(), type: 'image', x: center.x - w / 2, y: center.y - h / 2, w, h, src: dataUrl };
    state.objects.push(obj);
    setTool('select');
    state.selection = [obj];
    render(); scheduleSave();
  };
  img.src = dataUrl;
}

function insertFileObject(dataUrl, name, mime, atWorldPos) {
  pushHistory();
  const w = 170, h = 210;
  const center = atWorldPos || screenToWorld(wrap.clientWidth / 2, wrap.clientHeight / 2);
  const obj = { id: uid(), type: 'file', x: center.x - w / 2, y: center.y - h / 2, w, h, name: name || 'document.pdf', mime: mime || 'application/pdf', src: dataUrl };
  state.objects.push(obj);
  setTool('select');
  state.selection = [obj];
  render(); scheduleSave();
}

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (file.type === 'application/pdf') {
      insertFileObject(reader.result, file.name, file.type, pendingImagePos);
    } else {
      insertImageObject(reader.result, pendingImagePos);
    }
  };
  reader.readAsDataURL(file);
  imageInput.value = '';
});

// ---------- Keyboard shortcuts ----------
// "calculator" isn't a tool (setTool never sees it) — it's handled as a special case in the
// keydown dispatch below, but shares the same customization list/UI/storage as the tool keys.
const TOOL_LABELS = { select: 'Sélection', hand: 'Main', pen: 'Stylo', eraser: 'Gomme', arrow: 'Flèche', line: 'Ligne', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Texte', note: 'Note', calculator: 'Calculatrice' };
const DEFAULT_SHORTCUTS = { select: 'a', hand: 'z', pen: 'e', eraser: 'v', arrow: 'h', line: 'l', rect: 'g', ellipse: 'o', text: 't', note: 'n', calculator: 'r' };
let activeShortcuts = { ...DEFAULT_SHORTCUTS };
let toolKeyMap = invertShortcuts(activeShortcuts);
let shortcutsModalOpen = false;

function invertShortcuts(shortcuts) {
  const map = {};
  for (const tool in shortcuts) map[shortcuts[tool]] = tool;
  return map;
}

// Merges the user's saved overrides (if any) on top of the defaults — called once at startup
// once state.settings has loaded, and again whenever the shortcuts modal saves a change.
function applyShortcutsFromSettings() {
  const saved = (state.settings && state.settings.shortcuts) || {};
  activeShortcuts = { ...DEFAULT_SHORTCUTS, ...saved };
  toolKeyMap = invertShortcuts(activeShortcuts);
}

window.addEventListener('keydown', (e) => {
  if (editingEl || shortcutsModalOpen) return;
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.code === 'Space') { spaceHeld = true; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); state.selection = state.objects.slice(); render(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (state.selection.length) { e.preventDefault(); deleteSelection(); } return; }
  if (e.key === 'Escape') { clearSelection(); return; }
  const k = e.key.toLowerCase();
  const tool = toolKeyMap[k];
  if (!tool || e.ctrlKey || e.metaKey) return;
  if (tool === 'calculator') { toggleCalc(); return; }
  setTool(tool === 'select' ? state.lastSelectTool : tool);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { spaceHeld = false; }
});

// ---------- Shortcuts customization modal ----------
const shortcutsModalEl = document.getElementById('shortcuts-modal');
const shortcutsListEl = document.getElementById('shortcuts-list');
let stopListeningForKey = null;

function renderShortcutsList() {
  shortcutsListEl.innerHTML = '';
  for (const tool in TOOL_LABELS) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const label = document.createElement('span');
    label.className = 'shortcut-row-label';
    label.textContent = TOOL_LABELS[tool];
    const keyBtn = document.createElement('button');
    keyBtn.className = 'shortcut-key-btn';
    keyBtn.textContent = activeShortcuts[tool];
    keyBtn.addEventListener('click', () => listenForNewKey(tool, keyBtn));
    row.append(label, keyBtn);
    shortcutsListEl.appendChild(row);
  }
}

// Records the next keystroke as the new shortcut for `tool`. Captured on the window in the
// capture phase (and with shortcutsModalOpen already true) so it never reaches the normal
// tool-switching handler above. If the chosen key is already used by another tool, the two
// tools simply swap keys — no key is ever left unbound or shared by two tools.
function listenForNewKey(tool, btnEl) {
  if (stopListeningForKey) stopListeningForKey();
  btnEl.textContent = '…';
  btnEl.classList.add('listening');
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return; // wait for a real key
    if (e.key === 'Escape' || e.key === ' ' || e.key.length !== 1) { stop(); renderShortcutsList(); return; }
    const newKey = e.key.toLowerCase();
    stop();
    const updated = { ...activeShortcuts };
    const conflictTool = Object.keys(updated).find(t => updated[t] === newKey && t !== tool);
    if (conflictTool) updated[conflictTool] = activeShortcuts[tool];
    updated[tool] = newKey;
    activeShortcuts = updated;
    toolKeyMap = invertShortcuts(activeShortcuts);
    renderShortcutsList();
    window.api.setSettings({ shortcuts: activeShortcuts }).then((s) => { state.settings = s; });
  };
  function stop() { window.removeEventListener('keydown', onKey, true); stopListeningForKey = null; }
  stopListeningForKey = stop;
  window.addEventListener('keydown', onKey, true);
}

function closeShortcutsModal() {
  if (stopListeningForKey) stopListeningForKey();
  shortcutsModalOpen = false;
  shortcutsModalEl.classList.add('hidden');
}

document.getElementById('btn-shortcuts').addEventListener('click', () => {
  shortcutsModalOpen = true;
  renderShortcutsList();
  shortcutsModalEl.classList.remove('hidden');
});
document.getElementById('btn-shortcuts-close').addEventListener('click', closeShortcutsModal);
shortcutsModalEl.addEventListener('click', (e) => { if (e.target === shortcutsModalEl) closeShortcutsModal(); });
document.getElementById('btn-shortcuts-reset').addEventListener('click', () => {
  activeShortcuts = { ...DEFAULT_SHORTCUTS };
  toolKeyMap = invertShortcuts(activeShortcuts);
  renderShortcutsList();
  window.api.setSettings({ shortcuts: activeShortcuts }).then((s) => { state.settings = s; });
});

// ---------- Zoom/clear/export/theme buttons ----------
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!state.objects.length) return;
  if (!confirm('Effacer tout le tableau ? Cette action est réversible avec Ctrl+Z.')) return;
  pushHistory();
  state.objects = [];
  state.selection = [];
  render(); scheduleSave();
});

document.getElementById('btn-promo').addEventListener('click', () => window.api.openPromoSite());

// ---------- Subscription / paid PDF customization ----------
const subscribeModalEl = document.getElementById('subscribe-modal');
const subscribeTitleEl = document.getElementById('subscribe-title');
const subscribeStatusEl = document.getElementById('subscribe-status');
const subscribeEmailEl = document.getElementById('subscribe-email');
const screenExplainerEl = document.getElementById('subscribe-screen-explainer');
const screenManageEl = document.getElementById('subscribe-screen-manage');
const screenSettingsEl = document.getElementById('subscribe-screen-settings');
const manageStatusEl = document.getElementById('manage-status');

const pdfPrefsHeaderTextEl = document.getElementById('pdf-prefs-header-text');
const pdfPrefsFooterTextEl = document.getElementById('pdf-prefs-footer-text');
const pdfPrefsCoverEl = document.getElementById('pdf-prefs-cover');
const pdfPrefsEndEl = document.getElementById('pdf-prefs-end');
const pdfPrefsHeaderEl = document.getElementById('pdf-prefs-header');
const pdfPrefsFooterEl = document.getElementById('pdf-prefs-footer');
const pdfPrefsPageNumbersEl = document.getElementById('pdf-prefs-page-numbers');
const pdfPrefsStarsEl = document.getElementById('pdf-prefs-stars');
const pdfPrefsLogoToggleEl = document.getElementById('pdf-prefs-logo');
const pdfPrefsMeteorsEl = document.getElementById('pdf-prefs-meteors');
const pdfPrefsLogoPreviewEl = document.getElementById('pdf-prefs-logo-preview');
const pdfPrefsLogoEmptyEl = document.getElementById('pdf-prefs-logo-empty');
const btnClearLogoEl = document.getElementById('btn-pdf-prefs-clear-logo');
const pdfPrefsEndPdfNameEl = document.getElementById('pdf-prefs-endpdf-name');
const btnClearEndPdfEl = document.getElementById('btn-pdf-prefs-clear-endpdf');

const btnSubscribeEl = document.getElementById('btn-subscribe');
const subscribeBtnLabelEl = document.getElementById('btn-subscribe-label');
buildRisingStars(document.getElementById('subscribe-btn-stars'), 'subscribe-star');

function updateSubscribeButton() {
  const active = !!(state.settings && state.settings.subscriptionActive);
  subscribeBtnLabelEl.textContent = active ? 'Gérer mon abonnement' : "Personnaliser l'export PDF";
}

function showSubscribeScreen(name) {
  screenExplainerEl.classList.toggle('hidden', name !== 'explainer');
  screenManageEl.classList.toggle('hidden', name !== 'manage');
  screenSettingsEl.classList.toggle('hidden', name !== 'settings');
  document.getElementById('subscribe-panel').classList.toggle('wide', name === 'settings');
}

async function openSubscribeModal(context) {
  subscribeModalEl.classList.remove('hidden');
  const s = state.settings;
  const active = !!(s && s.subscriptionActive);

  if (!active) {
    subscribeTitleEl.textContent = "Personnaliser l'export PDF";
    subscribeEmailEl.value = (s && s.email) || '';
    subscribeStatusEl.textContent = s && s.subscriptionCheckedAt
      ? 'Aucun abonnement actif pour cet email.'
      : 'Statut : entre ton email et clique sur Vérifier après paiement.';
    showSubscribeScreen('explainer');
    return;
  }

  if (context === 'gear') {
    subscribeTitleEl.textContent = 'Réglages de l\'export PDF';
    showSubscribeScreen('settings');
    // A cancellation stays fully editable until the paid period actually ends — this is just an
    // informational heads-up, not a lock, so someone who cancelled by mistake can still adjust
    // their export settings right up until the last day.
    const notice = document.getElementById('pdf-prefs-cancel-notice');
    if (s.cancelAtPeriodEnd) {
      const details = await window.api.getSubscriptionDetails(s.email);
      const endDate = details && details.ok && details.currentPeriodEnd
        ? new Date(details.currentPeriodEnd * 1000).toLocaleDateString('fr-FR')
        : null;
      notice.textContent = endDate
        ? `Abonnement annulé — ces réglages restent actifs et modifiables jusqu'au ${endDate}.`
        : 'Abonnement annulé — ces réglages restent actifs et modifiables jusqu\'à la fin de la période en cours.';
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }
    await refreshPdfPrefsForm();
    return;
  }

  subscribeTitleEl.textContent = 'Gérer mon abonnement';
  showSubscribeScreen('manage');
  manageStatusEl.textContent = 'Chargement...';
  const res = await window.api.getSubscriptionDetails(s.email);
  if (res && res.ok && res.active) {
    state.settings = await window.api.getSettings();
    const planLabel = res.interval === 'year' ? '10€ / an' : '1€ / mois';
    const renewDate = res.currentPeriodEnd ? new Date(res.currentPeriodEnd * 1000).toLocaleDateString('fr-FR') : '?';
    manageStatusEl.innerHTML = `Formule : <strong>${planLabel}</strong><br>` + (
      res.cancelAtPeriodEnd
        ? `Annulation prévue — tu gardes l'accès à la personnalisation jusqu'au <strong>${renewDate}</strong>, puis les réglages d'export reviendront par défaut.`
        : `Prochain renouvellement : <strong>${renewDate}</strong>`
    );
  } else {
    manageStatusEl.textContent = "Impossible de récupérer les détails de l'abonnement (hors ligne ?).";
  }
}
function closeSubscribeModal() {
  subscribeModalEl.classList.add('hidden');
}

btnSubscribeEl.addEventListener('click', () => openSubscribeModal('star'));
document.getElementById('btn-settings').addEventListener('click', () => openSubscribeModal('gear'));
document.getElementById('btn-subscribe-close').addEventListener('click', closeSubscribeModal);
subscribeModalEl.addEventListener('click', (e) => { if (e.target === subscribeModalEl) closeSubscribeModal(); });

async function verifySubscriptionByEmail(email) {
  if (!email) { subscribeStatusEl.textContent = 'Entre ton email pour vérifier.'; return; }
  subscribeStatusEl.textContent = 'Vérification en cours...';
  const res = await window.api.checkSubscription(email);
  if (!res || !res.ok) {
    subscribeStatusEl.textContent = 'Impossible de vérifier (hors ligne ou serveur indisponible). Réessaie plus tard.';
    return;
  }
  state.settings = await window.api.getSettings();
  updateSubscribeButton();
  if (state.settings.subscriptionActive) {
    flashStatus('Abonnement activé !');
    openSubscribeModal('star');
  } else {
    subscribeStatusEl.textContent = 'Aucun abonnement actif pour cet email.';
  }
}

document.getElementById('btn-subscribe-verify').addEventListener('click', () => {
  verifySubscriptionByEmail(subscribeEmailEl.value.trim());
});

document.getElementById('btn-subscribe-monthly').addEventListener('click', () => window.api.openPayment('monthly'));
document.getElementById('btn-subscribe-yearly').addEventListener('click', () => window.api.openPayment('yearly'));

// Fired once the in-app payment window intercepts Stripe's post-payment redirect. Auto-fills
// and auto-verifies the email that was actually used to pay, so the user never retypes it.
window.api.onPaymentCompleted((result) => {
  if (result && result.ok && result.email) {
    subscribeEmailEl.value = result.email;
    flashStatus('Paiement reçu, vérification en cours...');
    verifySubscriptionByEmail(result.email);
  } else {
    openSubscribeModal('star');
    subscribeStatusEl.textContent = "Paiement terminé — clique sur Vérifier pour activer l'abonnement.";
  }
});

const portalModalEl = document.getElementById('portal-modal');
const portalModalSlotEl = document.getElementById('portal-modal-slot');

function getPortalSlotBounds() {
  const r = portalModalSlotEl.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
}

function showPortalLoadingSplash() {
  portalModalSlotEl.classList.add('loading');
  portalModalSlotEl.innerHTML = '';
  if (splashOrbitTemplate) portalModalSlotEl.appendChild(splashOrbitTemplate.cloneNode(true));
}

async function openPortalEmbed(url) {
  portalModalEl.classList.remove('hidden');
  showPortalLoadingSplash();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await window.api.embedPortal(url, getPortalSlotBounds());
}

function closePortalEmbed() {
  portalModalEl.classList.add('hidden');
  window.api.closePortalEmbed();
}

// The BrowserView only gets attached (made visible) once Stripe's portal page has actually
// finished loading — until then this loading splash, matching the app's own, stays uncovered.
window.api.onPortalReady(() => {
  portalModalSlotEl.classList.remove('loading');
  portalModalSlotEl.innerHTML = '';
});

document.getElementById('btn-manage-portal').addEventListener('click', async () => {
  manageStatusEl.textContent = 'Ouverture du portail...';
  const res = await window.api.openSubscriptionPortal(state.settings.email);
  if (!res || !res.ok) {
    manageStatusEl.textContent = "Impossible d'ouvrir le portail pour le moment (réessaie plus tard).";
    return;
  }
  openPortalEmbed(res.url);
});

document.getElementById('btn-portal-close').addEventListener('click', closePortalEmbed);

window.addEventListener('resize', () => {
  if (!portalModalEl.classList.contains('hidden')) {
    window.api.updatePortalBounds(getPortalSlotBounds());
  }
});

// Fired when the embedded portal view closes (managed/canceled, or just dismissed) — refresh
// the subscription status so cancellation (or any other change) shows up immediately.
window.api.onPortalClosed(() => {
  portalModalEl.classList.add('hidden');
  state.settings.subscriptionActive && openSubscribeModal('star');
  updateSubscribeButton();
});

async function refreshPdfPrefsForm() {
  const p = (state.settings && state.settings.pdfPrefs) || DEFAULT_PDF_PREFS;
  pdfPrefsHeaderTextEl.value = p.headerText || '';
  pdfPrefsFooterTextEl.value = p.footerText || PDF_FOOTER_TEXT;
  pdfPrefsCoverEl.checked = !!p.showCover;
  pdfPrefsEndEl.checked = !!p.showEnd;
  pdfPrefsHeaderEl.checked = !!p.showHeader;
  pdfPrefsFooterEl.checked = !!p.showFooter;
  pdfPrefsPageNumbersEl.checked = !!p.showPageNumbers;
  pdfPrefsStarsEl.checked = !!p.showStars;
  pdfPrefsLogoToggleEl.checked = p.showLogo !== false;
  pdfPrefsMeteorsEl.checked = p.showMeteors !== false;

  cachedLogoImg = undefined; // force a re-fetch next time an export needs the logo
  const logoUrl = await window.api.getLogoDataUrl();
  pdfPrefsLogoPreviewEl.classList.toggle('hidden', !logoUrl);
  pdfPrefsLogoEmptyEl.classList.toggle('hidden', !!logoUrl);
  btnClearLogoEl.classList.toggle('hidden', !logoUrl);
  if (logoUrl) pdfPrefsLogoPreviewEl.src = logoUrl;

  pdfPrefsEndPdfNameEl.textContent = p.endPdfPath ? p.endPdfPath.split(/[\\/]/).pop() : 'Page par défaut (QR code)';
  btnClearEndPdfEl.classList.toggle('hidden', !p.endPdfPath);

  schedulePdfPreview();
}

// ---------- Live preview of the export settings, next to the form ----------
// Reads the form's current (possibly unsaved) values directly, so the preview reacts to every
// toggle/text change immediately rather than only after "Enregistrer". Reuses the exact same
// build*Image() functions as the real export, so what's shown here is pixel-for-pixel what a
// real export would produce, not a separate mockup that could drift out of sync.
function readLivePdfPrefs() {
  const saved = (state.settings && state.settings.pdfPrefs) || {};
  return {
    headerText: pdfPrefsHeaderTextEl.value.trim() || null,
    footerText: pdfPrefsFooterTextEl.value.trim() || PDF_FOOTER_TEXT,
    logoPath: saved.logoPath || null,
    endPdfPath: saved.endPdfPath || null,
    showCover: pdfPrefsCoverEl.checked,
    showEnd: pdfPrefsEndEl.checked,
    showHeader: pdfPrefsHeaderEl.checked,
    showFooter: pdfPrefsFooterEl.checked,
    showPageNumbers: pdfPrefsPageNumbersEl.checked,
    showStars: pdfPrefsStarsEl.checked,
    showLogo: pdfPrefsLogoToggleEl.checked,
    showMeteors: pdfPrefsMeteorsEl.checked
  };
}

function makePdfPreviewLabel(text) {
  const l = document.createElement('div');
  l.className = 'pdf-preview-label';
  l.textContent = text;
  return l;
}

let pdfPreviewToken = 0;
async function renderPdfPreview() {
  if (screenSettingsEl.classList.contains('hidden')) return;
  const myToken = ++pdfPreviewToken;
  const prefs = readLivePdfPrefs();

  const [coverImg, headerImg, footerImg, endImg] = await Promise.all([
    prefs.showCover ? buildCoverImage(state.theme, 'Tableau exemple', prefs) : null,
    (prefs.showHeader || prefs.showPageNumbers) ? buildHeaderImage(state.theme, 'Tableau exemple', 1, prefs) : null,
    prefs.showFooter ? buildFooterImage(state.theme, prefs) : null,
    (prefs.showEnd && !prefs.endPdfPath) ? buildEndImage(state.theme, prefs) : null
  ]);
  if (myToken !== pdfPreviewToken) return; // a newer render already superseded this one

  const stack = document.getElementById('pdf-preview-stack');
  stack.innerHTML = '';

  if (coverImg) {
    stack.appendChild(makePdfPreviewLabel('Page de garde'));
    const img = document.createElement('img');
    img.className = 'pdf-preview-full-img';
    img.src = coverImg;
    stack.appendChild(img);
  }

  stack.appendChild(makePdfPreviewLabel('Page de contenu'));
  const page = document.createElement('div');
  page.className = 'pdf-preview-page';
  if (headerImg) {
    const h = document.createElement('img');
    h.className = 'pdf-preview-band';
    h.src = headerImg;
    page.appendChild(h);
  }
  const body = document.createElement('div');
  body.className = 'pdf-preview-body';
  body.textContent = 'Tes notes';
  page.appendChild(body);
  if (footerImg) {
    const f = document.createElement('img');
    f.className = 'pdf-preview-band';
    f.src = footerImg;
    page.appendChild(f);
  }
  stack.appendChild(page);

  if (prefs.showEnd) {
    stack.appendChild(makePdfPreviewLabel('Page de fin'));
    if (prefs.endPdfPath) {
      const ph = document.createElement('div');
      ph.className = 'pdf-preview-endpdf-placeholder';
      ph.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/></svg><span>Ton PDF personnalisé</span>';
      stack.appendChild(ph);
    } else if (endImg) {
      const img = document.createElement('img');
      img.className = 'pdf-preview-full-img';
      img.src = endImg;
      stack.appendChild(img);
    }
  }
}

let pdfPreviewDebounceTimer = null;
function schedulePdfPreview() {
  clearTimeout(pdfPreviewDebounceTimer);
  pdfPreviewDebounceTimer = setTimeout(renderPdfPreview, 300);
}

[pdfPrefsHeaderTextEl, pdfPrefsFooterTextEl].forEach((el) => el.addEventListener('input', schedulePdfPreview));
[pdfPrefsCoverEl, pdfPrefsEndEl, pdfPrefsHeaderEl, pdfPrefsFooterEl, pdfPrefsPageNumbersEl, pdfPrefsStarsEl, pdfPrefsLogoToggleEl, pdfPrefsMeteorsEl]
  .forEach((el) => el.addEventListener('change', schedulePdfPreview));

document.getElementById('btn-pdf-prefs-pick-logo').addEventListener('click', async () => {
  const res = await window.api.pickLogo();
  if (res && res.ok) { state.settings = await window.api.getSettings(); refreshPdfPrefsForm(); }
});
btnClearLogoEl.addEventListener('click', async () => {
  state.settings = await window.api.clearLogo();
  refreshPdfPrefsForm();
});
document.getElementById('btn-pdf-prefs-pick-endpdf').addEventListener('click', async () => {
  const res = await window.api.pickEndPdf();
  if (res && res.ok) { state.settings = await window.api.getSettings(); refreshPdfPrefsForm(); }
});
btnClearEndPdfEl.addEventListener('click', async () => {
  state.settings = await window.api.clearEndPdf();
  refreshPdfPrefsForm();
});

document.getElementById('btn-pdf-prefs-save').addEventListener('click', async () => {
  const pdfPrefs = {
    headerText: pdfPrefsHeaderTextEl.value.trim() || null,
    footerText: pdfPrefsFooterTextEl.value.trim() || PDF_FOOTER_TEXT,
    showCover: pdfPrefsCoverEl.checked,
    showEnd: pdfPrefsEndEl.checked,
    showHeader: pdfPrefsHeaderEl.checked,
    showFooter: pdfPrefsFooterEl.checked,
    showPageNumbers: pdfPrefsPageNumbersEl.checked,
    showStars: pdfPrefsStarsEl.checked,
    showLogo: pdfPrefsLogoToggleEl.checked,
    showMeteors: pdfPrefsMeteorsEl.checked
  };
  state.settings = await window.api.setSettings({ pdfPrefs });
  flashStatus('Préférences PDF enregistrées');
  closeSubscribeModal();
});

const THEME_MODE_OPTIONS = [
  {
    mode: 'nuit', label: 'Nuit',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20.8 14.2A8.5 8.5 0 1 1 9.8 3.2 7 7 0 0 0 20.8 14.2z"/></svg>'
  },
  {
    mode: 'jour', label: 'Jour',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1.5v3M12 19.5v3M22.5 12h-3M4.5 12h-3M19.6 4.4l-2.1 2.1M6.5 17.5l-2.1 2.1M19.6 19.6l-2.1-2.1M6.5 6.5L4.4 4.4"/></svg>'
  },
  { mode: 'physique', label: 'Physique', icon: '<img src="assets/theme/physique.svg" width="16" height="16">' },
  { mode: 'chimie', label: 'Chimie', icon: '<img src="assets/theme/chimie.svg" width="16" height="16">' },
  { mode: 'biologie', label: 'Biologie', icon: '<img src="assets/theme/biologie.svg" width="16" height="16">' }
];
const THEME_MODE_META = {
  nuit: { dataTheme: 'dark', theme: 'dark' },
  jour: { dataTheme: 'light', theme: 'light' },
  physique: { dataTheme: 'physique', theme: 'light' },
  chimie: { dataTheme: 'chimie', theme: 'light' },
  biologie: { dataTheme: 'biologie', theme: 'light' }
};

const btnThemeEl = document.getElementById('btn-theme');

function updateThemeBtnIcon() {
  const opt = THEME_MODE_OPTIONS.find((o) => o.mode === state.colorMode);
  if (opt) btnThemeEl.innerHTML = opt.icon;
}

function setColorMode(mode) {
  const meta = THEME_MODE_META[mode];
  if (!meta) return;
  state.colorMode = mode;
  state.theme = meta.theme;
  document.documentElement.setAttribute('data-theme', meta.dataTheme);
  updateThemeBtnIcon();
  updateGridColorCache();
  render();
}

function closeThemeModeMenu() {
  document.querySelectorAll('.theme-mode-dropdown').forEach((d) => d.remove());
}

function openThemeModeMenu() {
  closeThemeModeMenu();
  const r = btnThemeEl.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'page-mode-dropdown theme-mode-dropdown';
  dd.style.left = Math.round(r.left) + 'px';
  dd.style.top = Math.round(r.bottom + 6) + 'px';
  THEME_MODE_OPTIONS.forEach((opt) => {
    const b = document.createElement('button');
    if (state.colorMode === opt.mode) b.classList.add('active-option');
    b.innerHTML = `<span class="pmd-icon">${opt.icon}</span><span>${opt.label}</span>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeThemeModeMenu();
      setColorMode(opt.mode);
    });
    dd.appendChild(b);
  });
  document.body.appendChild(dd);
  setTimeout(() => {
    document.addEventListener('click', function onDocClick(e) {
      if (!dd.contains(e.target) && e.target !== btnThemeEl) {
        closeThemeModeMenu();
        document.removeEventListener('click', onDocClick);
      }
    });
  }, 0);
}

btnThemeEl.addEventListener('click', (e) => {
  e.stopPropagation();
  openThemeModeMenu();
});
updateThemeBtnIcon();

document.getElementById('toggle-sidebar').addEventListener('click', () => sidebar.classList.toggle('collapsed'));

document.getElementById('btn-export').addEventListener('click', () => {
  if (state.pageMode !== 'off') exportPdfPagesMode();
  else exportPdfSinglePage();
});

const btnPagesModeEl = document.getElementById('btn-pages-mode');
function updatePagesModeBtn() {
  btnPagesModeEl.classList.toggle('active', state.pageMode !== 'off');
}

const PAGE_MODE_OPTIONS = [
  {
    mode: 'off', label: 'One page',
    icon: '<svg viewBox="0 0 114 151" width="11" height="15" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="104" height="141" rx="14" stroke="currentColor" stroke-width="10" stroke-dasharray="20 20"/></svg>'
  },
  {
    mode: 'vertical', label: 'Pages verticales',
    icon: '<svg viewBox="0 0 114 324" width="11" height="32" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="178" width="104" height="141" rx="14" stroke="currentColor" stroke-width="10" stroke-dasharray="20 20"/><rect x="5" y="5" width="104" height="141" rx="14" stroke="currentColor" stroke-width="10" stroke-dasharray="20 20"/></svg>'
  },
  {
    mode: 'horizontal', label: 'Pages horizontales',
    icon: '<svg viewBox="0 0 246 151" width="25" height="15" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="137" y="5" width="104" height="141" rx="14" stroke="currentColor" stroke-width="10" stroke-dasharray="20 20"/><rect x="5" y="5" width="104" height="141" rx="14" stroke="currentColor" stroke-width="10" stroke-dasharray="20 20"/></svg>'
  },
  {
    mode: 'plus', label: 'Pages +',
    icon: '<svg viewBox="0 0 114 151" width="11" height="15" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="5" width="104" height="141" rx="14" stroke="currentColor" stroke-width="10" stroke-dasharray="20 20"/><path d="M57.5 57V98.5" stroke="currentColor" stroke-width="10"/><path d="M78.2549 77.745L36.7549 77.745" stroke="currentColor" stroke-width="10"/></svg>'
  }
];

function closePageModeMenu() {
  document.querySelectorAll('.page-mode-dropdown').forEach(d => d.remove());
}

function setPageMode(mode) {
  if (!state.boardId) return;
  if (mode !== state.pageMode) state.pageBoxes = [];
  state.pageMode = mode;
  updatePagesModeBtn();
  render();
  scheduleSave();
}

function openPageModeMenu() {
  closePageModeMenu();
  const r = btnPagesModeEl.getBoundingClientRect();
  const dd = document.createElement('div');
  dd.className = 'page-mode-dropdown';
  dd.style.left = Math.round(r.left) + 'px';
  dd.style.top = Math.round(r.bottom + 6) + 'px';
  PAGE_MODE_OPTIONS.forEach(opt => {
    const b = document.createElement('button');
    if (state.pageMode === opt.mode) b.classList.add('active-option');
    b.innerHTML = `<span class="pmd-icon">${opt.icon}</span><span>${opt.label}</span>`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closePageModeMenu();
      setPageMode(opt.mode);
    });
    dd.appendChild(b);
  });
  document.body.appendChild(dd);
  setTimeout(() => {
    document.addEventListener('click', function onDocClick(e) {
      if (!dd.contains(e.target) && e.target !== btnPagesModeEl) {
        closePageModeMenu();
        document.removeEventListener('click', onDocClick);
      }
    });
  }, 0);
}

btnPagesModeEl.addEventListener('click', (e) => {
  if (!state.boardId) return;
  e.stopPropagation();
  openPageModeMenu();
});

function buildExportCanvas() {
  const bbox = getObjectsBBox(state.objects) || { x: 0, y: 0, w: 800, h: 600 };
  const pad = 40;
  const scale = 2;
  const off = document.createElement('canvas');
  off.width = (bbox.w + pad * 2) * scale;
  off.height = (bbox.h + pad * 2) * scale;
  const octx = off.getContext('2d');
  octx.fillStyle = state.theme === 'dark' ? '#2a2a2a' : '#ffffff';
  octx.fillRect(0, 0, off.width, off.height);
  octx.setTransform(scale, 0, 0, scale, (pad - bbox.x) * scale, (pad - bbox.y) * scale);
  for (const obj of state.objects) drawObjectGeneric(octx, obj);
  return off;
}

// Renders one canvas per page box in state.pageBoxes (world-anchored rects matching the
// dashed guides drawn by drawPageOverlay() — vertical/horizontal auto-flow modes are
// extended first via ensureAutoPageBoxes(); 'plus' mode uses exactly what the user placed).
// Returns {img, pageNum} pairs so skipped empty pages don't shift the numbering of the rest.
function buildExportPagesFixed() {
  ensureAutoPageBoxes();
  const boxes = state.pageBoxes;
  if (!boxes.length) return [];
  const pageWidthPx = A4_PAGE_W * A4_SUPERSAMPLE;
  const pageHeightPx = A4_PAGE_H * A4_SUPERSAMPLE;
  const pages = [];
  boxes.forEach((b, i) => {
    const pageRect = { x: b.x, y: b.y, w: A4_PAGE_W, h: A4_PAGE_H };
    const hasContent = state.objects.some(obj => bboxIntersects(getObjBBox(obj), pageRect));
    if (!hasContent) return;
    const off = document.createElement('canvas');
    off.width = pageWidthPx;
    off.height = pageHeightPx;
    const octx = off.getContext('2d');
    octx.fillStyle = state.theme === 'dark' ? '#2a2a2a' : '#ffffff';
    octx.fillRect(0, 0, off.width, off.height);
    octx.setTransform(A4_SUPERSAMPLE, 0, 0, A4_SUPERSAMPLE, -b.x * A4_SUPERSAMPLE, -b.y * A4_SUPERSAMPLE);
    for (const obj of state.objects) drawObjectGeneric(octx, obj);
    pages.push({ img: off.toDataURL('image/png'), pageNum: i + 1 });
  });
  return pages;
}

// ---------- PDF cover / header / footer art compositing ----------
// The cover/header/footer are static brand SVGs with placeholder text baked in as vector
// outlines (no editable <text> node), so the board name is painted in by: rasterizing the
// source art, sampling the true background pixel color next to the placeholder to mask it
// seamlessly (works regardless of gradients/decoration behind it), then drawing fresh text.
const PDF_ASSET_W = 1237, PDF_ASSET_H_COVER = 1751, PDF_ASSET_H_BAND = 186;
const PDF_COVER_TITLE_BBOX = { x: 531.9, y: 850, w: 172.3, h: 60 }; // "Titre" placeholder
const PDF_COVER_TAGLINE_BBOX = { x: 73.2, y: 1641, w: 1093.4, h: 48.5 }; // repeats the footer tagline
const PDF_HEADER_TITLE_BBOX = { x: 564.4, y: 77.1, w: 107.7, h: 37.5 };
const PDF_HEADER_CIRCLE = { cx: 1122.65, cy: 93.25, r: 50 };
const PDF_FOOTER_TEXT_BBOX = { x: 73.2, y: 50, w: 1093.4, h: 48.5 };
const PDF_FOOTER_TEXT = 'Propulsé par Echec & Maths - Cours particuliers';
// Pixel font size shared by the footer and the cover's matching tagline, computed once from
// the band's own scale so both end up visually identical regardless of the cover's own scale.
const PDF_FOOTER_FONT_PX = Math.round(PDF_HEADER_TITLE_BBOX.h * 0.82 * (PDF_BAND_H * A4_SUPERSAMPLE / PDF_ASSET_H_BAND));

function loadImageAsync(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// The sparkle stars in the brand SVGs are each their own "<g filter=...>" group with a drop
// shadow — stripping them (for subscribers who turn "afficher les étoiles" off) means parsing
// the real SVG DOM and removing those groups before rasterizing, instead of just pointing an
// <img> at the file. A plain regex on the raw markup isn't safe here: at least one app icon
// (Astrolab, on the end page) has its own star-shaped logomark built the exact same way — a
// white sparkle path in a "<g filter=...>" group — so matching on the filter alone would also
// delete real logo art. The real difference is structural: decorative stars sit directly in the
// page-level clip, while an icon's glyph sits inside that icon's own much smaller clip (the
// colored square behind it), so we only strip groups whose clip is close to full-page size.
// Meteor tails are big elongated gradient paths ("url(#paintN_linear...)" fill, much wider than
// tall); meteor heads are the plain white/dark circle at the tail's start (same fill as the
// current theme's "ink" color, roughly square, sized well above any decorative star). Matching
// on shape/fill like this (rather than hardcoded ids, which differ between the dark/white asset
// variants) finds every meteor consistently across cover/end art. Icon glyphs (like Astrolab's
// own star-shaped logomark on the end page) can accidentally match the same fill/size profile,
// so anything sitting inside a small icon-slot clip — same test used to spare it from star
// stripping — is excluded here too.
function isMeteorTail(el) {
  const fill = el.getAttribute('fill') || '';
  if (!/^url\(#paint\d+_linear/.test(fill)) return false;
  const bb = el.getBBox();
  return bb.width > 150 && bb.height > 100 && bb.width > bb.height * 1.5;
}
function isMeteorHead(el) {
  const fill = (el.getAttribute('fill') || '').trim().toLowerCase();
  if (fill !== 'white' && fill !== '#2a2a2a') return false;
  const bb = el.getBBox();
  return bb.width > 140 && bb.width < 520 && Math.abs(bb.width - bb.height) < 15;
}
function isInsideIconClip(el, svgW, svgH) {
  let anc = el.parentElement;
  while (anc && anc.tagName !== 'svg') {
    const clip = anc.getAttribute && anc.getAttribute('clip-path');
    const m = clip && clip.match(/url\(#([^)]+)\)/);
    if (m) {
      const clipEl = document.getElementById(m[1]);
      const clipRect = clipEl && clipEl.querySelector('rect');
      if (clipRect && svgW && svgH) {
        const cw = parseFloat(clipRect.getAttribute('width')) || 0;
        const ch = parseFloat(clipRect.getAttribute('height')) || 0;
        if (cw < svgW * 0.5 || ch < svgH * 0.5) return true;
      }
    }
    anc = anc.parentElement;
  }
  return false;
}

// A single reusable, zero-size, off-screen host — meteor detection needs getBBox(), which only
// works on elements actually laid out by the renderer; a document from DOMParser is never
// attached to the page so every getBBox() on it comes back {0,0,0,0}. Briefly mounting the
// parsed SVG here gives it real layout without it ever being visible.
let hiddenSvgHost;
function getHiddenSvgHost() {
  if (!hiddenSvgHost) {
    hiddenSvgHost = document.createElement('div');
    hiddenSvgHost.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;left:-99999px;top:-99999px;';
    document.body.appendChild(hiddenSvgHost);
  }
  return hiddenSvgHost;
}

async function loadSvgImage(src, opts) {
  const { stripStars, stripMeteors, accent } = opts || {};
  const res = await fetch(src);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svgRoot = doc.documentElement;
  const svgW = parseFloat(svgRoot.getAttribute('width')) || 0;
  const svgH = parseFloat(svgRoot.getAttribute('height')) || 0;

  if (stripStars) {
    const filterGroups = Array.from(svgRoot.querySelectorAll('g[filter]'))
      .filter(g => /filter\d+_d_/.test(g.getAttribute('filter') || ''));
    for (const g of filterGroups) {
      const parentClip = g.parentElement && g.parentElement.getAttribute('clip-path');
      const clipIdMatch = parentClip && parentClip.match(/url\(#([^)]+)\)/);
      let isDecorativeStar = true;
      if (clipIdMatch) {
        const clipEl = doc.getElementById(clipIdMatch[1]);
        const clipRect = clipEl && clipEl.querySelector('rect');
        if (clipRect && svgW && svgH) {
          const cw = parseFloat(clipRect.getAttribute('width')) || 0;
          const ch = parseFloat(clipRect.getAttribute('height')) || 0;
          if (cw < svgW * 0.5 || ch < svgH * 0.5) isDecorativeStar = false;
        }
      }
      if (isDecorativeStar) g.remove();
    }
  }

  // Meteor pass: mount on the hidden host so getBBox() reflects real geometry, decide what to
  // remove, then serialize that same (now live) element rather than the original detached one.
  // "Afficher les météorites" is the sole toggle here — every comet on the page (the one at the
  // top as much as any other) is removed only when that checkbox is off, never unconditionally.
  const host = getHiddenSvgHost();
  const imported = document.importNode(svgRoot, true);
  host.appendChild(imported);
  if (svgW && svgH && stripMeteors) {
    const candidates = Array.from(imported.querySelectorAll('path')).filter(
      (el) => (isMeteorTail(el) || isMeteorHead(el)) && !isInsideIconClip(el, svgW, svgH)
    );
    for (const el of candidates) el.remove();
  }

  // A subject color mode recolors all of the artwork's baked-in "ink" — static slogan text
  // (e.g. "Notes de cours"), comet/meteor gradients and star shapes all use the same fixed
  // #2A2A2A/#D9D9D9 ink pair (never the Astrolab logo's own orange gradient), so a blanket swap
  // recolors everything the theme should touch without needing per-element bookkeeping. This
  // runs AFTER meteor pruning above — isMeteorHead()/isMeteorTail() key off the original
  // white/#2A2A2A fills, so recoloring first would make surviving comet heads invisible to that
  // check and orphan them from their (still-detected, still-removed) tails.
  if (accent) {
    for (const el of imported.querySelectorAll('[fill]')) {
      if ((el.getAttribute('fill') || '').toLowerCase() === '#2a2a2a') el.setAttribute('fill', accent);
    }
    for (const el of imported.querySelectorAll('[stroke]')) {
      if ((el.getAttribute('stroke') || '').toLowerCase() === '#2a2a2a') el.setAttribute('stroke', accent);
    }
    const inkStops = new Set(['#2a2a2a', '#d9d9d9']);
    for (const stop of imported.querySelectorAll('linearGradient stop, radialGradient stop')) {
      if (inkStops.has((stop.getAttribute('stop-color') || '').toLowerCase())) stop.setAttribute('stop-color', accent);
    }
  }

  const cleaned = new XMLSerializer().serializeToString(imported);
  host.removeChild(imported);

  const blobUrl = URL.createObjectURL(new Blob([cleaned], { type: 'image/svg+xml' }));
  try {
    return await loadImageAsync(blobUrl);
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
  }
}

let cachedLogoImg;
async function loadLogoImage() {
  if (cachedLogoImg !== undefined) return cachedLogoImg;
  const dataUrl = await window.api.getLogoDataUrl();
  cachedLogoImg = dataUrl ? await loadImageAsync(dataUrl) : null;
  return cachedLogoImg;
}

// Draws the subscriber's custom logo in the bottom-left corner of whatever page/band was
// just composited — always the same corner across cover, header, footer and end pages, so it
// reads as a consistent brand mark. Sized relative to band height so it reads consistently
// across the header, footer and full pages.
function overlayLogo(ctx, logoImg, canvasW, canvasH, refH) {
  if (!logoImg) return;
  const h = refH * 0.6;
  const w = h * (logoImg.naturalWidth / logoImg.naturalHeight);
  const pad = refH * 0.2;
  ctx.drawImage(logoImg, pad, canvasH - h - pad, w, h);
}

function sampleColorNear(ctx, x, y) {
  const d = ctx.getImageData(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)), 1, 1).data;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}

// The header's backdrop is a left-to-right gradient band, so a single flat sampled color
// leaves a visible seam at the patch edges — sample both edges and mask with a matching
// gradient instead, so the patch blends into the real backdrop at every x.
function fillMaskGradient(ctx, x, y, w, h, sampleY) {
  const left = sampleColorNear(ctx, x, sampleY);
  const right = sampleColorNear(ctx, x + w, sampleY);
  const grad = ctx.createLinearGradient(x, y, x + w, y);
  grad.addColorStop(0, left);
  grad.addColorStop(1, right);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

// A subject color mode (Physique/Chimie/Biologie) recolors the PDF's own "ink" — title, header,
// footer text and the page-number badge — to match the accent shown throughout the app, instead
// of the plain black/white text the default Nuit/Jour modes use.
const PDF_ACCENT_BY_MODE = { physique: '#FF8A1F', chimie: '#57B3FE', biologie: '#6DC82A' };
function getPdfAccentColor() {
  return PDF_ACCENT_BY_MODE[state.colorMode] || null;
}

async function buildCoverImage(theme, boardName, prefs) {
  const asset = theme === 'dark' ? 'assets/pdf/cover-dark.svg' : 'assets/pdf/cover-white.svg';
  // A visible custom logo replaces the default branding, so the decorative stars (designed
  // around the default look) are hidden too, on top of whatever "afficher les étoiles" is set
  // to. Meteors stay under the sole control of "afficher les météorites" — a custom logo no
  // longer forces them off.
  const logoVisible = !!prefs.logoPath && prefs.showLogo;
  const accent = getPdfAccentColor();
  const img = await loadSvgImage(asset, { stripStars: !prefs.showStars || logoVisible, stripMeteors: !prefs.showMeteors, accent });
  const SS = A4_SUPERSAMPLE;
  const c = document.createElement('canvas');
  c.width = A4_PAGE_W * SS; c.height = A4_PAGE_H * SS;
  const octx = c.getContext('2d');
  octx.drawImage(img, 0, 0, c.width, c.height);
  const kx = c.width / PDF_ASSET_W, ky = c.height / PDF_ASSET_H_COVER;
  const textColor = accent || (theme === 'dark' ? '#ffffff' : '#2A2A2A');

  // Bottom tagline — resized to match the footer's text size exactly (same PDF_FOOTER_FONT_PX).
  const tag = PDF_COVER_TAGLINE_BBOX;
  const tagBg = sampleColorNear(octx, 4, tag.y * ky);
  octx.fillStyle = tagBg;
  octx.fillRect(0, (tag.y - 4) * ky, c.width, (tag.h + 8) * ky);
  octx.fillStyle = textColor;
  octx.font = `700 ${PDF_FOOTER_FONT_PX}px Arial, "Segoe UI", sans-serif`;
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillText(prefs.footerText || PDF_FOOTER_TEXT, c.width / 2, (tag.y + tag.h / 2) * ky + 1);

  // Title (board name) — enlarged. Mask width is measured from the actual text so long
  // board names don't get clipped by a fixed-size patch.
  const b = PDF_COVER_TITLE_BBOX;
  const titleFontPx = Math.round(b.h * 1.3 * ky);
  octx.font = `700 ${titleFontPx}px Arial, "Segoe UI", sans-serif`;
  const text = boardName || 'Tableau sans titre';
  const textW = octx.measureText(text).width;
  const padX = b.h * 0.5 * kx, padY = b.h * 0.45 * ky;
  const maskW = textW + padX * 2, maskH = titleFontPx + padY * 2;
  const cx = (b.x + b.w / 2) * kx, cy = (b.y + b.h / 2) * ky;
  const titleBg = sampleColorNear(octx, cx - maskW / 2, cy - maskH / 2 - 4);
  octx.fillStyle = titleBg;
  octx.fillRect(cx - maskW / 2, cy - maskH / 2, maskW, maskH);
  octx.fillStyle = textColor;
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillText(text, cx, cy + 1);
  overlayLogo(octx, prefs.showLogo ? await loadLogoImage() : null, c.width, c.height, PDF_BAND_H * SS);
  return c.toDataURL('image/png');
}

// Static promo end-page — no placeholder text, just rasterized as-is at full page size.
async function buildEndImage(theme, prefs) {
  const asset = theme === 'dark' ? 'assets/pdf/end-dark.svg' : 'assets/pdf/end-white.svg';
  const img = await loadSvgImage(asset, { stripStars: !prefs.showStars, stripMeteors: !prefs.showMeteors, accent: getPdfAccentColor() });
  const SS = A4_SUPERSAMPLE;
  const c = document.createElement('canvas');
  c.width = A4_PAGE_W * SS; c.height = A4_PAGE_H * SS;
  const octx = c.getContext('2d');
  octx.drawImage(img, 0, 0, c.width, c.height);
  overlayLogo(octx, prefs.showLogo ? await loadLogoImage() : null, c.width, c.height, PDF_BAND_H * SS);
  return c.toDataURL('image/png');
}

async function buildHeaderImage(theme, boardName, pageNum, prefs) {
  const SS = A4_SUPERSAMPLE;
  const c = document.createElement('canvas');
  c.width = A4_PAGE_W * SS; c.height = PDF_BAND_H * SS;
  const octx = c.getContext('2d');
  const kx = c.width / PDF_ASSET_W, ky = c.height / PDF_ASSET_H_BAND;

  if (!prefs.showHeader) {
    // Header artwork/title hidden but page numbers kept: just the numbered circle, no trail —
    // same circle position/size as in the full header, on a flat page-background band.
    if (!prefs.showPageNumbers) return null;
    const bg = theme === 'dark' ? '#2A2A2A' : '#ffffff';
    octx.fillStyle = bg;
    octx.fillRect(0, 0, c.width, c.height);
    const accent = getPdfAccentColor();
    const circleFill = accent || (theme === 'dark' ? '#ffffff' : '#2A2A2A');
    const numberColor = accent ? '#ffffff' : (theme === 'dark' ? '#2A2A2A' : '#ffffff');
    octx.fillStyle = circleFill;
    octx.beginPath();
    octx.arc(PDF_HEADER_CIRCLE.cx * kx, PDF_HEADER_CIRCLE.cy * ky, PDF_HEADER_CIRCLE.r * ((kx + ky) / 2), 0, Math.PI * 2);
    octx.fill();
    octx.fillStyle = numberColor;
    octx.font = `700 ${Math.round(PDF_HEADER_CIRCLE.r * 0.85 * ky)}px Arial, "Segoe UI", sans-serif`;
    octx.textAlign = 'center'; octx.textBaseline = 'middle';
    octx.fillText(String(pageNum), PDF_HEADER_CIRCLE.cx * kx, PDF_HEADER_CIRCLE.cy * ky + 1);
    // No logo here — the header band sits at the top of the page, and the logo belongs at the
    // bottom-left of the page itself (cover, footer, end), never up here.
    return c.toDataURL('image/png');
  }

  const asset = theme === 'dark' ? 'assets/pdf/header-dark.svg' : 'assets/pdf/header-white.svg';
  const img = await loadSvgImage(asset, { stripStars: !prefs.showStars, accent: getPdfAccentColor() });
  octx.drawImage(img, 0, 0, c.width, c.height);
  const b = PDF_HEADER_TITLE_BBOX;
  const pad = b.h * 0.35;
  fillMaskGradient(octx, (b.x - pad) * kx, (b.y - pad) * ky, (b.w + pad * 2) * kx, (b.h + pad * 2) * ky, b.y * ky);
  const titleColor = getPdfAccentColor() || (theme === 'dark' ? '#ffffff' : '#2A2A2A');
  octx.fillStyle = titleColor;
  octx.font = `700 ${Math.round(b.h * 0.82 * ky)}px Arial, "Segoe UI", sans-serif`;
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillText(prefs.headerText || boardName || 'Tableau sans titre', (b.x + b.w / 2) * kx, (b.y + b.h / 2) * ky + 1);
  if (prefs.showPageNumbers) {
    const circleColor = theme === 'dark' ? '#2A2A2A' : '#ffffff';
    octx.fillStyle = circleColor;
    octx.font = `700 ${Math.round(PDF_HEADER_CIRCLE.r * 0.85 * ky)}px Arial, "Segoe UI", sans-serif`;
    octx.fillText(String(pageNum), PDF_HEADER_CIRCLE.cx * kx, PDF_HEADER_CIRCLE.cy * ky + 1);
  }
  // No logo here either — same reasoning as the page-numbers-only branch above.
  return c.toDataURL('image/png');
}

async function buildFooterImage(theme, prefs) {
  const asset = theme === 'dark' ? 'assets/pdf/footer-dark.svg' : 'assets/pdf/footer-white.svg';
  const img = await loadSvgImage(asset, { stripStars: !prefs.showStars, accent: getPdfAccentColor() });
  const SS = A4_SUPERSAMPLE;
  const c = document.createElement('canvas');
  c.width = A4_PAGE_W * SS; c.height = PDF_BAND_H * SS;
  const octx = c.getContext('2d');
  octx.drawImage(img, 0, 0, c.width, c.height);
  const kx = c.width / PDF_ASSET_W, ky = c.height / PDF_ASSET_H_BAND;
  const b = PDF_FOOTER_TEXT_BBOX;
  const bg = sampleColorNear(octx, 4, b.y * ky);
  octx.fillStyle = bg;
  octx.fillRect(0, (b.y - 4) * ky, c.width, (b.h + 8) * ky);
  octx.fillStyle = getPdfAccentColor() || (theme === 'dark' ? '#ffffff' : '#2A2A2A');
  octx.font = `700 ${PDF_FOOTER_FONT_PX}px Arial, "Segoe UI", sans-serif`;
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillText(prefs.footerText || PDF_FOOTER_TEXT, c.width / 2, (b.y + b.h / 2) * ky + 1);
  overlayLogo(octx, prefs.showLogo ? await loadLogoImage() : null, c.width, c.height, c.height);
  return c.toDataURL('image/png');
}

// PDF customization (logo, texts, which pages/bands to include) is a paid feature — without
// an active subscription the export always uses these unmodified defaults.
const DEFAULT_PDF_PREFS = {
  footerText: PDF_FOOTER_TEXT, headerText: null, logoPath: null, endPdfPath: null,
  showCover: true, showEnd: true, showHeader: true, showFooter: true,
  showPageNumbers: true, showStars: true, showLogo: true, showMeteors: true
};
function getPdfPrefs() {
  const s = state.settings;
  if (s && s.subscriptionActive && s.pdfPrefs) return s.pdfPrefs;
  return DEFAULT_PDF_PREFS;
}

async function exportPdfSinglePage() {
  const prefs = getPdfPrefs();
  const off = buildExportCanvas();
  const [coverImg, footerImg, headerImg, endImg] = await Promise.all([
    prefs.showCover ? buildCoverImage(state.theme, state.boardName, prefs) : null,
    prefs.showFooter ? buildFooterImage(state.theme, prefs) : null,
    (prefs.showHeader || prefs.showPageNumbers) ? buildHeaderImage(state.theme, state.boardName, 1, prefs) : null,
    (prefs.showEnd && !prefs.endPdfPath) ? buildEndImage(state.theme, prefs) : null
  ]);
  const contentPages = [{ img: off.toDataURL('image/png'), headerImg }];
  // Single-page export: the page height follows the notes' own aspect ratio at A4 width,
  // instead of forcing everything into a fixed A4 height (only width stays fixed).
  const contentPageHeight = A4_PAGE_W * (off.height / off.width);
  const res = await window.api.exportPdfFull({ theme: state.theme, boardName: state.boardName, coverImg, footerImg, endImg, contentPages, pdfPrefs: prefs, contentPageHeight });
  flashStatus(res && res.ok ? 'PDF exporté' : 'Export annulé');
}

async function exportPdfPagesMode() {
  const prefs = getPdfPrefs();
  const pages = buildExportPagesFixed();
  if (!pages.length) { flashStatus('Aucune page à exporter'); return; }
  const [coverImg, footerImg, endImg] = await Promise.all([
    prefs.showCover ? buildCoverImage(state.theme, state.boardName, prefs) : null,
    prefs.showFooter ? buildFooterImage(state.theme, prefs) : null,
    (prefs.showEnd && !prefs.endPdfPath) ? buildEndImage(state.theme, prefs) : null
  ]);
  const contentPages = await Promise.all(pages.map(async (p) => ({
    img: p.img,
    headerImg: (prefs.showHeader || prefs.showPageNumbers) ? await buildHeaderImage(state.theme, state.boardName, p.pageNum, prefs) : null
  })));
  const res = await window.api.exportPdfFull({ theme: state.theme, boardName: state.boardName, coverImg, footerImg, endImg, contentPages, pdfPrefs: prefs });
  flashStatus(res && res.ok ? 'PDF exporté' : 'Export annulé');
}

// Redraw helper that targets an arbitrary context (used for export and thumbnails)
function drawObjectGeneric(c, obj) {
  c.save();
  switch (obj.type) {
    case 'stroke': {
      if (!obj.points.length) break;
      c.strokeStyle = obj.color; c.lineWidth = obj.width; c.lineCap = 'round'; c.lineJoin = 'round';
      if (obj.tool === 'highlighter') { c.globalAlpha = 0.35; c.lineWidth = obj.width * 2.2; }
      if (obj.points.length === 1) {
        c.beginPath();
        c.arc(obj.points[0].x, obj.points[0].y, c.lineWidth / 2, 0, Math.PI * 2);
        c.fillStyle = c.strokeStyle;
        c.fill();
        break;
      }
      c.beginPath();
      tracePointsSmooth(c, obj.points);
      c.stroke();
      break;
    }
    case 'line':
      c.strokeStyle = obj.color; c.lineWidth = obj.width; c.lineCap = 'round';
      c.beginPath(); c.moveTo(obj.x1, obj.y1); c.lineTo(obj.x2, obj.y2); c.stroke();
      break;
    case 'arrow': {
      c.strokeStyle = obj.color; c.lineWidth = obj.width; c.lineCap = 'round';
      c.beginPath(); c.moveTo(obj.x1, obj.y1); c.lineTo(obj.x2, obj.y2); c.stroke();
      const angle = Math.atan2(obj.y2 - obj.y1, obj.x2 - obj.x1);
      const len = Math.max(10, obj.width * 3);
      c.beginPath();
      c.moveTo(obj.x2, obj.y2);
      c.lineTo(obj.x2 - len * Math.cos(angle - Math.PI / 7), obj.y2 - len * Math.sin(angle - Math.PI / 7));
      c.lineTo(obj.x2 - len * Math.cos(angle + Math.PI / 7), obj.y2 - len * Math.sin(angle + Math.PI / 7));
      c.closePath(); c.fillStyle = obj.color; c.fill();
      break;
    }
    case 'rect':
      c.strokeStyle = obj.color; c.lineWidth = obj.width;
      if (obj.filled) { c.fillStyle = obj.color; c.fillRect(obj.x, obj.y, obj.w, obj.h); }
      else c.strokeRect(obj.x, obj.y, obj.w, obj.h);
      break;
    case 'ellipse':
      c.strokeStyle = obj.color; c.lineWidth = obj.width;
      c.beginPath();
      c.ellipse(obj.x + obj.w / 2, obj.y + obj.h / 2, Math.abs(obj.w / 2), Math.abs(obj.h / 2), 0, 0, Math.PI * 2);
      if (obj.filled) { c.fillStyle = obj.color; c.fill(); }
      else c.stroke();
      break;
    case 'axes2d':
      drawAxes2D(c, obj);
      break;
    case 'axes3d':
      drawAxes3D(c, obj);
      break;
    case 'trigcircle':
      drawTrigCircle(c, obj);
      break;
    case 'text': {
      c.fillStyle = obj.color;
      c.font = `${obj.fontSize}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
      c.textBaseline = 'top';
      const lines = wrapText(c, obj.text, obj.w);
      const lh = obj.fontSize * 1.3;
      lines.forEach((line, i) => c.fillText(line, obj.x, obj.y + i * lh));
      break;
    }
    case 'note': {
      const r = 8;
      c.fillStyle = obj.color;
      c.beginPath();
      c.moveTo(obj.x + r, obj.y);
      c.arcTo(obj.x + obj.w, obj.y, obj.x + obj.w, obj.y + obj.h, r);
      c.arcTo(obj.x + obj.w, obj.y + obj.h, obj.x, obj.y + obj.h, r);
      c.arcTo(obj.x, obj.y + obj.h, obj.x, obj.y, r);
      c.arcTo(obj.x, obj.y, obj.x + obj.w, obj.y, r);
      c.closePath(); c.fill();
      c.fillStyle = '#1a1a1a';
      c.font = '15px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      c.textBaseline = 'top';
      const pad = 12;
      const lines = wrapText(c, obj.text, obj.w - pad * 2);
      const lh = 15 * 1.3;
      lines.forEach((line, i) => c.fillText(line, obj.x + pad, obj.y + pad + i * lh));
      break;
    }
    case 'image': {
      const img = imageCache.get(obj.id);
      if (img && img.complete && img.naturalWidth) c.drawImage(img, obj.x, obj.y, obj.w, obj.h);
      break;
    }
    case 'file':
      drawFileCard(c, obj);
      break;
  }
  c.restore();
}

// ---------- Board persistence ----------
function flashStatus(text) {
  saveStatusEl.textContent = text;
  clearTimeout(flashStatus._t);
  flashStatus._t = setTimeout(() => { saveStatusEl.textContent = 'Enregistré'; }, 1800);
}

function generateThumbnail() {
  const bbox = getObjectsBBox(state.objects);
  if (!bbox) return null;
  const tw = 220, th = 150;
  const pad = 20;
  const scale = Math.min(tw / (bbox.w + pad * 2), th / (bbox.h + pad * 2), 1.5);
  const off = document.createElement('canvas');
  off.width = tw; off.height = th;
  const octx = off.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, tw, th);
  octx.save();
  octx.translate(tw / 2 - (bbox.x + bbox.w / 2) * scale, th / 2 - (bbox.y + bbox.h / 2) * scale);
  octx.scale(scale, scale);
  for (const obj of state.objects) drawObjectGeneric(octx, obj);
  octx.restore();
  return off.toDataURL('image/png');
}

function currentBoardSnapshot() {
  return {
    id: state.boardId,
    name: state.boardName,
    objects: state.objects,
    viewport: state.viewport,
    pageMode: state.pageMode,
    pageBoxes: state.pageBoxes,
    thumbnail: generateThumbnail()
  };
}

function scheduleSave() {
  saveStatusEl.textContent = 'Enregistrement...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentBoard, 600);
}

async function saveCurrentBoard() {
  if (!state.boardId) return;
  await window.api.saveBoard(currentBoardSnapshot());
  saveStatusEl.textContent = 'Enregistré';
  refreshBoardListMeta();
}

async function refreshBoardListMeta() {
  boardsCache = await window.api.listBoards();
  renderBoardList();
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function renderBoardList() {
  boardListEl.innerHTML = '';
  for (const b of boardsCache) {
    const item = document.createElement('div');
    item.className = 'board-item' + (b.id === state.boardId ? ' active' : '');
    if (boardSelectMode) {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'board-checkbox';
      checkbox.checked = selectedBoardIds.has(b.id);
      checkbox.addEventListener('click', (e) => e.stopPropagation());
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedBoardIds.add(b.id); else selectedBoardIds.delete(b.id);
        updateBoardSelectBar();
      });
      item.appendChild(checkbox);
    }
    const thumb = document.createElement('div');
    thumb.className = 'board-thumb';
    if (b.thumbnail) thumb.style.backgroundImage = `url(${b.thumbnail})`;
    const info = document.createElement('div');
    info.className = 'board-info';
    const name = document.createElement('div'); name.className = 'board-name'; name.textContent = b.name;
    const date = document.createElement('div'); date.className = 'board-date'; date.textContent = fmtDate(b.updatedAt);
    info.appendChild(name); info.appendChild(date);
    item.appendChild(thumb); item.appendChild(info);

    let menuBtn = null;
    if (!boardSelectMode) {
      menuBtn = document.createElement('button');
      menuBtn.className = 'board-menu-btn'; menuBtn.textContent = '⋮';
      menuBtn.title = 'Renommer, dupliquer, supprimer...';
      item.appendChild(menuBtn);
    }

    item.addEventListener('click', (e) => {
      if (boardSelectMode) {
        const checkbox = item.querySelector('.board-checkbox');
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
        return;
      }
      if (e.target === menuBtn) return;
      if (b.id !== state.boardId) switchBoard(b.id);
    });
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openBoardMenu(item, b);
      });
    }
    boardListEl.appendChild(item);
  }
  if (boardSelectMode) updateBoardSelectBar();
}

const boardSelectBarEl = document.getElementById('board-select-bar');
const btnSelectBoardsEl = document.getElementById('btn-select-boards');
const chkSelectAllEl = document.getElementById('chk-select-all');
const btnDeleteSelectedEl = document.getElementById('btn-delete-selected');
const btnCancelSelectEl = document.getElementById('btn-cancel-select');

function updateBoardSelectBar() {
  const n = selectedBoardIds.size;
  btnDeleteSelectedEl.textContent = n > 0 ? `Supprimer (${n})` : 'Supprimer';
  btnDeleteSelectedEl.disabled = n === 0;
  chkSelectAllEl.checked = n > 0 && n === boardsCache.length;
  chkSelectAllEl.indeterminate = n > 0 && n < boardsCache.length;
}

function setBoardSelectMode(on) {
  boardSelectMode = on;
  selectedBoardIds.clear();
  btnSelectBoardsEl.classList.toggle('active', on);
  boardSelectBarEl.classList.toggle('hidden', !on);
  renderBoardList();
}

btnSelectBoardsEl.addEventListener('click', () => setBoardSelectMode(!boardSelectMode));
btnCancelSelectEl.addEventListener('click', () => setBoardSelectMode(false));

chkSelectAllEl.addEventListener('change', () => {
  if (chkSelectAllEl.checked) {
    boardsCache.forEach(b => selectedBoardIds.add(b.id));
  } else {
    selectedBoardIds.clear();
  }
  renderBoardList();
});

btnDeleteSelectedEl.addEventListener('click', async () => {
  const n = selectedBoardIds.size;
  if (!n) return;
  const label = n === 1 ? 'ce tableau' : `ces ${n} tableaux`;
  if (!confirm(`Supprimer ${label} définitivement ?`)) return;
  const deletingActive = selectedBoardIds.has(state.boardId);
  const idsToDelete = [...selectedBoardIds];
  for (const id of idsToDelete) {
    await window.api.deleteBoard(id);
  }
  boardSelectMode = false;
  selectedBoardIds.clear();
  btnSelectBoardsEl.classList.remove('active');
  boardSelectBarEl.classList.add('hidden');
  if (deletingActive) state.boardId = null;
  const list = await window.api.listBoards();
  if (deletingActive) {
    if (list.length) await switchBoard(list[0].id);
    else clearActiveBoard();
  }
  boardsCache = list;
  renderBoardList();
});

function openBoardMenu(item, b) {
  document.querySelectorAll('.board-dropdown').forEach(d => d.remove());
  const dd = document.createElement('div');
  dd.className = 'board-dropdown';
  const mkBtn = (label, fn, danger) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (danger) btn.classList.add('danger');
    btn.addEventListener('click', async (e) => { e.stopPropagation(); dd.remove(); await fn(); });
    return btn;
  };
  dd.appendChild(mkBtn('Renommer', () => startInlineBoardRename(item, b)));
  dd.appendChild(mkBtn('Dupliquer', async () => {
    const copy = await window.api.duplicateBoard(b.id);
    if (copy) { refreshBoardListMeta(); }
  }));
  dd.appendChild(mkBtn('Supprimer', async () => {
    if (!confirm(`Supprimer "${b.name}" définitivement ?`)) return;
    const wasActive = b.id === state.boardId;
    if (wasActive) state.boardId = null;
    await window.api.deleteBoard(b.id);
    if (wasActive) {
      const list = await window.api.listBoards();
      if (list.length) await switchBoard(list[0].id);
      else clearActiveBoard();
    }
    refreshBoardListMeta();
  }, true));
  item.appendChild(dd);
  const closeHandler = (e) => { if (!dd.contains(e.target)) { dd.remove(); document.removeEventListener('click', closeHandler); } };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// Swaps the board-list item's name label for a text input, in place — replaces the previous
// window.prompt()-based rename, which Electron's renderer never actually shows (prompt() is
// unimplemented there and just returns null instantly), so "Renommer" silently did nothing.
function startInlineBoardRename(item, b) {
  const nameEl = item.querySelector('.board-name');
  if (!nameEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'board-name-edit';
  input.value = b.name;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const newName = input.value.trim() || b.name;
    if (newName !== b.name) {
      await window.api.renameBoard(b.id, newName);
      if (b.id === state.boardId) { state.boardName = newName; boardTitleInput.value = newName; }
      await refreshBoardListMeta();
    } else {
      renderBoardList();
    }
  };
  const cancel = () => { if (done) return; done = true; renderBoardList(); };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', commit);
}

async function switchBoard(id) {
  closeEditor(true);
  await saveCurrentBoard();
  const board = await window.api.loadBoard(id);
  if (!board) return;
  loadBoardIntoState(board);
  boardsCache = await window.api.listBoards();
  renderBoardList();
}

function loadBoardIntoState(board) {
  state.boardId = board.id;
  state.boardName = board.name;
  state.objects = board.objects || [];
  state.viewport = board.viewport || { panX: wrap.clientWidth / 2, panY: wrap.clientHeight / 2, zoom: 1 };
  state.pageMode = board.pageMode || (board.pagesMode ? 'vertical' : 'off');
  state.pageBoxes = board.pageBoxes || [];
  updatePagesModeBtn();
  state.selection = [];
  history.undo = []; history.redo = [];
  imageCache.clear();
  boardTitleInput.value = state.boardName;
  updateBoardActiveUI();
  render();
}

function clearActiveBoard() {
  closeEditor(false);
  state.boardId = null;
  state.boardName = '';
  state.objects = [];
  state.selection = [];
  state.pageMode = 'off';
  state.pageBoxes = [];
  updatePagesModeBtn();
  history.undo = []; history.redo = [];
  imageCache.clear();
  updateBoardActiveUI();
  render();
}

const mainEl = document.getElementById('main');
const emptyStateEl = document.getElementById('empty-state');

function updateBoardActiveUI() {
  const hasBoard = !!state.boardId;
  mainEl.classList.toggle('no-board', !hasBoard);
  emptyStateEl.classList.toggle('hidden', hasBoard);
  boardTitleInput.disabled = !hasBoard;
  boardTitleInput.placeholder = hasBoard ? '' : 'Aucun tableau';
  if (!hasBoard) boardTitleInput.value = '';
}

document.getElementById('btn-empty-new').addEventListener('click', createNewBoard);

async function createNewBoard() {
  closeEditor(true);
  if (state.boardId) await saveCurrentBoard();
  const board = await window.api.createBoard('Tableau ' + (boardsCache.length + 1));
  loadBoardIntoState(board);
  boardsCache = await window.api.listBoards();
  renderBoardList();
}
document.getElementById('btn-new-board').addEventListener('click', createNewBoard);

boardTitleInput.addEventListener('change', () => {
  const name = boardTitleInput.value.trim() || 'Tableau sans titre';
  boardTitleInput.value = name;
  state.boardName = name;
  window.api.renameBoard(state.boardId, name).then(refreshBoardListMeta);
});
boardTitleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') boardTitleInput.blur(); });

// ---------- Init ----------
const SPLASH_MIN_MS = 3000;
function hideSplash(startedAt) {
  const splashEl = document.getElementById('splash-screen');
  if (!splashEl) return;
  const elapsed = performance.now() - startedAt;
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
  setTimeout(() => {
    splashEl.classList.add('splash-hidden');
    setTimeout(() => splashEl.remove(), 550);
  }, wait);
}

async function init() {
  const splashStart = performance.now();
  updateGridColorCache();
  resizeCanvas();
  state.settings = await window.api.getSettings();
  applyShortcutsFromSettings();
  updateSubscribeButton();
  boardsCache = await window.api.listBoards();
  if (!boardsCache.length) {
    const board = await window.api.createBoard('Tableau 1');
    loadBoardIntoState(board);
  } else {
    const board = await window.api.loadBoard(boardsCache[0].id);
    loadBoardIntoState(board);
  }
  renderBoardList();
  setTool('pen');
  buildToolbarStars();
  window.addEventListener('beforeunload', () => { /* best effort sync save skipped */ });
  hideSplash(splashStart);
}
init();

})();
