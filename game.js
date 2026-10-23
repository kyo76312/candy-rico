/* Candy Ricochet — all coordinates use the same 420 × 740 logical playfield. */
(() => {
'use strict';
const W=420,H=740,COLS=7,ROWS=6,CELL=50,BX=35,BY=112,PY=685,PADDLE_ZONE_TOP=600;
const BOARD_BOTTOM=BY+ROWS*CELL,BOARD_CEILING=BY+4;
const colors=['#ff759c','#ffc66b','#9d8cff','#65d9c5','#79bafa'];
const $=id=>document.getElementById(id),canvas=$('game'),ctx=canvas.getContext('2d');
const query=new URLSearchParams(window.location?.search||'');
const devMode=query.get('dev')==='1';
const requestedLevel=Number(query.get('level'));
const startingLevel=devMode&&Number.isSafeInteger(requestedLevel)&&requestedLevel>0?Math.min(999,requestedLevel):1;
const requestedSpeed=Number(query.get('speed'));
const devBallSpeed=devMode&&Number.isFinite(requestedSpeed)&&requestedSpeed>=50&&requestedSpeed<=1000?requestedSpeed:null;
let board=[],mode='ready',level=startingLevel,score=0,best=0,time=9,penalty=0,wide=0,settle=0,needsFall=false,hasMoves=true;
let paddle={x:210},balls=[],particles=[],selected=null,active=null,toastTime=0,resumeTime=0,resumeTo='playing';
let finishing=false,motion=null,drag=null,ghosts=[];
let wideScale=1.5;
let lives=devMode?3:1,reviving=false,milestoneMessage='';
let consecutiveTimeouts=0,lastLossReason='';
let shrinkScale=1;
const rewardedMilestones=new Set();
let elapsed=0,combo=0,comboTime=0,comboFlash=0,lastComboBonus=0,stats=null,clearSummary=null;
function resetStats(){elapsed=0;combo=0;comboTime=0;comboFlash=0;lastComboBonus=0;clearSummary=null;stats={base:0,combo:0,skill:0,clear:0,time:0,discipline:0,maxCombo:0,timeouts:0,revives:0};$('levelStats').hidden=true;}
function formatTime(seconds,roundUp=false){const n=roundUp?Math.ceil(Math.max(0,seconds-1e-7)):Math.floor(seconds);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function addScore(amount,category){score+=amount;if(stats)stats[category]+=amount;}
function clearLevel(){if(mode==='clear')return;mode='clear';combo=0;comboTime=0;comboFlash=0;addScore(500*level,'clear');addScore(Math.max(0,90-Math.ceil(Math.max(0,elapsed-1e-7)))*10,'time');if(stats.timeouts===0)addScore(300,'discipline');const total=stats.base+stats.combo+stats.skill+stats.clear+stats.time+stats.discipline;clearSummary={...stats,elapsed,total,cumulative:score};overlay('SWEET VICTORY',`第 ${level} 關完成！`,`本關耗時 ${formatTime(elapsed,true)} · 最佳 ${stats.maxCombo} COMBO`,'下一關','✧');const rows=[['消除得分',stats.base],['COMBO 獎勵',stats.combo],['技巧獎勵',stats.skill],['過關獎勵',stats.clear],['時間獎勵',stats.time],['零超時獎勵',stats.discipline],['本關復活次數',stats.revives],['本關合計',total],['累積總分',score]];$('levelStats').innerHTML=rows.map(([label,value])=>`<div><span>${label}</span><b>${value.toLocaleString()}</b></div>`).join('');$('levelStats').hidden=false;}
try{best=Number(localStorage.getItem('candy-ricochet-best'))||0;}catch{}
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
// Each group of five adds a shell; 15–19 mark infinite normal-ball durability.
const candyColor=c=>c===null?null:c%5;
const durability=c=>c===null?0:c>=15?'∞':Math.floor(c/5)+1;
function matches(b=board){const ids=new Set();let max=0,groups=0;for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){const c=candyColor(b[y][x]);if(c===null)continue;for(const [dx,dy]of [[1,0],[0,1]]){if(x-dx>=0&&y-dy>=0&&candyColor(b[y-dy][x-dx])===c)continue;let run=[];for(let i=x,j=y;i<COLS&&j<ROWS&&candyColor(b[j][i])===c;i+=dx,j+=dy)run.push(j*COLS+i);if(run.length>=3){run.forEach(n=>ids.add(n));max=Math.max(max,run.length);groups++;}}}return{ids:[...ids],max,groups};}
function swap(b,a,c){[b[a.y][a.x],b[c.y][c.x]]=[b[c.y][c.x],b[a.y][a.x]];}
function available(b=board){for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){if(b[y][x]===null)continue;for(const [dx,dy]of [[1,0],[0,1]]){const a={x,y},c={x:x+dx,y:y+dy};if(c.x>=COLS||c.y>=ROWS||b[c.y][c.x]===null)continue;swap(b,a,c);const m=matches(b);swap(b,a,c);if(m.ids.includes(y*COLS+x)||m.ids.includes(c.y*COLS+c.x))return true;}}return false;}
function freshBoard(){let b;do{b=Array.from({length:ROWS},()=>Array(COLS).fill(null));for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){let opts=[0,1,2,3,4].filter(c=>!(x>1&&b[y][x-1]===c&&b[y][x-2]===c)&&!(y>1&&b[y-1][x]===c&&b[y-2][x]===c));b[y][x]=opts[Math.floor(Math.random()*opts.length)];}}while(!available(b));return b;}
function notify(s){$('toast').textContent=s;toastTime=2.3;$('toast').classList.add('show');}
function tone(freq=440,d=.08){window.CandyAudio?.effect(freq,d);}
function width(){return Math.round(100*(wide>0?wideScale:shrinkScale));}
function constrain(){paddle.x=clamp(paddle.x,16+width()/2,W-16-width()/2);}
function ballSpeed(){return devBallSpeed??(level<=11?Math.round((139+(level-1)*26.1)*10)/10:400+(level-11)*10);}
function turnLimit(){return Math.max(5,9-(level-1)*.5);}
function roundLimit(){return Math.max(3,turnLimit()-2*consecutiveTimeouts);}
function resetTurn(){consecutiveTimeouts=0;time=turnLimit();penalty=0;shrinkScale=1;}
function timeout(){stats.timeouts++;consecutiveTimeouts=Math.min(2,consecutiveTimeouts+1);wide=0;penalty=consecutiveTimeouts;time=roundLimit();constrain();notify(consecutiveTimeouts===1?`第一次超時 · 每秒縮短 10% · 下一輪 ${+time.toFixed(1)} 秒`:`超時 · 每秒縮短 15% · ${+time.toFixed(1)} 秒內三消即可恢復`);tone(consecutiveTimeouts===2?180:220,.18);}
function coatBoard(){board=board.map(row=>row.map(c=>c===null?null:candyColor(c)+(level>=11?15:10)));}
function shuffleBoard(randomAttempts=120){
  const values=board.flat().filter(c=>c!==null),cells=[];
  // Pack rows from the bottom so isolated columns can become playable again.
  for(let y=ROWS-1;y>=0;y--)for(let x=0;x<COLS&&cells.length<values.length;x++)cells.push({x,y});
  const blank=()=>Array.from({length:ROWS},()=>Array(COLS).fill(null));
  const accept=b=>{board=b;cancelDrag();active=null;selected=null;for(const ball of balls)ball.contactCells=[];notify('沒有可用三消 · 重新洗牌，耐久與倒數保留');tone(620,.12);return true;};
  for(let attempt=0;attempt<randomAttempts;attempt++){
    const bag=values.slice();for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
    const b=blank();cells.forEach(({x,y},i)=>b[y][x]=bag[i]);
    if(!matches(b).ids.length&&available(b))return accept(b);
  }
  // Exact fallback: reserve a possible three-match swap, then place the remaining
  // color counts without existing matches. Shells travel with their original candy.
  const pools=colors.map((_,color)=>values.filter(c=>candyColor(c)===color));
  const occupied=new Set(cells.map(c=>c.y*COLS+c.x));
  const fits=(b,x,y,color)=>{for(const [dx,dy]of [[1,0],[0,1]])for(let k=-2;k<=0;k++){let run=true;for(let i=0;i<3;i++){const xx=x+(k+i)*dx,yy=y+(k+i)*dy;if(xx<0||xx>=COLS||yy<0||yy>=ROWS||(xx===x&&yy===y?color:b[yy][xx])!==color){run=false;break;}}if(run)return false;}return true;};
  const solve=(b,counts)=>{
    let chosen=null,options=null;const capacity=Array(5).fill(0);
    for(const c of cells){if(b[c.y][c.x]!==null)continue;const opts=counts.map((n,color)=>n>0&&fits(b,c.x,c.y,color)?color:-1).filter(c=>c>=0);if(!opts.length)return false;opts.forEach(c=>capacity[c]++);if(!options||opts.length<options.length){chosen=c;options=opts;}}
    if(!chosen)return true;if(counts.some((n,c)=>n>capacity[c]))return false;
    options.sort((a,c)=>counts[c]-counts[a]);for(const color of options){b[chosen.y][chosen.x]=color;counts[color]--;if(solve(b,counts))return true;counts[color]++;b[chosen.y][chosen.x]=null;}return false;
  };
  for(let color=0;color<5;color++){if(pools[color].length<3)continue;for(let other=0;other<5;other++){if(other===color||!pools[other].length)continue;
    for(const origin of cells)for(const [dx,dy]of [[1,0],[0,1]]){
      const trio=Array.from({length:3},(_,i)=>({x:origin.x+i*dx,y:origin.y+i*dy}));if(trio.some(c=>c.x>=COLS||c.y>=ROWS||!occupied.has(c.y*COLS+c.x)))continue;
      for(const target of trio)for(const [sx,sy]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const source={x:target.x+sx,y:target.y+sy};if(source.x<0||source.x>=COLS||source.y<0||source.y>=ROWS||!occupied.has(source.y*COLS+source.x)||trio.some(c=>c.x===source.x&&c.y===source.y))continue;
        const b=blank(),counts=pools.map(p=>p.length);for(const c of trio)b[c.y][c.x]=c===target?other:color;b[source.y][source.x]=color;counts[color]-=3;counts[other]--;
        if(matches(b).ids.length||!solve(b,counts))continue;
        const remaining=pools.map(p=>p.slice());for(const c of cells)b[c.y][c.x]=remaining[b[c.y][c.x]].pop();
        if(available(b))return accept(b);
      }
    }
  }}return false;
}
function makeBall(x,y,angle,speed=ballSpeed()){return{x,y,vx:Math.sin(angle)*speed,vy:-Math.cos(angle)*speed,trail:[]};}
function launch(){paddle.x=210;balls=[makeBall(210,PY-23,(Math.random()<.5?-1:1)*.377)];}
function rewardMilestone(){if(level%5!==0||rewardedMilestones.has(level))return;rewardedMilestones.add(level);const previous=lives;lives=Math.min(3,lives+1);milestoneMessage=`第 ${level} 關達成 · ${lives>previous?'生命 +1':'生命已滿'}`;window.CandyAudio?.lifeReward();}
function loadLevel(){resetStats();reviving=false;milestoneMessage='';lastLossReason='';board=freshBoard();coatBoard();resetTurn();wide=0;wideScale=1.5;settle=0;needsFall=false;hasMoves=true;finishing=false;motion=null;drag=null;ghosts=[];particles=[];selected=null;active=null;launch();rewardMilestone();}
function overlay(tag,title,text,button,icon='✦',secondary=false){cancelDrag();active=null;selected=null;$('levelStats').hidden=true;$('overlay').classList.toggle('results',mode==='clear');$('overlay').hidden=false;$('modalTag').textContent=tag;$('modalTitle').textContent=title;$('modalText').textContent=text;$('primary').innerHTML=button+' <span>↗</span>';$('modalIcon').textContent=icon;$('secondary').hidden=!secondary;window.CandyLeaderboard?.setGameView(mode);window.CandyAudio?.setScene(mode,finishing,ballSpeed());}
function beginRun(target){window.CandyAudio?.reset();window.CandyAudio?.unlock();window.CandyLeaderboard?.gameStart();level=target;score=0;lives=devMode?3:1;rewardedMilestones.clear();loadLevel();mode='countdown';resumeTime=3;resumeTo='playing';toastTime=0;$('toast').classList.remove('show');$('overlay').hidden=true;}
function start(){beginRun(startingLevel);}
function pause(){if(!['playing','countdown'].includes(mode))return;mode='paused';overlay('TAKE A BREATH','休息一下','準備好後繼續，倒數三秒再回到挑戰。','繼續遊戲','Ⅱ',true);}
function finish(reason='miss'){lastLossReason=reason;mode='over';combo=0;comboTime=0;comboFlash=0;if(!devMode&&score>best){best=score;try{localStorage.setItem('candy-ricochet-best',best);}catch{}}overlay('ONE MORE RICOCHET?','差一點，就接到了',`第 ${level} 關 · 得分 ${score.toLocaleString()}\n本關耗時 ${formatTime(elapsed,true)} · 最佳 ${stats.maxCombo} COMBO`,'再挑戰一次','♡');if(!devMode)window.CandyLeaderboard?.finish(score,level);tone(160,.3);}
function fillFinaleBalls(){const source=balls[0]||{x:paddle.x,y:PY-23};const missing=15-balls.length,speed=devBallSpeed??Math.max(ballSpeed(),170);for(let i=0;i<missing;i++){const spread=missing>1?i/(missing-1):.5;balls.push(makeBall(clamp(source.x+(spread-.5)*40,26,W-26),clamp(source.y,106,PY-22),-1.1+2.2*spread,speed));}}
function checkBoard(){const count=board.flat().filter(c=>c!==null).length;if(!count){clearLevel();return;}hasMoves=available();if(!finishing&&level>=6&&count>8&&!hasMoves)hasMoves=shuffleBoard();if((count<=8||!hasMoves)&&!finishing){finishing=true;resetTurn();constrain();fillFinaleBalls();notify('15 球貫穿！全部漏接扣一命 · 倒數暫停');tone(740,.18);}}
function loseLife(reason='miss'){if(mode!=='playing')return;lastLossReason=reason;lives=Math.max(0,lives-1);if(lives===0){finish(reason);return;}stats.revives++;combo=0;comboTime=0;comboFlash=0;lastComboBonus=0;resetTurn();wide=0;wideScale=1.5;const pendingFall=needsFall||motion?.kind==='fall';motion=null;settle=0;needsFall=pendingFall;ghosts=[];particles=[];cancelDrag();active=null;selected=null;launch();if(finishing)fillFinaleBalls();reviving=true;milestoneMessage='';mode='countdown';resumeTime=3;resumeTo='playing';$('overlay').hidden=true;toastTime=0;$('toast').classList.remove('show');window.CandyAudio?.setScene(mode,finishing,ballSpeed());tone(260,.16);}
function burst(x,y,c){for(let i=0;i<10;i++){const a=Math.random()*Math.PI*2,s=25+Math.random()*100;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.5+Math.random()*.3,c});}}
function busy(){return settle>0||motion!==null;}
function visualPosition(x,y){const item=motion?.kind==='fall'?motion.items.find(i=>i.x===x&&i.y===y):null;const t=item?Math.min(1,motion.elapsed/motion.duration):1;return{x:BX+x*CELL,y:BY+(item?item.fromY+(y-item.fromY)*t*t:y)*CELL};}
function remove(ids,points){cancelDrag();for(const n of ids){const y=Math.floor(n/COLS),x=n%COLS,c=board[y][x];if(c===null)continue;const p=visualPosition(x,y);ghosts.push({...p,c,life:.18});burst(p.x+25,p.y+25,colors[candyColor(c)]);board[y][x]=null;addScore(points,'base');}settle=Math.max(settle,.18);needsFall=true;selected=null;}
function fall(){cancelDrag();const items=[];for(let x=0;x<COLS;x++){const col=[];for(let y=0;y<ROWS;y++)if(board[y][x]!==null)col.push({c:board[y][x],fromY:y});for(let y=0;y<ROWS;y++){const item=col[y-(ROWS-col.length)];board[y][x]=item?item.c:null;if(item&&item.fromY!==y)items.push({x,y,fromY:item.fromY,c:item.c});}}needsFall=false;if(items.length)motion={kind:'fall',items,elapsed:0,duration:.26};else resolveBoard();}
function registerCombo(){combo=comboTime>0?combo+1:1;comboTime=5;comboFlash=1.8;lastComboBonus=Math.min(400,(combo-1)*100);stats.maxCombo=Math.max(stats.maxCombo,combo);addScore(lastComboBonus,'combo');window.CandyAudio?.combo(combo);}
function resolveBoard(){const m=matches();if(m.ids.length){registerCombo();remove(m.ids,60);notify(`掉落連鎖 · ${combo} COMBO${lastComboBonus?' · +'+lastComboBonus:''}`);}else checkBoard();}
function awardMatch(m){resetTurn();registerCombo();const skill=(m.max>=5?300:m.max>=4?150:0)+(m.groups>=2?200:0);addScore(skill,'skill');const extending=wide>0&&combo>1;if(m.max>=4){const base=m.max>=5?2:1.5;wideScale=wide>0?Math.min(2.5,Math.round(Math.max(base,wideScale+.2)*100)/100):base;wide=6;notify(`${m.max>=5?'五消':'四消'} · 橫桿 ${Math.round(wideScale*100)}% · 技巧 +${skill}`);}else{if(extending)wide=6;if(skill){notify(`雙重消除 · 技巧 +${skill}`);}else{notify(extending?'COMBO！加寬時間刷新為 6 秒':finishing?'三消成功 · 繼續15 球收尾':'三消成功 · 倒數重置');}}constrain();remove(m.ids,100);}
function validCell(c){return c&&c.x>=0&&c.x<COLS&&c.y>=0&&c.y<ROWS&&board[c.y][c.x]!==null;}
function adjacent(a,b){return Math.abs(a.x-b.x)+Math.abs(a.y-b.y)===1;}
function attempt(a,b,fromDrag=null){if(busy()||mode!=='playing'||!validCell(a)||!validCell(b)||!adjacent(a,b))return false;swap(board,a,b);const m=matches();swap(board,a,b);const valid=m.ids.includes(a.y*COLS+a.x)||m.ids.includes(b.y*COLS+b.x);motion={kind:'swap',a:{...a},b:{...b},ca:board[a.y][a.x],cb:board[b.y][b.x],offset:fromDrag?{x:fromDrag.dx,y:fromDrag.dy}:{x:0,y:0},valid,elapsed:0,duration:.16};selected=null;drag=null;return valid;}
function animate(dt){for(const g of ghosts)g.life-=dt;ghosts=ghosts.filter(g=>g.life>0);if(settle>0)settle=Math.max(0,settle-dt);if(motion){motion.elapsed+=dt;if(motion.elapsed<motion.duration)return;const done=motion;motion=null;if(done.kind==='swap'){if(done.valid){swap(board,done.a,done.b);awardMatch(matches());}else{motion={...done,kind:'return',elapsed:0,duration:.16};notify('沒有形成三消 · 糖果回到原位');}}else if(done.kind==='fall'&&!needsFall)resolveBoard();}if(!motion&&settle<=0&&needsFall)fall();}
function cancelDrag(){if(drag){if(active?.type==='candy')active.done=true;drag=null;}}
function cellAt(p){const x=Math.floor((p.x-BX)/CELL),y=Math.floor((p.y-BY)/CELL);return x>=0&&x<COLS&&y>=0&&y<ROWS?{x,y}:null;}
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height};}
canvas.addEventListener('pointerdown',e=>{e.preventDefault();if(mode!=='playing'||active!==null||e.button!==0)return;const p=point(e);if(p.y>=PADDLE_ZONE_TOP&&p.y<=H&&p.x>=0&&p.x<=W){active={id:e.pointerId,type:'paddle',lastX:p.x};selected=null;}else{const c=cellAt(p);if(!c||busy()||board[c.y][c.x]===null)return;active={id:e.pointerId,type:'candy',start:p,cell:c,done:false};if(selected&&adjacent(selected,c)){attempt(selected,c);selected=null;active.done=true;}else{selected=c;drag={cell:c,dx:0,dy:0,axis:null,target:null};}}canvas.setPointerCapture(e.pointerId);});
function movePointer(p){if(active.type==='paddle'){paddle.x+=p.x-active.lastX;active.lastX=p.x;constrain();}else if(!active.done&&drag&&!busy()){const dx=p.x-active.start.x,dy=p.y-active.start.y;if(!drag.axis&&Math.max(Math.abs(dx),Math.abs(dy))>4)drag.axis=Math.abs(dx)>Math.abs(dy)?'x':'y';if(drag.axis){const horizontal=drag.axis==='x',delta=horizontal?dx:dy;const b={x:drag.cell.x+(horizontal?Math.sign(delta):0),y:drag.cell.y+(horizontal?0:Math.sign(delta))};const valid=validCell(b);const displacement=clamp(delta,valid?-CELL:-10,valid?CELL:10);drag.dx=horizontal?displacement:0;drag.dy=horizontal?0:displacement;drag.target=valid?b:null;}}}
canvas.addEventListener('pointermove',e=>{if(!active||active.id!==e.pointerId||mode!=='playing')return;e.preventDefault();movePointer(point(e));});
function release(e,cancelled=false){if(active?.id!==e.pointerId)return;if(!cancelled&&mode==='playing')movePointer(point(e));const d=drag;if(active.type==='candy'&&!active.done&&d){if(!cancelled&&d.target&&Math.hypot(d.dx,d.dy)>=12){attempt(d.cell,d.target,d);selected=null;}else{if(Math.hypot(d.dx,d.dy)>1)motion={kind:'snap',cell:d.cell,c:board[d.cell.y][d.cell.x],offset:{x:d.dx,y:d.dy},elapsed:0,duration:.12};drag=null;if(cancelled)selected=null;}}active=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}
canvas.addEventListener('pointerup',e=>release(e));canvas.addEventListener('pointercancel',e=>release(e,true));canvas.addEventListener('lostpointercapture',e=>release(e,true));
$('retryLevel').onclick=()=>{if(devMode)beginRun(level);};
$('devTools').hidden=!devMode;
if(devMode){$('devStatus').textContent=`\u6e2c\u8a66\u6a21\u5f0f \u00b7 \u8d77\u59cb\u7b2c ${startingLevel} \u95dc \u00b7 \u7403\u901f ${devBallSpeed??'\u95dc\u5361\u9810\u8a2d'} \u00b7 \u4e0d\u8a18\u9304\u6210\u7e3e`;$('modalTitle').textContent='\u958b\u767c\u8005\u6e2c\u8a66\u6a21\u5f0f';$('modalText').textContent=`\u5f9e\u7b2c ${startingLevel} \u95dc\u958b\u59cb\uff0c\u9810\u8a2d\u4e09\u689d\u547d\u3002\u53ef\u96a8\u6642\u6309\u300c\u91cd\u8a66\u672c\u95dc\u300d\u91cd\u65b0\u7522\u751f\u76e4\u9762\u3002\u6e2c\u8a66\u5206\u6578\u4e0d\u767b\u6392\u884c\u699c\uff0c\u4e5f\u4e0d\u66f4\u65b0\u672c\u6a5f\u6700\u9ad8\u5206\u3002`;$('primary').textContent='\u958b\u59cb\u6e2c\u8a66';}
$('pause').onclick=pause;$('primary').onclick=()=>{window.CandyAudio?.unlock();if(mode==='paused'){mode='countdown';resumeTime=3;$('overlay').hidden=true;}else if(mode==='clear'){level++;loadLevel();mode='countdown';resumeTime=3;$('overlay').hidden=true;}else start();};$('secondary').onclick=start;document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});window.addEventListener('blur',pause);
function protectedCell(x,y){if(drag&&(drag.cell.x===x&&drag.cell.y===y||drag.target?.x===x&&drag.target?.y===y))return true;if(motion&&['swap','return'].includes(motion.kind))return[motion.a,motion.b].some(c=>c.x===x&&c.y===y);return motion?.kind==='snap'&&motion.cell.x===x&&motion.cell.y===y;}
function moveBall(ball,dt){const steps=Math.max(1,Math.ceil(Math.hypot(ball.vx,ball.vy)*dt/3)),ds=dt/steps;for(let s=0;s<steps;s++){const previousContacts=ball.contactCells||[];const contacts=[];const ox=ball.x,oy=ball.y;ball.x+=ball.vx*ds;ball.y+=ball.vy*ds;if(ball.x<22){ball.x=22;ball.vx=Math.abs(ball.vx);}if(ball.x>W-22){ball.x=W-22;ball.vx=-Math.abs(ball.vx);}if(ball.y<BOARD_CEILING+7){ball.y=BOARD_CEILING+7;ball.vy=Math.abs(ball.vy);}
// Solid side walls close the outer lanes, including their lower faces.
if(ball.y-7<BOARD_BOTTOM&&(ball.x-7<BX||ball.x+7>BX+COLS*CELL)){if(oy-7>=BOARD_BOTTOM&&ball.vy<0){ball.y=BOARD_BOTTOM+7;ball.vy=Math.abs(ball.vy);}else if(ball.x<W/2){ball.x=BX+7;ball.vx=Math.abs(ball.vx);}else{ball.x=BX+COLS*CELL-7;ball.vx=-Math.abs(ball.vx);}}const pw=width();if(ball.vy>0&&oy+7<=PY-7&&ball.y+7>=PY-7&&ball.x>=paddle.x-pw/2-5&&ball.x<=paddle.x+pw/2+5){const angle=clamp((ball.x-paddle.x)/(pw/2),-.95,.95)*1.05,speed=Math.hypot(ball.vx,ball.vy);ball.vx=Math.sin(angle)*speed;ball.vy=-Math.cos(angle)*speed;ball.y=PY-14;tone(330,.045);}
let hit=false;for(let y=0;y<ROWS&&!hit;y++)for(let x=0;x<COLS&&!hit;x++){if(board[y][x]===null||protectedCell(x,y))continue;const p=visualPosition(x,y),l=p.x+4,r=l+42,t=p.y+4,b=t+42,nx=clamp(ball.x,l,r),ny=clamp(ball.y,t,b);if((ball.x-nx)**2+(ball.y-ny)**2>49)continue;const cell=y*COLS+x;contacts.push(cell);if(previousContacts.includes(cell))continue;if(!finishing){if(oy<=t-6){ball.vy=-Math.abs(ball.vy);ball.y=t-7;}else if(oy>=b+6){ball.vy=Math.abs(ball.vy);ball.y=b+7;}else if(ox<l){ball.vx=-Math.abs(ball.vx);ball.x=l-7;}else{ball.vx=Math.abs(ball.vx);ball.x=r+7;}}if(finishing){remove([cell],25);}else if(board[y][x]>=15){tone(430,.035);}else if(board[y][x]>=5){board[y][x]-=5;burst(p.x+25,p.y+25,'#c8f4ff');tone(920,.055);}else{remove([cell],25);}if(finishing)burst(ball.x,ball.y,'#ffe7a5');tone(finishing?760:515,.04);hit=!finishing;}ball.contactCells=contacts;if(ball.y>H+12)return false;}
ball.trail.push({x:ball.x,y:ball.y});if(ball.trail.length>(finishing?18:12))ball.trail.shift();return true;}
function tick(dt){if(mode==='countdown'){resumeTime-=dt;if(resumeTime<=0){mode=resumeTo;reviving=false;}return;}if(mode!=='playing')return;elapsed+=dt;comboFlash=Math.max(0,comboFlash-dt);if(toastTime>0){toastTime-=dt;if(toastTime<=0)$('toast').classList.remove('show');}if(wide>0){wide=Math.max(0,wide-dt);constrain();}const wasBusy=busy();animate(dt);if(mode!=='playing')return;if(!wasBusy&&!busy()){if(comboTime>0){comboTime=Math.max(0,comboTime-dt);if(comboTime===0){combo=0;comboFlash=0;}}if(!finishing){if(penalty>0){shrinkScale=Math.max(.2,shrinkScale-(penalty===1?.1:.15)*Math.min(dt,Math.max(0,time)));constrain();}time-=dt;if(time<=0){timeout();if(mode!=='playing')return;}}}
if(mode!=='playing')return;balls=balls.filter(ball=>moveBall(ball,dt));if(!balls.length){if(!board.flat().some(c=>c!==null))checkBoard();else loseLife();}for(const p of particles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=100*dt;p.life-=dt;}particles=particles.filter(p=>p.life>0);}
function rr(x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}}
function drawPaddle(){
  $('lives').textContent='♥ '+lives;$('lives').setAttribute('aria-label','剩餘生命 '+lives);
  const pw=width(),left=paddle.x-pw/2,right=paddle.x+pw/2;
  ctx.save();
  rr(left-7,PY-15,pw+14,30,15,'#f5c29c09');
  if(wide>0){
    const pulse=.5+.5*Math.sin(elapsed*Math.PI*2),age=6-wide;
    const aura=ctx.createRadialGradient(paddle.x,PY,5,paddle.x,PY,pw*.7);
    aura.addColorStop(0,'#62ffd33b');aura.addColorStop(1,'#62ffd300');
    ctx.fillStyle=aura;ctx.fillRect(left-30,PY-30,pw+60,60);
    ctx.shadowColor='#4effd4';ctx.shadowBlur=23+pulse*7;
    const body=ctx.createLinearGradient(left,PY-7,right,PY+7);
    body.addColorStop(0,'#41dfff');body.addColorStop(.5,'#caffeb');body.addColorStop(1,'#41dfff');
    rr(left-1,PY-8,pw+2,16,8,body,'#e3fff5');
    ctx.shadowBlur=0;
    ctx.save();ctx.beginPath();ctx.roundRect(left,PY-7,pw,14,7);ctx.clip();
    const sweep=left-35+((elapsed*1.2)%1)*(pw+70);
    const sheen=ctx.createLinearGradient(sweep-20,0,sweep+20,0);
    sheen.addColorStop(0,'#ffffff00');sheen.addColorStop(.5,'#ffffffcc');sheen.addColorStop(1,'#ffffff00');
    ctx.fillStyle=sheen;ctx.fillRect(left,PY-8,pw,16);ctx.restore();
    rr(left+9,PY-5,pw-18,2,1,'#ffffffdd');
    for(const end of [left,right]){
      ctx.shadowColor='#64fff2';ctx.shadowBlur=14;
      ctx.fillStyle='#f0ffeb';ctx.beginPath();ctx.arc(end,PY,4+pulse,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#abfff4';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(end-7,PY);ctx.lineTo(end+7,PY);ctx.moveTo(end,PY-10);ctx.lineTo(end,PY+10);ctx.stroke();
    }
    ctx.shadowBlur=0;
    for(let i=0;i<8;i++){
      const phase=(elapsed*.65+i/8)%1;
      const x=left+pw*((i*.381966)%1),y=PY-10-phase*19;
      ctx.globalAlpha=(1-phase)*.75;ctx.fillStyle=i%2?'#83faff':'#d8ffda';
      ctx.beginPath();ctx.arc(x+Math.sin(elapsed*2+i)*3,y,1.2+(1-phase)*.7,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
    rr(left,PY+14,pw,3,1.5,'#ffffff1c');
    rr(left,PY+14,Math.max(.1,pw*wide/6),3,1.5,wide<1.5?'#ffe3a0':'#7effda');
    if(age<.45){ctx.globalAlpha=(1-age/.45)*.7;ctx.strokeStyle='#b7ffe5';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(paddle.x,PY,pw/2+age*45,11+age*35,0,0,Math.PI*2);ctx.stroke();}
  }else{
    ctx.shadowColor='#ffc28f';ctx.shadowBlur=18;
    rr(left,PY-6,pw,12,6,penalty?'#ee8ea6':'#f5c6a5');ctx.shadowBlur=0;
    rr(left+8,PY-4,pw-16,2,2,'#ffffff70');
  }
  if(active?.type==='paddle'){ctx.globalAlpha=1;ctx.shadowColor='#fff1b8';ctx.shadowBlur=20;ctx.strokeStyle='#fff1b8';ctx.lineWidth=3;ctx.beginPath();ctx.roundRect(left-4,PY-12,pw+8,24,12);ctx.stroke();}
  ctx.restore();
}
function candy(x,y,c,sel){const hits=durability(c),coated=c>=5;c=candyColor(c);const cx=x+25,cy=y+25;ctx.save();ctx.translate(cx,cy);ctx.shadowColor=colors[c]+'55';ctx.shadowBlur=coated?0:10;ctx.beginPath();if(c===0){ctx.roundRect(-17,-20,34,40,14);}if(c===1){ctx.moveTo(0,-22);ctx.lineTo(20,0);ctx.lineTo(0,22);ctx.lineTo(-20,0);ctx.closePath();}if(c===2){for(let i=0;i<12;i++){let a=i*Math.PI/6-Math.PI/2,r=i%2?13:22;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();}if(c===3)ctx.arc(0,0,19,0,Math.PI*2);if(c===4)ctx.roundRect(-18,-18,36,36,9);const g=ctx.createLinearGradient(-15,-20,14,21);g.addColorStop(0,'#fff0');g.addColorStop(.02,colors[c]);g.addColorStop(1,['#c93c75','#da8647','#6656c1','#289c92','#3c79bc'][c]);ctx.fillStyle=g;ctx.fill();ctx.shadowBlur=0;ctx.strokeStyle='#ffffff55';ctx.stroke();ctx.beginPath();ctx.ellipse(-6,-9,8,3,-.45,0,Math.PI*2);ctx.fillStyle='#ffffff70';ctx.fill();ctx.fillStyle='#181327dd';ctx.beginPath();ctx.roundRect(7,8,15,15,5);ctx.fill();ctx.fillStyle=hits===3?'#ffe0a3':hits===2?'#c8f4ff':'#ffffffaa';ctx.font='bold 12px system-ui';ctx.textAlign='center';ctx.fillText(String(hits),14,20);ctx.restore();if(sel)rr(x+1,y+1,48,48,12,null,'#fff1be');}
function liftedCandy(x,y,c,scale=1.08){ctx.save();ctx.translate(x+25,y+25);ctx.scale(scale,scale);candy(-25,-25,c,false);ctx.restore();}
function drawCandies(){for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){rr(BX+x*CELL+3,BY+y*CELL+3,44,44,10,'#ffffff04');if(board[y][x]===null)continue;if(motion&&['swap','return'].includes(motion.kind)&&[motion.a,motion.b].some(c=>c.x===x&&c.y===y))continue;if(motion?.kind==='snap'&&motion.cell.x===x&&motion.cell.y===y)continue;if(drag?.cell.x===x&&drag.cell.y===y)continue;const p=visualPosition(x,y);if(drag?.target?.x===x&&drag.target.y===y){p.x-=drag.dx;p.y-=drag.dy;}candy(p.x,p.y,board[y][x],selected?.x===x&&selected?.y===y);}
if(motion){const t=clamp(motion.elapsed/motion.duration,0,1),ease=1-(1-t)**3;if(['swap','return'].includes(motion.kind)){const {a,b,ca,cb,offset}=motion,dx=(b.x-a.x)*CELL,dy=(b.y-a.y)*CELL;const ox=motion.kind==='return'?dx*(1-ease):offset.x+(dx-offset.x)*ease,oy=motion.kind==='return'?dy*(1-ease):offset.y+(dy-offset.y)*ease;candy(BX+b.x*CELL-ox,BY+b.y*CELL-oy,cb,false);liftedCandy(BX+a.x*CELL+ox,BY+a.y*CELL+oy,ca,1.04);}else if(motion.kind==='snap'){candy(BX+motion.cell.x*CELL+motion.offset.x*(1-ease),BY+motion.cell.y*CELL+motion.offset.y*(1-ease),motion.c,false);}}
for(const g of ghosts){ctx.save();ctx.globalAlpha=clamp(g.life/.18,0,1);liftedCandy(g.x,g.y,g.c,Math.max(.1,g.life/.18));ctx.restore();}if(drag)liftedCandy(BX+drag.cell.x*CELL+drag.dx,BY+drag.cell.y*CELL+drag.dy,board[drag.cell.y][drag.cell.x]);}
function drawBalls(){for(const ball of balls){ball.trail.forEach((p,i)=>{const t=i/ball.trail.length;ctx.globalAlpha=t*(finishing?.32:.3);ctx.fillStyle=finishing?'#ffc45c':'#ffe1a6';ctx.beginPath();ctx.arc(p.x,p.y,(finishing?5:6)*t,0,7);ctx.fill();});ctx.globalAlpha=1;ctx.shadowColor=finishing?'#ffb63d':'#ffdab1';ctx.shadowBlur=finishing?14:20;if(finishing){ctx.strokeStyle='#ffe8a580';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(ball.x,ball.y,9,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(ball.x-11,ball.y);ctx.lineTo(ball.x+11,ball.y);ctx.moveTo(ball.x,ball.y-11);ctx.lineTo(ball.x,ball.y+11);ctx.stroke();}ctx.beginPath();ctx.arc(ball.x,ball.y,7,0,7);ctx.fillStyle=finishing?'#fff9dc':'#fff1d4';ctx.fill();ctx.shadowBlur=0;}}
function warningActive(){return mode==='playing'&&!finishing&&time>0&&time<=roundLimit()/2;}
function drawRewards(){$('elapsed').textContent=formatTime(elapsed,mode==='clear'||mode==='over');$('toast').classList.toggle('suppressed',warningActive());if(mode!=='playing')return;ctx.textAlign='center';if(combo>0&&comboFlash>0){ctx.save();ctx.globalAlpha=Math.min(1,comboFlash*2);ctx.fillStyle='#b9f5e1';ctx.font='bold 25px system-ui';ctx.fillText(`${combo} COMBO${lastComboBonus?'  +'+lastComboBonus:''}`,210,503);ctx.restore();}if(warningActive()){ctx.save();ctx.globalAlpha=.6;ctx.fillStyle='#ff6e88';ctx.font='bold 70px system-ui';ctx.fillText(Math.ceil(time),210,566);ctx.globalAlpha=.9;ctx.font='bold 16px system-ui';ctx.fillText('完成一次有效三消',210,591);ctx.fillText(penalty?'\u6a6b\u687f\u6301\u7e8c\u7e2e\u77ed\uff0c\u4e09\u6d88\u5373\u53ef\u6062\u5fa9':'否則橫桿會持續縮短',210,614);ctx.font='bold 14px system-ui';ctx.fillText(`\u7b2c ${Math.min(3,consecutiveTimeouts+1)} \u8f2a\u5012\u6578`,210,525);ctx.restore();}}
function draw(){window.CandyAudio?.setScene(mode,finishing,ballSpeed());ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,W,H);const bg=ctx.createLinearGradient(0,90,0,H);bg.addColorStop(0,'#241a36');bg.addColorStop(.55,'#1c182f');bg.addColorStop(1,'#24213d');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);ctx.fillStyle='#191425';ctx.fillRect(0,0,W,88);ctx.strokeStyle='#ffffff0d';ctx.beginPath();ctx.moveTo(20,89);ctx.lineTo(400,89);ctx.stroke();rr(16,101,W-32,322,15,'#110f2060','#bfa0db16');drawCandies();
ctx.textAlign='center';ctx.font='bold 15px system-ui';ctx.fillStyle=finishing?'#baf4df':'#d2c0e4';ctx.fillText(finishing?`貫穿收尾 · 剩餘 ${balls.length} 球`:'上方拖曳三消 · 下方接球',210,448);if(!finishing){ctx.font='13px system-ui';ctx.fillStyle='#c8f4ff';ctx.fillText(level>=11?'\u221e \u8010\u4e45 \u00b7 \u666e\u901a\u7403\u4e0d\u6d88\u9664\uff0c\u8acb\u4e09\u6d88':'\u649e\u4e09\u6b21 \u00b7 \u4e09\u6d88\u4e00\u6b21\u6d88\u9664',210,470);}if(finishing){ctx.font='13px system-ui';ctx.fillStyle='#d2c0e4';ctx.fillText('倒數暫停 · 全部漏接扣一命',210,470);}for(let i=0;i<18;i++){const x=25+(i*71)%370,y=485+(i*53)%160;ctx.fillStyle='#d3bcff14';ctx.beginPath();ctx.arc(x,y,i%3===0?1.6:.8,0,7);ctx.fill();}ctx.strokeStyle='#cbb4ee0c';ctx.setLineDash([3,8]);ctx.beginPath();ctx.moveTo(210,490);ctx.lineTo(210,635);ctx.stroke();ctx.setLineDash([]);
drawRewards();drawBalls();drawPaddle();ctx.fillStyle='#f0deff';ctx.font='bold 15px system-ui';ctx.fillText(active?.type==='paddle'?'←  左右拖動接球  →':'按住底部區域 · 左右拖動',210,722);for(const p of particles){ctx.globalAlpha=clamp(p.life*2,0,1);rr(p.x-2,p.y-2,4,4,1,p.c);}ctx.globalAlpha=1;
if(mode==='countdown'){ctx.fillStyle='#171124bb';ctx.fillRect(0,90,W,H-90);ctx.font='bold 82px system-ui';ctx.fillStyle='#ffdcab';ctx.fillText(Math.ceil(resumeTime),210,505);ctx.font='bold 24px system-ui';ctx.fillStyle='#fff0d8';ctx.fillText(reviving?'復活準備':'準備接球',210,546);ctx.font='bold 15px system-ui';ctx.fillStyle='#ffbdd1';if(reviving){ctx.fillText(`保留盤面與分數 · 剩餘 ${lives} 條命`,210,578);ctx.fillText('\u5f48\u73e0\u5168\u90e8\u6f0f\u63a5 \u00b7 \u5931\u53bb\u4e00\u689d\u547d',210,606);}else if(milestoneMessage)ctx.fillText(milestoneMessage,210,578);else ctx.fillText(level>=11?'\u221e \u8010\u4e45 \u00b7 \u4e09\u6d88\u6d88\u9664\uff0c\u6536\u5c3e\u7121\u8996\u8010\u4e45':'\u4e09\u5c64\u8010\u4e45 \u00b7 \u4e09\u6d88\u4e00\u6b21\u6d88\u9664',210,578);}
$('level').textContent=String(level).padStart(2,'0');$('score').textContent=String(score).padStart(5,'0');$('timer').innerHTML=!finishing?Math.ceil(Math.max(0,time))+'<span>s</span>':'暫停';$('timerBox').className='timer'+(finishing?' safe':time<=3?' danger':'');$('best').textContent='BEST '+String(best).padStart(5,'0');$('hint').textContent=wide>0?`✦ ${Math.round(wideScale*100)}% · ${wide.toFixed(1)}s`:!finishing&&consecutiveTimeouts>=2?`\u6a6b\u687f ${width()}% \u00b7 \u4e09\u6d88\u5373\u53ef\u6062\u5fa9`:penalty?`橫桿 ${Math.round(width())}% · 三消恢復`:finishing?'15 球貫穿 · 不再補球':'三消 × 打磚塊';$('pause').disabled=!['playing','countdown'].includes(mode);}
board=freshBoard();coatBoard();time=turnLimit();let last=performance.now(),acc=0;function frame(now){acc+=Math.min((now-last)/1000,.1);last=now;while(acc>=1/120){tick(1/120);acc-=1/120;}draw();requestAnimationFrame(frame);}requestAnimationFrame(frame);
// Read-only diagnostics for prototype QA; no gameplay shortcuts exposed.
window.CandyRicochet={snapshot:()=>({version:'20261023-dynamic-music',devMode,startingLevel,devBallSpeed,mode,level,score,lives,reviving,milestoneMessage,time,consecutiveTimeouts,lastLossReason,roundLimit:roundLimit(),turnLimit:turnLimit(),ballSpeed:ballSpeed(),durability:board.map(row=>row.map(durability)),coatedCount:board.flat().filter(c=>c!==null&&c>=5).length,elapsed,combo,comboTime,wideScale,warning:warningActive(),stats:stats?{...stats}:null,clearSummary:clearSummary?{...clearSummary}:null,penalty,shrinkScale,shrinkRate:penalty===1?.1:penalty>=2?.15:0,wide,hasMoves,settle,finishing,board:board.map(r=>r.slice()),ball:balls[0]?{...balls[0]}:null,balls:balls.map(b=>({...b,trail:undefined})),motion:motion?{kind:motion.kind,elapsed:motion.elapsed,duration:motion.duration}:null,drag:drag?{...drag}:null,paddle:{...paddle,width:width()},active:active?{id:active.id,type:active.type}:null}),rules:{matches,available,freshBoard}};
})();
