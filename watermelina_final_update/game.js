const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const finalScoreEl = document.getElementById('finalScore');
const shareXBtn = document.getElementById('shareX');
const fartSound = new Audio('assets/fart.wav');

function fitCanvas(){
  const maxW = Math.min(window.innerWidth - 36, 720);
  canvas.width = maxW;
  canvas.height = Math.round(maxW * 1.45);
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

let game;
function resetGame(){
  game = {
    running:false,
    over:false,
    t:0,
    score:0,
    spawnTick:0,
    ground:canvas.height - 48,
    player:{
      x:100,
      y:canvas.height/2,
      w:46,
      h:58,
      vy:0
    },
    obstacles:[],
    particles:[]
  };
  scoreEl.textContent = '0';
  bestEl.textContent = localStorage.getItem('watermelina_best') || '0';
}
resetGame();

const fruits = [
  {name:'orange', color:'#ff9b2f', leaf:'#46c768'},
  {name:'pineapple', color:'#f8cb39', leaf:'#46c768'},
  {name:'apple', color:'#ff4d4d', leaf:'#46c768'},
  {name:'strawberry', color:'#ff4078', leaf:'#46c768'}
];

function addParticles(){
  for(let i=0;i<10;i++){
    game.particles.push({
      x: game.player.x - 10,
      y: game.player.y + 20,
      vx: -Math.random()*3 - 1,
      vy: (Math.random()-0.5)*2,
      life: 26 + Math.random()*14,
      size: 6 + Math.random()*6
    });
  }
}

function playFart(){
  const s = fartSound.cloneNode();
  s.volume = 0.95;
  s.play().catch(()=>{});
}

function fartFly(){
  if(!game.running && !game.over){
    game.running = true;
    overlay.classList.add('hidden');
  }
  if(game.over) return;
  game.player.vy = -7.2;
  addParticles();
  playFart();
}

document.addEventListener('keydown', e => {
  if(e.code === 'Space'){
    e.preventDefault();
    fartFly();
  }
});
canvas.addEventListener('pointerdown', fartFly);
startBtn.addEventListener('click', fartFly);
restartBtn.addEventListener('click', ()=>{
  resetGame();
  overlay.classList.remove('hidden');
  startBtn.style.display = 'inline-block';
  restartBtn.style.display = 'none';
  finalScoreEl.textContent = '';
});
shareXBtn.addEventListener('click', ()=>{
  const shareUrl = window.location.href;
  const txt = encodeURIComponent(
`I just escaped fruit jail with a score of ${game.score} 🍉💨

Can you beat my score?

Play Watermelina:
${shareUrl}`
  );
  window.open(`https://x.com/intent/tweet?text=${txt}`, '_blank');
});

function spawnPair(){
  const gap = Math.max(190, 220 - Math.min(game.score * 2, 20));
  const topHeight = 90 + Math.random()*(canvas.height - 360);
  const bottomY = topHeight + gap;
  const x = canvas.width + 80;
  const topFruit = fruits[Math.floor(Math.random()*fruits.length)];
  let bottomFruit = fruits[Math.floor(Math.random()*fruits.length)];
  game.obstacles.push(
    {x, y:topHeight-88, w:76, h:88, fruit:topFruit, passed:false},
    {x, y:bottomY, w:76, h:88, fruit:bottomFruit, passed:true}
  );
}

function rectsIntersect(a, b){
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function drawFruitOfficer(o){
  const cx = o.x + o.w/2;
  const cy = o.y + o.h/2 - 6;
  ctx.save();
  ctx.fillStyle = o.fruit.color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 24, 28, 0, 0, Math.PI*2);
  ctx.fill();

  if(o.fruit.name === 'orange'){
    ctx.strokeStyle = '#ffb865';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 16, 0, Math.PI*2); ctx.stroke();
  }
  if(o.fruit.name === 'pineapple'){
    ctx.fillStyle = '#d7a62b';
    for(let i=-12;i<=12;i+=8){
      ctx.fillRect(cx+i, cy-18, 2, 36);
    }
  }
  if(o.fruit.name === 'apple'){
    ctx.fillStyle = '#ffd8d8';
    ctx.beginPath(); ctx.arc(cx-8, cy+2, 3, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+8, cy+2, 3, 0, Math.PI*2); ctx.fill();
  }
  if(o.fruit.name === 'strawberry'){
    ctx.fillStyle = '#ffe28f';
    for(let i=0;i<8;i++){
      ctx.beginPath();
      ctx.arc(cx-14 + i*4, cy + ((i%2)*8)-4, 1.6, 0, Math.PI*2);
      ctx.fill();
    }
  }

  ctx.fillStyle = o.fruit.leaf;
  ctx.beginPath();
  ctx.moveTo(cx, cy-32);
  ctx.lineTo(cx-12, cy-42);
  ctx.lineTo(cx-2, cy-24);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy-32);
  ctx.lineTo(cx+12, cy-42);
  ctx.lineTo(cx+2, cy-24);
  ctx.fill();

  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(cx-7, cy-6, 2.5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+7, cy-6, 2.5, 0, Math.PI*2); ctx.fill();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy+4, 7, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke();

  ctx.fillStyle = '#20365c';
  ctx.fillRect(cx-18, cy-34, 36, 8);
  ctx.fillRect(cx-10, cy-42, 20, 10);
  ctx.fillStyle = '#ffd24d';
  ctx.fillRect(cx-4, cy-38, 8, 4);

  ctx.strokeStyle = '#f0d0ad';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx-20, cy+2); ctx.lineTo(cx-34, cy+6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+20, cy+2); ctx.lineTo(cx+34, cy+6); ctx.stroke();

  ctx.beginPath(); ctx.moveTo(cx-8, cy+28); ctx.lineTo(cx-10, cy+42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+8, cy+28); ctx.lineTo(cx+10, cy+42); ctx.stroke();

  ctx.strokeStyle = '#111';
  ctx.beginPath(); ctx.moveTo(cx-14, cy+42); ctx.lineTo(cx-4, cy+42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+4, cy+42); ctx.lineTo(cx+14, cy+42); ctx.stroke();
  ctx.restore();
}

