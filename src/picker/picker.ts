/**
 * Browser-side picker logic.
 * Bundled by esbuild → dist/picker.js and served as a static file.
 */

import type { AssetPickerItem, PickerConfig } from './types.js';

declare global {
  interface Window { __PICKER_CONFIG__: PickerConfig; }
}

const { sessionId: SESSION, multiSelect: MULTI, allowUpload: UPLOAD, items: ITEMS } =
  window.__PICKER_CONFIG__;

const selected = new Set<number>();
const uploaded: Array<{ name: string; path: string }> = [];
let nextIdx = ITEMS.length;
let filteredItems = [...ITEMS];

const grid    = document.getElementById('grid')!;
const count   = document.getElementById('count')!;
const btnOk   = document.getElementById('btn-confirm') as HTMLButtonElement;
const btnX    = document.getElementById('btn-cancel') as HTMLButtonElement;
const zone    = document.getElementById('upload-zone')!;
const status  = document.getElementById('upload-status')!;

const trimRanges = new Map<number, { start: number; end: number }>();

renderGrid();

btnOk.addEventListener('click', confirm_);
btnX.addEventListener('click', cancel_);

if (UPLOAD) {
  zone.style.display = 'flex';
  const fi = document.getElementById('fi') as HTMLInputElement;
  zone.addEventListener('click', () => fi.click());
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files);
  });
  fi.addEventListener('change', () => { if (fi.files) handleFiles(fi.files); });
}

// ── Search & Filter ───────────────────────────────────────────────────────────

function initSearch() {
  const searchBox = document.getElementById('search-box') as HTMLInputElement;
  if (!searchBox) return;
  searchBox.addEventListener('input', () => {
    const q = searchBox.value.trim().toLowerCase();
    filteredItems = q
      ? ITEMS.filter(item => (item.label + ' ' + item.imagePath).toLowerCase().includes(q))
      : [...ITEMS];
    renderGrid();
  });
}
initSearch();

// ── Select All / Invert ───────────────────────────────────────────────────────

function initSelectAll() {
  const btnAll = document.getElementById('btn-select-all') as HTMLButtonElement;
  const btnInv = document.getElementById('btn-select-invert') as HTMLButtonElement;
  if (!btnAll || !btnInv) return;
  btnAll.addEventListener('click', () => {
    const vis = getVisibleIndices();
    const allSel = vis.every(i => selected.has(i));
    vis.forEach(i => allSel ? selected.delete(i) : selected.add(i));
    render();
  });
  btnInv.addEventListener('click', () => {
    getVisibleIndices().forEach(i => selected.has(i) ? selected.delete(i) : selected.add(i));
    render();
  });
}
initSelectAll();

function getVisibleIndices(): number[] {
  return filteredItems.map(item => ITEMS.indexOf(item)).filter(i => i >= 0);
}

function renderGrid() {
  grid.innerHTML = '';
  filteredItems.forEach((item, displayIdx) => {
    const realIdx = ITEMS.indexOf(item);
    addCard(item, realIdx, displayIdx);
  });
  render();
}

// ── Media type ────────────────────────────────────────────────────────────────

function getMediaType(p: string): 'image' | 'audio' | 'video' | 'unknown' {
  const ext = p.split('.').pop()?.toLowerCase();
  if (!ext) return 'unknown';
  if (['png','jpg','jpeg','gif','webp','bmp','svg','ico'].includes(ext)) return 'image';
  if (['mp3','wav','ogg','aac','flac','m4a','opus','wma'].includes(ext)) return 'audio';
  if (['mp4','webm','mov','avi','mkv','flv','wmv','m4v','ogv'].includes(ext)) return 'video';
  return 'unknown';
}

