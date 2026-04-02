# 🤖 Trading Bot — Contexto Completo para Continuação

> Usa este ficheiro no início de qualquer nova conversa com o Claude para retomar o projecto com contexto total.

---

## 🎯 Resumo do Projecto

Plataforma de trading algorítmico autónoma em criptomoedas, desenvolvida de raiz em Node.js, a correr 24/7 no Railway, operando na **Binance REAL** com €20 em USDC.

**Criador:** Rui Almeida (rpaalmeida-svg)
**Assistente:** Ana (Claude)
**Estado actual:** Bot operacional — primeira posição aberta (BNBUSDC a $614.71)

---

## 🏗️ Arquitectura e Stack

```
Exchange:     Binance REAL (migrado de Testnet em 01/04/2026)
Backend:      Node.js + Express
Base de dados: PostgreSQL (Railway)
Deploy:       Railway (cloud 24/7) — serviço: trustworthy-charm
Dashboard:    Web — trading-rui.up.railway.app
GitHub:       https://github.com/rpaalmeida-svg/trading-bot (privado)
Telegram:     @meutradingbot_rui_bot
Railway IP:   208.77.244.40 (MUDA a cada deploy — resolver com key Unrestricted)
```

---

## 📊 Pares e Configuração ACTUAL

```javascript
// ACTUAL — 3 pares altamente correlacionados (a expandir para 10-12)
BTCUSDC: { interval: '30m', rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 }
ETHUSDC: { interval: '1h',  rsiBuy: 35, rsiSell: 65, stopLoss: 0.025, takeProfit: 0.05 }
BNBUSDC: { interval: '1h',  rsiBuy: 40, rsiSell: 60, stopLoss: 0.025, takeProfit: 0.05 }
```

**Configurações optimizadas por backtest de 5 anos (01/04/2026):**
- BNB 1h RSI40/60: +54.8% em 5 anos | Win 50% 🏆
- BNB 1h RSI35/65: +20.2% | Win 42.4%
- BTC 30min RSI40/60: +10.5% | Win 53.2%
- ETH em 30min: NEGATIVO em 5 anos → mudado para 1h

---

## 🔑 Variáveis de Ambiente (Railway — serviço trustworthy-charm)

```
BINANCE_API_KEY=[key real Binance — com Spot Trading activo]
BINANCE_SECRET_KEY=[secret real Binance]
MAX_CAPITAL=20
DATABASE_URL=[URL PostgreSQL Railway]
TELEGRAM_TOKEN=[token bot Telegram]
TELEGRAM_CHAT_ID=5474962616
DASHBOARD_USER=[utilizador dashboard]
DASHBOARD_PASSWORD=[password dashboard]
SESSION_SECRET=[secret sessão]
```

**API Key Binance (ACTUAL — a substituir):**
- Enable Reading ✅
- Enable Spot & Margin Trading ✅
- IP restrito a: 34.90.174.40 + 208.77.244.40
- ⚠️ PROBLEMA: IP muda a cada deploy Railway

**API Key Binance (PRÓXIMA SESSÃO — nova key):**
- Enable Reading ✅
- Enable Spot & Margin Trading ✅
- Enable Withdrawals ❌ NUNCA
- IP: Unrestricted ← resolve o problema de vez

---

## 📁 Estrutura de Ficheiros

```
trading-bot/
├── src/
│   ├── bot.js          ← ciclo principal + gestão posições + lock BD + IP logging
│   ├── strategy.js     ← indicadores técnicos (ATR sanitizado)
│   ├── portfolio.js    ← scoring, alocação capital, MAX_POSITIONS, MIN_TRADE
│   ├── news.js         ← macro overlay
│   ├── scanner.js      ← scanner mensal de pares
│   ├── risk.js         ← gestão de risco
│   ├── telegram.js     ← alertas
│   ├── sentiment.js    ← Fear & Greed
│   ├── history.js      ← histórico trades (PostgreSQL)
│   ├── database.js     ← PostgreSQL
│   ├── dashboard.js    ← interface web
│   └── logger.js       ← logs
├── backtest/
│   └── run.js          ← backtest 5 anos (já executado)
├── public/
│   └── index.html      ← dashboard com TradingView ao vivo
└── index.js            ← arranque
```

---

## 🧠 Estratégia de Trading — Completa

### Indicadores Técnicos (60% do score final)

```
RSI (14 períodos) — rsiBuy/rsiSell por par
SMA cruzamento — SMA9 vs SMA21
MACD — histograma > 0 confirma momentum
Bollinger Bands — percentB < 0.2 confirma sobrevendido
ATR (14 períodos) — volatilidade real, stop-loss adaptativo
  → sanitização wicks > 15% (mantido por segurança)
  → cap de segurança 8%
Tendência 4h — SMA20/SMA50
Padrões de Velas — Hammer, Bullish Engulfing, Doji, Bearish Engulfing
```

