// noprotect
P5Capture.setDefaultOptions({ format: "png", framerate: 30, disableUi: true });

// --- キャンバスサイズ ---
const INITIAL_W = 630;
const INITIAL_H = 891;

let fontPoints = [];
let movingPoints = []; // 各ピクセルの軌道情報を保持
let pointsKey = ''; // 点の生成条件。変わったら再生成する

// === マウスドラッグ ===
// Trail: 軌跡上にタイルを置く。Fill: ブラシで塗った範囲（スタンプの円）をセルで埋める。
// Fill はスタンプ（位置と半径）だけを保存し、セルは Cell Size から作り直すので、描いた後でも Cell Size を変えられる。
let trailStrokes = [];   // Trail の軌跡。ストロークごとのマウス位置の列 [[{x, y}, ...], ...]
let trailPts = [];       // 軌跡を Spacing ごとに打ち直したタイル位置（描画用）
let trailBuiltSpacing = null; // trailPts を作ったときの Spacing
let trailDirty = false;  // 軌跡が変わって trailPts の作り直しが必要か
let brushStamps = [];    // Fill ブラシのスタンプ {x, y, r}
let brushPts = [];       // スタンプから作ったセル中心 {x, y}（描画用）
let brushCells = new Set(); // 作成済みのセル（重複防止）
let brushBuiltStep = null;  // brushPts を作ったときの Cell Size
let lastTrailPt = null;  // 直前に置いた位置（ストロークごとにリセット）
let isDragging = false;  // キャンバス上で押下中か

// Undo 用の履歴。ストロークの開始前（と Clear の前）の状態を保存しておく
const HISTORY_LIMIT = 100;
let history = [];

function pushHistory() {
  history.push({ trail: trailStrokes.slice(), stamps: brushStamps.slice() });
  if (history.length > HISTORY_LIMIT) history.shift();
}

function undo() {
  if (!history.length || isDragging) return;
  const h = history.pop();
  trailStrokes = h.trail;
  trailDirty = true;
  brushStamps = h.stamps;
  lastTrailPt = null;
  rebuildBrushCells();
}

// ドラッグで置いたタイルを全て消す（Undo で戻せる）
function clearCanvas() {
  if ((!trailStrokes.length && !brushStamps.length) || isDragging) return;
  pushHistory();
  trailStrokes = [];
  trailDirty = true;
  brushStamps = [];
  lastTrailPt = null;
  rebuildBrushCells();
}

function insideCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
}

// スタンプ（円）の内側にあるセル中心を brushPts に足す
// セル中心は step/2 + k*step（generateFillPoints と同じ格子）
function addStampCells(stamp, step) {
  const { x, y, r } = stamp;
  const kx0 = Math.ceil((x - r - step / 2) / step);
  const kx1 = Math.floor((x + r - step / 2) / step);
  const ky0 = Math.ceil((y - r - step / 2) / step);
  const ky1 = Math.floor((y + r - step / 2) / step);
  for (let ky = ky0; ky <= ky1; ky++) {
    for (let kx = kx0; kx <= kx1; kx++) {
      const cx = step / 2 + kx * step, cy = step / 2 + ky * step;
      if (cx < 0 || cx > width || cy < 0 || cy > height) continue;
      if (Math.hypot(cx - x, cy - y) > r) continue;
      const key = kx + ',' + ky; // 同じセルに重複して置かない
      if (brushCells.has(key)) continue;
      brushCells.add(key);
      brushPts.push({ x: cx, y: cy });
    }
  }
}

// 全スタンプから、現在の Cell Size でセルを作り直す
function rebuildBrushCells() {
  const step = params.trailGridStep;
  brushPts = [];
  brushCells = new Set();
  brushBuiltStep = step;
  for (const stamp of brushStamps) addStampCells(stamp, step);
}

function paintBrush(x, y) {
  const stamp = { x, y, r: params.brushSize / 2 };
  brushStamps.push(stamp);
  if (brushBuiltStep !== params.trailGridStep) rebuildBrushCells();
  else addStampCells(stamp, params.trailGridStep);
}