function fmtDuration(s: number): string {
  if (!isFinite(s) || s < 0) return '--:--';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUDIO EDITOR MODAL  (waveform + range selection + playback)
// ═══════════════════════════════════════════════════════════════════════════════

interface AudioEditResult { start: number; end: number }

function openAudioEditor(item: AssetPickerItem, idx: number, existingTrim?: { start: number; end: number }): Promise<AudioEditResult | null> {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal-panel' });

    const header = el('div', { class: 'modal-header' });
    header.append(
      el('h2', {}, '✂️ 音频剪辑'),
      el('span', { class: 'modal-filename' }, item.label),
    );

    // Waveform container
    const waveBox = el('div', { class: 'waveform-box' });
    const canvas = el('canvas', { class: 'waveform-canvas' }) as HTMLCanvasElement;
    const cursorLine = el('div', { class: 'cursor-line' });
    const rangeOverlay = el('div', { class: 'range-overlay' });
    waveBox.append(canvas, cursorLine, rangeOverlay);

    // Time labels
    const timeRow = el('div', { class: 'time-row' });
    const startLabel = el('span', { class: 'time-label' }, '开始: 0:00');
    const durLabel = el('span', { class: 'time-label total' }, '总时长: --:--');
    const endLabel = el('span', { class: 'time-label' }, '结束: --:--');
    timeRow.append(startLabel, durLabel, endLabel);

    // Playback controls
    const controls = el('div', { class: 'playback-controls' });
    const playBtn = el('button', { class: 'btn-play' }, '▶ 播放');
    const playRangeBtn = el('button', { class: 'btn-play-range' }, '▶ 播放选中区间');
    controls.append(playBtn, playRangeBtn);

    // Buttons
    const btnRow = el('div', { class: 'modal-buttons' });
    const btnCancel = el('button', { class: 'btn-cancel-modal' }, '取消');
    const btnConfirm = el('button', { class: 'btn-confirm-modal' }, '确认裁剪');
    btnRow.append(btnCancel, btnConfirm);

    modal.append(header, waveBox, timeRow, controls, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Audio setup
    const audio = new Audio('/picker-image?path=' + encodeURIComponent(item.imagePath));
    let duration = 0;
    let rangeStart = existingTrim?.start ?? 0;
    let rangeEnd = existingTrim?.end ?? 0;
    let isDragging: 'start' | 'end' | null = null;
    let animationId = 0;

    function close(result: AudioEditResult | null) {
      cancelAnimationFrame(animationId);
      audio.pause();
      overlay.remove();
      resolve(result);
    }

    btnCancel.addEventListener('click', () => close(null));
    btnConfirm.addEventListener('click', () => close({ start: rangeStart, end: rangeEnd }));

    // Load audio & draw waveform
    audio.addEventListener('loadedmetadata', () => {
      duration = audio.duration;
      if (rangeEnd === 0 || rangeEnd > duration) rangeEnd = duration;
      durLabel.textContent = '总时长: ' + fmtDuration(duration);
      updateLabels();
      drawWaveform(canvas, audio.src, duration);
    });

    audio.addEventListener('error', () => {
      durLabel.textContent = '无法加载音频';
    });

    // Playback
    playBtn.addEventListener('click', () => {
      if (audio.paused) { audio.play(); playBtn.textContent = '⏸ 暂停'; }
      else { audio.pause(); playBtn.textContent = '▶ 播放'; }
    });
    audio.addEventListener('ended', () => { playBtn.textContent = '▶ 播放'; });
    audio.addEventListener('pause', () => { playBtn.textContent = '▶ 播放'; });

    playRangeBtn.addEventListener('click', () => {
      audio.currentTime = rangeStart;
      audio.play();
      playBtn.textContent = '⏸ 暂停';
    });

    // Cursor animation
    function tick() {
      if (!audio.paused && duration > 0) {
        const pct = (audio.currentTime / duration) * 100;
        cursorLine.style.left = pct + '%';
        if (audio.currentTime >= rangeEnd) {
          audio.pause();
          playBtn.textContent = '▶ 播放';
        }
      }
      animationId = requestAnimationFrame(tick);
    }
    tick();

    // Range selection on waveform
    function updateLabels() {
      startLabel.textContent = '开始: ' + fmtDuration(rangeStart);
      endLabel.textContent = '结束: ' + fmtDuration(rangeEnd);
      if (duration > 0) {
        const sp = (rangeStart / duration) * 100;
        const ep = (rangeEnd / duration) * 100;
        rangeOverlay.style.left = sp + '%';
        rangeOverlay.style.width = (ep - sp) + '%';
      }
    }

    function getTimeFromX(x: number): number {
      const rect = canvas.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      return pct * duration;
    }

    waveBox.addEventListener('mousedown', (e) => {
      const t = getTimeFromX(e.clientX);
      const startDist = Math.abs(t - rangeStart);
      const endDist = Math.abs(t - rangeEnd);
      isDragging = startDist < endDist ? 'start' : 'end';
      updateRange(t);
    });

    waveBox.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      updateRange(getTimeFromX(e.clientX));
    });

    window.addEventListener('mouseup', () => { isDragging = null; });

    function updateRange(t: number) {
      if (isDragging === 'start') {
        rangeStart = Math.max(0, Math.min(t, rangeEnd - 0.5));
      } else if (isDragging === 'end') {
        rangeEnd = Math.min(duration, Math.max(t, rangeStart + 0.5));
      }
      updateLabels();
    }

    // Click on waveform to seek
    waveBox.addEventListener('click', (e) => {
      if (isDragging) return;
      const t = getTimeFromX(e.clientX);
      audio.currentTime = t;
      cursorLine.style.left = ((t / duration) * 100) + '%';
    });
  });
}

