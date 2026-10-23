/* ایرانمنش فایل — همه پردازش‌ها در مرورگر؛ هیچ درخواست شبکه‌ای به بیرون ندارد. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const fa = (x) => String(x).replace(/[0-9]/g, (d) => FA_DIGITS[d]).replace(/\./g, "٫");
const toLatin = (s) => String(s).replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d)).replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
const kbLabel = (kb) => (kb >= 1000 ? fa(+(kb / 1000).toFixed(1)) + " مگابایت" : fa(kb) + " کیلوبایت");
const fmtSize = (b) => {
  if (b < 1024) return fa(b) + " بایت";
  if (b < 1024 * 1024) return fa(Math.round(b / 1024)) + " کیلوبایت";
  return fa((b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 1)) + " مگابایت";
};
const KB = 1000; // هدف حجم با ۱۰۰۰ بایت حساب می‌شود (سخت‌گیرانه‌تر از ۱۰۲۴)
const MAX_PIXELS = 16_000_000; // سقف بوم در Safari آیفون (حدود ۱۶٫۷ میلیون پیکسل)
const A4 = [595.28, 841.89];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const baseName = (n) => n.replace(/\.[^.]+$/, "") || "file";
const safeName = (n, fb) => (String(n || "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\.pdf$/i, "") || fb);

// برای آزمون خودکار
const STATE = (window.__IF = { results: {}, errors: [] });

/* ---------- ابزارهای مشترک ---------- */
const isHeic = (f) => /hei[cf]$/i.test(f.type || "") || /\.hei[cf]$/i.test(f.name || "");
const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
const isImage = (f) => (f.type || "").startsWith("image/") || isHeic(f) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name || "");

const scriptCache = {};
function loadScript(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => { delete scriptCache[src]; rej(new Error("بارگذاری کتابخانه ناموفق بود: " + src)); };
      document.head.appendChild(s);
    });
  }
  return scriptCache[src];
}
const getPdfLib = async () => { await loadScript("./pdf-lib.min.js"); return window.PDFLib; };
const getZip = async () => { await loadScript("./jszip.min.js"); return window.JSZip; };
let pdfjsP;
function getPdfjs() {
  if (!pdfjsP) {
    pdfjsP = import("./pdf.min.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", document.baseURI).href;
      return m;
    }).catch((e) => { pdfjsP = null; throw e; });
  }
  return pdfjsP;
}
async function openPdf(file) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  try {
    return await pdfjs.getDocument({
      data, isEvalSupported: false, disableAutoFetch: true, disableStream: true,
      standardFontDataUrl: new URL("./", document.baseURI).href,
    }).promise;
  } catch (e) {
    if (e && e.name === "PasswordException") throw new Error("این PDF رمز دارد؛ ابتدا رمز آن را بردارید.");
    throw new Error("فایل PDF خوانده نشد (ممکن است خراب باشد).");
  }
}