// 前回位置から現在位置まで、取りこぼしがないよう細かく補間してブラシを当てる
function paintBrushTo(x, y) {
  const spacing = Math.max(1, params.brushSize / 8); // 半径の 1/4 ごと
  const dx = x - lastTrailPt.x, dy = y - lastTrailPt.y;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / spacing));
  for (let i = 1; i <= n; i++) paintBrush(lastTrailPt.x + dx * i / n, lastTrailPt.y + dy * i / n);
  lastTrailPt = { x, y };
}

// ブラシサイズを示す円（キャンバスの外側に重ねる DOM。録画には写らない）
let brushCursor;
function updateBrushCursor() {
  if (!brushCursor) {
    brushCursor = document.createElement('div');
    brushCursor.style.cssText = 'position:fixed;pointer-events:none;border:1px solid #888;border-radius:50%;display:none;transform:translate(-50%,-50%);';
    document.body.appendChild(brushCursor);
  }
  const show = params.trailMode === 'fill' && insideCanvas();
  brushCursor.style.display = show ? 'block' : 'none';
  if (!show) return;
  const rect = drawingContext.canvas.getBoundingClientRect();
  brushCursor.style.left = (rect.left + mouseX) + 'px';
  brushCursor.style.top = (rect.top + mouseY) + 'px';
  brushCursor.style.width = brushCursor.style.height = params.brushSize + 'px';
}

function mousePressed() {
  // GUI 上の操作では軌跡を描かない
  isDragging = insideCanvas();
  if (!isDragging) return;
  pushHistory(); // このストロークを Undo で取り消せるようにする
  lastTrailPt = { x: mouseX, y: mouseY };
  if (params.trailMode === 'fill') {
    paintBrush(mouseX, mouseY);
  } else {
    trailStrokes.push([{ x: mouseX, y: mouseY }]);
    trailDirty = true;
  }
}

function mouseDragged() {
  if (!isDragging) return;
  if (params.trailMode === 'fill') {
    paintBrushTo(mouseX, mouseY);
    return;
  }
  // マウス位置を記録するだけ。タイルは Spacing に応じて描画時に打つので、後から Spacing を変えられる
  const stroke = trailStrokes[trailStrokes.length - 1];
  const last = stroke[stroke.length - 1];
  if (Math.hypot(mouseX - last.x, mouseY - last.y) >= 1) {
    stroke.push({ x: mouseX, y: mouseY });
    trailDirty = true;
  }
}

// 全ストロークを現在の Spacing で打ち直す
function rebuildTrail() {
  const spacing = Math.max(1, params.trailSpacing);
  trailPts = [];
  for (const stroke of trailStrokes) {
    if (stroke.length === 1) trailPts.push(stroke[0]); // クリックだけの点
    else resampleRing(stroke.map(p => [p.x, p.y]), spacing, trailPts); // resampleRing は [x, y] 形式
  }
  trailBuiltSpacing = params.trailSpacing;
  trailDirty = false;
}

function mouseReleased() {
  isDragging = false;
}

// === フォント ===
// OS に入っているシステムフォント（CSS のフォント名）を canvas に描き、そのラスターから点を作る。
const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];

// === 描画するテキストとサイズ（GUI の Text / Font Size） ===

// Text / SVG それぞれの配置設定（Mode・Cell Size・Pix per Cell・Count は別々）
function shapeParams(src) {
  return src === 'svg'
    ? { mode: params.svgMode, gridStep: params.svgGridStep, pix: params.svgPixPerCell, count: params.svgCount }
    : { mode: params.mode, gridStep: params.gridStep, pix: params.pixPerCell, count: params.count };
}

