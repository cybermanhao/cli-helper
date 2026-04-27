/**
 * Asset Picker — Browser-based image selection with optional upload
 *
 * Shared state between MCP tool (index.ts) and HTTP handlers (server.ts).
 */

import type { AssetPickerItem } from '../picker/types.js';

export interface PickerContext {
  items: AssetPickerItem[];
  multiSelect: boolean;
  uploadDir?: string;
  choiceId: string;
}

export const pickerContexts = new Map<string, PickerContext>();

export function buildPickerHtml(
  sessionId: string,
  title: string,
  message: string,
  items: AssetPickerItem[],
  multiSelect: boolean,
  allowUpload: boolean,
): string {
  function esc(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const config = JSON.stringify({ sessionId, multiSelect, allowUpload, items });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f1a;color:#e0e0e0;padding:24px;min-height:100vh}
  h1{font-size:1.4rem;color:#c8a2e8;margin-bottom:6px}
  .msg{color:#888;margin-bottom:8px;font-size:.9rem}
  .hint{color:#555;font-size:.8rem;margin-bottom:18px}
  .grid{display:flex;flex-wrap:wrap;gap:16px;justify-content:flex-start;margin-bottom:24px}
  .card{background:#16213e;border:2px solid #2a2a4e;border-radius:10px;padding:12px;width:200px;
        text-align:center;cursor:pointer;position:relative;transition:border-color .15s,transform .1s,box-shadow .15s;user-select:none}
  .card:hover{border-color:#7b5ea7;transform:translateY(-2px);box-shadow:0 4px 20px rgba(123,94,167,.3)}
  .card.selected{border-color:#c8a2e8;box-shadow:0 0 0 3px rgba(200,162,232,.25)}
  .card.history{border-style:dashed;opacity:.85}
  .badge{position:absolute;top:8px;left:8px;background:#7b5ea7;color:#fff;border-radius:50%;
         width:22px;height:22px;line-height:22px;font-size:.75rem;font-weight:700;text-align:center}
  .hist-badge{position:absolute;bottom:8px;left:8px;background:#3a2a4e;color:#9070c0;
              border-radius:4px;padding:1px 5px;font-size:.65rem;font-weight:600}
  .check{position:absolute;top:8px;right:8px;background:#c8a2e8;color:#0f0f1a;border-radius:50%;
         width:22px;height:22px;line-height:22px;font-size:.85rem;font-weight:700;display:none;text-align:center}
  .card.selected .check{display:block}
  .card-img{max-width:100%;max-height:160px;border-radius:6px;object-fit:contain;display:block;margin:28px auto 10px}
  .card-media-wrapper{position:relative;margin:28px auto 10px;display:flex;flex-direction:column;align-items:center;gap:6px}
  .audio-wrapper{padding:8px}
  .card-audio{width:100%;max-width:180px;height:32px;border-radius:4px}
  .video-wrapper{position:relative;width:100%;display:flex;justify-content:center}
  .card-video{max-width:100%;max-height:140px;border-radius:6px;object-fit:contain;cursor:pointer}
  .card-play-btn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:40px;height:40px;border-radius:50%;background:rgba(123,94,167,.85);color:#fff;font-size:1.2rem;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:none;transition:opacity .2s}
  .card-video:hover ~ .card-play-btn,.card-play-btn:hover{opacity:.9}
  .card-media-icon{font-size:3rem;color:#7b5ea7;margin:20px 0}
  .search-bar{margin-bottom:12px}
  #search-box{width:100%;padding:10px 14px;border-radius:8px;border:1px solid #2a2a4e;background:#0f0f1a;color:#d4c4f0;font-size:.9rem;outline:none;transition:border-color .2s}
  #search-box:focus{border-color:#7b5ea7}
  #search-box::placeholder{color:#555}
  .select-bar{display:flex;gap:8px;margin-bottom:12px}
  .btn-bar{padding:6px 14px;border-radius:6px;border:1px solid #2a2a4e;background:#16213e;color:#888;font-size:.8rem;cursor:pointer;transition:all .15s}
  .btn-bar:hover{border-color:#7b5ea7;color:#c8a2e8}
  .card-duration{font-size:.7rem;color:#888;margin-top:2px}
  .card-path-row{display:flex;align-items:center;gap:4px;margin:4px 0;padding:0 4px;opacity:0;transition:opacity .2s}
  .card:hover .card-path-row{opacity:1}
  .card-path{font-size:.65rem;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;direction:rtl;text-align:left}
  .card-open-btn{background:#2a2a4e;border:none;border-radius:4px;color:#9070c0;font-size:.75rem;padding:2px 6px;cursor:pointer;transition:background .15s;flex-shrink:0}
  .card-open-btn:hover{background:#3a3a5e;color:#c8a2e8}
  .card-trim-container{margin:6px 0;padding:0 4px}
  .trim-controls{display:flex;flex-direction:column;gap:4px}
  .trim-range{width:100%;height:6px;-webkit-appearance:none;background:#2a2a4e;border-radius:3px;outline:none;cursor:pointer}
  .trim-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#7b5ea7;cursor:pointer}
  .trim-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#7b5ea7;cursor:pointer;border:none}
  .trim-label{font-size:.65rem;color:#888}
  .trim-preview-btn{align-self:flex-start;padding:4px 10px;border-radius:4px;border:1px solid #3a3a5e;background:#16213e;color:#7b5ea7;font-size:.7rem;cursor:pointer;transition:all .15s;margin-top:2px}
  .trim-preview-btn:hover{border-color:#7b5ea7;color:#c8a2e8}
  .card-info-btn{align-self:flex-start;padding:4px 10px;border-radius:4px;border:1px solid #3a3a5e;background:#16213e;color:#7b5ea7;font-size:.7rem;cursor:pointer;transition:all .15s;margin:4px 0}
  .card-info-btn:hover{border-color:#7b5ea7;color:#c8a2e8}
  .card-info-panel{padding:8px;background:#0f0f1a;border-radius:6px;margin-bottom:6px;font-size:.7rem}
  .info-row{display:flex;gap:8px;padding:2px 0}
  .info-key{color:#5555aa;min-width:60px}
  .info-val{color:#aaa}
  .unknown-wrapper{padding:12px;text-align:center}
  /* Audio edit hint */
  .card-edit-hint{font-size:.7rem;color:#7b5ea7;margin-top:2px}
  .trim-badge{font-size:.65rem;color:#c8a2e8;background:#3a2a4e;border-radius:4px;padding:2px 6px;margin-top:4px;display:inline-block}
  /* Modal */
  .modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(4px)}
  .modal-panel{background:#16213e;border:2px solid #2a2a4e;border-radius:16px;padding:24px;width:90%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.5)}
  .modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;border-bottom:1px solid #2a2a4e;padding-bottom:12px}
  .modal-header h2{font-size:1.1rem;color:#c8a2e8;margin:0}
  .modal-filename{font-size:.8rem;color:#888}
  /* Waveform / Thumbnail timeline */
  .waveform-box{position:relative;width:100%;height:120px;background:#0f0f1a;border-radius:8px;overflow:hidden;margin-bottom:12px;cursor:crosshair}
  .waveform-canvas{width:100%;height:100%;display:block}
  .thumbnail-timeline{position:relative;width:100%;height:80px;background:#0f0f1a;border-radius:8px;overflow:hidden;margin-bottom:12px;cursor:crosshair}
  .thumb-canvas{width:100%;height:100%;display:block}
  .cursor-line{position:absolute;top:0;width:2px;height:100%;background:#c8a2e8;pointer-events:none;left:0}
  .range-overlay{position:absolute;top:0;height:100%;background:rgba(123,94,167,.25);pointer-events:none;left:0;width:100%}
  .time-row{display:flex;justify-content:space-between;margin-bottom:12px;font-size:.75rem;color:#888}
  .time-label.total{color:#c8a2e8}
  .slider-row{display:flex;align-items:center;gap:8px;margin-bottom:12px}
  .slider-row .trim-range{flex:1}
  .slider-label{font-size:.7rem;color:#888;white-space:nowrap}
  /* Video preview */
  .video-preview-box{width:100%;background:#0f0f1a;border-radius:8px;overflow:hidden;margin-bottom:12px;display:flex;justify-content:center}
  .video-preview{max-width:100%;max-height:300px;border-radius:8px}
  /* Image editor */
  .image-editor-panel{max-width:900px}
  .image-preview-box{position:relative;width:100%;min-height:300px;max-height:400px;background:#0f0f1a;border-radius:8px;overflow:hidden;margin-bottom:12px;display:flex;justify-content:center;align-items:center}
  .image-preview{max-width:100%;max-height:400px;object-fit:contain}
  .crop-overlay{position:absolute;top:0;left:0;width:100%;height:100%;cursor:crosshair}
  .crop-box{position:absolute;border:2px dashed #c8a2e8;background:rgba(200,162,232,.15);cursor:move;min-width:30px;min-height:30px}
  .size-row{text-align:center;font-size:.8rem;color:#888;margin-bottom:8px}
  .image-tools{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px}
  .tool-section{flex:1;min-width:200px;background:#0f0f1a;border-radius:8px;padding:12px}
  .tool-section h4{font-size:.85rem;color:#c8a2e8;margin:0 0 8px}
  .crop-inputs,.resize-inputs{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
  .num-input{width:60px;padding:6px;border-radius:4px;border:1px solid #2a2a4e;background:#16213e;color:#d4c4f0;font-size:.8rem}
  .btn-tool{padding:6px 12px;border-radius:6px;border:1px solid #3a3a5e;background:#16213e;color:#d4c4f0;font-size:.8rem;cursor:pointer;transition:all .15s}
  .btn-tool:hover{border-color:#7b5ea7}
  .btn-magic{border-color:#7b5ea7;color:#c8a2e8}
  .btn-magic:hover{background:#3a2a4e}
  .bg-status{font-size:.75rem;color:#888;margin-top:6px}
  /* Playback controls */
  .playback-controls{display:flex;gap:10px;margin-bottom:16px}
  .btn-play,.btn-play-range{padding:8px 16px;border-radius:8px;border:1px solid #3a3a5e;background:#16213e;color:#d4c4f0;font-size:.85rem;cursor:pointer;transition:all .15s}
  .btn-play:hover,.btn-play-range:hover{border-color:#7b5ea7}
  /* Modal buttons */
  .modal-buttons{display:flex;gap:10px;justify-content:flex-end}
  .btn-cancel-modal{padding:8px 20px;border-radius:8px;border:1px solid #2a2a4e;background:#16213e;color:#888;font-size:.85rem;cursor:pointer;transition:all .15s}
  .btn-cancel-modal:hover{border-color:#7b5ea7;color:#d4c4f0}
  .btn-confirm-modal{padding:8px 20px;border-radius:8px;border:none;background:#7b5ea7;color:#fff;font-size:.85rem;cursor:pointer;transition:opacity .15s}
  .btn-confirm-modal:hover{opacity:.85}
  .card-file-label{font-size:.8rem;color:#d4c4f0;word-break:break-all;margin-top:4px}
  .label{font-size:.85rem;color:#d4c4f0;font-weight:600;margin-bottom:6px;word-break:break-all}
  .meta{font-size:.72rem;color:#666;text-align:left;margin-top:4px}
  .meta-row{display:flex;gap:6px;padding:1px 0}
  .mk{color:#5555aa;min-width:50px}
  #upload-zone{border:2px dashed #3a2a5e;border-radius:10px;padding:16px 24px;
               display:flex;align-items:center;gap:12px;cursor:pointer;margin-bottom:20px;
               transition:border-color .2s,background .2s}
  #upload-zone:hover,#upload-zone.over{border-color:#c8a2e8;background:#16213e}
  .uz-icon{font-size:1.4rem;color:#7b5ea7}
  .uz-text{color:#7b5ea7;font-size:.9rem}
  #upload-status{font-size:.8rem;color:#7b5ea7;min-height:1.2em;margin-bottom:12px}
  input[type=file]{display:none}
  .toolbar{display:flex;gap:12px;align-items:center;border-top:1px solid #2a2a4e;padding-top:16px}
  .count{flex:1;color:#888;font-size:.85rem}
  button{padding:10px 28px;border-radius:8px;border:none;font-size:.95rem;font-weight:600;cursor:pointer;transition:opacity .15s}
  .btn-confirm{background:#7b5ea7;color:#fff}
  .btn-confirm:hover{opacity:.85}
  .btn-confirm:disabled{background:#3a3a5e;color:#666;cursor:not-allowed}
  .btn-cancel{background:#2a2a4e;color:#888}
  .btn-cancel:hover{opacity:.85}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="msg">${esc(message)}</p>
<p class="hint">${multiSelect ? '点击多选 · 拖拽裁剪区间 · then click Confirm' : '点击选择 · then click Confirm'}</p>

<div class="search-bar">
  <input type="text" id="search-box" placeholder="🔍 搜索文件名..." autocomplete="off">
</div>

<div id="upload-zone" style="display:none">
  <span class="uz-icon">＋</span>
  <span class="uz-text">上传媒体文件（图片/音频/视频，拖拽或点击）</span>
</div>
<input type="file" id="fi" accept="image/*,audio/*,video/*" multiple>
<div id="upload-status"></div>

<div class="select-bar">
  <button class="btn-bar" id="btn-select-all">全选</button>
  <button class="btn-bar" id="btn-select-invert">反选</button>
</div>

<div class="grid" id="grid"></div>
<div class="toolbar">
  <div class="count" id="count">0 selected</div>
  <button class="btn-cancel" id="btn-cancel">Cancel</button>
  <button class="btn-confirm" id="btn-confirm" disabled>Confirm</button>
</div>

<script>window.__PICKER_CONFIG__ = ${config};</script>
<script src="/picker.js"></script>
</body>
</html>`;
}
