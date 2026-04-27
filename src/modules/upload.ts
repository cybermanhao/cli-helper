/**
 * File Upload — Browser-based drag-and-drop upload
 *
 * Shared state between MCP tool (index.ts) and HTTP handlers (server.ts).
 */

export interface UploadContext {
  saveDir: string;
  choiceId: string;
}

export const uploadContexts = new Map<string, UploadContext>();

export function buildUploadHtml(sessionId: string, title: string, message: string): string {
  function esc(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f0f1a;color:#e0e0e0;padding:32px;min-height:100vh}
  h1{font-size:1.4rem;color:#c8a2e8;margin-bottom:6px}
  .msg{color:#888;margin-bottom:24px;font-size:.9rem}
  #drop{border:2px dashed #3a2a5e;border-radius:12px;padding:48px 24px;text-align:center;
        cursor:pointer;transition:border-color .2s,background .2s;margin-bottom:24px}
  #drop:hover,#drop.over{border-color:#c8a2e8;background:#16213e}
  #drop .icon{font-size:3rem;margin-bottom:12px;opacity:.6}
  #drop .hint{color:#7b5ea7;font-size:1rem;margin-bottom:6px}
  #drop .sub{color:#555;font-size:.8rem}
  #previews{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:24px}
  .prev{position:relative;width:140px;background:#16213e;border-radius:8px;padding:8px;border:1px solid #2a2a4e}
  .prev img{width:100%;height:100px;object-fit:contain;border-radius:4px;display:block;margin-bottom:6px}
  .prev .name{font-size:.72rem;color:#aaa;word-break:break-all}
  .prev .size{font-size:.68rem;color:#555}
  .prev .rm{position:absolute;top:4px;right:4px;background:#3a0a0a;color:#ff6b6b;border:none;
            border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:.8rem;line-height:20px;text-align:center}
  .toolbar{display:flex;gap:12px;align-items:center}
  .count{flex:1;color:#888;font-size:.85rem}
  button{padding:10px 28px;border-radius:8px;border:none;font-size:.95rem;font-weight:600;cursor:pointer;transition:opacity .15s}
  .btn-confirm{background:#7b5ea7;color:#fff}
  .btn-confirm:hover{opacity:.85}
  .btn-confirm:disabled{background:#3a3a5e;color:#666;cursor:not-allowed}
  .btn-cancel{background:#2a2a4e;color:#888}
  .btn-cancel:hover{opacity:.85}
  #status{margin-top:16px;font-size:.85rem;color:#7b5ea7;min-height:1.2em}
  input[type=file]{display:none}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<p class="msg">${esc(message)}</p>
<div id="drop" onclick="document.getElementById('fi').click()">
  <div class="icon">📁</div>
  <div class="hint">拖拽图片到这里，或点击浏览</div>
  <div class="sub">支持 PNG / JPG / JPEG / WEBP · 可多选</div>
</div>
<input type="file" id="fi" accept="image/*" multiple onchange="addFiles(this.files)">
<div id="previews"></div>
<div class="toolbar">
  <div class="count" id="count">0 files</div>
  <button class="btn-cancel" onclick="cancel()">Cancel</button>
  <button class="btn-confirm" id="btn-ok" disabled onclick="upload()">Upload & Confirm</button>
</div>
<div id="status"></div>
<script>
const SESSION='${sessionId}';
const files=[];

const drop=document.getElementById('drop');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('over')});
drop.addEventListener('dragleave',()=>drop.classList.remove('over'));
drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('over');addFiles(e.dataTransfer.files)});

function addFiles(fl){
  [...fl].forEach(f=>{
    if(!f.type.startsWith('image/'))return;
    files.push(f);
    const idx=files.length-1;
    const url=URL.createObjectURL(f);
    const d=document.createElement('div');d.className='prev';d.id='p'+idx;
    d.innerHTML=\`<button class="rm" onclick="removeFile(\${idx})">×</button>
      <img src="\${url}"><div class="name">\${f.name}</div>
      <div class="size">\${(f.size/1024).toFixed(1)} KB</div>\`;
    document.getElementById('previews').appendChild(d);
  });
  render();
}

function removeFile(i){
  files[i]=null;
  const el=document.getElementById('p'+i);
  if(el)el.remove();
  render();
}

function render(){
  const n=files.filter(Boolean).length;
  document.getElementById('count').textContent=n+' file'+(n!==1?'s':'');
  document.getElementById('btn-ok').disabled=n===0;
}

async function readBase64(f){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(',')[1]);
    r.onerror=rej;
    r.readAsDataURL(f);
  });
}

async function upload(){
  const valid=files.filter(Boolean);
  if(!valid.length)return;
  document.getElementById('btn-ok').disabled=true;
  document.getElementById('status').textContent='Uploading...';
  const payload=await Promise.all(valid.map(async f=>({
    name:f.name,data:await readBase64(f),mime:f.type,size:f.size
  })));
  const r=await fetch('/api/upload/'+SESSION,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({files:payload,cancelled:false})});
  if(r.ok){
    document.body.innerHTML='<div style="text-align:center;padding:80px;color:#c8a2e8;font-size:1.2rem">✓ Uploaded — you can close this tab</div>';
  } else {
    document.getElementById('status').textContent='Upload failed, try again';
    document.getElementById('btn-ok').disabled=false;
  }
}

async function cancel(){
  await fetch('/api/upload/'+SESSION,{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[],cancelled:true})});
  document.body.innerHTML='<div style="text-align:center;padding:80px;color:#666;font-size:1.2rem">Cancelled</div>';
}
</script>
</body>
</html>`;
}