function drawWatermelina(){
  const p = game.player;
  const cx = p.x + p.w/2;
  const cy = p.y + p.h/2;
  ctx.save();
  ctx.fillStyle = '#33b45b';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 22, 28, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#ff6f8c';
  ctx.beginPath();
  ctx.ellipse(cx, cy+2, 15, 20, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(cx-6, cy-6, 2.7, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+6, cy-6, 2.7, 0, Math.PI*2); ctx.fill();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy+4, 7, 0.12*Math.PI, 0.9*Math.PI); ctx.stroke();

  ctx.strokeStyle = '#f0d0ad'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx-18, cy+2); ctx.lineTo(cx-30, cy+8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+18, cy+2); ctx.lineTo(cx+30, cy+8); ctx.stroke();

  ctx.beginPath(); ctx.moveTo(cx-8, cy+28); ctx.lineTo(cx-10, cy+42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+8, cy+28); ctx.lineTo(cx+10, cy+42); ctx.stroke();
  ctx.strokeStyle = '#111';
  ctx.beginPath(); ctx.moveTo(cx-14, cy+42); ctx.lineTo(cx-4, cy+42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+4, cy+42); ctx.lineTo(cx+14, cy+42); ctx.stroke();
  ctx.restore();
}

function drawParticles(){
  for(const p of game.particles){
    ctx.fillStyle = `rgba(124,255,124,${Math.max(0,p.life/40)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
    ctx.fill();
  }
}

function update(){
  requestAnimationFrame(update);
  ctx.clearRect(0,0,canvas.width,canvas.height);

  ctx.fillStyle = '#2a2145';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<6;i++){
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 70 + i*120, canvas.width, 4);
  }
  ctx.fillStyle = '#1b152d';
  ctx.fillRect(0, game.ground, canvas.width, canvas.height - game.ground);

  if(game.running && !game.over){
    game.t++;
    game.spawnTick++;
    if(game.spawnTick > 90){
      spawnPair();
      game.spawnTick = 0;
    }
    game.player.vy += 0.38;
    game.player.y += game.player.vy;
  }

  for(let i=game.particles.length-1;i>=0;i--){
    const p = game.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 1;
    p.size *= 0.97;
    if(p.life <= 0) game.particles.splice(i,1);
  }
  drawParticles();

  for(let i=game.obstacles.length-1;i>=0;i--){
    const o = game.obstacles[i];
    if(game.running && !game.over) o.x -= 3.3;
    drawFruitOfficer(o);

    if(!o.passed && o.x + o.w < game.player.x){
      o.passed = true;
      game.score += 1;
      scoreEl.textContent = game.score;
      const best = Math.max(game.score, parseInt(localStorage.getItem('watermelina_best') || '0', 10));
      localStorage.setItem('watermelina_best', best);
      bestEl.textContent = best;
    }

    if(o.x + o.w < -20) game.obstacles.splice(i,1);

    const hitboxPlayer = {x:game.player.x+6, y:game.player.y+4, w:game.player.w-12, h:game.player.h-10};
    const hitboxFruit = {x:o.x+4, y:o.y+4, w:o.w-8, h:o.h-8};
    if(!game.over && rectsIntersect(hitboxPlayer, hitboxFruit)){
      endGame();
    }
  }

  drawWatermelina();

  if(!game.over && (game.player.y < 0 || game.player.y + game.player.h > game.ground)){
    endGame();
  }
}

function endGame(){
  game.over = true;
  game.running = false;
  finalScoreEl.textContent = `Final score: ${game.score}`;
  overlay.classList.remove('hidden');
  startBtn.style.display = 'none';
  restartBtn.style.display = 'inline-block';
}

update();