async function drawWaveform(canvas: HTMLCanvasElement, audioSrc: string, duration: number) {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width = canvas.offsetWidth * 2;
  const height = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;

  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, w, h);

  try {
    const res = await fetch(audioSrc);
    const buf = await res.arrayBuffer();
    const actx = new AudioContext();
    const decoded = await actx.decodeAudioData(buf);
    const ch = decoded.getChannelData(0);
    const step = Math.ceil(ch.length / w);

    ctx.fillStyle = '#7b5ea7';
    for (let x = 0; x < w; x++) {
      let max = 0;
      for (let s = 0; s < step; s++) {
        const v = Math.abs(ch[x * step + s] || 0);
        if (v > max) max = v;
      }
      const barH = max * h * 0.9;
      ctx.fillRect(x, (h - barH) / 2, 1, barH);
    }
    actx.close();
  } catch {
    // Fallback: draw placeholder bars
    ctx.fillStyle = '#3a3a5e';
    for (let x = 0; x < w; x += 3) {
      const barH = Math.random() * h * 0.6 + 4;
      ctx.fillRect(x, (h - barH) / 2, 2, barH);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VIDEO EDITOR MODAL  (thumbnail timeline + range selection + playback)
// ═══════════════════════════════════════════════════════════════════════════════

function openVideoEditor(item: AssetPickerItem, idx: number, existingTrim?: { start: number; end: number }): Promise<AudioEditResult | null> {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal-panel' });

    const header = el('div', { class: 'modal-header' });
    header.append(
      el('h2', {}, '🎬 视频剪辑'),
      el('span', { class: 'modal-filename' }, item.label),
    );

    // Video preview
    const previewBox = el('div', { class: 'video-preview-box' });
    const video = el('video', { class: 'video-preview', preload: 'metadata' }) as HTMLVideoElement;
    video.src = '/picker-image?path=' + encodeURIComponent(item.imagePath);
    previewBox.appendChild(video);

    // Thumbnail timeline
    const thumbBox = el('div', { class: 'thumbnail-timeline' });
    const thumbCanvas = el('canvas', { class: 'thumb-canvas' }) as HTMLCanvasElement;
    const rangeOverlay = el('div', { class: 'range-overlay' });
    const cursorLine = el('div', { class: 'cursor-line' });
    thumbBox.append(thumbCanvas, rangeOverlay, cursorLine);

    // Time labels
    const timeRow = el('div', { class: 'time-row' });
    const startLabel = el('span', { class: 'time-label' }, '开始: 0:00');
    const durLabel = el('span', { class: 'time-label total' }, '总时长: --:--');
    const endLabel = el('span', { class: 'time-label' }, '结束: --:--');
    timeRow.append(startLabel, durLabel, endLabel);

    // Range sliders
    const sliderRow = el('div', { class: 'slider-row' });
    const startSlider = el('input', { type: 'range', class: 'trim-range', min: '0', max: '100', step: '0.1', value: '0' }) as HTMLInputElement;
    const endSlider = el('input', { type: 'range', class: 'trim-range', min: '0', max: '100', step: '0.1', value: '100' }) as HTMLInputElement;
    sliderRow.append(el('span', { class: 'slider-label' }, '开始'), startSlider, el('span', { class: 'slider-label' }, '结束'), endSlider);

    // Playback controls
    const controls = el('div', { class: 'playback-controls' });
    const playBtn = el('button', { class: 'btn-play' }, '▶ 播放');
    const playRangeBtn = el('button', { class: 'btn-play-range' }, '▶ 播放选中区间');
    controls.append(playBtn, playRangeBtn);

    // Buttons
    const btnRow = el('div', { class: 'modal-buttons' });
    const btnCancel = el('button', { class: 'btn-cancel-modal' }, '取消');
    const btnConfirm = el('button', { class: 'btn-confirm-modal' }, '确认裁剪');
    btnRow.append(btnCancel, btnConfirm);

    modal.append(header, previewBox, thumbBox, timeRow, sliderRow, controls, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let duration = 0;
    let rangeStart = existingTrim?.start ?? 0;
    let rangeEnd = existingTrim?.end ?? 0;
    let isDragging: 'start' | 'end' | null = null;
    let animationId = 0;

    function close(result: AudioEditResult | null) {
      cancelAnimationFrame(animationId);
      video.pause();
      overlay.remove();
      resolve(result);
    }

    btnCancel.addEventListener('click', () => close(null));
    btnConfirm.addEventListener('click', () => close({ start: rangeStart, end: rangeEnd }));

    // Load video metadata
    video.addEventListener('loadedmetadata', async () => {
      duration = video.duration;
      if (rangeEnd === 0 || rangeEnd > duration) rangeEnd = duration;
      durLabel.textContent = '总时长: ' + fmtDuration(duration);
      updateLabels();
      await drawThumbnails(video, thumbCanvas, 12);
    });

    video.addEventListener('error', () => {
      durLabel.textContent = '无法加载视频';
    });

    // Playback
    playBtn.addEventListener('click', () => {
      if (video.paused) { video.play(); playBtn.textContent = '⏸ 暂停'; }
      else { video.pause(); playBtn.textContent = '▶ 播放'; }
    });
    video.addEventListener('ended', () => { playBtn.textContent = '▶ 播放'; });
    video.addEventListener('pause', () => { playBtn.textContent = '▶ 播放'; });

    playRangeBtn.addEventListener('click', () => {
      video.currentTime = rangeStart;
      video.play();
      playBtn.textContent = '⏸ 暂停';
    });

    // Cursor animation
    function tick() {
      if (!video.paused && duration > 0) {
        const pct = (video.currentTime / duration) * 100;
        cursorLine.style.left = pct + '%';
        if (video.currentTime >= rangeEnd) {
          video.pause();
          playBtn.textContent = '▶ 播放';
        }
      }
      animationId = requestAnimationFrame(tick);
    }
    tick();

    // Slider updates
    function updateLabels() {
      startLabel.textContent = '开始: ' + fmtDuration(rangeStart);
      endLabel.textContent = '结束: ' + fmtDuration(rangeEnd);
      if (duration > 0) {
        startSlider.value = String((rangeStart / duration) * 100);
        endSlider.value = String((rangeEnd / duration) * 100);
        const sp = (rangeStart / duration) * 100;
        const ep = (rangeEnd / duration) * 100;
        rangeOverlay.style.left = sp + '%';
        rangeOverlay.style.width = (ep - sp) + '%';
      }
    }

    startSlider.addEventListener('input', () => {
      rangeStart = Math.max(0, Math.min((parseFloat(startSlider.value) / 100) * duration, rangeEnd - 0.5));
      updateLabels();
    });
    endSlider.addEventListener('input', () => {
      rangeEnd = Math.min(duration, Math.max((parseFloat(endSlider.value) / 100) * duration, rangeStart + 0.5));
      updateLabels();
    });
    startSlider.addEventListener('click', e => e.stopPropagation());
    endSlider.addEventListener('click', e => e.stopPropagation());

    // Click on timeline to seek
    thumbBox.addEventListener('click', (e) => {
      if (isDragging) return;
      const rect = thumbBox.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = pct * duration;
      video.currentTime = t;
      cursorLine.style.left = (pct * 100) + '%';
    });

    // Drag on timeline
    thumbBox.addEventListener('mousedown', (e) => {
      const rect = thumbBox.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const t = pct * duration;
      const startDist = Math.abs(t - rangeStart);
      const endDist = Math.abs(t - rangeEnd);
      isDragging = startDist < endDist ? 'start' : 'end';
      updateRange(t);
    });
    thumbBox.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = thumbBox.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
      updateRange(t);
    });
    window.addEventListener('mouseup', () => { isDragging = null; });

    function updateRange(t: number) {
      if (isDragging === 'start') {
        rangeStart = Math.max(0, Math.min(t, rangeEnd - 0.5));
      } else if (isDragging === 'end') {
        rangeEnd = Math.min(duration, Math.max(t, rangeStart + 0.5));
      }
      updateLabels();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMAGE EDITOR MODAL  (crop + resize + removebg)
// ═══════════════════════════════════════════════════════════════════════════════

interface ImageEditResult {
  crop?: { left: number; top: number; right: number; bottom: number };
  resize?: { width: number; height: number };
  removebg?: boolean;
}

function openImageEditor(item: AssetPickerItem, idx: number): Promise<ImageEditResult | null> {
  return new Promise((resolve) => {
    const overlay = el('div', { class: 'modal-overlay' });
    const modal = el('div', { class: 'modal-panel image-editor-panel' });

    const header = el('div', { class: 'modal-header' });
    header.append(el('h2', {}, '🖼️ 图片编辑'), el('span', { class: 'modal-filename' }, item.label));

    // Image preview with crop overlay
    const previewBox = el('div', { class: 'image-preview-box' });
    const img = el('img', { class: 'image-preview', src: '/picker-image?path=' + encodeURIComponent(item.imagePath) }) as HTMLImageElement;
    const cropBox = el('div', { class: 'crop-box' });
    const cropOverlay = el('div', { class: 'crop-overlay' });
    previewBox.append(img, cropOverlay, cropBox);

    // Size info
    const sizeRow = el('div', { class: 'size-row' });
    const sizeLabel = el('span', { class: 'size-label' }, '尺寸: 加载中...');
    sizeRow.append(sizeLabel);

    // Tools
    const tools = el('div', { class: 'image-tools' });

    // Crop controls
    const cropSection = el('div', { class: 'tool-section' });
    cropSection.append(el('h4', {}, '✂️ 裁剪'));
    const cropInputs = el('div', { class: 'crop-inputs' });
    const inLeft = el('input', { type: 'number', placeholder: '左', class: 'num-input' }) as HTMLInputElement;
    const inTop = el('input', { type: 'number', placeholder: '上', class: 'num-input' }) as HTMLInputElement;
    const inRight = el('input', { type: 'number', placeholder: '右', class: 'num-input' }) as HTMLInputElement;
    const inBottom = el('input', { type: 'number', placeholder: '下', class: 'num-input' }) as HTMLInputElement;
    cropInputs.append(inLeft, inTop, inRight, inBottom);
    const btnApplyCrop = el('button', { class: 'btn-tool' }, '应用裁剪');
    cropSection.append(cropInputs, btnApplyCrop);

    // Resize controls
    const resizeSection = el('div', { class: 'tool-section' });
    resizeSection.append(el('h4', {}, '📐 调整大小'));
    const resizeInputs = el('div', { class: 'resize-inputs' });
    const inW = el('input', { type: 'number', placeholder: '宽度', class: 'num-input' }) as HTMLInputElement;
    const inH = el('input', { type: 'number', placeholder: '高度', class: 'num-input' }) as HTMLInputElement;
    const keepRatio = el('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
    resizeInputs.append(inW, el('span', {}, '×'), inH, el('label', {}, '保持比例'), keepRatio);
    const btnApplyResize = el('button', { class: 'btn-tool' }, '应用调整');
    resizeSection.append(resizeInputs, btnApplyResize);

    // Remove background
    const bgSection = el('div', { class: 'tool-section' });
    bgSection.append(el('h4', {}, '🪄 抠图（移除背景）'));
    const btnRemoveBg = el('button', { class: 'btn-tool btn-magic' }, '🪄 一键抠图');
    const bgStatus = el('div', { class: 'bg-status' }, '');
    bgSection.append(btnRemoveBg, bgStatus);

    tools.append(cropSection, resizeSection, bgSection);

    // Buttons
    const btnRow = el('div', { class: 'modal-buttons' });
    const btnCancel = el('button', { class: 'btn-cancel-modal' }, '取消');
    const btnConfirm = el('button', { class: 'btn-confirm-modal' }, '确认');
    btnRow.append(btnCancel, btnConfirm);

    modal.append(header, previewBox, sizeRow, tools, btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    let naturalW = 0, naturalH = 0;
    let crop = { left: 0, top: 0, right: 1, bottom: 1 };
    let resize: { width: number; height: number } | null = null;
    let removebg = false;

    function close(result: ImageEditResult | null) {
      overlay.remove();
      resolve(result);
    }

    btnCancel.addEventListener('click', () => close(null));
    btnConfirm.addEventListener('click', () => {
      const result: ImageEditResult = {};
      if (crop.left !== 0 || crop.top !== 0 || crop.right !== 1 || crop.bottom !== 1) {
        result.crop = crop;
      }
      if (resize) result.resize = resize;
      if (removebg) result.removebg = true;
      close(Object.keys(result).length ? result : null);
    });

    // Load image
    img.addEventListener('load', () => {
      naturalW = img.naturalWidth;
      naturalH = img.naturalHeight;
      sizeLabel.textContent = `尺寸: ${naturalW} × ${naturalH}`;
      inW.value = String(naturalW);
      inH.value = String(naturalH);
      inRight.value = String(naturalW);
      inBottom.value = String(naturalH);
    });

    // Crop box dragging
    let dragStart = { x: 0, y: 0, l: 0, t: 0, r: 0, b: 0 };
    cropBox.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      dragStart = { x: e.clientX, y: e.clientY, l: crop.left, t: crop.top, r: crop.right, b: crop.bottom };
      const onMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - dragStart.x) / img.offsetWidth;
        const dy = (ev.clientY - dragStart.y) / img.offsetHeight;
        const w = dragStart.r - dragStart.l;
        const h = dragStart.b - dragStart.t;
        crop.left = Math.max(0, Math.min(dragStart.l + dx, 1 - w));
        crop.top = Math.max(0, Math.min(dragStart.t + dy, 1 - h));
        crop.right = crop.left + w;
        crop.bottom = crop.top + h;
        updateCropBox();
      };
      const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });

    // Click on overlay to set crop
    cropOverlay.addEventListener('mousedown', (e) => {
      const rect = previewBox.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      crop = { left: x, top: y, right: x + 0.3, bottom: y + 0.3 };
      updateCropBox();
    });

    function updateCropBox() {
      cropBox.style.left = (crop.left * 100) + '%';
      cropBox.style.top = (crop.top * 100) + '%';
      cropBox.style.width = ((crop.right - crop.left) * 100) + '%';
      cropBox.style.height = ((crop.bottom - crop.top) * 100) + '%';
    }

    // Apply crop inputs
    btnApplyCrop.addEventListener('click', () => {
      const l = parseFloat(inLeft.value) / naturalW;
      const t = parseFloat(inTop.value) / naturalH;
      const r = parseFloat(inRight.value) / naturalW;
      const b = parseFloat(inBottom.value) / naturalH;
      crop = { left: Math.max(0, l), top: Math.max(0, t), right: Math.min(1, r), bottom: Math.min(1, b) };
      updateCropBox();
    });

    // Resize with aspect ratio
    let aspect = 1;
    img.addEventListener('load', () => { aspect = img.naturalWidth / img.naturalHeight; });
    inW.addEventListener('input', () => {
      if (keepRatio.checked) inH.value = String(Math.round(parseFloat(inW.value) / aspect));
    });
    inH.addEventListener('input', () => {
      if (keepRatio.checked) inW.value = String(Math.round(parseFloat(inH.value) * aspect));
    });
    btnApplyResize.addEventListener('click', () => {
      resize = { width: parseInt(inW.value), height: parseInt(inH.value) };
      btnApplyResize.textContent = '✓ 已设置';
    });

    // Remove background
    btnRemoveBg.addEventListener('click', async () => {
      btnRemoveBg.disabled = true;
      bgStatus.textContent = '处理中...';
      try {
        const res = await fetch('/api/image-edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: item.imagePath, action: 'removebg' }),
        });
        const data = await res.json();
        if (data.success) {
          removebg = true;
          bgStatus.textContent = '✅ 抠图完成';
          // Show preview with alpha
          img.src = '/picker-image?path=' + encodeURIComponent(data.path) + '&t=' + Date.now();
        } else {
          bgStatus.textContent = '❌ ' + (data.error || '失败');
        }
      } catch {
        bgStatus.textContent = '❌ 请求失败';
      } finally {
        btnRemoveBg.disabled = false;
      }
    });
  });
}

