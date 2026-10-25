// noprotect
P5Capture.setDefaultOptions({ format: "png", framerate: 30, disableUi: true });

// --- キャンバスサイズ ---
const INITIAL_W = 630;
const INITIAL_H = 891;

let myFont;
let fontPoints = [];
let movingPoints = []; // 各ピクセルの軌道情報を保持
let currentSampleFactor = 0.05;

// === 描画するテキストとサイズ ===
let myText = "a";
let fontSize = 700; // キャンバスサイズ(400x400)に合わせて調整

// フォントポイントを生成（sampleFactor 変更時に再実行）
function generatePoints(sf) {
  currentSampleFactor = sf;
  
  // 1. テキストの実際の幅と高さを測る
  let bounds = myFont.textBounds(myText, 0, 0, fontSize);
  
  // 2. 画面のど真ん中に来るように開始座標(x, y)を逆算する
  let startX = width / 2 - bounds.w / 2 - bounds.x;
  let startY = height / 2 - bounds.h / 2 - bounds.y;

  // 3. 計算した座標を使ってパス（点）を生成
  fontPoints = myFont.textToPoints(myText, startX, startY, fontSize, {
    sampleFactor: sf,
    simplifyThreshold: 0
  });

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
  generatePoints(params.count / 100);

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

function draw() {
  // GUI（Tweakpane）のパラメータを取得
  let d = params.circleSize;
  let sf = params.count / 100;
  let seed = params.seed;
  let jitter = params.jitter;
  let hScale = params.hScale / 100;
  let tileAngle = radians(params.tileAngle);
  let tileAspect = params.tileAspect;
  let tileW = d * tileAspect;
  let tileRound = params.tileRound / 100;

  // sampleFactor が変わったら再生成
  if (Math.abs(sf - currentSampleFactor) > 0.0001) {
    generatePoints(sf);
  }

  // 背景は白
  background(255);
  blendMode(BLEND);

  // 3. 文字の塗りはなし（円のみ描画）

  // 4. ブレンドモードを DIFFERENCE に変更
  blendMode(DIFFERENCE);

  // 5. 白色で輪郭に沿って矩形を描画
  fill(255);
  noStroke();
  rectMode(CENTER);

  // 疎密パラメータ
  let densityScale = params.densityScale / 100;
  let densityContrast = params.densityContrast / 100;

  // === 描画（疎密フィルタはここだけ） ===
  // シードを再セット（疎密・ジッターの再現性のため）
  randomSeed(seed);
  noiseSeed(seed);

  for (let i = 0; i < movingPoints.length; i++) {
    let pt = movingPoints[i];

    // 疎密判定
    let t = i / movingPoints.length;
    let noiseVal = noise(t * densityScale * 20);
    let threshold = densityContrast * (1 - noiseVal);
    if (random(1) < threshold) continue;

    // ジッター（シード固定なので毎フレーム同じ値）
    let offsetX = random(-jitter, jitter);
    let offsetY = random(-jitter, jitter);

    // 描画座標（元の位置）
    let px = pt.origin.x;
    let py = pt.origin.y;

    // 長体に合わせて x 座標をスケール
    let drawX = width / 2 + (px - width / 2) * hScale;

    push();
    translate(drawX + offsetX, py + offsetY);
    rotate(tileAngle);
    drawTile(tileW, d, tileRound);
    pop();
  }
  blendMode(BLEND);
}