### Macro Overlay (40% do score final)

```
Fear & Greed + tendência 14 dias
Market Cap Global 24h (CoinGecko)
BTC Dominance
BTC Performance 7 dias
Distância do ATH
ETF Flows (SoSoValue)
CoinGecko Trending
```

### Score Composto

```javascript
compositeScore = technicalScore * 0.60 + macroScore * 0.40
// Mínimo para comprar: 75/100
```

### NOTA: Signal vs Score (design deliberado)

O `signal` no strategy.js exige TODOS os filtros ao mesmo tempo (RSI + SMA + MACD + BB + padrão). Isto é muito restritivo — raramente diz BUY.
O `score` no portfolio.js é uma média ponderada mais flexível — é este que decide as compras.
O signal é informativo para o dashboard; o score é operacional para trades.
NÃO alinhar signal com score — são perspectivas diferentes propositadamente.

---

## 🛡️ Gestão de Risco

```
Stop-Loss adaptativo:    2x ATR
Trailing Take-Profit:    activa após +3%, vende se recua 4% do máximo
Take-Profit fixo:        5% (backup)
Position sizing:         dinâmico por ATR
Max posições simultâneas: 2 (MAX_POSITIONS) — subir para 3 com €1000
Min trade:               $5 (MIN_TRADE_AMOUNT)
Cooldown após SL:        2 horas
Score mínimo:            75/100
Limite perda diária:     5% do capital
Lock de ciclo BD:        2 minutos (evita processos duplos durante deploy)
Loop recursivo:          setTimeout em vez de setInterval
Ciclo:                   30 minutos
```

### Alocação de Capital (contas pequenas <$50)

```
- Concentra 95% do capital no MELHOR par (não divide por 3)
- MAX_POSITIONS = 2 (máximo 2 trades abertos ao mesmo tempo)
- MIN_TRADE_AMOUNT = $5 (Binance aceita ~$5 notional)
- Capital disponível = min(saldo, MAX_CAPITAL) — sem divisão artificial por pares
- allocateCapital() recebe slots disponíveis e distribui inteligentemente
```

### Estratégia de Pares (EVOLUÇÃO PLANEADA)

```
ACTUAL:   3 pares (BTC, ETH, BNB) — correlação ~80%, pouca diversificação
PRÓXIMO:  10-12 pares watchlist, 2-3 posições activas nos melhores

Conceito: POOL de candidatos > POSIÇÕES activas
- Bot analisa 10-12 pares a cada ciclo
- Compra nos 2-3 com melhor score naquele momento
- Pool diversificado = sempre há bons setups disponíveis
- Pares descorrelacionados = se um perde, os outros não perdem automaticamente

Pool candidato (a validar com backtest + verificar pares USDC na Binance):
  BTC  — o mercado (referência)
  SOL  — ecossistema alternativo ao ETH
  LINK — infraestrutura DeFi/oracles
  DOGE — meme coin (descorrelaciona por hype/social)
  AVAX — L1 alternativo
  DOT  — interoperabilidade
  MATIC/POL — L2 Ethereum
  ATOM — cosmos/interchain
  NEAR — L1 alternativo
  UNI  — DeFi puro
  ADA  — L1 alternativo
  ETH  — manter como referência

Cada par precisa de:
  1. Confirmar que existe como USDC na Binance
  2. Backtest com lógica de scores (não só RSI)
  3. Configuração própria (rsiBuy/rsiSell, intervalo)
  4. Medir correlação com os outros pares do pool
```

---

## 📈 Estado Actual (01/04/2026 — 16:45)

```
Exchange:         Binance REAL
Saldo:            ~$22.35 USDC (parte em USDC, parte em BNB)
Capital inicial:  $22.35 USDC
MAX_CAPITAL:      20

POSIÇÃO ABERTA:
  BNBUSDC — Entrada: $614.71 | SL: $607.92 | TP: $645.45
  Quantidade: ~0.034 BNB | Capital: $20.90
  Score na compra: 84/100 (T:84 M:83)
  Razão: Medo extremo (8) + Mercado a subir +2.6% + Zona de valor histórico

Trades concluídos: 0
Win Rate:         0%
P&L:              +$0
Fear & Greed:     8 (Extreme Fear)
```

**Estado do Railway:**
- Serviço: trustworthy-charm — ONLINE ✅
- Dashboard: trading-rui.up.railway.app ✅
- Bot a monitorizar posição BNB activamente
- ⚠️ NÃO FAZER DEPLOY enquanto posição estiver aberta

---

## 🐛 Problemas Resolvidos

### Sessão 01/04/2026 — Tarde