function imgFromBlob(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.decoding = "async";
    im.onload = () => res({ src: im, w: im.naturalWidth, h: im.naturalHeight, release: () => URL.revokeObjectURL(url) });
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
    im.src = url; // مرورگرهای جدید جهت EXIF را خودکار اعمال می‌کنند
  });
}
async function heicToJpegBlob(file) {
  await loadScript("./heic2any.min.js");
  const out = await Promise.race([
    window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.95 }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("heic-timeout")), 90000)),
  ]);
  return Array.isArray(out) ? out[0] : out;
}
/** عکس را باز می‌کند (با رعایت چرخش EXIF و پشتیبانی HEIC) */
async function decodeImage(file) {
  try { return await imgFromBlob(file); }
  catch (e) {
    if (isHeic(file)) {
      try { return await imgFromBlob(await heicToJpegBlob(file)); }
      catch (e2) { throw new Error("عکس HEIC باز نشد. در آیفون: تنظیمات ← Camera ← Formats ← Most Compatible، یا عکس را از گالری انتخاب کنید تا خودکار JPG شود."); }
    }
    throw new Error("این فایل عکس قابل خواندن نیست.");
  }
}
function newCanvas(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function freeCanvas(c) { if (c) { c.width = 0; c.height = 0; } }
function fitPixels(w, h, maxPix = MAX_PIXELS) { const p = w * h; if (p <= maxPix) return [w, h]; const s = Math.sqrt(maxPix / p); return [Math.floor(w * s), Math.floor(h * s)]; }

/** کوچک‌کردن مرحله‌ای برای حفظ وضوح متن */
function resizeCanvas(src, w, h) {
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 >= w * 1.05 && ch / 2 >= h * 1.05) {
    const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
    const c = newCanvas(nw, nh); const x = c.getContext("2d");
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, nw, nh);
    if (cur !== src) freeCanvas(cur);
    cur = c; cw = nw; ch = nh;
  }
  const out = newCanvas(w, h); const x = out.getContext("2d");
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, w, h);
  if (cur !== src) freeCanvas(cur);
  return out;
}
function toGray(canvas) {
  const x = canvas.getContext("2d"); const d = x.getImageData(0, 0, canvas.width, canvas.height); const a = d.data;
  for (let i = 0; i < a.length; i += 4) { const y = (a[i] * 299 + a[i + 1] * 587 + a[i + 2] * 114) / 1000; a[i] = a[i + 1] = a[i + 2] = y; }
  x.putImageData(d, 0, 0);
}
/** رسم عکس روی بوم با پس‌زمینه سفید، چرخش و حداکثر ضلع */
function imageToCanvas(img, { maxEdge = 0, gray = false, rotate = 0, bg = "#ffffff" } = {}) {
  let w = img.w, h = img.h;
  if (maxEdge && Math.max(w, h) > maxEdge) { const s = maxEdge / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  [w, h] = fitPixels(w, h);
  let c;
  if (w === img.w && h === img.h) { c = newCanvas(w, h); const x = c.getContext("2d"); if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); } x.drawImage(img.src, 0, 0); }
  else {
    // اول در اندازه حداکثر مجاز رسم، بعد کوچک‌سازی مرحله‌ای
    const [fw, fh] = fitPixels(img.w, img.h);
    const full = newCanvas(fw, fh); const fx = full.getContext("2d"); if (bg) { fx.fillStyle = bg; fx.fillRect(0, 0, fw, fh); }
    fx.imageSmoothingQuality = "high"; fx.drawImage(img.src, 0, 0, fw, fh);
    c = resizeCanvas(full, w, h); freeCanvas(full);
  }
  if (rotate) {
    const r = ((rotate % 360) + 360) % 360; const sw = r === 90 || r === 270;
    const rc = newCanvas(sw ? c.height : c.width, sw ? c.width : c.height); const x = rc.getContext("2d");
    x.translate(rc.width / 2, rc.height / 2); x.rotate((r * Math.PI) / 180); x.drawImage(c, -c.width / 2, -c.height / 2);
    freeCanvas(c); c = rc;
  }
  if (gray) toGray(c);
  return c;
}
function encode(canvas, type = "image/jpeg", q) {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("ساخت تصویر ناموفق بود (حافظه کافی نیست؟)"))), type, q));
}
/**
 * بهترین JPEG زیر حجم هدف: اول کیفیت را (با جست‌وجوی دودویی) پایین می‌آورد،
 * و فقط وقتی کیفیت از کف مجاز پایین‌تر برود، ابعاد را کم می‌کند.
 * تا وقتی ممکن است ضلع بلند >= minEdge نگه داشته می‌شود.
 */
async function fitCanvasToBytes(base, target, { minEdge = 1600, qMax = 0.92, onStep } = {}) {
  const W = base.width, H = base.height, long = Math.max(W, H);
  const ladder = [2480, 2200, 2000, 1800, 1600, 1400, 1240, 1100, 1000, 900, 800, 700, 600, 500].filter((e) => e < long);
  const edges = [long, ...ladder];
  let last = null;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const c = e === long ? base : resizeCanvas(base, Math.max(1, Math.round((W * e) / long)), Math.max(1, Math.round((H * e) / long)));
    const isLast = i === edges.length - 1;
    const floor = isLast ? 0.2 : e >= minEdge ? 0.55 : 0.4;
    onStep && onStep(e);
    try {
      const top = await encode(c, "image/jpeg", qMax);
      if (top.size <= target) return { blob: top, q: qMax, w: c.width, h: c.height, ok: true };
      const low = await encode(c, "image/jpeg", floor);
      if (low.size <= target) {
        let lo = floor, hi = qMax, best = { blob: low, q: floor };
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2; const b = await encode(c, "image/jpeg", mid);
          if (b.size <= target) { best = { blob: b, q: mid }; lo = mid; } else hi = mid;
        }
        return { ...best, w: c.width, h: c.height, ok: true };
      }
      last = { blob: low, q: floor, w: c.width, h: c.height, ok: false };
    } finally { if (c !== base) freeCanvas(c); }
  }
  return last;
}

