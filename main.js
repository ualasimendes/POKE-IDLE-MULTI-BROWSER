const { app, BaseWindow, WebContentsView, session, screen, Tray, Menu, nativeImage, safeStorage } = require('electron');
const { getRecommendedHunts } = require('./hunts');
const path = require('path');
const fs = require('fs');

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const URL = 'https://poke.idleworld.online/play';

function getLocalAccountsPath() {
  const userDataPath = app.getPath('userData');
  const tempPath = path.join(userDataPath, 'accounts.temp');
  const legacyPath = path.join(userDataPath, 'accounts-config.json');

  if (!fs.existsSync(tempPath) && fs.existsSync(legacyPath)) {
    try {
      fs.copyFileSync(legacyPath, tempPath);
      fs.unlinkSync(legacyPath);
    } catch (e) {}
  }

  return tempPath;
}

function encryptPassword(plainText) {
  if (!plainText) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plainText).toString('base64');
    }
  } catch (e) {
    console.error("Erro ao criptografar senha:", e);
  }
  return plainText;
}

function decryptPassword(storedValue) {
  if (!storedValue) return '';
  if (typeof storedValue === 'string' && storedValue.startsWith('enc:')) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const base64Data = storedValue.slice(4);
        return safeStorage.decryptString(Buffer.from(base64Data, 'base64'));
      }
    } catch (e) {
      console.error("Erro ao descriptografar senha:", e);
      return '';
    }
  }
  return storedValue;
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
        return data.map(acc => ({
          ...acc,
          password: decryptPassword(acc.password)
        }));
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
    const encryptedData = accountsData.map(acc => ({
      ...acc,
      password: encryptPassword(acc.password)
    }));
    fs.writeFileSync(filePath, JSON.stringify(encryptedData, null, 2), 'utf8');
  } catch (e) {
    console.error("Erro ao salvar configuracoes locais de contas:", e);
  }
}

let ACCOUNTS = [];
let autoModeEnabledList = [true, true, true, true];
let isGridMode = false;
let alertCooldowns = {};
const SIDEBAR_WIDTH = 260;

function showDesktopNotification(title, body) {
  try {
    const { Notification } = require('electron');
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  } catch (e) {}
}

function playAudioBeep() {
  if (sidebarView && !sidebarView.webContents.isLoading()) {
    sidebarView.webContents.executeJavaScript(`if (typeof playAlertBeep === 'function') playAlertBeep();`).catch(() => {});
  }
}

