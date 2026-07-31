const { app, BaseWindow, WebContentsView, session, screen, Tray, Menu, nativeImage } = require('electron');
const { getRecommendedHunts } = require('./hunts');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const URL = 'https://poke.idleworld.online/play';

function getLocalAccountsPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'accounts-config.json');
}

function loadAccountsConfig() {
  const filePath = getLocalAccountsPath();
  const defaultAccounts = [
    { label: 'Conta 1', username: '', password: '', partition: 'persist:conta1' },
    { label: 'Conta 2', username: '', password: '', partition: 'persist:conta2' },
    { label: 'Conta 3', username: '', password: '', partition: 'persist:conta3' },
    { label: 'Conta 4', username: '', password: '', partition: 'persist:conta4' }
  ];

  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e) {
    console.error("Erro ao carregar configuracoes locais de contas:", e);
  }
  return defaultAccounts;
}

function saveAccountsConfig(accountsData) {
  try {
    const filePath = getLocalAccountsPath();
    fs.writeFileSync(filePath, JSON.stringify(accountsData, null, 2), 'utf8');
  } catch (e) {
    console.error("Erro ao salvar configuracoes locais de contas:", e);
  }
}

let ACCOUNTS = loadAccountsConfig();
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
        <div style="display: flex; align-items: center; gap: 4px;">
          <button type="button" class="btn-quick-login" onclick="event.preventDefault(); event.stopPropagation(); window.location.href='app://login-${i}';" title="Fazer Login Automático com as credenciais salvas" style="font-size: 10px; background: #313244; color: #a6e3a1; border: 1px solid #45475a; padding: 1px 6px; border-radius: 4px; font-weight: 600; cursor: pointer;">🔑 Login</button>
          <span class="trainer-tag" id="trainer-tag-${i}">Carregando...</span>
        </div>
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
      <!-- Accounts Config Modal -->
      <div id="accounts-modal" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(17, 17, 27, 0.96); z-index: 9999; padding: 12px; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #313244; padding-bottom: 8px; margin-bottom: 10px;">
          <span style="font-weight: 700; color: #f9e2af; font-size: 12px;">🔑 GERENCIAR CONTAS</span>
          <button onclick="closeAccountsModal()" style="background: #313244; color: #cdd6f4; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">✕</button>
        </div>
        <p style="font-size: 10px; color: #a6adc8; margin-top: 0; margin-bottom: 10px; line-height: 1.3;">
          🔒 <b>100% Salvo Localmente ('AppData'):</b> Suas senhas <u>nunca</u> são enviadas ou armazenadas no GitHub.
        </p>

        <div id="acc-inputs-container">
          ${ACCOUNTS.map((acc, i) => `
            <div style="background: #181825; border: 1px solid #313244; border-radius: 6px; padding: 8px; margin-bottom: 8px;">
              <div style="font-size: 11px; font-weight: 700; color: #89b4fa; margin-bottom: 6px;">Conta ${i + 1}</div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <input type="text" id="acc-label-${i}" placeholder="Nome / Apelido" value="${acc.label || ''}" style="background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px; padding: 4px 6px; font-size: 11px;">
                <input type="text" id="acc-user-${i}" placeholder="Login / E-mail" value="${acc.username || ''}" style="background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px; padding: 4px 6px; font-size: 11px;">
                <input type="password" id="acc-pass-${i}" placeholder="Senha" value="${acc.password || ''}" style="background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px; padding: 4px 6px; font-size: 11px;">
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
          <button onclick="saveAccountsModal()" style="background: #a6e3a1; color: #11111b; font-weight: 700; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px;">💾 Salvar Localmente</button>
          <button onclick="autoLoginActive()" style="background: #89b4fa; color: #11111b; font-weight: 700; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px;">🔑 Auto Login na Aba Ativa</button>
        </div>
      </div>

      <div class="sidebar-header" style="justify-content: space-between;">
        <span>🎮 Contas</span>
        <a href="app://open-accounts-modal" id="btn-config-accs" style="color: #89b4fa; text-decoration: none; font-size: 10px; font-weight: 600; background: #1e1e2e; padding: 2px 7px; border-radius: 4px; border: 1px solid #313244;">⚙️ Contas</a>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <div class="hunt-badge xp-badge" style="margin-bottom: 0;">🚀 1ª Opção: Melhor XP/h</div>
            <a href="#" id="btn-go-xp" style="display: none; color: #11111b; background: #a6e3a1; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-decoration: none; font-size: 10px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">Ir ➔</a>
          </div>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <div class="hunt-badge dollar-badge" style="margin-bottom: 0;">💰 2ª Opção: Melhor $/h</div>
            <a href="#" id="btn-go-dollar" style="display: none; color: #11111b; background: #f9e2af; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-decoration: none; font-size: 10px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">Ir ➔</a>
          </div>
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

      <!-- Hunt Analyzer Live Box -->
      <div class="info-panel" style="border-color: #45475a;">
        <div class="panel-title" style="color: #a6e3a1;">📊 Hunt Analyzer</div>
        <div class="info-row">
          <span class="info-label">⚔️ Derrotados:</span>
          <span class="info-val" id="ha-derrotados">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">⏱️ Tempo:</span>
          <span class="info-val" id="ha-tempo">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">✨ XP Ganha:</span>
          <span class="info-val" id="ha-xp" style="color: #a6e3a1;">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">⚾ Capturados:</span>
          <span class="info-val" id="ha-catch" style="color: #f9e2af;">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">💰 Loot:</span>
          <span class="info-val" id="ha-loot" style="color: #a6e3a1;">—</span>
        </div>
        <div class="info-row">
          <span class="info-label">🛒 Supply:</span>
          <span class="info-val" id="ha-supply" style="color: #f38ba8;">—</span>
        </div>
        <div class="info-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed #313244;">
          <span class="info-label">💵 Saldo:</span>
          <span class="info-val" id="ha-saldo" style="font-weight: 700; color: #a6e3a1;">—</span>
        </div>
      </div>

      <script>
        function openAccountsModal() {
          const m = document.getElementById('accounts-modal');
          if (m) m.style.display = 'block';
        }
        function closeAccountsModal() {
          const m = document.getElementById('accounts-modal');
          if (m) m.style.display = 'none';
        }
        function saveAccountsModal() {
          const accs = [];
          const count = ${ACCOUNTS.length};
          for (let i = 0; i < count; i++) {
            const label = document.getElementById('acc-label-' + i)?.value.trim() || ('Conta ' + (i + 1));
            const username = document.getElementById('acc-user-' + i)?.value.trim() || '';
            const password = document.getElementById('acc-pass-' + i)?.value.trim() || '';
            const partition = 'persist:conta' + (i + 1);
            accs.push({ label, username, password, partition });
          }
          window.location.href = 'app://save-accounts-data?json=' + encodeURIComponent(JSON.stringify(accs));
        }
        function autoLoginActive() {
          window.location.href = 'app://auto-login-active';
        }

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
          const btnGoXpEl = document.getElementById('btn-go-xp');
          const btnGoDollarEl = document.getElementById('btn-go-dollar');

          const haDerrotadosEl = document.getElementById('ha-derrotados');
          const haTempoEl = document.getElementById('ha-tempo');
          const haXpEl = document.getElementById('ha-xp');
          const haCatchEl = document.getElementById('ha-catch');
          const haLootEl = document.getElementById('ha-loot');
          const haSupplyEl = document.getElementById('ha-supply');
          const haSaldoEl = document.getElementById('ha-saldo');

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
                const targetName = bestXp.targetName || bestXp.location;
                huntXpTargetEl.innerText = (bestXp.location || targetName) + ' (Lv.' + bestXp.huntLevel + ')';
                huntXpValEl.innerText = bestXp.xpFormatted + ' XP/h (' + bestXp.typeEff + 'x)';
                if (btnGoXpEl) {
                  btnGoXpEl.style.display = 'inline-block';
                  btnGoXpEl.href = 'app://go-to-hunt?target=' + encodeURIComponent(targetName);
                }
              } else {
                huntXpTargetEl.innerText = '—';
                huntXpValEl.innerText = '—';
                if (btnGoXpEl) btnGoXpEl.style.display = 'none';
              }

              if (bestDollar) {
                const targetName = bestDollar.targetName || bestDollar.location;
                huntDollarTargetEl.innerText = (bestDollar.location || targetName) + ' (Lv.' + bestDollar.huntLevel + ')';
                huntDollarValEl.innerText = bestDollar.dollarFormatted + ' $/h (' + bestDollar.typeEff + 'x)';
                if (btnGoDollarEl) {
                  btnGoDollarEl.style.display = 'inline-block';
                  btnGoDollarEl.href = 'app://go-to-hunt?target=' + encodeURIComponent(targetName);
                }
              } else {
                huntDollarTargetEl.innerText = '—';
                huntDollarValEl.innerText = '—';
                if (btnGoDollarEl) btnGoDollarEl.style.display = 'none';
              }
            } else {
              huntXpTargetEl.innerText = '—';
              huntXpValEl.innerText = '—';
              huntDollarTargetEl.innerText = '—';
              huntDollarValEl.innerText = '—';
              if (btnGoXpEl) btnGoXpEl.style.display = 'none';
              if (btnGoDollarEl) btnGoDollarEl.style.display = 'none';
            }

            // Update Hunt Analyzer
            if (activeStat.huntAnalyzer) {
              const ha = activeStat.huntAnalyzer;
              if (haDerrotadosEl) haDerrotadosEl.innerText = ha.derrotados || '0';
              if (haTempoEl) haTempoEl.innerText = ha.tempo || '0s';
              if (haXpEl) haXpEl.innerText = ha.xp || '0';
              if (haCatchEl) haCatchEl.innerText = ha.catch || '0';
              if (haLootEl) haLootEl.innerText = ha.loot || '$0';
              if (haSupplyEl) haSupplyEl.innerText = ha.supply || '-$0';
              if (haSaldoEl) {
                haSaldoEl.innerText = ha.saldo || '+$0';
                if (ha.saldo && ha.saldo.includes('-')) {
                  haSaldoEl.style.color = '#f38ba8';
                } else {
                  haSaldoEl.style.color = '#a6e3a1';
                }
              }
            } else {
              if (haDerrotadosEl) haDerrotadosEl.innerText = '—';
              if (haTempoEl) haTempoEl.innerText = '—';
              if (haXpEl) haXpEl.innerText = '—';
              if (haCatchEl) haCatchEl.innerText = '—';
              if (haLootEl) haLootEl.innerText = '—';
              if (haSupplyEl) haSupplyEl.innerText = '—';
              if (haSaldoEl) {
                haSaldoEl.innerText = '—';
                haSaldoEl.style.color = '#cdd6f4';
              }
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
            if (btnGoXpEl) btnGoXpEl.style.display = 'none';
            if (btnGoDollarEl) btnGoDollarEl.style.display = 'none';
            if (haDerrotadosEl) haDerrotadosEl.innerText = '—';
            if (haTempoEl) haTempoEl.innerText = '—';
            if (haXpEl) haXpEl.innerText = '—';
            if (haCatchEl) haCatchEl.innerText = '—';
            if (haLootEl) haLootEl.innerText = '—';
            if (haSupplyEl) haSupplyEl.innerText = '—';
            if (haSaldoEl) {
              haSaldoEl.innerText = '—';
              haSaldoEl.style.color = '#cdd6f4';
            }
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

async function triggerGoToHunt(targetName) {
  if (activeIndex < 0 || activeIndex >= contentViews.length) return;
  try {
    console.log(`[AUTO-HUNT] Viajando para: "${targetName}" na Conta ${activeIndex + 1}`);

    await contentViews[activeIndex].webContents.executeJavaScript(`
      (async () => {
        const target = ${JSON.stringify(targetName)};
        if (!target) return;

        const targetClean = target.toLowerCase().replace(/[^a-z0-9]/g, '');
        const slug = target.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        const findMarker = () => {
          return document.querySelector('button.hunt-marker[data-guide="hunt-' + slug + '"]') ||
                 document.querySelector('button.hunt-marker[title*="' + target + '"]') ||
                 Array.from(document.querySelectorAll('button.hunt-marker')).find(b => {
                   const title = (b.getAttribute('title') || '').toLowerCase();
                   const name = (b.querySelector('.hunt-name')?.textContent || '').toLowerCase();
                   return title.includes(targetClean) || name.includes(targetClean);
                 });
        };

        // Helper para aguardar o mapa abrir no DOM
        const waitForMap = async (timeoutMs = 1500) => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            if (document.querySelector('.map-body, .map-viewport, .hunt-marker, .map-filter-types')) {
              return true;
            }
            await new Promise(r => setTimeout(r, 100));
          }
          return false;
        };

        // 1. Verificar se o Mapa já está aberto
        let isMapOpen = await waitForMap(200);

        if (!isMapOpen) {
          console.log('[AUTO-HUNT] Mapa fechado. Abrindo mapa...');
          let mapBtn = document.querySelector('button[data-guide="dock-map"], button[data-guide="map"], button[title*="Mapa"], .dock-btn[title*="Mapa"]');
          
          if (!mapBtn) {
            const btns = document.querySelectorAll('button, div[role="button"], a');
            for (const b of btns) {
              const guide = (b.getAttribute('data-guide') || '').toLowerCase();
              const title = (b.getAttribute('title') || '').toLowerCase();
              const txt = (b.textContent || '').toLowerCase();
              if (guide.includes('map') || title.includes('mapa') || txt.includes('mapa')) {
                mapBtn = b;
                break;
              }
            }
          }

          if (mapBtn) {
            mapBtn.click();
          } else {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', keyCode: 77, bubbles: true }));
          }

          // Aguarda o container do mapa aparecer
          isMapOpen = await waitForMap(1500);
        }

        // 2. Tentar achar o marker na aba atual
        let marker = findMarker();

        // 3. Se não encontrou, alternar pelas abas das regiões
        if (!marker && isMapOpen) {
          console.log('[AUTO-HUNT] Hunt não encontrada na aba atual. Buscando em outras regiões...');
          const regions = ['kanto', 'johto', 'outland', 'orre', 'nightmare'];

          const categoryBtns = Array.from(document.querySelectorAll('button, div[role="button"], a, span, .map-tab')).filter(b => {
            const txt = (b.textContent || b.getAttribute('title') || b.className || '').toLowerCase();
            return regions.some(r => txt.includes(r));
          });

          for (const catBtn of categoryBtns) {
            const txt = (catBtn.textContent || catBtn.getAttribute('title') || '').toLowerCase();
            if (txt.includes('indisponivel') || txt.includes('indisponível') || catBtn.disabled) continue;

            console.log('[AUTO-HUNT] Clicando na aba da região: ' + txt.trim());
            catBtn.click();
            await new Promise(r => setTimeout(r, 400));

            marker = findMarker();
            if (marker) break;
          }
        }

        // 4. Clicar no marker e confirmar
        if (marker) {
          console.log('[AUTO-HUNT] Marker localizado! Clicando para viajar para: ' + target);
          marker.click();
          await new Promise(r => setTimeout(r, 200));

          const confirmBtn = document.querySelector('.swal-button--confirm, button.confirm, button[class*="confirm"], button[title*="Sim"]');
          if (confirmBtn) {
            confirmBtn.click();
          }
          return true;
        } else {
          console.error('[AUTO-HUNT] Marker não encontrado para a hunt: ' + target);
          return false;
        }
      })()
    `);
  } catch (e) {
    console.error("Erro ao viajar para hunt:", e);
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

          // Auto-open Hunt Analyzer se não estiver aberto
          let gridCards = document.querySelectorAll('.ha-grid > .ha-card');
          if ((!gridCards || gridCards.length === 0) && !window._haAutoClicked) {
            let btn = document.querySelector('button[data-guide="dock-analyzer"], .dock-btn[data-guide="dock-analyzer"], button[title="Hunt Analyzer"], .dock-btn[title*="Hunt Analyzer"]');
            if (!btn) {
              const img = document.querySelector('img[alt="Hunt Analyzer"], img[src*="analyzer"]');
              if (img) btn = img.closest('button, .dock-btn, a');
            }
            if (btn) {
              window._haAutoClicked = true;
              btn.click();
              gridCards = document.querySelectorAll('.ha-grid > .ha-card');
            }
          }

          // Move a janela do Hunt Analyzer para fora da tela (invisível) para não poluir o jogo
          const haGrid = document.querySelector('.ha-grid');
          if (haGrid) {
            const container = haGrid.closest('[class*="window"], [class*="modal"], [class*="dialog"]') || haGrid.parentElement;
            if (container && !container.dataset.autoManaged) {
              container.dataset.autoManaged = 'true';
              container.style.position = 'absolute';
              container.style.left = '-9999px';
              container.style.opacity = '0';
              container.style.pointerEvents = 'none';
            }
          }

          const haDerrotados = gridCards[0]?.querySelector('b')?.innerText.trim() || '0';
          const haTempo = gridCards[1]?.querySelector('b')?.innerText.trim() || '0s';
          const haXp = document.querySelector('.ha-card.ha-xp b')?.innerText.trim() || '0';
          const haCatch = document.querySelector('.ha-card.ha-catch b')?.innerText.trim() || '0';
          const haLoot = document.querySelector('.ha-card.ha-loot b')?.innerText.trim() || '$0';
          const haSupply = document.querySelector('.ha-card.ha-supply b')?.innerText.trim() || '-$0';
          const haSaldo = document.querySelector('.ha-balance b')?.innerText.trim() || '+$0';

          const huntAnalyzer = {
            derrotados: haDerrotados,
            tempo: haTempo,
            xp: haXp,
            catch: haCatch,
            loot: haLoot,
            supply: haSupply,
            saldo: haSaldo
          };

          return { trainerName: tname, location: tloc, monName, monLv, monHp, huntAnalyzer };
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

async function triggerAutoLogin(accountIndex) {
  const idx = typeof accountIndex === 'number' ? accountIndex : activeIndex;
  if (idx < 0 || idx >= contentViews.length) return;
  const acc = ACCOUNTS[idx];
  if (!acc || (!acc.username && !acc.password)) return;

  try {
    await contentViews[idx].webContents.executeJavaScript(`
      (() => {
        const username = ${JSON.stringify(acc.username || '')};
        const password = ${JSON.stringify(acc.password || '')};

        if (username) {
          const userInputs = document.querySelectorAll('input[name="email"], input[name="username"], input[type="email"], input[type="text"]');
          for (const inp of userInputs) {
            if (inp.offsetParent !== null) {
              inp.focus();
              inp.value = username;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }

        if (password) {
          const passInputs = document.querySelectorAll('input[name="password"], input[type="password"]');
          for (const inp of passInputs) {
            if (inp.offsetParent !== null) {
              inp.focus();
              inp.value = password;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }

        const loginBtn = document.querySelector('button[type="submit"], .btn-login, button.login-btn, button[title*="Entrar"]');
        if (loginBtn && username && password) {
          setTimeout(() => loginBtn.click(), 150);
        }
      })()
    `);
  } catch (e) {
    console.error("Erro no auto login:", e);
  }
}

let tray = null;
let isQuitting = false;

function createTray() {
  const iconBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACNSURBVDhPY/wPBAwUACZcchgAC6hhgJkZgwEkBq6AiYEBA4O9PX416EChw8BAV48uxmEA0YChHl0NXQ2yASAD0O2luhmXASADHkNDuho0gK4H0YAhv5yugWYARQao7iE1m4jVgCktUPsJuhnkAKoBqH34jCFlA1T7cYWhqUFXAwPEmofFAFLsxxWG2AB1AwB9lSjV/w+3twAAAABJRU5ErkJggg==',
    'base64'
  );
  const icon = nativeImage.createFromBuffer(iconBuffer);

  tray = new Tray(icon);
  tray.setToolTip('Poke Idle Multi-Browser');

  updateTrayMenu();

  tray.on('click', () => {
    if (win) {
      if (win.isVisible()) {
        win.focus();
      } else {
        win.show();
        win.focus();
      }
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const autoLaunchEnabled = app.getLoginItemSettings().openAtLogin;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🎮 Abrir Multi-Browser',
      click: () => {
        if (win) {
          win.show();
          win.focus();
        }
      }
    },
    {
      label: '📌 Iniciar com o Windows',
      type: 'checkbox',
      checked: autoLaunchEnabled,
      click: (menuItem) => {
        app.setLoginItemSettings({
          openAtLogin: menuItem.checked,
          openAsHidden: false
        });
        updateTrayMenu();
        if (sidebarView && !sidebarView.webContents.isLoading()) {
          sidebarView.webContents.loadURL(buildSidebarHtml());
        }
      }
    },
    { type: 'separator' },
    {
      label: '❌ Sair Totalmente',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  win = new BaseWindow({ width, height, center: true });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
      return false;
    }
  });

  sidebarView = new WebContentsView();
  sidebarView.webContents.loadURL(buildSidebarHtml());
  sidebarView.webContents.on('will-navigate', (event, targetUrl) => {
    event.preventDefault();
    if (targetUrl.includes('toggle-autostart')) {
      const match = targetUrl.match(/enable=(true|false)/);
      if (match && match[1]) {
        const enable = match[1] === 'true';
        app.setLoginItemSettings({ openAtLogin: enable });
        updateTrayMenu();
      }
      return;
    }
    if (targetUrl.includes('open-accounts-modal')) {
      sidebarView.webContents.executeJavaScript(`if (typeof openAccountsModal === 'function') openAccountsModal();`).catch(() => {});
      return;
    }
    if (targetUrl.includes('save-accounts-data')) {
      const match = targetUrl.match(/json=([^&]+)/);
      if (match && match[1]) {
        try {
          const newAccs = JSON.parse(decodeURIComponent(match[1]));
          saveAccountsConfig(newAccs);
          ACCOUNTS = newAccs;
          sidebarView.webContents.loadURL(buildSidebarHtml());
        } catch (e) {
          console.error("Erro ao salvar contas:", e);
        }
      }
      return;
    }
    if (targetUrl.includes('auto-login-active')) {
      triggerAutoLogin(activeIndex);
      return;
    }
    if (targetUrl.includes('login-')) {
      const match = targetUrl.match(/login-(\d+)/);
      if (match && match[1]) {
        const idx = parseInt(match[1], 10);
        if (!isNaN(idx)) {
          switchTo(idx);
          setTimeout(() => triggerAutoLogin(idx), 200);
        }
      }
      return;
    }
    if (targetUrl.includes('go-to-hunt')) {
      const match = targetUrl.match(/target=([^&]+)/);
      if (match && match[1]) {
        const targetName = decodeURIComponent(match[1]);
        triggerGoToHunt(targetName);
      }
      return;
    }
    const index = parseInt(targetUrl.replace('app://', ''), 10);
    if (!isNaN(index)) switchTo(index);
  });
  win.contentView.addChildView(sidebarView);

  contentViews = ACCOUNTS.map((acc, index) => {
    const view = new WebContentsView({
      webPreferences: { session: session.fromPartition(acc.partition) }
    });
    view.webContents.on('console-message', (event, level, message) => {
      if (message.includes('[AUTO-HUNT]')) {
        console.log(`[Conta ${index + 1} LOG]`, message);
      }
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

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