// 現在のパラメータから点の生成条件を表すキーを作る
function makePointsKey() {
  // 表示中のものだけがキーに入る（Text と SVG は独立に表示/非表示でき、Mode などの設定も別々）
  const modeKey = (c) => c.mode === 'fill' ? `fill:${c.gridStep}` : `outline:${c.count}`;
  const textKey = params.showText ? `text:${modeKey(shapeParams('text'))}:${params.fontName}:${params.fontSize}:${params.text}` : 'text:off';
  const svgKey = svgIsShown() ? `svg:${modeKey(shapeParams('svg'))}:${svgVersion}:${params.svgScale}` : 'svg:off';
  return `${textKey}:${svgKey}`;
}

// === SVG 読み込み ===
const svgIsShown = () => params.showSvg && svgShapes.length > 0;
// Outline: SVG のパス上を getPointAtLength でたどって点を取る（線の太さに関係なくパスそのもの）。
// Fill: 全図形を黒で塗りつぶした SVG 画像をキャンバスに描き、塗りつぶしをスキャンする。
let svgFillImage = null;  // 塗りつぶし用に描き直した画像
let svgHost = null;       // パスを測るために DOM に置いた SVG
let svgShapes = [];       // {el, m, ranges}: 図形・root への変換行列・サブパスごとの長さ範囲
let svgSize = { x: 0, y: 0, w: 1, h: 1 }; // viewBox
let svgVersion = 0;       // 読み込むたびに増やし、点を再生成させる

// path の d を M/m ごとのサブパスに分け、getPointAtLength 上の長さ範囲 [from, to] を返す
// （moveto は長さに数えられないので、手前までの d の長さがそのままサブパスの開始位置になる）
function subpathRanges(pathEl, svgEl) {
  const d = pathEl.getAttribute('d') || '';
  const starts = [...d.matchAll(/[Mm]/g)].map(m => m.index).filter(i => i > 0);
  const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svgEl.appendChild(tmp);
  const bounds = [0];
  for (const i of starts) {
    tmp.setAttribute('d', d.slice(0, i));
    bounds.push(tmp.getTotalLength());
  }
  tmp.remove();
  bounds.push(pathEl.getTotalLength());
  const ranges = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (bounds[i + 1] - bounds[i] > 0) ranges.push([bounds[i], bounds[i + 1]]);
  }
  return ranges;
}

function loadSVG(text) {
  return new Promise((resolve, reject) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (doc.querySelector('parsererror') || root.localName !== 'svg') {
      reject(new Error('SVG を解析できませんでした'));
      return;
    }
    // 寸法は viewBox を優先し、なければ width/height
    let vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (!(vb.length === 4 && vb[2] > 0 && vb[3] > 0)) {
      vb = [0, 0, parseFloat(root.getAttribute('width')) || 100, parseFloat(root.getAttribute('height')) || 100];
      root.setAttribute('viewBox', vb.join(' '));
    }
    // 画面上で 1 ユーザー単位 = 1px になるよう寸法と名前空間を明示する
    root.setAttribute('width', vb[2]);
    root.setAttribute('height', vb[3]);
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const source = new XMLSerializer().serializeToString(root);

    // --- Outline 用: DOM に置いてパスを測れるようにする ---
    if (svgHost) svgHost.remove();
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;';
    host.innerHTML = source;
    document.body.appendChild(host);
    const svgEl = host.querySelector('svg');
    const rootInv = svgEl.getScreenCTM().inverse();
    const shapes = [];
    for (const el of svgEl.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon')) {
      if (el.closest('defs,clipPath,mask,symbol,marker,pattern')) continue;
      const ranges = el.localName === 'path' ? subpathRanges(el, svgEl) : [[0, el.getTotalLength()]];
      shapes.push({ el, m: rootInv.multiply(el.getScreenCTM()), ranges });
    }

    // --- Fill 用: 全図形を黒で塗りつぶし（線は消す）、塗りつぶした画像を作る ---
    const fillRoot = root.cloneNode(true);
    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = 'path,rect,circle,ellipse,polygon,polyline{fill:#000 !important;stroke:none !important}';
    fillRoot.insertBefore(style, fillRoot.firstChild);
    const img = new Image();
    img.onload = () => {
      svgHost = host;
      svgShapes = shapes;
      svgFillImage = img;
      svgSize = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
      svgVersion++;
      resolve();
    };
    img.onerror = () => { host.remove(); reject(new Error('SVG を描画できませんでした')); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(fillRoot));
  });
}