#### Bug fatal: Bot nunca comprava com €20
- **Problema:** capitalPerPair = $20/3 = $6.67, mas mínimo era $10 → SKIP sempre
- **Solução:** Reescrita da alocação de capital — contas <$50 concentram 95% no melhor par
- **Ficheiros alterados:** bot.js, portfolio.js
- **Novas constantes:** MAX_POSITIONS=2, MIN_TRADE_AMOUNT=$5

#### Bug dashboard: BTC $0.00 e RSI N/A no header
- **Problema:** `sendDashboardUpdate` procurava `BTCUSDT` em vez de `BTCUSDC`
- **Solução:** Corrigido para `BTCUSDC` em 2 locais no bot.js

#### API key sem permissão de Spot Trading
- **Problema:** Binance erro -2015 "Invalid API-key, IP, or permissions"
- **Solução:** Activado "Enable Spot & Margin Trading" + IP whitelisted

#### IP do Railway muda a cada deploy
- **Problema:** Cada push → novo IP → bot crashado → Binance rejeita
- **IPs usados:** 34.90.174.40 (1º deploy) → 208.77.244.40 (2º deploy)
- **Solução temporária:** Adicionar IP manualmente + log permanente do IP no arranque
- **Solução definitiva:** Nova API key com IP Unrestricted (próxima sessão)

### Sessão 01/04/2026 — Manhã (migração)

#### Migração Testnet → Binance Real
- **Problema:** Testnet gera dados sintéticos (ATR distorcido, comportamentos impossíveis)
- **Solução:** Migração para `https://api.binance.com/api`
- **USDT → USDC:** Regulação europeia não permite comprar USDT — migrado para USDC

#### Processo Duplo Railway
- **Problema:** Durante deploys, dois processos corriam em simultâneo
- **Solução:** Lock na BD (`lastCycleStart`) bloqueia processos duplicados por 2 minutos
- **Solução adicional:** Loop recursivo com `setTimeout` em vez de `setInterval`

#### History.js — Trades perdidos após restart
- **Problema:** `trades.json` no filesystem era apagado em cada deploy
- **Solução:** Migrado para PostgreSQL com chave `trades_history`

#### ATR distorcido na Testnet
- **Problema:** ETH mostrava ATR de 14% em velas de 30min
- **Solução:** Sanitização de wicks > 15% + cap de 8%

---

## 🗺️ Roadmap

```
Nível 1 — Amador melhorado              ✅ concluído
Nível 2 — Trader individual sério       ✅ concluído
Nível 3 — Semi-profissional              🔄 ~85% completo
  ✅ Alocação de capital para contas pequenas
  ✅ Bot operacional na Binance real
  ✅ Gestão de posições com trailing TP/SL
  ✅ Primeiro trade real executado (BNBUSDC)
  Falta:
  ❌ Expandir para 10-12 pares descorrelacionados (pool de candidatos)
  ❌ Relatórios de performance entre datas
  ❌ Fase 1 ML: tabela ml_snapshots
  ❌ Sharpe Ratio
  ❌ Correlação entre pares (medir e usar na selecção)
  ❌ Backtesting com lógica de scores
Nível 4 — Profissional                   🔮 futuro
  ❌ Fase 2 ML: treinar modelo (200+ trades)
  ❌ Fase 3 ML: micro-serviço
  ❌ Multi-exchange
  ❌ Portfolio rebalancing automático
```

---

## 📋 TAREFAS PENDENTES (próxima sessão)

### Prioridade 1 — Fazer quando posição BNB fechar

1. **Nova API key Binance — IP Unrestricted**
   - Criar nova key com Reading + Spot Trading
   - NÃO activar Withdrawals
   - IP: Unrestricted
   - Actualizar BINANCE_API_KEY e BINANCE_SECRET_KEY no Railway Variables
   - Testa: deploy sem preocupações de IP

2. **Mensagens Telegram mais legíveis**
   - Ficheiro: telegram.js (formatTrade e formatAlert)
   - Compra: mostrar quantidade, preço unitário, valor total investido
   - Venda: mostrar quantidade, preço compra/venda, lucro/perda em $ e %, duração
   - Exemplo formato compra:
     ```
     🟢 COMPRA BNBUSDC
     Quantidade: 0.034 BNB
     Preço: $614.71
     Investido: $20.90
     Stop-Loss: $607.92 (-1.1%)
     Take-Profit: $645.45 (+5.0%)
     Score: 84/100
     ```
   - Exemplo formato venda:
     ```
     🔴 VENDA BNBUSDC — Take-Profit
     Quantidade: 0.034 BNB
     Compra: $614.71 → Venda: $645.45
     Lucro: +$1.04 (+5.0%)
     Duração: 2h 30min
     ```