/* ---------- رابط کاربری مشترک ---------- */
const toastEl = $("#toast"); let toastT;
function toast(msg, ms = 3200) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), ms); }
const urls = new Set();
const objUrl = (b) => { const u = URL.createObjectURL(b); urls.add(u); return u; };
function revokeAll(scope) { (scope._urls || []).forEach((u) => URL.revokeObjectURL(u)); scope._urls = []; }

let canShareFiles = false;
try { canShareFiles = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [new File(["x"], "t.txt", { type: "text/plain" })] })); } catch { canShareFiles = false; }
async function shareFiles(files) {
  try { await navigator.share({ files, title: "ایرانمنش فایل" }); }
  catch (e) { if (e && e.name !== "AbortError") toast("اشتراک‌گذاری انجام نشد؛ از دکمه ذخیره استفاده کنید."); }
}
function svgIcon(id, cls = "ic") { return `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`; }
const midTrunc = (s, n) => (s.length <= n ? s : s.slice(0, Math.ceil((n - 1) * 0.55)) + "…" + s.slice(s.length - Math.floor((n - 1) * 0.45)));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function makeTool(id, { accept, sortable = false, single = false }) {
  const root = $("#view-" + id);
  const T = { id, root, files: [], busy: false, _urls: [] };
  const input = $(".drop input", root), drop = $(".drop", root), list = $(".picked", root);
  const run = $(".run", root), prog = $(".progress", root), bar = $(".bar i", prog), ptext = $(".ptext", prog), results = $(".results", root);
  T.results = results;
  T.addFiles = (fl) => {
    const arr = Array.from(fl || []);
    const ok = arr.filter(accept), bad = arr.length - ok.length;
    if (bad) toast(fa(bad) + " فایل با نوع نامناسب کنار گذاشته شد.");
    if (!ok.length) return;
    const key = (f) => f.name + "|" + f.size + "|" + f.lastModified;
    const have = new Set(T.files.map(key));
    T.files = single ? [ok[0]] : T.files.concat(ok.filter((f) => !have.has(key(f)) && have.add(key(f))));
    results.innerHTML = ""; revokeAll(T);
    render();
  };
  function render() {
    (T._thumbUrls || []).forEach((u) => URL.revokeObjectURL(u)); T._thumbUrls = [];
    list.innerHTML = "";
    if (T.files.length > 1) { const h = document.createElement("li"); h.className = "list-head"; h.innerHTML = `<span>${fa(T.files.length)} فایل انتخاب شده</span><button type="button" class="link-btn">پاک کردن همه</button>`; h.querySelector("button").onclick = () => { T.files = []; results.innerHTML = ""; revokeAll(T); render(); }; list.appendChild(h); }
    T.files.forEach((f, i) => {
      const li = document.createElement("li");
      let th = `<span class="th">${svgIcon("i-file")}</span>`;
      if (isImage(f) && !isHeic(f)) { const u = URL.createObjectURL(f); T._thumbUrls.push(u); th = `<img class="th" alt="" src="${u}">`; }
      li.innerHTML = `${sortable ? `<span class="num">${fa(i + 1)}</span>` : ""}${th}<span class="info"><span class="nm" title="${esc(f.name)}">${esc(midTrunc(f.name, 26))}</span><span class="sz">${fmtSize(f.size)}</span></span>
        <span class="ctl">${sortable ? `<span class="updown"><button type="button" class="icon-btn up" aria-label="بالاتر" ${i === 0 ? "disabled" : ""}>${svgIcon("i-up")}</button><button type="button" class="icon-btn down" aria-label="پایین‌تر" ${i === T.files.length - 1 ? "disabled" : ""}>${svgIcon("i-down")}</button></span>` : ""}<button type="button" class="icon-btn del" aria-label="حذف">${svgIcon("i-x")}</button></span>`;
      li.querySelector(".del").onclick = () => { T.files.splice(i, 1); render(); };
      if (sortable) {
        li.querySelector(".up").onclick = () => { [T.files[i - 1], T.files[i]] = [T.files[i], T.files[i - 1]]; render(); };
        li.querySelector(".down").onclick = () => { [T.files[i + 1], T.files[i]] = [T.files[i], T.files[i + 1]]; render(); };
        li.draggable = true;
        li.addEventListener("dragstart", (e) => { li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-idx", String(i)); });
        li.addEventListener("dragend", () => li.classList.remove("dragging"));
        li.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/x-idx")) { e.preventDefault(); li.classList.add("drop-target"); } });
        li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
        li.addEventListener("drop", (e) => {
          const from = e.dataTransfer.getData("text/x-idx"); if (from === "") return;
          e.preventDefault(); e.stopPropagation(); const f0 = T.files.splice(+from, 1)[0]; T.files.splice(i, 0, f0); render();
        });
      }
      list.appendChild(li);
    });
    run.disabled = !T.files.length || T.busy;
  }
  T.render = render;
  input.addEventListener("change", () => { T.addFiles(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { if (e.dataTransfer && e.dataTransfer.types.includes("Files")) { e.preventDefault(); drop.classList.add("over"); } }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); T.addFiles(e.dataTransfer.files); } });
  T.progress = (frac, text) => { prog.hidden = false; bar.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + "%"; if (text != null) ptext.textContent = text; };
  T.setBusy = (b) => { T.busy = b; run.disabled = b || !T.files.length; run.setAttribute("aria-busy", b ? "true" : "false"); };
  T.opt = (name) => { const el = root.querySelector(`[name="${name}"]`); if (!el) return null; if (el.type === "radio") return (root.querySelector(`[name="${name}"]:checked`) || {}).value; if (el.type === "checkbox") return el.checked; return el.value; };
  run.disabled = true;
  run.addEventListener("click", async () => {
    if (T.busy || !T.files.length) return;
    T.setBusy(true); results.innerHTML = ""; revokeAll(T); STATE.results[id] = null;
    const t0 = performance.now();
    try { await T.process(); T.progress(1, "انجام شد ✓ (" + fa(((performance.now() - t0) / 1000).toFixed(1)) + " ثانیه)"); }
    catch (e) { console.error(e); STATE.errors.push(String(e && e.message || e)); T.progress(0, ""); prog.hidden = true; results.innerHTML = `<div class="summary"><span class="badge err">خطا</span> ${esc(e.message || "خطای ناشناخته")}</div>`; }
    finally { T.setBusy(false); }
  });
  return T;
}

/** نمایش خروجی‌ها؛ items: [{name, blob, before, note, kind, preview}] */
function showResults(T, items, { title = "نتیجه", summary = "", zipName = null } = {}) {
  STATE.results[T.id] = items;
  const u = (b) => { const x = URL.createObjectURL(b); T._urls.push(x); return x; };
  const box = T.results;
  box.innerHTML = `<div class="res-head"><h2>${title}</h2><div class="res-actions"></div></div>${summary ? `<div class="summary">${summary}</div>` : ""}<div class="list"></div>`;
  const acts = $(".res-actions", box), list = $(".list", box);
  if (items.length > 1) {
    if (zipName) {
      const zb = document.createElement("button"); zb.type = "button"; zb.className = "btn solid"; zb.innerHTML = svgIcon("i-save") + "ذخیره همه (ZIP)";
      zb.onclick = async () => {
        zb.disabled = true; try {
          const JSZip = await getZip(); const z = new JSZip(); const used = new Set();
          items.forEach((it) => { let n = it.name, k = 2; while (used.has(n)) n = baseName(it.name) + "-" + k++ + it.name.slice(baseName(it.name).length); used.add(n); z.file(n, it.blob); });
          const blob = await z.generateAsync({ type: "blob", compression: "STORE" });
          STATE.lastZip = blob; saveBlob(blob, zipName);
        } finally { zb.disabled = false; }
      };
      acts.appendChild(zb);
    }
    if (canShareFiles) {
      const sb = document.createElement("button"); sb.type = "button"; sb.className = "btn"; sb.innerHTML = svgIcon("i-share") + "اشتراک همه";
      sb.onclick = () => shareFiles(items.map((it) => new File([it.blob], it.name, { type: it.blob.type })));
      acts.appendChild(sb);
    }
  }
  for (const it of items) {
    const el = document.createElement("div"); el.className = "result";
    const isImg = it.blob.type.startsWith("image/");
    const pv = isImg ? `<img class="pv" alt="پیش‌نمایش" src="${u(it.blob)}">` : `<span class="pv">${svgIcon("i-file")}</span>`;
    let sizes = `<b>${fmtSize(it.blob.size)}</b>`;
    if (it.before) {
      const pct = Math.round((1 - it.blob.size / it.before) * 100);
      sizes = `قبل: ${fmtSize(it.before)} ← بعد: <b>${fmtSize(it.blob.size)}</b>${pct > 0 ? ` <span class="pct">${fa(pct)}٪ کمتر</span>` : ""}`;
    }
    el.innerHTML = `${pv}<div class="meta"><div class="fname">${esc(it.name)}</div><div class="sizes">${sizes}</div>${it.extra ? `<div class="sizes">${it.extra}</div>` : ""}${it.note ? `<span class="badge ${it.noteKind || "ok"}">${it.note}</span>` : ""}</div>
      <div class="acts"><a class="btn solid" download="${esc(it.name)}" href="${u(it.blob)}">${svgIcon("i-save")}ذخیره</a>${canShareFiles ? `<button type="button" class="btn share">${svgIcon("i-share")}اشتراک / Files</button>` : ""}</div>`;
    const sh = el.querySelector(".share"); if (sh) sh.onclick = () => shareFiles([new File([it.blob], it.name, { type: it.blob.type })]);
    list.appendChild(el);
  }
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
function saveBlob(blob, name) {
  const a = document.createElement("a"); const url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ---------- ۱. کاهش حجم عکس ---------- */
const tCompress = makeTool("compress", { accept: isImage });
$$('#view-compress [name="target"]').forEach((r) => r.addEventListener("change", () => { $("#view-compress .custom-kb").hidden = tCompress.opt("target") !== "custom"; }));
function readTargetKB(T) {
  let v = T.opt("target");
  if (v === "custom") { v = parseFloat(toLatin(T.opt("customkb")).replace(/[^\d.]/g, "")); if (!(v >= 20)) throw new Error("حجم دلخواه را حداقل ۲۰ کیلوبایت وارد کنید."); }
  return +v;
}
tCompress.process = async function () {
  const T = this, kb = readTargetKB(T), target = kb * KB, gray = T.opt("gray");
  const out = []; const n = T.files.length;
  for (let i = 0; i < n; i++) {
    const f = T.files[i]; const label = `عکس ${fa(i + 1)} از ${fa(n)}`;
    T.progress(i / n, label + "…"); await tick();
    const name = baseName(f.name) + `-${kb}kb.jpg`;
    try {
      if (/jpe?g$/i.test(f.type) && f.size <= target && !gray) {
        out.push({ name, blob: f.slice(0, f.size, "image/jpeg"), before: f.size, note: `از قبل زیر ${kbLabel(kb)} بود؛ بدون تغییر`, noteKind: "ok" });
        continue;
      }
      const img = await decodeImage(f);
      const base = imageToCanvas(img, { gray }); img.release();
      const r = await fitCanvasToBytes(base, target, { onStep: (e) => T.progress((i + 0.5) / n, `${label} — آزمایش ابعاد ${fa(e)} پیکسل`) });
      freeCanvas(base);
      out.push({
        name, blob: r.blob, before: f.size,
        extra: `ابعاد: ${fa(r.w)}×${fa(r.h)} · کیفیت ${fa(Math.round(r.q * 100))}٪`,
        note: r.ok ? `زیر ${kbLabel(kb)} ✓` : `کوچک‌تر از این ممکن نشد بدون از بین رفتن خوانایی`, noteKind: r.ok ? "ok" : "warn",
      });
    } catch (e) { out.push({ name: f.name, blob: new Blob([], { type: "text/plain" }), note: e.message, noteKind: "err" }); }
  }
  const good = out.filter((o) => o.blob.size);
  const tb = good.reduce((s, o) => s + o.before, 0), ta = good.reduce((s, o) => s + o.blob.size, 0);
  showResults(T, good.length ? out.filter((o) => o.blob.size) : [], {
    title: "عکس‌های کم‌حجم", zipName: `iranmanesh-file-${kb}kb.zip`,
    summary: `${fa(good.length)} عکس · مجموع ${fmtSize(tb)} ← ${fmtSize(ta)}` + (out.length > good.length ? ` · <span class="badge err">${fa(out.length - good.length)} فایل خطا داشت</span>` : ""),
  });
};

/* ---------- ۲. عکس به PDF ---------- */
const tImg2pdf = makeTool("img2pdf", { accept: isImage, sortable: true });
async function buildImagesPdf(files, { targetBytes = 0, gray = false, landscape = true, margin = 22, title = "", onProgress } = {}) {
  const PDFLib = await getPdfLib();
  const n = files.length;
  // ابتدا هر عکس یک‌بار باز و در اندازه A4/۳۰۰DPI آماده می‌شود
  let perImg = targetBytes ? Math.max(15 * KB, (targetBytes * 0.97 - 3000 - n * 900) / n) : 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await PDFLib.PDFDocument.create();
    doc.setTitle(title || "مدارک"); doc.setCreator("ایرانمنش فایل"); doc.setProducer("ایرانمنش فایل");
    for (let i = 0; i < n; i++) {
      onProgress && onProgress((i + attempt * 0) / n, `صفحه ${fa(i + 1)} از ${fa(n)}${attempt ? " (تلاش دوباره برای حجم کمتر)" : ""}`);
      await tick();
      const img = await decodeImage(files[i]);
      const c = imageToCanvas(img, { maxEdge: 2480, gray }); img.release();
      let blob;
      if (perImg) blob = (await fitCanvasToBytes(c, perImg, { minEdge: 1600, qMax: 0.88 })).blob;
      else { const cc = Math.max(c.width, c.height) > 2000 ? resizeCanvas(c, ...scaleTo(c, 2000)) : c; blob = await encode(cc, "image/jpeg", 0.85); if (cc !== c) freeCanvas(cc); }
      const iw = c.width, ih = c.height; freeCanvas(c);
      const jpg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const land = landscape && iw > ih;
      const [pw, ph] = land ? [A4[1], A4[0]] : A4;
      const page = doc.addPage([pw, ph]);
      const s = Math.min((pw - 2 * margin) / iw, (ph - 2 * margin) / ih);
      const dw = iw * s, dh = ih * s;
      page.drawImage(jpg, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
    }
    const bytes = await doc.save({ useObjectStreams: true });
    if (!targetBytes || bytes.length <= targetBytes || perImg <= 15 * KB) return { bytes, pages: n, ok: !targetBytes || bytes.length <= targetBytes };
    perImg = Math.max(15 * KB, perImg * (targetBytes / bytes.length) * 0.95);
  }
  throw new Error("رسیدن به این حجم ممکن نشد؛ هدف بزرگ‌تری انتخاب کنید یا تعداد صفحه‌ها را کم کنید.");
}
function scaleTo(c, edge) { const s = edge / Math.max(c.width, c.height); return [Math.round(c.width * s), Math.round(c.height * s)]; }
tImg2pdf.process = async function () {
  const T = this, kb = +T.opt("target"), name = safeName(T.opt("outname"), "madarek") + ".pdf";
  const before = T.files.reduce((s, f) => s + f.size, 0);
  const r = await buildImagesPdf(T.files, { targetBytes: kb * KB, gray: T.opt("gray"), landscape: T.opt("landscape"), title: baseName(name), onProgress: (p, t) => T.progress(p * 0.95, t) });
  const blob = new Blob([r.bytes], { type: "application/pdf" });
  showResults(T, [{ name, blob, before, extra: `${fa(r.pages)} صفحه A4`, note: kb ? (r.ok ? `زیر ${kbLabel(kb)} ✓` : "از حجم هدف بیشتر شد") : "ساخته شد ✓", noteKind: r.ok ? "ok" : "warn" }], { title: "PDF آماده است" });
};

/* ---------- ۳. PDF به عکس ---------- */
const tPdf2img = makeTool("pdf2img", { accept: isPdf, single: true });
async function renderPage(pdf, num, dpi, { maxPix = MAX_PIXELS } = {}) {
  const page = await pdf.getPage(num);
  const vp1 = page.getViewport({ scale: 1 });
  let scale = dpi / 72; const [w, h] = fitPixels(vp1.width * scale, vp1.height * scale, maxPix);
  scale = Math.min(scale, w / vp1.width);
  const vp = page.getViewport({ scale });
  const c = newCanvas(vp.width, vp.height); const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return { canvas: c, ptW: vp1.width, ptH: vp1.height };
}
tPdf2img.process = async function () {
  const T = this, f = T.files[0], dpi = +T.opt("dpi");
  T.progress(0.02, "باز کردن PDF…");
  const pdf = await openPdf(f); const n = pdf.numPages; const out = []; const pad = String(n).length < 2 ? 2 : String(n).length;
  for (let p = 1; p <= n; p++) {
    T.progress((p - 1) / n, `صفحه ${fa(p)} از ${fa(n)}`); await tick();
    const { canvas } = await renderPage(pdf, p, dpi);
    const blob = await encode(canvas, "image/jpeg", 0.9);
    out.push({ name: `${baseName(f.name)}-p${String(p).padStart(pad, "0")}.jpg`, blob, extra: `${fa(canvas.width)}×${fa(canvas.height)} پیکسل` });
    freeCanvas(canvas);
  }
  await pdf.destroy();
  showResults(T, out, { title: `${fa(n)} عکس`, zipName: baseName(f.name) + "-images.zip", summary: `هر صفحه با وضوح ${fa(dpi)} نقطه در اینچ · مجموع ${fmtSize(out.reduce((s, o) => s + o.blob.size, 0))}` });
};

/* ---------- ۴. کاهش حجم PDF ---------- */
const tPdfsmall = makeTool("pdfsmall", { accept: isPdf, single: true });
const LEVELS = { high: { dpi: 200, q: 0.8 }, mid: { dpi: 150, q: 0.7 }, low: { dpi: 100, q: 0.55 } };
async function compressPdf(file, { targetBytes = 0, level = "mid", gray = false, onProgress } = {}) {
  const PDFLib = await getPdfLib(); const L = LEVELS[level] || LEVELS.mid;
  const pdf = await openPdf(file); const n = pdf.numPages;
  let perPage = targetBytes ? Math.max(12 * KB, (targetBytes * 0.97 - 3000 - n * 900) / n) : 0;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const doc = await PDFLib.PDFDocument.create();
      doc.setCreator("ایرانمنش فایل"); doc.setProducer("ایرانمنش فایل");
      for (let p = 1; p <= n; p++) {
        onProgress && onProgress((p - 1) / n, `صفحه ${fa(p)} از ${fa(n)}${attempt ? " (تلاش دوباره برای حجم کمتر)" : ""}`); await tick();
        const { canvas, ptW, ptH } = await renderPage(pdf, p, L.dpi);
        if (gray) toGray(canvas);
        const blob = perPage ? (await fitCanvasToBytes(canvas, perPage, { minEdge: Math.min(1600, Math.max(canvas.width, canvas.height)), qMax: L.q + 0.08 })).blob : await encode(canvas, "image/jpeg", L.q);
        freeCanvas(canvas);
        const jpg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
        doc.addPage([ptW, ptH]).drawImage(jpg, { x: 0, y: 0, width: ptW, height: ptH });
      }
      const bytes = await doc.save({ useObjectStreams: true });
      if (!targetBytes || bytes.length <= targetBytes || perPage <= 12 * KB) return { bytes, pages: n, ok: !targetBytes || bytes.length <= targetBytes };
      perPage = Math.max(12 * KB, perPage * (targetBytes / bytes.length) * 0.95);
    }
    throw new Error("رسیدن به این حجم ممکن نشد؛ هدف بزرگ‌تری انتخاب کنید.");
  } finally { pdf.destroy(); }
}
tPdfsmall.process = async function () {
  const T = this, f = T.files[0], kb = +T.opt("target");
  const r = await compressPdf(f, { targetBytes: kb * KB, level: T.opt("level"), gray: T.opt("gray"), onProgress: (p, t) => T.progress(p * 0.95, t) });
  const name = baseName(f.name) + "-kam.pdf";
  if (r.bytes.length >= f.size) {
    showResults(T, [{ name: f.name, blob: f.slice(0, f.size, "application/pdf"), before: f.size, extra: `${fa(r.pages)} صفحه`, note: `نسخه فشرده (${fmtSize(r.bytes.length)}) بزرگ‌تر از اصل می‌شد؛ همان فایل اصلی نگه داشته شد`, noteKind: "warn" }], { title: "نتیجه" });
    return;
  }
  const blob = new Blob([r.bytes], { type: "application/pdf" });
  showResults(T, [{ name, blob, before: f.size, extra: `${fa(r.pages)} صفحه · متن به تصویر تبدیل شده است`, note: kb ? (r.ok ? `زیر ${kbLabel(kb)} ✓` : "از حجم هدف بیشتر شد") : "فشرده شد ✓", noteKind: r.ok ? "ok" : "warn" }], { title: "PDF کم‌حجم" });
};

/* ---------- ۵. تغییر فرمت و چرخش ---------- */
const tConvert = makeTool("convert", { accept: isImage });
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
let webpOK = true;
(async () => {
  try { const c = newCanvas(2, 2); const b = await encode(c, "image/webp", 0.8); webpOK = b.type === "image/webp"; } catch { webpOK = false; }
  if (!webpOK) { const w = $('#view-convert input[value="image/webp"]'); w.disabled = true; $("#view-convert .webp-note").hidden = false; }
})();
tConvert.process = async function () {
  const T = this, fmt = T.opt("fmt"), rot = +T.opt("rotate"); const n = T.files.length; const out = [];
  if (fmt === "image/webp" && !webpOK) throw new Error("این مرورگر WebP نمی‌سازد؛ JPG یا PNG را انتخاب کنید.");
  for (let i = 0; i < n; i++) {
    const f = T.files[i]; T.progress(i / n, `عکس ${fa(i + 1)} از ${fa(n)}`); await tick();
    try {
      const img = await decodeImage(f);
      const c = imageToCanvas(img, { rotate: rot, bg: fmt === "image/jpeg" ? "#ffffff" : null }); img.release();
      const blob = await encode(c, fmt, fmt === "image/png" ? undefined : 0.92);
      out.push({ name: `${baseName(f.name)}${rot ? "-rot" + rot : ""}.${EXT[fmt]}`, blob, before: f.size, extra: `${fa(c.width)}×${fa(c.height)} پیکسل`, note: (isHeic(f) ? "از HEIC به " : "تبدیل به ") + EXT[fmt].toUpperCase() + " ✓" });
      freeCanvas(c);
    } catch (e) { out.push({ name: f.name, blob: new Blob([]), note: e.message, noteKind: "err" }); }
  }
  const good = out.filter((o) => o.blob.size), bad = out.length - good.length;
  showResults(T, good, { title: "عکس‌های تبدیل‌شده", zipName: "iranmanesh-file-images.zip", summary: `${fa(good.length)} عکس تبدیل شد` + (bad ? ` · <span class="badge err">${fa(bad)} فایل باز نشد: ${esc(out.find((o) => !o.blob.size).note)}</span>` : "") });
};

/* ---------- ۶. ادغام PDF ---------- */
const tMerge = makeTool("merge", { accept: isPdf, sortable: true });
tMerge.process = async function () {
  const T = this; const PDFLib = await getPdfLib(); const n = T.files.length;
  if (n < 2) throw new Error("حداقل دو فایل PDF انتخاب کنید.");
  const doc = await PDFLib.PDFDocument.create(); doc.setCreator("ایرانمنش فایل"); doc.setProducer("ایرانمنش فایل");
  let pages = 0;
  for (let i = 0; i < n; i++) {
    const f = T.files[i]; T.progress(i / n, `فایل ${fa(i + 1)} از ${fa(n)}`); await tick();
    let src;
    try { src = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: false }); }
    catch (e) { throw new Error(`فایل «${f.name}» باز نشد${/encrypt/i.test(String(e)) ? " (رمز دارد)" : ""}.`); }
    const cp = await doc.copyPages(src, src.getPageIndices()); cp.forEach((p) => doc.addPage(p)); pages += cp.length;
  }
  const bytes = await doc.save({ useObjectStreams: true });
  const name = safeName(T.opt("outname"), "edgham") + ".pdf";
  showResults(T, [{ name, blob: new Blob([bytes], { type: "application/pdf" }), before: 0, extra: `${fa(n)} فایل · ${fa(pages)} صفحه`, note: "ادغام شد ✓" }], { title: "PDF ادغام‌شده" });
};

/* ---------- مسیریابی ---------- */
const VIEWS = ["home", "compress", "img2pdf", "pdf2img", "pdfsmall", "convert", "merge"];
function route() {
  const id = (location.hash.replace(/^#\/?/, "") || "home");
  const v = VIEWS.includes(id) ? id : "home";
  VIEWS.forEach((k) => ($("#view-" + k).hidden = k !== v));
  document.title = v === "home" ? "ایرانمنش فایل" : $("#view-" + v + " h1").textContent + " — ایرانمنش فایل";
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route); route();

// جلوگیری از باز شدن فایل رهاشده در خود مرورگر
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
// پیش‌بارگذاری آرام کتابخانه‌ها برای استفاده آفلاین
window.addEventListener("load", () => setTimeout(() => { getPdfLib().catch(() => {}); }, 1500));
