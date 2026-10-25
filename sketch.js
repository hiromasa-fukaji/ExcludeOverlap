// noprotect
P5Capture.setDefaultOptions({ format: "png", framerate: 30, disableUi: true });

// --- キャンバスサイズ ---
const INITIAL_W = 630;
const INITIAL_H = 891;

let myFont;
let fontPoints = [];
let movingPoints = []; // 各ピクセルの軌道情報を保持
let pointsKey = ''; // 点の生成条件。変わったら再生成する

// === マウスドラッグの軌跡 ===
let trailPoints = [];   // 軌跡上のタイル位置 {x, y}
let lastTrailPt = null; // 直前に置いたタイルの位置（ストロークごとにリセット）
let isDragging = false; // キャンバス上で押下中か
let brushCells = new Set(); // ブラシで塗り済みのセル

function clearTrail() {
  trailPoints = [];
  brushCells.clear();
  lastTrailPt = null;
}

function insideCanvas() {
  return mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
}

// ブラシ（fill モード）: 中心(x,y)・半径 brushSize/2 の円内にあるセル中心にタイルを置く
// セル中心は step/2 + k*step（generateFillPoints と同じ格子）
function paintBrush(x, y) {
  const step = params.gridStep;
  const r = params.brushSize / 2;
  const kx0 = Math.ceil((x - r - step / 2) / step);
  const kx1 = Math.floor((x + r - step / 2) / step);
  const ky0 = Math.ceil((y - r - step / 2) / step);
  const ky1 = Math.floor((y + r - step / 2) / step);
  for (let ky = ky0; ky <= ky1; ky++) {
    for (let kx = kx0; kx <= kx1; kx++) {
      const cx = step / 2 + kx * step, cy = step / 2 + ky * step;
      if (cx < 0 || cx > width || cy < 0 || cy > height) continue;
      if (Math.hypot(cx - x, cy - y) > r) continue;
      const key = `${step}:${kx},${ky}`; // 同じセルに重複して置かない
      if (brushCells.has(key)) continue;
      brushCells.add(key);
      trailPoints.push({ x: cx, y: cy });
    }
  }
}

// 前回位置から現在位置まで、取りこぼしがないよう細かく補間してブラシを当てる
function paintBrushTo(x, y) {
  const spacing = Math.max(1, Math.min(params.gridStep, params.brushSize / 2) / 2);
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
  lastTrailPt = { x: mouseX, y: mouseY };
  if (params.trailMode === 'fill') {
    paintBrush(mouseX, mouseY);
  } else {
    trailPoints.push(lastTrailPt);
  }
}

function mouseDragged() {
  if (!isDragging) return;
  if (params.trailMode === 'fill') {
    paintBrushTo(mouseX, mouseY);
    return;
  }
  // 前回の位置から現在位置まで、spacing ごとにタイルを補間して置く
  const spacing = Math.max(1, params.trailSpacing);
  let dx = mouseX - lastTrailPt.x;
  let dy = mouseY - lastTrailPt.y;
  let dist = Math.hypot(dx, dy);
  while (dist >= spacing) {
    const k = spacing / dist;
    lastTrailPt = { x: lastTrailPt.x + dx * k, y: lastTrailPt.y + dy * k };
    trailPoints.push(lastTrailPt);
    dx = mouseX - lastTrailPt.x;
    dy = mouseY - lastTrailPt.y;
    dist = Math.hypot(dx, dy);
  }
}

function mouseReleased() {
  isDragging = false;
}

// === 描画するテキストとサイズ ===
let myText = "a";
let fontSize = 700; // キャンバスサイズ(400x400)に合わせて調整

// 現在のパラメータから点の生成条件を表すキーを作る
function makePointsKey() {
  return params.mode === 'fill'
    ? `fill:${params.gridStep}`
    : `outline:${params.count}`;
}