async function drawThumbnails(video: HTMLVideoElement, canvas: HTMLCanvasElement, count: number) {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width = canvas.offsetWidth * 2;
  const height = canvas.height = canvas.offsetHeight * 2;
  ctx.scale(2, 2);
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  const thumbW = w / count;

  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, w, h);

  const duration = video.duration;
  for (let i = 0; i < count; i++) {
    try {
      video.currentTime = (duration / count) * i + 0.1;
      await new Promise<void>(r => video.addEventListener('seeked', () => r(), { once: true }));
      ctx.drawImage(video, i * thumbW, 0, thumbW, h);
      // Draw separator
      ctx.strokeStyle = '#2a2a4e';
      ctx.strokeRect(i * thumbW, 0, thumbW, h);
    } catch {
      ctx.fillStyle = '#3a3a5e';
      ctx.fillRect(i * thumbW, 0, thumbW, h);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CARD RENDERING
// ═══════════════════════════════════════════════════════════════════════════════

function addCard(item: AssetPickerItem, idx: number, displayIdx: number): void {
  const isHistory = item.metadata?.['_src'] === 'history';
  const mediaType = getMediaType(item.imagePath);

  const card = el('div', {
    class: 'card' + (isHistory ? ' history' : '') + ' type-' + mediaType,
    'data-idx': String(idx),
  });

  // For media files, clicking opens editor; images toggle after edit
  if (mediaType === 'audio') {
    card.addEventListener('click', async () => {
      const existing = trimRanges.get(idx);
      const result = await openAudioEditor(item, idx, existing);
      if (result) {
        trimRanges.set(idx, result);
        selected.add(idx);
        render();
      }
    });
  } else if (mediaType === 'video') {
    card.addEventListener('click', async () => {
      const existing = trimRanges.get(idx);
      const result = await openVideoEditor(item, idx, existing);
      if (result) {
        trimRanges.set(idx, result);
        selected.add(idx);
        render();
      }
    });
  } else if (mediaType === 'image') {
    card.addEventListener('click', async () => {
      const result = await openImageEditor(item, idx);
      if (result) {
        selected.add(idx);
        render();
      }
    });
  } else {
    card.addEventListener('click', () => toggle(idx));
  }

  card.append(el('div', { class: 'badge' }, String(displayIdx + 1)));

  // Media preview
  if (mediaType === 'image') {
    const img = el('img', { class: 'card-img', src: '/picker-image?path=' + encodeURIComponent(item.imagePath), alt: item.label });
    img.addEventListener('error', () => { img.style.opacity = '0.2'; });
    card.append(img);
  } else if (mediaType === 'audio') {
    const wrapper = el('div', { class: 'card-media-wrapper audio-wrapper' });
    const icon = el('div', { class: 'card-media-icon' }, '♪');
    const hint = el('div', { class: 'card-edit-hint' }, '点击打开剪辑器');
    const dur = el('div', { class: 'card-duration' }, '加载中...');

    const audio = new Audio('/picker-image?path=' + encodeURIComponent(item.imagePath));
    audio.addEventListener('loadedmetadata', () => {
      dur.textContent = fmtDuration(audio.duration);
    });

    // Show trim indicator if set
    const trim = trimRanges.get(idx);
    const trimBadge = el('div', { class: 'trim-badge' }, trim ? `⏱ ${fmtDuration(trim.start)}-${fmtDuration(trim.end)}` : '');

    wrapper.append(icon, hint, dur, trimBadge);
    card.append(wrapper);
  } else if (mediaType === 'video') {
    const wrapper = el('div', { class: 'card-media-wrapper video-wrapper' });
    const video = el('video', { class: 'card-video', preload: 'metadata' }) as HTMLVideoElement;
    video.src = '/picker-image?path=' + encodeURIComponent(item.imagePath);
    video.addEventListener('click', e => { e.stopPropagation(); video.paused ? video.play() : video.pause(); });

    const dur = el('div', { class: 'card-duration' }, '加载中...');
    video.addEventListener('loadedmetadata', () => { dur.textContent = fmtDuration(video.duration); });
    video.addEventListener('error', () => { dur.textContent = '无法加载'; });

    const playBtn = el('div', { class: 'card-play-btn' }, '▶');
    playBtn.addEventListener('click', e => {
      e.stopPropagation();
      video.paused ? (video.play(), playBtn.textContent = '⏸') : (video.pause(), playBtn.textContent = '▶');
    });
    video.addEventListener('play', () => playBtn.textContent = '⏸');
    video.addEventListener('pause', () => playBtn.textContent = '▶');
    video.addEventListener('ended', () => playBtn.textContent = '▶');

    const hint = el('div', { class: 'card-edit-hint' }, '点击打开剪辑器');

    // Show trim indicator if set
    const trim = trimRanges.get(idx);
    const trimBadge = el('div', { class: 'trim-badge' }, trim ? `⏱ ${fmtDuration(trim.start)}-${fmtDuration(trim.end)}` : '');

    wrapper.append(video, playBtn, dur, hint, trimBadge);
    card.append(wrapper);
  } else {
    const wrapper = el('div', { class: 'card-media-wrapper unknown-wrapper' });
    wrapper.append(el('div', { class: 'card-media-icon' }, '📄'), el('div', { class: 'card-file-label' }, item.label));
    card.append(wrapper);
  }

  if (mediaType !== 'unknown') card.append(el('div', { class: 'label' }, item.label));

  // Path row
  const pathRow = el('div', { class: 'card-path-row' });
  pathRow.append(
    el('span', { class: 'card-path', title: item.imagePath }, item.imagePath),
    el('button', { class: 'card-open-btn', title: '在资源管理器中打开' }, '📂'),
  );
  (pathRow.querySelector('.card-open-btn') as HTMLButtonElement).addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch('/api/open-path', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: item.imagePath }) });
      const data = await res.json();
      if (!data.opened) alert('打开失败: ' + (data.error || '未知错误'));
    } catch { alert('打开目录请求失败'); }
  });
  card.append(pathRow);

  // Metadata info
  if (item.metadata && Object.keys(item.metadata).length > 0) {
    const infoBtn = el('button', { class: 'card-info-btn' }, 'ℹ️ 详情');
    const infoPanel = el('div', { class: 'card-info-panel' });
    infoPanel.style.display = 'none';
    for (const [k, v] of Object.entries(item.metadata)) {
      if (k === '_src') continue;
      const row = el('div', { class: 'info-row' });
      row.append(el('span', { class: 'info-key' }, k), el('span', { class: 'info-val' }, v));
      infoPanel.append(row);
    }
    infoBtn.addEventListener('click', (e) => { e.stopPropagation(); infoPanel.style.display = infoPanel.style.display === 'none' ? 'block' : 'none'; });
    card.append(infoBtn, infoPanel);
  }

  if (isHistory) card.append(el('div', { class: 'hist-badge' }, '历史'));
  card.append(el('div', { class: 'check' }, '✓'));
  grid.appendChild(card);
}