// SVG をキャンバスの 90% に収め、SVG Scale を掛けて中央に置くための倍率と原点
function svgFit() {
  const k = Math.min(width * 0.9 / svgSize.w, height * 0.9 / svgSize.h) * params.svgScale / 100;
  return { k, ox: (width - svgSize.w * k) / 2, oy: (height - svgSize.h * k) / 2 };
}

// Outline: 全パスを Count に応じた間隔でたどり、キャンバス座標の点にする
function generateSvgOutlinePoints() {
  const { k, ox, oy } = svgFit();
  const step = 100 / shapeParams('svg').count / k; // キャンバス上の間隔を SVG 単位に直す
  const pts = [];
  for (const { el, m, ranges } of svgShapes) {
    for (const [from, to] of ranges) {
      for (let len = from; len < to; len += step) {
        const p = el.getPointAtLength(len);
        const x = m.a * p.x + m.c * p.y + m.e;
        const y = m.b * p.x + m.d * p.y + m.f;
        pts.push({ x: ox + (x - svgSize.x) * k, y: oy + (y - svgSize.y) * k });
      }
    }
  }
  return pts;
}

// 点の元になる「描かれた範囲」を 0〜255 のカバレッジとして返す（width × height、1ピクセル1要素）
function getCoverage(src) {
  const g = createGraphics(width, height);
  g.pixelDensity(1);
  const ctx = g.drawingContext;
  const cov = new Uint8Array(width * height);

  if (src === 'svg') {
    // 透明な背景に塗りつぶした SVG を描き、アルファ値を使う
    if (svgFillImage) {
      const { k, ox, oy } = svgFit();
      ctx.drawImage(svgFillImage, ox, oy, svgSize.w * k, svgSize.h * k);
    }
    g.loadPixels();
    for (let i = 0; i < cov.length; i++) cov[i] = g.pixels[i * 4 + 3];
  } else {
    // 白背景に文字を黒で描き、暗さを使う
    g.background(255);
    const family = GENERIC_FAMILIES.includes(params.fontName) ? params.fontName : `"${params.fontName}"`;
    ctx.font = `${params.fontSize}px ${family}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#000';
    // 実際のインク範囲で中央に揃える
    const m = ctx.measureText(params.text);
    const x = width / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    const y = height / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(params.text, x, y);
    g.loadPixels();
    for (let i = 0; i < cov.length; i++) cov[i] = 255 - g.pixels[i * 4];
  }
  g.remove();
  return cov;
}

// 塗りつぶしをスキャンして、グリッド状の点を作る
function generateFillPoints(src) {
  const step = shapeParams(src).gridStep;
  const cov = getCoverage(src);

  const pts = [];
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      // セル中心のピクセルが描かれていれば内側
      if (cov[Math.floor(y) * width + Math.floor(x)] > 127) pts.push({ x, y });
    }
  }
  return pts;
}

// 折れ線 ring（輪郭やマウスの軌跡）に沿って spacing ごとに点を打つ
function resampleRing(ring, spacing, out) {
  let pos = 0; // 現在の線分上で、次に点を打つ位置
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1], [x1, y1] = ring[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    while (pos <= len) {
      const t = len ? pos / len : 0;
      out.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
      pos += spacing;
    }
    pos -= len;
  }
}

// ラスターから輪郭（等値線 0.5）を取り、Count に応じた間隔で点を打つ
function generateOutlinePointsFromRaster(src) {
  const cov = getCoverage(src);
  const values = new Float32Array(cov.length);
  for (let i = 0; i < values.length; i++) values[i] = cov[i] / 255;

  const spacing = 100 / shapeParams(src).count; // textToPoints の sampleFactor (= count/100) 相当
  const pts = [];
  const multiPolygon = d3.contours().size([width, height]).thresholds([0.5])(values)[0];
  if (!multiPolygon) return pts; // 何も描かれていない場合
  for (const polygon of multiPolygon.coordinates) {
    for (const ring of polygon) resampleRing(ring, spacing, pts);
  }
  return pts;
}

// 点を生成（モード・円の数・グリッド解像度・フォントの変更時に再実行）
function generatePoints() {
  pointsKey = makePointsKey();

  // Text と SVG は独立に表示でき、両方が ON なら両方の点を置く
  const generate = (src) => {
    if (shapeParams(src).mode === 'fill') return generateFillPoints(src);
    return src === 'svg' ? generateSvgOutlinePoints() : generateOutlinePointsFromRaster('text');
  };
  fontPoints = [];
  if (params.showText) fontPoints = fontPoints.concat(generate('text').map(p => ({ ...p, src: 'text' })));
  if (svgIsShown()) fontPoints = fontPoints.concat(generate('svg').map(p => ({ ...p, src: 'svg' })));

  // movingPoints を再構築
  movingPoints = fontPoints.map(p => ({
    origin: createVector(p.x, p.y),       // 元の位置
    src: p.src                            // 'text' | 'svg'（設定の参照先）
  }));
}

function setup() {
  createCanvas(INITIAL_W, INITIAL_H).parent('sketch-holder');

  // 初期 sampleFactor（params は index.html で localStorage から復元済み）
  generatePoints();

  loop();
  frameRate(30);
}

// 中心(0,0)に w×h のタイルを描く。t=0 で四角、t=1 で楕円。
// 角を楕円弧にして、各辺方向に半径 (w/2*t, h/2*t) を使うので、
// t=1 のときは縦横比に関わらず正しい楕円になる
function drawPix(w, h, t) {
  const hw = w / 2, hh = h / 2;
  const rx = hw * t, ry = hh * t;
  const ix = hw - rx, iy = hh - ry; // 角の円弧の中心位置
  const ctx = drawingContext;
  ctx.beginPath();
  ctx.ellipse(ix, iy, rx, ry, 0, 0, HALF_PI);
  ctx.ellipse(-ix, iy, rx, ry, 0, HALF_PI, PI);
  ctx.ellipse(-ix, -iy, rx, ry, 0, PI, PI + HALF_PI);
  ctx.ellipse(ix, -iy, rx, ry, 0, PI + HALF_PI, TWO_PI);
  ctx.closePath();
  ctx.fill();
}

// セル中心 (x, y) にタイルを置く。cellWidth > 0（Fill）なら、セルの幅を等分して
// Pix per Cell 個のタイルを横並びに置く
function pushCellPix(pix, x, y, cellWidth, pixPerCell) {
  const n = cellWidth > 0 ? pixPerCell : 1;
  for (let j = 0; j < n; j++) {
    pix.push({ x: x + ((j + 0.5) / n - 0.5) * cellWidth, y });
  }
}

// 描画するタイルの中心位置を全て計算する（輪郭/塗りつぶし + ドラッグの軌跡）
function computePix() {
  const jitter = params.jitter;
  const thinOut = params.thinOut / 100; // 間引く割合 0〜1
  const pix = [];

  // シードを再セット（疎密・ジッターの再現性のため）
  randomSeed(params.seed);
  noiseSeed(params.seed);

  // 文字・SVG のタイルは、それぞれの Show が ON のときだけ点がある（初期は真っ白なキャンバス）
  for (let i = 0; i < movingPoints.length; i++) {
    const pt = movingPoints[i];

    // 間引き判定（全タイル共通の確率）
    if (random(1) < thinOut) continue;

    // ジッター（シード固定なので毎フレーム同じ値）
    const offsetX = random(-jitter, jitter);
    const offsetY = random(-jitter, jitter);

    const c = shapeParams(pt.src);
    pushCellPix(pix, pt.origin.x + offsetX, pt.origin.y + offsetY, c.mode === 'fill' ? c.gridStep : 0, c.pix);
  }

  // ブラシ（Trail / Fill）で描いたタイルにも、Distribution（疎密・ジッター）を効かせる。
  // 描き足しても既存のタイルの結果が変わらないよう、順番ではなく位置から決める
  const hash01 = (x, y, salt) => {
    const v = Math.sin(x * 12.9898 + y * 78.233 + params.seed * 37.719 + salt * 4.581) * 43758.5453;
    return v - Math.floor(v);
  };
  const distribute = (x, y) => {
    // 間引き: 位置から決まる乱数が thinOut 未満なら消す
    if (hash01(x, y, 1) < thinOut) return null;
    return { x: x + (hash01(x, y, 2) * 2 - 1) * jitter, y: y + (hash01(x, y, 3) * 2 - 1) * jitter };
  };

  // マウスドラッグの軌跡にも同じタイルを置く
  if (trailDirty || trailBuiltSpacing !== params.trailSpacing) rebuildTrail();
  for (const tp of trailPts) {
    const d = distribute(tp.x, tp.y);
    if (d) pushCellPix(pix, d.x, d.y, 0, 1);
  }
  // Fill ブラシのセル。Cell Size が変わっていたら作り直す
  if (brushBuiltStep !== params.trailGridStep) rebuildBrushCells();
  for (const bp of brushPts) {
    const d = distribute(bp.x, bp.y);
    if (d) pushCellPix(pix, d.x, d.y, params.trailGridStep, params.trailPixPerCell);
  }
  return pix;
}

function draw() {
  // GUI（Tweakpane）のパラメータを取得
  const d = params.circleSize;
  const pixAngle = radians(params.pixAngle);
  const pixW = d * params.pixAspect;
  const pixRound = params.pixRound / 100;

  // 点の生成条件が変わったら再生成
  if (makePointsKey() !== pointsKey) {
    generatePoints();
  }

  // 背景は白
  background(255);

  // 文字の塗りはなし。白いタイルを DIFFERENCE で重ねる
  blendMode(DIFFERENCE);
  fill(255);
  noStroke();

  for (const pix of computePix()) {
    push();
    translate(pix.x, pix.y);
    rotate(pixAngle);
    drawPix(pixW, d, pixRound);
    pop();
  }
  blendMode(BLEND);
  updateBrushCursor();
}

// === SVG 書き出し ===
// 白背景に白タイルを DIFFERENCE で重ねる見た目は、奇数回重なった所だけ黒になる（XOR）。
// 全タイルを1つのパスにまとめて fill-rule="evenodd" にすると、同じ結果をベクターで再現できる。
function pixPathData(cx, cy, w, h, t, angleDeg) {
  const a = radians(angleDeg), cos = Math.cos(a), sin = Math.sin(a);
  const hw = w / 2, hh = h / 2;
  const rx = hw * t, ry = hh * t;
  const ix = hw - rx, iy = hh - ry;
  const P = (x, y) => `${(cx + x * cos - y * sin).toFixed(2)} ${(cy + x * sin + y * cos).toFixed(2)}`;
  const corner = (x, y) => (rx > 0 && ry > 0)
    ? `A${rx.toFixed(2)} ${ry.toFixed(2)} ${angleDeg} 0 1 ${P(x, y)}`
    : `L${P(x, y)}`;
  // 右辺の下端から時計回り（画面座標）。各角は楕円弧
  return `M${P(hw, iy)}` + corner(ix, hh) + `L${P(-ix, hh)}` + corner(-hw, iy)
    + `L${P(-hw, -iy)}` + corner(-ix, -hh) + `L${P(ix, -hh)}` + corner(hw, -iy) + 'Z';
}

function exportSVG() {
  const d = params.circleSize;
  const w = d * params.pixAspect;
  const t = params.pixRound / 100;
  const paths = computePix().map(tl => pixPathData(tl.x, tl.y, w, d, t, params.pixAngle)).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
    + `<rect width="${width}" height="${height}" fill="#fff"/>\n`
    + `<path fill="#000" fill-rule="evenodd" d="${paths}"/>\n</svg>\n`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'exclude-overlap.svg';
  link.click();
  URL.revokeObjectURL(url);
}