// 文字の塗りつぶしをスキャンして、グリッド状の点を作る
function generateFillPoints(startX, startY) {
  const step = params.gridStep;
  const g = createGraphics(width, height);
  g.pixelDensity(1);
  g.background(255);
  g.fill(0);
  g.noStroke();
  g.textFont(myFont);
  g.textSize(fontSize);
  g.text(myText, startX, startY);
  g.loadPixels();

  const pts = [];
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      // セル中心のピクセルが暗ければ文字の内側
      const idx = (Math.floor(y) * width + Math.floor(x)) * 4;
      if (g.pixels[idx] < 128) pts.push({ x, y });
    }
  }
  g.remove();
  return pts;
}

// 点を生成（モード・円の数・グリッド解像度の変更時に再実行）
function generatePoints() {
  pointsKey = makePointsKey();

  // 1. テキストの実際の幅と高さを測る
  let bounds = myFont.textBounds(myText, 0, 0, fontSize);
  
  // 2. 画面のど真ん中に来るように開始座標(x, y)を逆算する
  let startX = width / 2 - bounds.w / 2 - bounds.x;
  let startY = height / 2 - bounds.h / 2 - bounds.y;

  // 3. 計算した座標を使ってパス（点）を生成
  if (params.mode === 'fill') {
    fontPoints = generateFillPoints(startX, startY);
  } else {
    fontPoints = myFont.textToPoints(myText, startX, startY, fontSize, {
      sampleFactor: params.count / 100,
      simplifyThreshold: 0
    });
  }

  // movingPoints を再構築
  movingPoints = fontPoints.map(p => ({
    origin: createVector(p.x, p.y)        // 元の位置
  }));
}

// 1. フォントファイルを読み込む
function preload() {
  myFont = loadFont('CormorantGaramond-SemiBold.ttf');
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
function drawTile(w, h, t) {
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

// 描画するタイルの中心位置を全て計算する（輪郭/塗りつぶし + ドラッグの軌跡）
function computeTiles() {
  const jitter = params.jitter;
  const hScale = params.hScale / 100;
  const densityScale = params.densityScale / 100;
  const densityContrast = params.densityContrast / 100;
  const tiles = [];

  // シードを再セット（疎密・ジッターの再現性のため）
  randomSeed(params.seed);
  noiseSeed(params.seed);

  for (let i = 0; i < movingPoints.length; i++) {
    const pt = movingPoints[i];

    // 疎密判定（疎密フィルタはここだけ）
    const t = i / movingPoints.length;
    const noiseVal = noise(t * densityScale * 20);
    const threshold = densityContrast * (1 - noiseVal);
    if (random(1) < threshold) continue;

    // ジッター（シード固定なので毎フレーム同じ値）
    const offsetX = random(-jitter, jitter);
    const offsetY = random(-jitter, jitter);

    // 長体に合わせて x 座標をスケール
    const drawX = width / 2 + (pt.origin.x - width / 2) * hScale;
    tiles.push({ x: drawX + offsetX, y: pt.origin.y + offsetY });
  }

  // マウスドラッグの軌跡にも同じタイルを置く
  for (const tp of trailPoints) tiles.push(tp);
  return tiles;
}

function draw() {
  // GUI（Tweakpane）のパラメータを取得
  const d = params.circleSize;
  const tileAngle = radians(params.tileAngle);
  const tileW = d * params.tileAspect;
  const tileRound = params.tileRound / 100;

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

  for (const tile of computeTiles()) {
    push();
    translate(tile.x, tile.y);
    rotate(tileAngle);
    drawTile(tileW, d, tileRound);
    pop();
  }
  blendMode(BLEND);
  updateBrushCursor();
}

// === SVG 書き出し ===
// 白背景に白タイルを DIFFERENCE で重ねる見た目は、奇数回重なった所だけ黒になる（XOR）。
// 全タイルを1つのパスにまとめて fill-rule="evenodd" にすると、同じ結果をベクターで再現できる。
function tilePathData(cx, cy, w, h, t, angleDeg) {
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
  const w = d * params.tileAspect;
  const t = params.tileRound / 100;
  const paths = computeTiles().map(tl => tilePathData(tl.x, tl.y, w, d, t, params.tileAngle)).join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n`
    + `<rect width="${width}" height="${height}" fill="#fff"/>\n`
    + `<path fill="#000" fill-rule="evenodd" d="${paths}"/>\n</svg>\n`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'difference-ellipses.svg';
  link.click();
  URL.revokeObjectURL(url);
}