3. **Expandir pool de pares para 10-12**
   - Verificar quais pares existem como USDC na Binance
   - Backtestar cada par candidato com lógica de scores
   - Definir rsiBuy/rsiSell e intervalo para cada par
   - Medir correlação entre pares para garantir diversificação
   - Pool candidato: BTC, ETH, SOL, LINK, DOGE, AVAX, DOT, MATIC, ATOM, NEAR, UNI, ADA
   - Actualizar PAIRS e PAIR_CONFIG no portfolio.js
   - MAX_POSITIONS: manter 2 com €20, subir para 3 com €1000

4. **Sistema de Relatórios**
   - Nova secção no dashboard ou endpoint `/reports`
   - Filtros: data início, data fim, par (ou todos)
   - Métricas por período:
     ```
     Total de trades (ganhos / perdidos)
     Win Rate %
     P&L total ($) e percentual (%)
     Melhor trade / Pior trade
     Drawdown máximo
     Tempo médio em posição
     P&L por par
     Equity curve (gráfico evolução do saldo)
     Profit factor (lucros totais / perdas totais)
     ```
   - Exportar: CSV para análise externa
   - Relatório semanal automático via Telegram

### Prioridade 2 — Melhorias técnicas

5. **Fase 1 ML: tabela ml_snapshots**
   - Criar tabela em PostgreSQL
   - A cada ciclo, guardar snapshot de todos os indicadores
   - Ligar snapshots a trades quando ocorrem
   - Logging passivo — não afecta o bot

6. **Sharpe Ratio**
   - Calcular e mostrar no dashboard e relatórios
   - Mede se o risco compensa vs retorno

7. **Correlação entre pares em tempo real**
   - Medir correlação rolling 30 dias entre todos os pares
   - Bloquear abertura de 2 posições com correlação > 0.8
   - Mostrar matriz de correlação no dashboard

### Prioridade 3 — Futuro

8. **Backtesting com scores compostos** (não só RSI)
9. **Fase 2 ML: treinar modelo** (quando 200+ trades)
10. **Fase 3 ML: micro-serviço** (quando modelo provado)
11. **Escalar capital** (€20 → €1000 quando resultados provados)

---

## 🤖 Machine Learning — Plano

### Fase 1 — Data Collection (PRÓXIMO PASSO)
- Criar tabela `ml_snapshots` em PostgreSQL
- A cada ciclo, guardar: RSI, MACD, BB, ATR, score, macroScore, F&G, trend4h, preço, volume
- Quando há trade: ligar snapshot ao resultado (profit/loss)
- Objectivo: construir dataset automaticamente enquanto o bot corre
- **Não afecta o bot — é só logging passivo**

### Fase 2 — Treino (quando tivermos 200+ trades)
- Gradient Boosting Classifier (XGBoost ou LightGBM) em Python
- Input: todos os indicadores do snapshot
- Output: probabilidade de trade lucrativo (0-100)
- Comparar com score actual para ver se ML é melhor
- Treinar offline, não no bot

### Fase 3 — Integração (se Fase 2 provar valor)
- Micro-serviço Python no Railway
- Bot chama API do modelo antes de comprar
- ML score complementa o score composto (não substitui)
- A/B testing: metade dos trades com ML, metade sem

---

## ⚠️ O que fazer na próxima sessão

1. **Verificar resultado da posição BNB** — TP, SL, ou ainda aberta?
2. **Se posição fechou → executar Prioridade 1:**
   - Nova API key Unrestricted
   - Mensagens Telegram legíveis
   - Expandir pool de pares (10-12)
   - Sistema de relatórios
3. **Se posição ainda aberta → NÃO fazer deploy**
4. **Implementar Fase 1 ML** (logging passivo — pode ir no mesmo deploy)
5. **Com 30+ trades reais:** primeira análise de performance

---

## 📝 Notas Importantes

- Sempre pedir código completo — nunca parcial
- Ana deve desafiar ideias — não só validar
- Decisões de capital real são sempre do Rui
- NÃO fazer deploys desnecessários — cada deploy pode causar período cego
- NÃO fazer deploy com posição aberta — bot perde monitorização se IP mudar
- O processo antigo da Testnet tinha dados contaminados — ignorar histórico anterior
- Os €20 depositados são USDC (não USDT) — regulação europeia
- MAX_CAPITAL deve ser 20 (não 3000 como era na Testnet)
- Railway IP muda a cada deploy — resolver com key Unrestricted
- Signal ≠ Score: signal é restritivo (informativo), score é operacional (decide trades)
- 3 pares actuais (BTC/ETH/BNB) são praticamente a mesma aposta — expandir é prioridade

---

*Última actualização: 01 Abril 2026, 17:00*
*Sessão: Primeiro trade real (BNBUSDC) + bugs corrigidos + roadmap expandido*