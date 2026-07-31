const { app, BaseWindow, WebContentsView, session, screen } = require('electron');
const { getRecommendedHunts } = require('./hunts');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const URL = 'https://poke.idleworld.online/play';
const ACCOUNTS = [
  { label: 'Conta 1', partition: 'persist:conta1' },
  { label: 'Conta 2', partition: 'persist:conta2' },
  { label: 'Conta 3', partition: 'persist:conta3' },
  { label: 'Conta 4', partition: 'persist:conta4' }
];
const SIDEBAR_WIDTH = 260;

let win;
let sidebarView;
let contentViews = [];
let activeIndex = 0;

function buildSidebarHtml() {
  const items = ACCOUNTS.map((acc, i) => `
    <a href="app://${i}" class="item ${i === 0 ? 'active' : ''}" data-index="${i}">
      <div class="item-header">
        <span class="item-title">${acc.label}</span>
        <span class="trainer-tag" id="trainer-tag-${i}">Carregando...</span>
      </div>
      <div class="item-details" id="item-details-${i}">
        <span class="mon-name">—</span>
        <span class="mon-lv"></span>
      </div>
    </a>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { box-sizing: border-box; }
        html, body {
          margin: 0; padding: 0; height: 100%;
          background: #11111b; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          color: #cdd6f4;
          user-select: none;
          overflow-y: auto;
        }
        .sidebar-header {
          padding: 14px 14px 10px;
          border-bottom: 1px solid #313244;
          font-weight: 700;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #89b4fa;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .items-container {
          padding: 8px;
        }
        .item {
          display: block;
          padding: 10px 12px;
          margin-bottom: 6px;
          color: #cdd6f4;
          text-decoration: none;
          background: #1e1e2e;
          border-radius: 8px;
          border: 1px solid transparent;
          transition: all 0.2s ease;
        }
        .item:hover {
          background: #2a2b3d;
          border-color: #45475a;
        }
        .item.active {
          background: #2b304f;
          border-color: #89b4fa;
          box-shadow: 0 0 10px rgba(137, 180, 250, 0.15);
        }
        .item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
          font-weight: 600;
        }
        .item.active .item-title {
          color: #89b4fa;
        }
        .trainer-tag {
          font-size: 11px;
          background: #313244;
          color: #a6adc8;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 400;
          max-width: 100px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .item.active .trainer-tag {
          background: #89b4fa;
          color: #11111b;
          font-weight: 600;
        }
        .item-details {
          margin-top: 5px;
          font-size: 12px;
          color: #bac2de;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .mon-lv {
          font-size: 10px;
          background: #fab387;
          color: #11111b;
          font-weight: 700;
          padding: 1px 4px;
          border-radius: 3px;
        }

        /* Panels Below Sidebar */
        .info-panel {
          margin: 10px 8px;
          padding: 12px;
          background: #181825;
          border: 1px solid #313244;
          border-radius: 8px;
        }
        .panel-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #f9e2af;
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
          font-size: 12px;
        }
        .info-row:last-child {
          margin-bottom: 0;
        }
        .info-label {
          color: #9399b2;
        }
        .info-val {
          font-weight: 600;
          color: #cdd6f4;
          text-align: right;
        }
        .hp-bar-container {
          margin-top: 4px;
          background: #313244;
          border-radius: 4px;
          height: 14px;
          position: relative;
          overflow: hidden;
        }
        .hp-bar-fill {
          background: #a6e3a1;
          height: 100%;
          width: 0%;
          transition: width 0.3s ease;
        }
        .hp-bar-text {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          font-size: 9px;
          font-weight: 700;
          color: #11111b;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Hunt Cards */
        .hunt-card {
          background: #1e1e2e;
          padding: 8px 10px;
          border-radius: 6px;
          border-left: 3px solid #89b4fa;
          margin-top: 6px;
        }
        .hunt-badge {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          display: inline-block;
          margin-bottom: 2px;
        }
        .xp-badge { color: #a6e3a1; }
        .dollar-badge { color: #f9e2af; }
      </style>
    </head>
    <body>
      <div class="sidebar-header">
        <span>🎮 Contas</span>
      </div>

      <div class="items-container">
        ${items}
      </div>

      <!-- Active Tab Status Box -->
      <div class="info-panel">
        <div class="panel-title">⚡ Status da Aba Ativa</div>
        <div class="info-row">
          <span class="info-label">Treinador / Conta:</span>
          <span class="info-val" id="active-trainer">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">Local:</span>
          <span class="info-val" id="active-loc">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">Pokémon:</span>
          <span class="info-val" id="active-mon">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">Nível:</span>
          <span class="info-val" id="active-lv">—</span>
        </div>
        <div class="info-row" style="flex-direction: column; align-items: stretch; margin-top: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 2px;">
            <span class="info-label">HP:</span>
            <span class="info-val" id="active-hp-text">—</span>
          </div>
          <div class="hp-bar-container">
            <div class="hp-bar-fill" id="active-hp-fill"></div>
            <div class="hp-bar-text" id="active-hp-bar-text"></div>
          </div>
        </div>
      </div>

      <!-- PIWTools Hunt Recommendations Box -->
      <div class="info-panel" style="border-color: #45475a;">
        <div class="panel-title" style="color: #89b4fa;">🎯 Melhores Hunts (PIWTools)</div>
        
        <div class="hunt-card" style="border-left-color: #a6e3a1;">
          <div class="hunt-badge xp-badge">🚀 1ª Opção: Melhor XP/h</div>
          <div class="info-row" style="margin-top: 2px;">
            <span class="info-label">Local:</span>
            <span class="info-val" id="hunt-xp-target">—</span>
          </div>
          <div class="info-row">
            <span class="info-label">Estimativa:</span>
            <span class="info-val" id="hunt-xp-val" style="color: #a6e3a1;">—</span>
          </div>
        </div>

        <div class="hunt-card" style="border-left-color: #f9e2af; margin-top: 8px;">
          <div class="hunt-badge dollar-badge">💰 2ª Opção: Melhor $/h</div>
          <div class="info-row" style="margin-top: 2px;">
            <span class="info-label">Local:</span>
            <span class="info-val" id="hunt-dollar-target">—</span>
          </div>
          <div class="info-row">
            <span class="info-label">Estimativa:</span>
            <span class="info-val" id="hunt-dollar-val" style="color: #f9e2af;">—</span>
          </div>
        </div>
      </div>

      <script>
        function updateSidebarActive(activeIndex) {
          document.querySelectorAll('.item').forEach(function (el) {
            el.classList.toggle('active', el.dataset.index === String(activeIndex));
          });
        }

        function updateStats(statsList, activeIndex) {
          updateSidebarActive(activeIndex);
          
          statsList.forEach((stat, i) => {
            const tagEl = document.getElementById('trainer-tag-' + i);
            const detailsEl = document.getElementById('item-details-' + i);
            
            if (!stat) {
              if (tagEl) tagEl.innerText = 'Off';
              if (detailsEl) detailsEl.innerHTML = '<span class="mon-name">—</span>';
              return;
            }

            if (tagEl) {
              tagEl.innerText = stat.trainerName || ('Conta ' + (i + 1));
            }
            if (detailsEl) {
              const nameStr = stat.monName ? ('⚔️ ' + stat.monName) : 'Sem Pokémon';
              const lvStr = stat.monLv ? ('<span class="mon-lv">' + stat.monLv + '</span>') : '';
              detailsEl.innerHTML = '<span class="mon-name">' + nameStr + '</span> ' + lvStr;
            }
          });

          // Update active tab panel
          const activeStat = statsList[activeIndex];
          const trEl = document.getElementById('active-trainer');
          const locEl = document.getElementById('active-loc');
          const monEl = document.getElementById('active-mon');
          const lvEl = document.getElementById('active-lv');
          const hpTextEl = document.getElementById('active-hp-text');
          const hpFillEl = document.getElementById('active-hp-fill');
          const hpBarTextEl = document.getElementById('active-hp-bar-text');

          const huntXpTargetEl = document.getElementById('hunt-xp-target');
          const huntXpValEl = document.getElementById('hunt-xp-val');
          const huntDollarTargetEl = document.getElementById('hunt-dollar-target');
          const huntDollarValEl = document.getElementById('hunt-dollar-val');

          if (activeStat) {
            trEl.innerText = activeStat.trainerName || ('Conta ' + (activeIndex + 1));
            locEl.innerText = activeStat.location || '—';
            monEl.innerText = activeStat.monName || 'Nenhum';
            lvEl.innerText = activeStat.monLv || '—';
            
            if (activeStat.monHp) {
              hpTextEl.innerText = activeStat.monHp;
              hpBarTextEl.innerText = activeStat.monHp;
              const parts = activeStat.monHp.split('/');
              if (parts.length === 2) {
                const cur = parseFloat(parts[0]);
                const max = parseFloat(parts[1]);
                if (max > 0) {
                  const pct = Math.min(100, Math.max(0, (cur / max) * 100));
                  hpFillEl.style.width = pct + '%';
                  if (pct < 25) hpFillEl.style.background = '#f38ba8';
                  else if (pct < 50) hpFillEl.style.background = '#f9e2af';
                  else hpFillEl.style.background = '#a6e3a1';
                }
              }
            } else {
              hpTextEl.innerText = '—';
              hpBarTextEl.innerText = '';
              hpFillEl.style.width = '0%';
            }

            // Update Hunts
            if (activeStat.hunts) {
              const { bestXp, bestDollar } = activeStat.hunts;
              if (bestXp) {
                huntXpTargetEl.innerText = (bestXp.location || bestXp.targetName) + ' (Lv.' + bestXp.huntLevel + ')';
                huntXpValEl.innerText = bestXp.xpFormatted + ' XP/h (' + bestXp.typeEff + 'x)';
              } else {
                huntXpTargetEl.innerText = '—';
                huntXpValEl.innerText = '—';
              }

              if (bestDollar) {
                huntDollarTargetEl.innerText = (bestDollar.location || bestDollar.targetName) + ' (Lv.' + bestDollar.huntLevel + ')';
                huntDollarValEl.innerText = bestDollar.dollarFormatted + ' $/h (' + bestDollar.typeEff + 'x)';
              } else {
                huntDollarTargetEl.innerText = '—';
                huntDollarValEl.innerText = '—';
              }
            } else {
              huntXpTargetEl.innerText = '—';
              huntXpValEl.innerText = '—';
              huntDollarTargetEl.innerText = '—';
              huntDollarValEl.innerText = '—';
            }
          } else {
            trEl.innerText = 'Conta ' + (activeIndex + 1);
            locEl.innerText = '—';
            monEl.innerText = '—';
            lvEl.innerText = '—';
            hpTextEl.innerText = '—';
            hpBarTextEl.innerText = '';
            hpFillEl.style.width = '0%';
            huntXpTargetEl.innerText = '—';
            huntXpValEl.innerText = '—';
            huntDollarTargetEl.innerText = '—';
            huntDollarValEl.innerText = '—';
          }
        }
      </script>
    </body>
    </html>
  `;
  return 'data:text/html,' + encodeURIComponent(html);
}

function updateSidebarActive() {
  if (sidebarView && !sidebarView.webContents.isLoading()) {
    sidebarView.webContents.executeJavaScript(`
      if (typeof updateSidebarActive === 'function') {
        updateSidebarActive('${activeIndex}');
      }
    `).catch(() => {});
  }
}

async function pollStats() {
  const stats = [];
  for (let i = 0; i < contentViews.length; i++) {
    try {
      const data = await contentViews[i].webContents.executeJavaScript(`
        (() => {
          const tname = document.querySelector('.phud-tname')?.innerText.trim() || null;
          const tloc = document.querySelector('.phud-tloc')?.innerText.trim() || '';
          const activeMon = document.querySelector('.phud-mon.active');
          const monName = activeMon?.querySelector('.phud-name')?.innerText.trim() || null;
          const monLv = activeMon?.querySelector('.phud-lv')?.innerText.trim() || null;
          const monHp = activeMon?.querySelector('.sbar-hp .sbar-txt')?.innerText.trim() || null;
          return { trainerName: tname, location: tloc, monName, monLv, monHp };
        })()
      `, true);

      if (data && data.monName) {
        data.hunts = getRecommendedHunts(data.monName, data.monLv);
      }

      stats.push(data);
    } catch (e) {
      stats.push(null);
    }
  }

  if (sidebarView && !sidebarView.webContents.isLoading()) {
    sidebarView.webContents.executeJavaScript(`
      if (typeof updateStats === 'function') {
        updateStats(${JSON.stringify(stats)}, ${activeIndex});
      }
    `).catch(() => {});
  }
}

function layout() {
  const { width, height } = win.getContentBounds();
  sidebarView.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height });

  const contentWidth = width - SIDEBAR_WIDTH;
  contentViews[activeIndex].setBounds({
    x: SIDEBAR_WIDTH, y: 0, width: contentWidth, height
  });
}

function switchTo(index) {
  if (index === activeIndex || index < 0 || index >= contentViews.length) return;
  win.contentView.removeChildView(contentViews[activeIndex]);
  activeIndex = index;
  win.contentView.addChildView(contentViews[activeIndex]);
  layout();
  updateSidebarActive();
  pollStats();
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BaseWindow({ width, height, center: true });

  sidebarView = new WebContentsView();
  sidebarView.webContents.loadURL(buildSidebarHtml());
  sidebarView.webContents.on('will-navigate', (event, targetUrl) => {
    event.preventDefault();
    const index = parseInt(targetUrl.replace('app://', ''), 10);
    switchTo(index);
  });
  win.contentView.addChildView(sidebarView);

  contentViews = ACCOUNTS.map((acc) => {
    const view = new WebContentsView({
      webPreferences: { session: session.fromPartition(acc.partition) }
    });
    view.webContents.loadURL(URL);
    return view;
  });

  win.contentView.addChildView(contentViews[activeIndex]);
  layout();
  updateSidebarActive();
  win.on('resize', layout);

  setInterval(pollStats, 1500);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