function attachHotkeys(view) {
  if (!view || !view.webContents) return;
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isCtrl = input.control || input.meta;
    const isShift = input.shift;

    if (isCtrl && !isShift) {
      if (input.code === 'Digit1' || input.key === '1') { event.preventDefault(); switchTo(0); }
      else if (input.code === 'Digit2' || input.key === '2') { event.preventDefault(); switchTo(1); }
      else if (input.code === 'Digit3' || input.key === '3') { event.preventDefault(); switchTo(2); }
      else if (input.code === 'Digit4' || input.key === '4') { event.preventDefault(); switchTo(3); }
    } else if (isCtrl && isShift) {
      if (input.code === 'KeyA' || input.key === 'A' || input.key === 'a') {
        event.preventDefault();
        const allEnabled = autoModeEnabledList.every(v => v);
        autoModeEnabledList = autoModeEnabledList.map(() => !allEnabled);
        sidebarView.webContents.loadURL(buildSidebarHtml());
        pollStats();
      } else if (input.code === 'KeyG' || input.key === 'G' || input.key === 'g') {
        event.preventDefault();
        isGridMode = !isGridMode;
        layout();
        sidebarView.webContents.loadURL(buildSidebarHtml());
      }
    }
  });
}

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
        /* Thin custom scrollbar */
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #11111b; }
        ::-webkit-scrollbar-thumb { background: #313244; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #45475a; }

        .sidebar-header {
          padding: 8px 10px 6px;
          border-bottom: 1px solid #313244;
          font-weight: 700;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #89b4fa;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .items-container {
          padding: 4px 6px;
        }
        .item {
          display: block;
          padding: 5px 8px;
          margin-bottom: 3px;
          color: #cdd6f4;
          text-decoration: none;
          background: #1e1e2e;
          border-radius: 6px;
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
          box-shadow: 0 0 8px rgba(137, 180, 250, 0.15);
        }
        .item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
          font-weight: 600;
        }
        .item.active .item-title {
          color: #89b4fa;
        }
        .trainer-tag {
          font-size: 9px;
          background: #313244;
          color: #a6adc8;
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 400;
          max-width: 90px;
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
          margin-top: 2px;
          font-size: 10px;
          color: #bac2de;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .mon-lv {
          font-size: 9px;
          background: #fab387;
          color: #11111b;
          font-weight: 700;
          padding: 0px 3px;
          border-radius: 2px;
        }

        /* Panels Below Sidebar */
        .info-panel {
          margin: 4px 6px;
          padding: 6px 8px;
          background: #181825;
          border: 1px solid #313244;
          border-radius: 6px;
        }
        .panel-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: #f9e2af;
          margin-bottom: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 2px;
          font-size: 11px;
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
          margin-top: 2px;
          background: #313244;
          border-radius: 3px;
          height: 10px;
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
          font-size: 8px;
          font-weight: 700;
          color: #11111b;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Hunt Cards */
        .hunt-card {
          background: #1e1e2e;
          padding: 4px 6px;
          border-radius: 5px;
          border-left: 3px solid #89b4fa;
          margin-top: 4px;
        }
        .hunt-badge {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          display: inline-block;
          margin-bottom: 1px;
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
                <input type="password" id="acc-pass-${i}" placeholder="Senha" value="${acc.password ? '••••••••' : ''}" style="background: #1e1e2e; color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px; padding: 4px 6px; font-size: 11px;">
              </div>
            </div>
          `).join('')}
        </div>

        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 10px;">
          <button onclick="saveAccountsModal()" style="background: #a6e3a1; color: #11111b; font-weight: 700; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px;">💾 Salvar Criptografado</button>
          <div style="display: flex; gap: 6px;">
            <button onclick="window.location.href='app://export-accounts-backup';" style="flex: 1; background: #fab387; color: #11111b; font-weight: 700; border: none; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 10px;">📤 Exportar Backup</button>
            <button onclick="window.location.href='app://import-accounts-backup';" style="flex: 1; background: #cba6f7; color: #11111b; font-weight: 700; border: none; padding: 6px; border-radius: 6px; cursor: pointer; font-size: 10px;">📥 Importar Backup</button>
          </div>
          <button onclick="autoLoginActive()" style="background: #89b4fa; color: #11111b; font-weight: 700; border: none; padding: 7px; border-radius: 6px; cursor: pointer; font-size: 11px;">🔑 Auto Login na Aba Ativa</button>
        </div>
      </div>

      <div class="sidebar-header" style="justify-content: space-between;">
        <span>🎮 Contas</span>
        <div style="display: flex; align-items: center; gap: 4px;">
          <a href="app://toggle-grid-mode" id="btn-grid-toggle" title="Alternar visão entre Aba Única e Grid 2x2 simultâneo (Ctrl+Shift+G)" style="color: ${isGridMode ? '#11111b' : '#a6e3a1'}; background: ${isGridMode ? '#a6e3a1' : '#1e1e2e'}; text-decoration: none; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; border: 1px solid #45475a;">
            ${isGridMode ? '🔲 2x2' : '🖥️ Única'}
          </a>
          <a href="app://open-accounts-modal" id="btn-config-accs" style="color: #89b4fa; text-decoration: none; font-size: 10px; font-weight: 600; background: #1e1e2e; padding: 2px 6px; border-radius: 4px; border: 1px solid #313244;">⚙️ Contas</a>
        </div>
      </div>

      <div class="items-container">
        ${items}
      </div>

      <!-- Master Automation Toggle Box -->
      <div class="info-panel" style="border-color: ${autoModeEnabledList[activeIndex] ? '#a6e3a1' : '#f38ba8'}; background: #1e1e2e; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 700; color: #cdd6f4;">🤖 Jogo Automático</span>
          <a href="app://toggle-auto-mode" id="btn-master-auto" title="Ativar/Desativar Automação (Ctrl+Shift+A)" style="color: #11111b; background: ${autoModeEnabledList[activeIndex] ? '#a6e3a1' : '#f38ba8'}; font-weight: 700; padding: 4px 10px; border-radius: 6px; text-decoration: none; font-size: 11px; transition: all 0.2s;">
            ${autoModeEnabledList[activeIndex] ? '🟢 ATIVADO' : '🔴 DESATIVADO'}
          </a>
        </div>
        <div style="font-size: 10px; color: #a6adc8; margin-top: 6px; line-height: 1.3;" id="auto-mode-desc">
          ${autoModeEnabledList[activeIndex] ? '✨ Janelas ocultas, auto-hunt, auto-helper & restock ativos.' : '🎮 Modo Manual: O jogador controla tudo. Opacidade normal.'}
        </div>
      </div>

      <!-- Active Tab Status Box -->
      <div class="info-panel">
        <div class="panel-title" onclick="toggleAccordion('panel-status')" style="cursor: pointer; justify-content: space-between; margin-bottom: 0;">
          <span>⚡ Status da Aba Ativa</span>
          <span id="icon-panel-status" style="font-size: 10px; color: #89b4fa;">[−]</span>
        </div>
        <div id="body-panel-status" style="margin-top: 4px;">
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
      </div>

      <!-- PIWTools Hunt Recommendations Box -->
      <div class="info-panel" style="border-color: #45475a;">
        <div class="panel-title" onclick="toggleAccordion('panel-hunts')" style="cursor: pointer; color: #89b4fa; justify-content: space-between; margin-bottom: 0;">
          <span>🎯 Melhores Hunts (PIWTools)</span>
          <span id="icon-panel-hunts" style="font-size: 10px; color: #89b4fa;">[−]</span>
        </div>
        
        <div id="body-panel-hunts" style="margin-top: 4px;">
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
      </div>

      <!-- Hunt Analyzer Live Box -->
      <div class="info-panel" style="border-color: #45475a;">
        <div class="panel-title" onclick="toggleAccordion('panel-ha')" style="cursor: pointer; color: #a6e3a1; justify-content: space-between; margin-bottom: 0;">
          <span>📊 Hunt Analyzer</span>
          <span id="icon-panel-ha" style="font-size: 10px; color: #89b4fa;">[−]</span>
        </div>
        <div id="body-panel-ha" style="margin-top: 4px;">
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
      </div>

      <!-- Auto-Helper & Supply Status Box -->
      <div class="info-panel" style="border-color: #45475a;">
        <div class="panel-title" onclick="toggleAccordion('panel-ah')" style="cursor: pointer; color: #fab387; justify-content: space-between; margin-bottom: 0;">
          <span>⚙️ Auto-Helper & Suprimentos</span>
          <span id="icon-panel-ah" style="font-size: 10px; color: #89b4fa;">[−]</span>
        </div>
        <div id="body-panel-ah" style="margin-top: 4px;">
          <div class="info-row">
            <span class="info-label">🧪 Auto-Potion:</span>
            <span class="info-val" id="ah-potion-status">—</span>
          </div>
          <div class="info-row">
            <span class="info-label">💖 Auto-Revive:</span>
            <span class="info-val" id="ah-revive-status">—</span>
          </div>
          <div class="info-row">
            <span class="info-label">⚾ Auto-Catch:</span>
            <span class="info-val" id="ah-catch-status">—</span>
          </div>
          <div class="info-row">
            <span class="info-label">✨ Shiny Catch:</span>
            <span class="info-val" id="ah-shiny-status">—</span>
          </div>
          <div class="info-row" style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed #313244;">
            <span class="info-label">🛒 Restock Auto:</span>
            <span class="info-val" id="ah-market-status" style="font-weight: 700; color: #a6e3a1;">—</span>
          </div>
        </div>
      </div>

      <!-- LivePix Donation QR Code Panel -->
      <div class="info-panel" style="border-color: #f5c2e7;">
        <div class="panel-title" onclick="toggleAccordion('panel-pix')" style="cursor: pointer; color: #f5c2e7; justify-content: space-between; margin-bottom: 0;">
          <span>💖 Apoie o Projeto (Pix LivePix)</span>
          <span id="icon-panel-pix" style="font-size: 10px; color: #89b4fa;">[−]</span>
        </div>
        <div id="body-panel-pix" style="margin-top: 6px; text-align: center;">
          <iframe src="https://widget.livepix.gg/embed/d0aaadfc-4b9e-491c-b2ef-ee4f4ac5d6f6" style="width: 100%; height: 260px; border: none; border-radius: 6px; background: #181825;" allow="autoplay"></iframe>
        </div>
      </div>

      <!-- LivePix Alert Overlay (Sincronizacao de Doacoes em Tempo Real: Audio, Foto e Mensagem Centralizados) -->
      <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 500px; height: 350px; pointer-events: none; z-index: 999999; display: flex; align-items: center; justify-content: center;">
        <iframe src="https://widget.livepix.gg/embed/40b17c8c-2f24-493a-a432-c8b1fec2627e" style="width: 100%; height: 100%; border: none; background: transparent;" allow="autoplay"></iframe>
      </div>

      <script>
        function playAlertBeep() {
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
          } catch(e) {}
        }

        function toggleAccordion(panelId) {
          const bodyEl = document.getElementById('body-' + panelId);
          const iconEl = document.getElementById('icon-' + panelId);
          if (bodyEl && iconEl) {
            const isHidden = bodyEl.style.display === 'none';
            bodyEl.style.display = isHidden ? 'block' : 'none';
            iconEl.innerText = isHidden ? '[−]' : '[+]';
          }
        }

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

          const ahPotionEl = document.getElementById('ah-potion-status');
          const ahReviveEl = document.getElementById('ah-revive-status');
          const ahCatchEl = document.getElementById('ah-catch-status');
          const ahShinyEl = document.getElementById('ah-shiny-status');
          const ahMarketEl = document.getElementById('ah-market-status');

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

            // Update Auto-Helper & Suprimentos
            if (activeStat.autoHelperConfig) {
              const ah = activeStat.autoHelperConfig;

              if (ahPotionEl) {
                if (ah.autoPotionEnabled) {
                  ahPotionEl.innerHTML = '<span style="color:#a6e3a1; font-weight: 700;">ON</span> (' + ah.selectedPotion + ': <b>' + ah.selectedPotionQty + '</b>)';
                } else {
                  ahPotionEl.innerHTML = '<span style="color:#9399b2;">OFF</span>';
                }
              }

              if (ahReviveEl) {
                if (ah.autoReviveEnabled) {
                  ahReviveEl.innerHTML = '<span style="color:#a6e3a1; font-weight: 700;">ON</span> (Revive: <b>' + ah.reviveQty + '</b>)';
                } else {
                  ahReviveEl.innerHTML = '<span style="color:#9399b2;">OFF</span>';
                }
              }

              if (ahCatchEl) {
                if (ah.autoCatchEnabled) {
                  ahCatchEl.innerHTML = '<span style="color:#a6e3a1; font-weight: 700;">ON</span> (' + ah.selectedBall + ': <b>' + ah.selectedBallQty + '</b>)';
                } else {
                  ahCatchEl.innerHTML = '<span style="color:#9399b2;">OFF</span>';
                }
              }

              if (ahShinyEl) {
                if (ah.autoCatchShinyEnabled) {
                  ahShinyEl.innerHTML = '<span style="color:#a6e3a1; font-weight: 700;">ON</span> (' + ah.selectedShinyBall + ': <b>' + ah.selectedShinyBallQty + '</b>)';
                } else {
                  ahShinyEl.innerHTML = '<span style="color:#9399b2;">OFF</span>';
                }
              }

              if (ahMarketEl) {
                ahMarketEl.innerText = ah.statusText || 'OK';
                if (ah.statusText && ah.statusText.includes('Comprando')) {
                  ahMarketEl.style.color = '#f9e2af';
                } else {
                  ahMarketEl.style.color = '#a6e3a1';
                }
              }
            } else {
              if (ahPotionEl) ahPotionEl.innerText = '—';
              if (ahReviveEl) ahReviveEl.innerText = '—';
              if (ahCatchEl) ahCatchEl.innerText = '—';
              if (ahShinyEl) ahShinyEl.innerText = '—';
              if (ahMarketEl) ahMarketEl.innerText = '—';
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
            if (ahPotionEl) ahPotionEl.innerText = '—';
            if (ahReviveEl) ahReviveEl.innerText = '—';
            if (ahCatchEl) ahCatchEl.innerText = '—';
            if (ahShinyEl) ahShinyEl.innerText = '—';
            if (ahMarketEl) ahMarketEl.innerText = '—';
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
  if (!autoModeEnabledList[activeIndex]) {
    console.log(`[AUTO-HUNT] Modo manual ativo para Conta ${activeIndex + 1}. Viagem automática ignorada.`);
    return;
  }
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

function pollStats() {
  // handled below
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
  if (!acc) return;

  const plainPassword = decryptPassword(acc.password || '');
  const username = acc.username || '';
  if (!username && !plainPassword) return;

  try {
    console.log(`[AUTO-LOGIN] Executando login automático para Conta ${idx + 1} (${username})...`);
    await contentViews[idx].webContents.executeJavaScript(`
      (() => {
        const username = ${JSON.stringify(username)};
        const password = ${JSON.stringify(plainPassword)};

        function setInputValue(inputEl, val) {
          if (!inputEl || !val) return;
          inputEl.focus();
          try {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(inputEl, val);
            } else {
              inputEl.value = val;
            }
          } catch (e) {
            inputEl.value = val;
          }
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          inputEl.dispatchEvent(new Event('blur', { bubbles: true }));
        }

        const allInputs = Array.from(document.querySelectorAll('input'));

        // 1. Password input MUST be type="password" or name/id containing pass
        let passInput = allInputs.find(inp => {
          const type = (inp.type || '').toLowerCase();
          const name = (inp.name || '').toLowerCase();
          const id = (inp.id || '').toLowerCase();
          const autocomplete = (inp.getAttribute('autocomplete') || '').toLowerCase();
          return type === 'password' || name.includes('pass') || id.includes('pass') || autocomplete.includes('password');
        });

        // 2. Username input MUST NOT be the password input!
        let userInputs = allInputs.filter(inp => {
          if (inp === passInput) return false;
          const type = (inp.type || '').toLowerCase();
          return type === 'text' || type === 'email' || type === '' || type === 'username';
        });

        let userInput = userInputs.find(inp => {
          const name = (inp.name || '').toLowerCase();
          const id = (inp.id || '').toLowerCase();
          const ph = (inp.placeholder || '').toLowerCase();
          return name.includes('user') || name.includes('email') || name.includes('login') ||
                 id.includes('user') || id.includes('email') || id.includes('login') ||
                 ph.includes('user') || ph.includes('email') || ph.includes('login') || ph.includes('usuário');
        }) || userInputs[0];

        if (userInput && username) {
          setInputValue(userInput, username);
        }

        if (passInput && password) {
          setInputValue(passInput, password);
        }

        const loginBtn = document.querySelector('button[type="submit"], .btn-login, button.login-btn, button[title*="Entrar"], button[title*="Login"]');
        if (loginBtn && username && password) {
          setTimeout(() => {
            loginBtn.click();
            // Observa e fecha a overlay de promoção (.promo-close) imediatamente
            const promoCheckInterval = setInterval(() => {
              const promoBtn = document.querySelector('.promo-overlay .promo-close, button.promo-close, .promo-box button.promo-close');
              if (promoBtn) {
                promoBtn.click();
                clearInterval(promoCheckInterval);
              }
            }, 200);
            setTimeout(() => clearInterval(promoCheckInterval), 10000);
          }, 250);
        }
      })()
    `);
  } catch (e) {
    console.error("Erro no auto login:", e);
  }
}

async function pollStats() {
  const stats = [];
  for (let i = 0; i < contentViews.length; i++) {
    try {
      const isAutoActive = !!autoModeEnabledList[i];
      const data = await contentViews[i].webContents.executeJavaScript(`
        (() => {
          const isAutoActive = ${JSON.stringify(isAutoActive)};

          // Auto-close overlay de promoção se estiver visível
          const promoCloseBtn = document.querySelector('.promo-overlay .promo-close, button.promo-close, .promo-box button.promo-close');
          if (promoCloseBtn) {
            promoCloseBtn.click();
          }

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

          // Controle de visibilidade do Hunt Analyzer
          const haGrid = document.querySelector('.ha-grid');
          if (haGrid) {
            const container = haGrid.closest('[class*="window"], [class*="modal"], [class*="dialog"]') || haGrid.parentElement;
            if (container) {
              if (isAutoActive) {
                container.style.position = 'absolute';
                container.style.left = '-9999px';
                container.style.opacity = '0';
                container.style.pointerEvents = 'none';
              } else {
                container.style.position = '';
                container.style.left = '';
                container.style.opacity = '1';
                container.style.pointerEvents = 'auto';
              }
            }
          }

          // Controle de visibilidade do Auto-Helper
          let ahBody = document.querySelector('.ah-body');
          let ahPanel = document.querySelector('.ah-panel');
          const ahHead = document.querySelector('button.ah-head, .ah-panel button.ah-head');

          if (isAutoActive) {
            if (!ahBody && !window._ahAutoOpened && ahHead) {
              window._ahAutoOpened = true;
              ahHead.click();
              ahBody = document.querySelector('.ah-body');
            }
            const ahTarget = ahBody?.closest('[class*="window"], [class*="panel"]') || ahPanel || ahBody;
            if (ahTarget) {
              ahTarget.style.position = 'absolute';
              ahTarget.style.left = '-9999px';
              ahTarget.style.opacity = '0';
              ahTarget.style.pointerEvents = 'none';
            }
          } else {
            const ahTarget = ahBody?.closest('[class*="window"], [class*="panel"]') || ahPanel || ahBody;
            if (ahTarget) {
              ahTarget.style.position = '';
              ahTarget.style.left = '';
              ahTarget.style.opacity = '1';
              ahTarget.style.pointerEvents = 'auto';
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

          // ==========================================
          // AUTO-HELPER & INVENTORY MONITORING & BUY
          // ==========================================

          // Auto-open Auto-Helper panel once if ah-body is missing so we can inspect settings
          ahBody = document.querySelector('.ah-body');
          if (!ahBody && !window._ahAutoOpened) {
            const ahHead = document.querySelector('button.ah-head, .ah-panel button.ah-head');
            if (ahHead) {
              window._ahAutoOpened = true;
              ahHead.click();
              ahBody = document.querySelector('.ah-body');
            }
          }

          // Parse Inventory Quantities
          const getInvQty = (namePattern) => {
            if (!namePattern) return 0;
            const pattern = namePattern.toLowerCase();
            const slots = document.querySelectorAll('.inv-grid .inv-slot');
            for (const slot of slots) {
              const img = slot.querySelector('img');
              const alt = (img?.getAttribute('alt') || '').toLowerCase();
              const title = (slot.getAttribute('title') || '').toLowerCase();
              const guide = (slot.getAttribute('data-guide') || '').toLowerCase();

              if (alt.includes(pattern) || title.includes(pattern) || guide.includes(pattern)) {
                const qtySpan = slot.querySelector('.inv-qty');
                if (qtySpan) {
                  const val = parseInt(qtySpan.textContent.replace(/\D/g, ''), 10);
                  return isNaN(val) ? 1 : val;
                }
                return 1;
              }
            }
            return 0;
          };

          // Helper to read Auto-Helper Config
          const autoHelperConfig = {
            autoPotionEnabled: false,
            selectedPotion: 'Automático (melhor)',
            selectedPotionQty: 0,
            healHpPercent: '50%',

            autoReviveEnabled: false,
            reviveQty: 0,

            autoCatchEnabled: false,
            selectedBall: 'Ultra Ball',
            selectedBallQty: 0,

            autoCatchShinyEnabled: false,
            selectedShinyBall: 'Ultra Ball',
            selectedShinyBallQty: 0,

            statusText: 'OK'
          };

          if (ahBody) {
            const rows = Array.from(ahBody.querySelectorAll('.ah-row'));

            // 1. Auto-Potion
            const potionRow = rows.find(r => r.textContent.includes('Auto-Potion'));
            if (potionRow) {
              const cb = potionRow.querySelector('input[type="checkbox"]');
              autoHelperConfig.autoPotionEnabled = cb ? cb.checked : potionRow.classList.contains('on');
              
              const sub = potionRow.nextElementSibling;
              if (sub && sub.classList.contains('ah-sub')) {
                const selects = sub.querySelectorAll('select.ah-sel');
                if (selects[0]) {
                  const opt = selects[0].options[selects[0].selectedIndex];
                  autoHelperConfig.selectedPotion = opt ? opt.text.split('×')[0].trim() : 'Automático (melhor)';
                }
                if (selects[1]) {
                  autoHelperConfig.healHpPercent = selects[1].value + '%';
                }
              }
            }

            // 2. Auto-Revive
            const reviveRow = rows.find(r => r.textContent.includes('Auto-Revive'));
            if (reviveRow) {
              const cb = reviveRow.querySelector('input[type="checkbox"]');
              autoHelperConfig.autoReviveEnabled = cb ? cb.checked : reviveRow.classList.contains('on');
            }

            // 3. Auto-Catch Normal
            const catchRow = rows.find(r => r.textContent.includes('Auto-Catch') && !r.textContent.includes('Shiny'));
            if (catchRow) {
              const cb = catchRow.querySelector('input[type="checkbox"]');
              autoHelperConfig.autoCatchEnabled = cb ? cb.checked : catchRow.classList.contains('on');

              const sub = catchRow.nextElementSibling;
              if (sub && sub.classList.contains('ah-sub')) {
                const chipOn = sub.querySelector('.cap-chip.on');
                if (chipOn) {
                  autoHelperConfig.selectedBall = chipOn.getAttribute('title') || chipOn.querySelector('img')?.getAttribute('alt') || 'Ultra Ball';
                }
              }
            }

            // 4. Auto-Catch Shiny
            const catchShinyRow = rows.find(r => r.textContent.includes('Auto-Catch Shiny'));
            if (catchShinyRow) {
              const cb = catchShinyRow.querySelector('input[type="checkbox"]');
              autoHelperConfig.autoCatchShinyEnabled = cb ? cb.checked : catchShinyRow.classList.contains('on');

              const sub = catchShinyRow.nextElementSibling;
              if (sub && sub.classList.contains('ah-sub')) {
                const chipOn = sub.querySelector('.cap-chip.on');
                if (chipOn) {
                  autoHelperConfig.selectedShinyBall = chipOn.getAttribute('title') || chipOn.querySelector('img')?.getAttribute('alt') || 'Ultra Ball';
                }
              }
            }
          }

          // Calculate inventory quantities
          if (autoHelperConfig.selectedPotion.includes('Automático')) {
            autoHelperConfig.selectedPotionQty = 
              getInvQty('small potion') + 
              getInvQty('great potion') + 
              getInvQty('ultra potion') + 
              getInvQty('hyper potion') + 
              getInvQty('ultimate potion');
          } else {
            autoHelperConfig.selectedPotionQty = getInvQty(autoHelperConfig.selectedPotion);
          }

          autoHelperConfig.reviveQty = getInvQty('revive') + getInvQty('max revive');
          autoHelperConfig.selectedBallQty = getInvQty(autoHelperConfig.selectedBall);
          autoHelperConfig.selectedShinyBallQty = getInvQty(autoHelperConfig.selectedShinyBall);

          // Determine items that need auto-restocking (low stock threshold)
          window._lastBuyTime = window._lastBuyTime || {};
          const LOW_STOCK_THRESHOLD = 15;
          const COOLDOWN_MS = 20000;

          let itemToBuy = null;

          if (autoHelperConfig.autoCatchEnabled && autoHelperConfig.selectedBallQty <= LOW_STOCK_THRESHOLD) {
            itemToBuy = autoHelperConfig.selectedBall;
          } else if (autoHelperConfig.autoCatchShinyEnabled && autoHelperConfig.selectedShinyBallQty <= LOW_STOCK_THRESHOLD) {
            itemToBuy = autoHelperConfig.selectedShinyBall;
          } else if (autoHelperConfig.autoPotionEnabled && autoHelperConfig.selectedPotionQty <= LOW_STOCK_THRESHOLD) {
            if (autoHelperConfig.selectedPotion.includes('Automático')) {
              itemToBuy = 'Ultra Potion';
            } else {
              itemToBuy = autoHelperConfig.selectedPotion;
            }
          } else if (autoHelperConfig.autoReviveEnabled && autoHelperConfig.reviveQty <= 5) {
            itemToBuy = 'Revive';
          }

          if (itemToBuy && !window._autoMarketBuying) {
            const lastBuy = window._lastBuyTime[itemToBuy] || 0;
            if (Date.now() - lastBuy > COOLDOWN_MS) {
              window._autoMarketBuying = true;
              window._lastBuyTime[itemToBuy] = Date.now();
              autoHelperConfig.statusText = '🛒 Comprando ' + itemToBuy + '...';

              (async () => {
                try {
                  console.log('[AUTO-BUY] Suprimento baixo detectado para: "' + itemToBuy + '". Iniciando compra no Mercado...');

                  // Step 1: Open Market if not already open
                  let mkWin = document.querySelector('.mk-window');
                  if (!mkWin) {
                    const mktBtn = document.querySelector('button.market-cta, .market-cta');
                    if (mktBtn) {
                      mktBtn.click();
                      await new Promise(r => setTimeout(r, 400));
                    }
                  }

                  // Step 2: Talk to Mark NPC if NPC dialog is visible
                  mkWin = document.querySelector('.mk-window');
                  if (!mkWin) {
                    const talkBtn = document.querySelector('.npc-plate-btn, button[class*="npc-plate-btn"]');
                    if (talkBtn) {
                      talkBtn.click();
                      await new Promise(r => setTimeout(r, 400));
                    }
                  }

                  // Step 3: Open Shop from NPC Dialog
                  mkWin = document.querySelector('.mk-window');
                  if (!mkWin) {
                    const shopBtn = document.querySelector('.npc-dlg-btn, button[class*="npc-dlg-btn"]');
                    if (shopBtn) {
                      shopBtn.click();
                      await new Promise(r => setTimeout(r, 500));
                    }
                  }

                  // Step 4: Maximize quantity to 1000 in market window
                  mkWin = document.querySelector('.mk-window');
                  if (mkWin) {
                    const slider = mkWin.querySelector('.mk-qtyslider');
                    const qtyInput = mkWin.querySelector('.mk-qty');

                    if (slider) {
                      slider.value = 1000;
                      slider.dispatchEvent(new Event('input', { bubbles: true }));
                      slider.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    if (qtyInput) {
                      qtyInput.value = 1000;
                      qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
                      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    await new Promise(r => setTimeout(r, 150));

                    // Step 5: Locate row matching itemToBuy and click Comprar
                    const rows = Array.from(mkWin.querySelectorAll('.mk-list .mk-row'));
                    const targetRow = rows.find(r => {
                      const nameText = (r.querySelector('.mk-name')?.textContent || '').toLowerCase();
                      return nameText.includes(itemToBuy.toLowerCase());
                    });

                    if (targetRow) {
                      const buyBtn = targetRow.querySelector('.mk-buy');
                      if (buyBtn) {
                        buyBtn.click();
                        console.log('[AUTO-BUY] Botão Comprar clicado com sucesso para: ' + itemToBuy + ' (x1000)!');
                        await new Promise(r => setTimeout(r, 400));
                      }
                    } else {
                      console.warn('[AUTO-BUY] Item não encontrado na lista da Loja:', itemToBuy);
                    }

                    // Step 6: Close Market window
                    const closeBtn = mkWin.querySelector('.cfg-x, button[aria-label="Fechar"]');
                    if (closeBtn) closeBtn.click();

                    const npcDlgClose = document.querySelector('.npc-dialog .cfg-x');
                    if (npcDlgClose) npcDlgClose.click();
                  }
                } catch (e) {
                  console.error('[AUTO-BUY] Erro no fluxo de compra automática:', e);
                } finally {
                  window._autoMarketBuying = false;
                }
              })();
            } else {
              autoHelperConfig.statusText = '⏳ Cooldown ' + itemToBuy;
            }
          } else if (!itemToBuy) {
            autoHelperConfig.statusText = '✅ OK (Estoque Suficiente)';
          }

          return { trainerName: tname, location: tloc, monName, monLv, monHp, huntAnalyzer, autoHelperConfig };
        })()
      `, true);

      if (data && data.monName) {
        data.hunts = getRecommendedHunts(data.monName, data.monLv);
      }

      // Alertas de Notificação do Sistema (Desktop & Som)
      const now = Date.now();
      if (data && data.monHp) {
        const hpVal = parseInt(data.monHp.replace(/\D/g, ''), 10);
        if (!isNaN(hpVal) && hpVal > 0 && hpVal <= 20) {
          const lastHpAlert = alertCooldowns['hp_' + i] || 0;
          if (now - lastHpAlert > 45000) {
            alertCooldowns['hp_' + i] = now;
            showDesktopNotification(`⚠️ HP Crítico (${data.monHp})`, `Conta ${i + 1} (${data.trainerName || 'Treinador'} - ${data.monName || 'Pokémon'}) está com vida baixa!`);
            playAudioBeep();
          }
        }
      }

      if (data && (
        (data.monName && data.monName.toLowerCase().includes('shiny')) ||
        (data.autoHelperConfig && data.autoHelperConfig.statusText && data.autoHelperConfig.statusText.toLowerCase().includes('shiny'))
      )) {
        const lastShinyAlert = alertCooldowns['shiny_' + i] || 0;
        if (now - lastShinyAlert > 60000) {
          alertCooldowns['shiny_' + i] = now;
          showDesktopNotification('✨ Pokémon SHINY Encontrado!', `Atenção na Conta ${i + 1} (${data.trainerName || 'Treinador'}): Shiny localizado!`);
          playAudioBeep();
        }
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
  if (!win || !sidebarView || contentViews.length === 0) return;
  const { width, height } = win.getContentBounds();
  sidebarView.setBounds({ x: 0, y: 0, width: SIDEBAR_WIDTH, height });

  const contentWidth = width - SIDEBAR_WIDTH;

  if (isGridMode) {
    // Remover todas as views antes de reordenar no grid 2x2
    contentViews.forEach(v => {
      try { win.contentView.removeChildView(v); } catch(e) {}
    });

    const cols = 2;
    const rows = 2;
    const cellWidth = Math.floor(contentWidth / cols);
    const cellHeight = Math.floor(height / rows);

    contentViews.forEach((v, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      v.setBounds({
        x: SIDEBAR_WIDTH + (col * cellWidth),
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight
      });
      win.contentView.addChildView(v);
    });
  } else {
    // Modo Aba Única
    contentViews.forEach((v, idx) => {
      if (idx !== activeIndex) {
        try { win.contentView.removeChildView(v); } catch(e) {}
      }
    });

    contentViews[activeIndex].setBounds({
      x: SIDEBAR_WIDTH, y: 0, width: contentWidth, height
    });

    try { win.contentView.addChildView(contentViews[activeIndex]); } catch(e) {}
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
  ACCOUNTS = loadAccountsConfig();
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
          const sanitizedAccs = newAccs.map((acc, idx) => {
            let pass = acc.password;
            if (pass === '••••••••' && ACCOUNTS[idx]) {
              pass = ACCOUNTS[idx].password || '';
            }
            return { ...acc, password: pass };
          });
          saveAccountsConfig(sanitizedAccs);
          ACCOUNTS = sanitizedAccs;
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
    if (targetUrl.includes('toggle-grid-mode')) {
      isGridMode = !isGridMode;
      layout();
      sidebarView.webContents.loadURL(buildSidebarHtml());
      return;
    }
    if (targetUrl.includes('export-accounts-backup')) {
      (async () => {
        try {
          const { dialog } = require('electron');
          const result = await dialog.showSaveDialog(win, {
            title: 'Exportar Backup Criptografado de Contas',
            defaultPath: 'poke-accounts-backup.json',
            filters: [{ name: 'JSON', extensions: ['json'] }]
          });
          if (!result.canceled && result.filePath) {
            const currentPath = getLocalAccountsPath();
            if (fs.existsSync(currentPath)) {
              fs.copyFileSync(currentPath, result.filePath);
              console.log('[BACKUP] Backup exportado com sucesso para:', result.filePath);
            }
          }
        } catch (e) {
          console.error('Erro ao exportar backup:', e);
        }
      })();
      return;
    }
    if (targetUrl.includes('import-accounts-backup')) {
      (async () => {
        try {
          const { dialog } = require('electron');
          const result = await dialog.showOpenDialog(win, {
            title: 'Importar Backup Criptografado de Contas',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile']
          });
          if (!result.canceled && result.filePaths && result.filePaths[0]) {
            const targetPath = getLocalAccountsPath();
            fs.copyFileSync(result.filePaths[0], targetPath);
            ACCOUNTS = loadAccountsConfig();
            sidebarView.webContents.loadURL(buildSidebarHtml());
            console.log('[BACKUP] Backup importado com sucesso de:', result.filePaths[0]);
          }
        } catch (e) {
          console.error('Erro ao importar backup:', e);
        }
      })();
      return;
    }
    if (targetUrl.includes('toggle-auto-mode')) {
      autoModeEnabledList[activeIndex] = !autoModeEnabledList[activeIndex];
      sidebarView.webContents.loadURL(buildSidebarHtml());
      pollStats();
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
    attachHotkeys(view);
    return view;
  });

  attachHotkeys(sidebarView);

  win.contentView.addChildView(contentViews[activeIndex]);
  layout();
  updateSidebarActive();
  win.on('resize', layout);

  setInterval(pollStats, 1500);
}

let updaterWin = null;

function createUpdaterWindow() {
  updaterWin = new BaseWindow({
    width: 440,
    height: 240,
    center: true,
    frame: false,
    transparent: false,
    resizable: false,
    alwaysOnTop: true
  });

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { box-sizing: border-box; }
        body {
          margin: 0; padding: 24px; height: 100%;
          background: #11111b; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
          color: #cdd6f4; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          user-select: none; border: 1px solid #313244; border-radius: 10px;
        }
        .title { font-size: 16px; font-weight: 700; color: #89b4fa; margin-bottom: 4px; }
        .version { font-size: 11px; color: #a6adc8; margin-bottom: 18px; }
        .status { font-size: 12px; font-weight: 600; color: #f9e2af; margin-bottom: 12px; text-align: center; }
        .progress-bar {
          width: 100%; background: #1e1e2e; height: 8px; border-radius: 4px;
          overflow: hidden; border: 1px solid #45475a; position: relative;
        }
        .progress-fill {
          height: 100%; background: #a6e3a1; width: 0%; transition: width 0.2s ease;
        }
        .pulse {
          animation: pulse 1.5s infinite ease-in-out;
        }
        @keyframes pulse {
          0% { width: 10%; left: 0%; }
          50% { width: 50%; left: 25%; }
          100% { width: 10%; left: 90%; }
        }
      </style>
    </head>
    <body>
      <div class="title">🎮 Poke Idle Multi-Browser</div>
      <div class="version">Versão v${app.getVersion()}</div>
      <div class="status" id="status-txt">🔍 Verificando atualizações...</div>
      <div class="progress-bar">
        <div class="progress-fill pulse" id="progress-fill"></div>
      </div>

      <script>
        function setStatus(text, progressPct) {
          const st = document.getElementById('status-txt');
          const pf = document.getElementById('progress-fill');
          if (st) st.innerText = text;
          if (pf) {
            if (typeof progressPct === 'number') {
              pf.classList.remove('pulse');
              pf.style.width = Math.min(100, Math.max(0, progressPct)) + '%';
            } else {
              pf.classList.add('pulse');
            }
          }
        }
      </script>
    </body>
    </html>
  `;

  const view = new WebContentsView();
  view.webContents.loadURL('data:text/html,' + encodeURIComponent(html));
  updaterWin.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 440, height: 240 });
  return view;
}

function updateSplashStatus(view, statusText, pct) {
  if (view && !view.webContents.isLoading()) {
    const pctArg = typeof pct === 'number' ? pct : 'null';
    view.webContents.executeJavaScript(`
      if (typeof setStatus === 'function') setStatus(${JSON.stringify(statusText)}, ${pctArg});
    `).catch(() => {});
  }
}

async function checkForUpdatesAndLaunch() {
  if (!app.isPackaged) {
    console.log('[AUTO-UPDATE] Modo desenvolvimento: iniciando aplicativo...');
    createWindow();
    createTray();
    return;
  }

  const splashView = createUpdaterWindow();

  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      updateSplashStatus(splashView, '🔍 Verificando atualizações no GitHub...');
    });

    autoUpdater.on('update-available', (info) => {
      updateSplashStatus(splashView, `⬇️ Nova versão v${info.version} encontrada! Baixando...`, 0);
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const pct = Math.round(progressObj.percent);
      updateSplashStatus(splashView, `⬇️ Baixando atualização: ${pct}%`, pct);
    });

    autoUpdater.on('update-downloaded', (info) => {
      updateSplashStatus(splashView, `⚡ Atualização v${info.version} instalada! Reiniciando...`, 100);
      setTimeout(() => {
        autoUpdater.quitAndInstall(false, true);
      }, 1000);
    });

    autoUpdater.on('update-not-available', () => {
      updateSplashStatus(splashView, '✅ O sistema já está atualizado!', 100);
      setTimeout(() => {
        if (updaterWin) {
          updaterWin.close();
          updaterWin = null;
        }
        createWindow();
        createTray();
      }, 600);
    });

    autoUpdater.on('error', (err) => {
      console.error('[AUTO-UPDATE] Erro ao verificar atualização:', err);
      updateSplashStatus(splashView, '⚠️ Iniciando aplicativo...', 100);
      setTimeout(() => {
        if (updaterWin) {
          updaterWin.close();
          updaterWin = null;
        }
        createWindow();
        createTray();
      }, 600);
    });

    autoUpdater.checkForUpdates();
  } catch (e) {
    console.error('[AUTO-UPDATE] Exceção no updater:', e);
    if (updaterWin) {
      updaterWin.close();
      updaterWin = null;
    }
    createWindow();
    createTray();
  }
}

app.whenReady().then(() => {
  checkForUpdatesAndLaunch();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


