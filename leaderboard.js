/* Public leaderboard endpoint. No Google credentials belong in browser code. */
(() => {
  'use strict';
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbxAWbd9OvFaF4oyitcb9pHOIPUtZOEyZrxVkkCKc8r4fvbADUt8P6HcnmXAmSQ01e0F/exec';
  const $ = id => document.getElementById(id);
  const openButton = document.createElement('button');
  openButton.id = 'showLeaderboard';
  openButton.className = 'leaderboard-open';
  openButton.textContent = '♛ 查看分數排行榜';
  $('primary').insertAdjacentElement('afterend', openButton);
  const panel = document.createElement('section');
  panel.id = 'leaderboardOverlay';
  panel.className = 'overlay leaderboard-overlay';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'leaderboardTitle');
  panel.innerHTML = `
    <div class="leaderboard-card">
      <div class="leaderboard-heading"><div><small>TOP 5 · CANDY RICOCHET</small><h2 id="leaderboardTitle">分數排行榜</h2></div><button id="leaderboardClose" aria-label="關閉排行榜">×</button></div>
      <p id="leaderboardScore" class="leaderboard-score" hidden></p>
      <table class="leaderboard-table"><caption class="sr-only">最高五筆分數，同分時先登錄者在前</caption><thead><tr><th scope="col">名次</th><th scope="col">名字</th><th scope="col">分數</th></tr></thead><tbody id="leaderboardRows"></tbody></table>
      <p id="leaderboardStatus" class="leaderboard-status" role="status" aria-live="polite"></p>
      <form id="leaderboardForm" hidden>
        <label for="leaderboardName">進入前五名！留下你的名字</label>
        <div class="leaderboard-inputs"><input id="leaderboardName" name="nickname" type="text" maxlength="24" autocomplete="off" placeholder="輸入名字" aria-describedby="leaderboardNameHelp"><button id="leaderboardSubmit" type="submit">登錄</button></div>
        <small id="leaderboardNameHelp">限 1～12 字；登錄後名字與分數會公開顯示。</small>
      </form>
      <div class="leaderboard-actions"><button id="leaderboardRefresh">重新整理</button><button id="leaderboardBack">返回</button></div>
      <small class="leaderboard-footnote">同分時先登錄者在前 · 本機最高分另行保存</small>
    </div>`;
  document.querySelector('.screen').appendChild(panel);

  let currentRun = null, entries = [], loaded = false, loading = false, saving = false;
  let generation = 0, controller = null, returnFocus = null, ambiguous = false;

  function status(message, error = false) {
    $('leaderboardStatus').textContent = message;
    $('leaderboardStatus').classList.toggle('error', error);
  }

  function validEntries(value) {
    if (!Array.isArray(value) || value.length > 5 || value.some(e => !e || typeof e.name !== 'string' || e.name.length > 100 || !Number.isSafeInteger(e.score) || e.score <= 0)) {
      throw new Error('排行榜回傳格式不正確，請稍後重試。');
    }
    return value.map(e => ({name: e.name, score: e.score})).sort((a, b) => b.score - a.score);
  }

  async function request(params, signal) {
    const response = await fetch(ENDPOINT, {
      method: params ? 'POST' : 'GET',
      credentials: 'omit',
      redirect: 'follow',
      signal,
      ...(params ? {body: new URLSearchParams(params)} : {})
    });
    if (!response.ok) throw new Error('無法連線排行榜，請稍後再試。');
    const result = await response.json();
    if (!result || result.ok !== true) {
      const error = new Error(result?.error || '排行榜暫時無法使用。');
      error.rejected = true;
      throw error;
    }
    result.entries = validEntries(result.entries);
    return result;
  }

  function renderRows() {
    const body = $('leaderboardRows');
    body.replaceChildren();
    entries.forEach((entry, index) => {
      const tr = document.createElement('tr');
      [String(index + 1).padStart(2, '0'), entry.name, entry.score.toLocaleString()].forEach(value => {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });
      if (index === 0) tr.className = 'first-place';
      body.appendChild(tr);
    });
    if (!entries.length) {
      const tr = document.createElement('tr'), td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'leaderboard-empty';
      td.textContent = loaded ? '還沒有紀錄，等你來挑戰！' : '—';
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  function eligible() {
    return loaded && currentRun && currentRun.score > 0 && !currentRun.submitted &&
      (entries.length < 5 || currentRun.score > entries[4].score);
  }

  function controls() {
    $('leaderboardScore').hidden = !currentRun;
    $('leaderboardScore').textContent = currentRun ? `本局得分 ${currentRun.score.toLocaleString()}` : '';
    $('leaderboardForm').hidden = !eligible() && !(saving || ambiguous);
    $('leaderboardName').disabled = saving || ambiguous;
    $('leaderboardSubmit').disabled = saving || loading;
    $('leaderboardSubmit').textContent = saving ? '送出中…' : ambiguous ? '重試確認' : '登錄';
    $('leaderboardBack').textContent = eligible() && !saving ? '略過，返回' : '返回';
    for (const id of ['leaderboardClose', 'leaderboardBack']) $(id).disabled = saving;
    $('leaderboardRefresh').disabled = loading || saving;
  }

  function summary() {
    if (currentRun?.submitted) return currentRun.accepted ? '本局已完成登錄，可以再挑戰更高分！' : '本局提交時未進入前五名，下一次再挑戰！';
    if (ambiguous) return '尚未確認送出結果，可用相同資料重試；不要重新開局後重送。';
    if (eligible()) return '恭喜進入前五名！你可以登錄名字，或直接返回。';
    if (currentRun?.score === 0) return '本局尚未得分，再試一次吧！';
    if (currentRun) return '本局未進入前五名，下一次再挑戰！';
    return '挑戰高分，留下你的名字。';
  }

  async function refresh(autoPrompt = false) {
    autoPrompt = autoPrompt === true;
    if (saving || loading) return;
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), 18000);
    loading = true;
    status('正在讀取排行榜…');
    controls();
    try {
      const result = await request(null, activeController.signal);
      if (version !== generation) return;
      entries = result.entries;
      loaded = true;
      renderRows();
      status(summary());
      if(autoPrompt && eligible() && panel.hidden) showPanel();
      if(autoPrompt) openButton.textContent=eligible()?'♛ 進入前五名 · 留下名字':'♛ 查看分數排行榜';
    } catch (error) {
      if (version !== generation) return;
      loaded = false;
      status('排行榜連線失敗。請確認網路後，按「重新整理」再試。', true);
      if(autoPrompt) openButton.textContent='♛ 排行榜連線失敗 · 點此重試';
    } finally {
      clearTimeout(timeout);
      if (version === generation) {loading = false; controls();}
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || loading || (!eligible() && !ambiguous)) return;
    const name = (ambiguous ? currentRun.pendingName : $('leaderboardName').value).normalize('NFC').trim();
    if (!name || Array.from(name).length > 12 || /[\u0000-\u001f\u007f]/.test(name) || /^[=+\-@']/.test(name)) {
      status('請輸入 1～12 字名字，開頭請避開 =、+、-、@ 或單引號。', true);
      $('leaderboardName').focus();
      return;
    }
    const version = ++generation, run = currentRun;
    run.pendingName = name;
    saving = true;
    controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), 22000);
    status('正在登錄分數，請稍候…');
    controls();
    try {
      const result = await request({name, score: String(run.score), runId: run.id}, activeController.signal);
      if (version !== generation) return;
      if (typeof result.qualified !== 'boolean' || (result.qualified && (!Number.isInteger(result.rank) || result.rank < 1 || result.rank > 5))) throw new Error('登錄回應格式不正確。');
      entries = result.entries;
      loaded = true;
      ambiguous = false;
      run.submitted = true;
      run.accepted = result.qualified;
      renderRows();
      status(result.qualified ? `登錄成功！本次排名第 ${result.rank} 名。` : '榜單剛剛更新，本次未進入前五名。再挑戰一次吧！');
    } catch (error) {
      if (version !== generation) return;
      ambiguous = !error.rejected;
      status(error.rejected ? error.message : '尚未確認登錄結果。請確認網路後，按「重試確認」使用相同資料重試。', true);
    } finally {
      clearTimeout(timeout);
      if (version === generation) {saving = false; controls();}
    }
  }

  function close() {
    if (saving) return;
    ++generation;
    controller?.abort();
    loading = false;
    panel.hidden = true;
    returnFocus?.focus();
  }

  function showPanel() {
    returnFocus = document.activeElement?.closest('#overlay') ? document.activeElement : openButton;
    panel.hidden = false;
    controls();
    renderRows();
    $('leaderboardClose').focus();
  }

  function open() {
    showPanel();
    refresh();
  }

  openButton.onclick = open;
  $('leaderboardRefresh').onclick = refresh;
  $('leaderboardClose').onclick = close;
  $('leaderboardBack').onclick = close;
  $('leaderboardForm').onsubmit = submit;
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {event.preventDefault(); close();}
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll('button,input')].filter(el => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items[items.length - 1];
    if (!first) {event.preventDefault(); return;}
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  });

  window.CandyLeaderboard = {
    setGameView(mode) {openButton.hidden = !['ready', 'over'].includes(mode);},
    gameStart() {
      ++generation;
      controller?.abort();
      currentRun = null;
      ambiguous = false;
      loading = false;
      saving = false;
      loaded = false;
      panel.hidden = true;
      openButton.hidden = true;
      openButton.textContent='♛ 查看分數排行榜';
      $('leaderboardName').value = '';
    },
    finish(score) {
      const id = window.crypto?.randomUUID?.() || 'game_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 15);
      currentRun = {score, id, submitted: false};
      ambiguous = false;
      openButton.hidden = false;
      loaded = false;
      if(score>0){openButton.textContent='♛ 正在檢查前五名…';refresh(true);}
    }
  };
})();