// ── Selection ─────────────────────────────────────────────────────────────────

function toggle(idx: number): void {
  if (!MULTI) selected.clear();
  selected.has(idx) ? selected.delete(idx) : selected.add(idx);
  render();
}

function render(): void {
  grid.querySelectorAll<HTMLElement>('.card').forEach(card => {
    const idx = Number(card.dataset['idx']);
    card.classList.toggle('selected', selected.has(idx));
  });
  const n = selected.size;
  count.textContent = `${n} selected` + (uploaded.length ? ` · ${uploaded.length} uploaded` : '');
  btnOk.disabled = n === 0;
}

// ── Upload ────────────────────────────────────────────────────────────────────

const MEDIA_EXTS = /\.(png|jpe?g|webp|gif|bmp|svg|mp3|wav|ogg|aac|flac|m4a|opus|wma|mp4|webm|mov|avi|mkv|flv|wmv|m4v|ogv)$/i;

function readB64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res((reader.result as string).split(',')[1]!);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

async function handleFiles(fileList: FileList): Promise<void> {
  const files = [...fileList].filter(f =>
    f.type.startsWith('image/') || f.type.startsWith('audio/') || f.type.startsWith('video/') || MEDIA_EXTS.test(f.name),
  );
  if (!files.length) { setStatus('⚠ No media files detected'); return; }
  setStatus(`Uploading ${files.length} file(s)...`);
  let ok = 0, fail = 0;
  for (const f of files) {
    try {
      const b64 = await readB64(f);
      const res = await fetch(`/api/picker-upload/${SESSION}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name, data: b64, mime: f.type || 'application/octet-stream', size: f.size }),
      });
      if (res.ok) {
        const { item } = await res.json() as { item: AssetPickerItem };
        const idx = nextIdx++;
        ITEMS.push(item);
        filteredItems = [...ITEMS];
        renderGrid();
        uploaded.push({ name: item.label, path: item.imagePath });
        ok++;
      } else { console.error('Upload failed:', res.status, await res.text()); fail++; }
    } catch (e) { console.error('Upload error:', e); fail++; }
  }
  setStatus(fail ? `⚠ ${fail} failed, ${ok} uploaded` : `✓ ${ok} uploaded — click to select`);
  render();
}

function setStatus(msg: string): void { status.textContent = msg; }

// ── Confirm / Cancel ──────────────────────────────────────────────────────────

async function confirm_(): Promise<void> {
  btnOk.disabled = true;
  const selections = [...selected].map(idx => {
    const item = ITEMS[idx];
    const trim = trimRanges.get(idx);
    const base: Record<string, unknown> = { label: item.label, index: idx, imagePath: item.imagePath };
    if (trim && (trim.start > 0 || trim.end > 0)) { base.trimStart = trim.start; base.trimEnd = trim.end; }
    return base;
  });
  await fetch(`/api/pick/${SESSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indices: [...selected], uploaded, cancelled: false, selections }),
  });
  document.body.innerHTML = '<div style="text-align:center;padding:80px;color:#c8a2e8;font-size:1.2rem">✓ Confirmed — you can close this tab</div>';
}

async function cancel_(): Promise<void> {
  await fetch(`/api/pick/${SESSION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ indices: [], uploaded: [], cancelled: true }),
  });
  document.body.innerHTML = '<div style="text-align:center;padding:80px;color:#666;font-size:1.2rem">Cancelled</div>';
}
