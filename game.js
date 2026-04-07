const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const finalScoreEl = document.getElementById('finalScore');
const shareXBtn = document.getElementById('shareX');
const fartSound = new Audio('assets/fart.mp3');

const TARGET_MS = 1000 / 60; // 16.667ms — baseline frame time at 60fps
let lastTime = 0;

// Fixed internal resolution — CSS handles visual scaling.
// All gameplay calculations use this fixed coordinate system.
const BASE_W = 800;
const BASE_H = 450;
canvas.width = BASE_W;
canvas.height = BASE_H;

// Prevent touch scrolling on mobile when interacting with canvas
document.addEventListener('touchmove', function(e) {
  if (e.target === canvas || canvas.contains(e.target)) e.preventDefault();
}, { passive: false });

let game;
function resetGame(){
  game = {
    running:false,
    over:false,
    t:0,
    score:0,
    spawnTick:0,
    ground:canvas.height - 48,
    shakeFrames:0,
    shakeIntensity:0,
    nearMissCooldown:0,
    floatingTexts:[],
    trailParticles:[],
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
  {name:'apple', color:'#ff4d4d', leaf:'#46c768'},
  {name:'pineapple', color:'#f8cb39', leaf:'#46c768'}
];

const rand = (a, b) => Math.random() * (b - a) + a;

function addFloatingText(x, y, text, color = '#ffd666', size = 18) {
  game.floatingTexts.push({ x, y, text, color, size, life: 50, vy: -1.6 });
}

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
`I just escaped fruit jail with a score of ${Math.floor(game.score)} 🍉💨

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

function nearMissTest(player, obstacle) {
  const margin = 18;
  const expanded = {x:obstacle.x - margin, y:obstacle.y - margin, w:obstacle.w + margin*2, h:obstacle.h + margin*2};
  const hitbox = {x:player.x+6, y:player.y+4, w:player.w-12, h:player.h-10};
  return rectsIntersect(hitbox, expanded);
}

function drawFruitOfficer(o){
  const cx = o.x + o.w/2;
  const cy = o.y + o.h/2 - 6;
  ctx.save();
  // Body at 2x original base: radii 48×56 (was 24×28 original, 36×42 previous)
  ctx.fillStyle = o.fruit.color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 48, 56, 0, 0, Math.PI*2);
  ctx.fill();

  if(o.fruit.name === 'pineapple'){
    ctx.strokeStyle = '#d7a62b';
    ctx.lineWidth = 3;
    for(let i=-19;i<=19;i+=13){
      ctx.beginPath(); ctx.moveTo(cx+i, cy-36); ctx.lineTo(cx+i+12, cy+36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx+i, cy+36); ctx.lineTo(cx+i+12, cy-36); ctx.stroke();
    }
  }
  if(o.fruit.name === 'apple'){
    ctx.fillStyle = '#ffd8d8';
    ctx.beginPath(); ctx.arc(cx-16, cy+4, 6, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx+16, cy+4, 6, 0, Math.PI*2); ctx.fill();
  }
  ctx.fillStyle = o.fruit.leaf;
  ctx.beginPath();
  ctx.moveTo(cx, cy-64);
  ctx.lineTo(cx-24, cy-84);
  ctx.lineTo(cx-4, cy-48);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx, cy-64);
  ctx.lineTo(cx+24, cy-84);
  ctx.lineTo(cx+4, cy-48);
  ctx.fill();

  ctx.fillStyle = '#111';
  ctx.beginPath(); ctx.arc(cx-14, cy-12, 5, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx+14, cy-12, 5, 0, Math.PI*2); ctx.fill();
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy+8, 14, 0.15*Math.PI, 0.85*Math.PI); ctx.stroke();

  ctx.fillStyle = '#20365c';
  ctx.fillRect(cx-36, cy-68, 72, 16);
  ctx.fillRect(cx-20, cy-84, 40, 19);
  ctx.fillStyle = '#ffd24d';
  ctx.fillRect(cx-8, cy-76, 16, 8);

  ctx.strokeStyle = '#f0d0ad';
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(cx-40, cy+4); ctx.lineTo(cx-64, cy+12); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+40, cy+4); ctx.lineTo(cx+64, cy+12); ctx.stroke();

  ctx.beginPath(); ctx.moveTo(cx-16, cy+56); ctx.lineTo(cx-20, cy+80); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+16, cy+56); ctx.lineTo(cx+20, cy+80); ctx.stroke();

  ctx.strokeStyle = '#111';
  ctx.beginPath(); ctx.moveTo(cx-28, cy+80); ctx.lineTo(cx-8, cy+80); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx+8, cy+80); ctx.lineTo(cx+28, cy+80); ctx.stroke();
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

function drawTrailParticles(){
  for(const p of game.trailParticles){
    ctx.fillStyle = `rgba(145,255,159,${Math.max(0,p.life/20)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
    ctx.fill();
  }
}

function drawFloatingTexts(){
  for(const ft of game.floatingTexts){
    const alpha = Math.min(1, ft.life / 18);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ft.color;
    ctx.font = `900 ${ft.size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.globalAlpha = 1;
  }
}

function update(now){
  requestAnimationFrame(update);

  // Calculate delta-time factor: 1.0 at 60fps, 2.0 at 30fps, etc.
  if(!lastTime) lastTime = now;
  const elapsed = now - lastTime;
  lastTime = now;
  // Clamp dt to avoid spiral of death on tab-switch or huge lag spikes
  const dt = Math.min(elapsed / TARGET_MS, 3);

  ctx.clearRect(0,0,canvas.width,canvas.height);

  ctx.save();
  // Screen shake
  if(game.shakeFrames > 0){
    game.shakeFrames -= dt;
    const intensity = game.shakeIntensity * (Math.max(0, game.shakeFrames) / 16);
    ctx.translate(rand(-intensity, intensity), rand(-intensity, intensity));
  }

  ctx.fillStyle = '#2a2145';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<6;i++){
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, 70 + i*120, canvas.width, 4);
  }
  ctx.fillStyle = '#1b152d';
  ctx.fillRect(0, game.ground, canvas.width, canvas.height - game.ground);

  if(game.running && !game.over){
    game.t += dt;
    game.spawnTick += dt;
    game.nearMissCooldown = Math.max(0, game.nearMissCooldown - dt);
    if(game.spawnTick > 82){
      spawnPair();
      game.spawnTick = 0;
    }
    game.player.vy += 0.38 * dt;
    game.player.y += game.player.vy * dt;

    // Trail particles (spawn roughly every 3 ticks at 60fps)
    if(Math.floor(game.t) % 3 === 0 && Math.floor(game.t - dt) % 3 !== 0){
      game.trailParticles.push({
        x: game.player.x - 6,
        y: game.player.y + game.player.h/2 + rand(-3, 3),
        size: rand(2, 4),
        life: rand(12, 20)
      });
    }
  }

  // Update trail particles
  for(let i=game.trailParticles.length-1;i>=0;i--){
    const p = game.trailParticles[i];
    p.x -= 1.2 * dt;
    p.life -= dt;
    p.size *= Math.pow(0.96, dt);
    if(p.life <= 0) game.trailParticles.splice(i,1);
  }
  drawTrailParticles();

  for(let i=game.particles.length-1;i>=0;i--){
    const p = game.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    p.size *= Math.pow(0.97, dt);
    if(p.life <= 0) game.particles.splice(i,1);
  }
  drawParticles();

  // Update floating texts
  for(let i=game.floatingTexts.length-1;i>=0;i--){
    const ft = game.floatingTexts[i];
    ft.y += ft.vy * dt;
    ft.life -= dt;
    if(ft.life <= 0) game.floatingTexts.splice(i,1);
  }

  for(let i=game.obstacles.length-1;i>=0;i--){
    const o = game.obstacles[i];
    if(game.running && !game.over) o.x -= 3.3 * dt;
    drawFruitOfficer(o);

    if(!o.passed && o.x + o.w < game.player.x){
      o.passed = true;
      game.score += 1;
      scoreEl.textContent = Math.floor(game.score);
      addFloatingText(game.player.x + 30, game.player.y - 10, '+1', '#91ff9f', 16);
      const best = Math.max(game.score, parseInt(localStorage.getItem('watermelina_best') || '0', 10));
      localStorage.setItem('watermelina_best', best);
      bestEl.textContent = Math.floor(best);
    }

    if(o.x + o.w < -20) game.obstacles.splice(i,1);

    const hitboxPlayer = {x:game.player.x+6, y:game.player.y+4, w:game.player.w-12, h:game.player.h-10};
    const hitboxFruit = {x:o.x+4, y:o.y+4, w:o.w-8, h:o.h-8};
    if(!game.over && rectsIntersect(hitboxPlayer, hitboxFruit)){
      endGame();
    }

    // Near-miss detection
    if(!game.over && game.running && !o.nearMissed && game.nearMissCooldown === 0
       && !rectsIntersect(hitboxPlayer, hitboxFruit) && nearMissTest(game.player, o)){
      o.nearMissed = true;
      game.nearMissCooldown = 25;
      game.score += 2;
      scoreEl.textContent = Math.floor(game.score);
      addFloatingText(game.player.x + 35, game.player.y - 20, 'CLOSE! +2', '#ff7ca3', 17);
    }
  }

  drawWatermelina();
  drawFloatingTexts();

  if(!game.over && (game.player.y < 0 || game.player.y + game.player.h > game.ground)){
    endGame();
  }

  ctx.restore();
}

function endGame(){
  game.over = true;
  game.running = false;
  game.shakeFrames = 16;
  game.shakeIntensity = 10;
  finalScoreEl.textContent = `Final score: ${Math.floor(game.score)}`;
  overlay.classList.remove('hidden');
  startBtn.style.display = 'none';
  restartBtn.style.display = 'inline-block';

  // Award points for finishing a game run
  (async () => {
    try {
      const wmUserId = localStorage.getItem("wm_user_id");
      console.log("GAME REWARD INSERT START", wmUserId);
      const { data, error } = await window.supabaseClient.from("point_events").insert([
        {
          user_id: wmUserId,
          event_type: "game_reward",
          points: 300,
          metadata: { reason: "finished_game" }
        }
      ]);
      console.log("GAME REWARD INSERT RESULT", { data, error });
    } catch (err) {
      console.error("game_reward insert failed", err);
    }
  })();
}

requestAnimationFrame(update);
