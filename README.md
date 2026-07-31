# 🎮 Poke Idle World - Multi-Browser com PIWTools HUD

Aplicação desktop em **Electron** para gerenciar múltiplos perfis de conta simultâneos no *Poke Idle World*, contando com detecção automática do estado do jogo (Treinador, Pokémon ativo, nível e barra de HP) e um **Recomendador Inteligente de Hunts integrado do PIWTools** (Melhor XP/hora e Melhor Dólar/hora em tempo real).

<img width="1913" height="1027" alt="e" src="https://github.com/user-attachments/assets/125d73ec-9d5f-4bc1-af39-9811d5a604ff" />
## ------------------------------------------------ IMAGEM ---------------------------------------------------------------------------
<img width="1917" height="1026" alt="exemplo2" src="https://github.com/user-attachments/assets/9df00558-c34b-4f4d-9849-f45a0b0714c4" />

---

## ⚡ Funcionalidades

- 📱 **Multi-Sessão Independente**: Alterne entre 4 contas persistentes salvas individualmente.
- 👤 **Detecção de Treinador**: Detecta automaticamente o nome do treinador e localização atual.
- ⚔️ **Detecção de Pokémon Ativo**: Identifica o Pokémon em batalha, seu nível e monitora a barra de vida (HP) dinamicamente.
- 🎯 **Recomendador de Hunts (PIWTools Integrado)**:
  - 🚀 **1ª Opção (Melhor XP/hora)**: Sugere a hunt ideal para maximizar a experiência por hora com base no nível e vantagem de elemento.
  - 💰 **2ª Opção (Melhor Dólar/hora)**: Sugere a melhor hunt para farmar dinheiro/loot com base na taxa de drop dos itens e valores NPC.

---

## 🚀 Como Executar Localmente

### Pré-requisitos
- Node.js (v18 ou superior)
- npm

### Passos
1. Clone o repositório:
   ```bash
   git clone https://github.com/ualasimendes/POKE-IDLE-MULTI-BROWSER.git
   cd POKE-IDLE-MULTI-BROWSER
   ```

2. Instale as dependências:
   ```bash
   npm install
   ```

3. Inicie o aplicativo:
   ```bash
   npm start
   ```

---

## 🐳 Executando com Docker (Setup Automatizado)

Você pode rodar a aplicação em um contêiner Docker isolado usando Docker Compose:

```bash
# Construir e iniciar os contêineres
docker compose up --build
```

---

## 🛠️ Estrutura do Projeto

```
multi-browser/
├── main.js             # Processo principal do Electron & Interface da Sidebar
├── hunts.js            # Engine de recomendação de Hunts (PIWTools)
├── creatures.json      # Banco de dados de Pokémons e atributos
├── items.json          # Banco de dados de preços NPC de itens
├── map-markers.json    # Mapeamento de hunts do mapa
├── package.json        # Dependências e scripts do projeto
├── Dockerfile          # Configuração da imagem Docker
├── docker-compose.yml  # Orquestração do serviço Docker
└── README.md           # Documentação do projeto
```
