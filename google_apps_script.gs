// ============================================================================
// GOOGLE APPS SCRIPT - SINCRONIZAÇÃO AUTOMÁTICA COM FIRESTORE
// ============================================================================

// Configurações (obtenha essas credenciais do Firebase)
const FIRESTORE_PROJECT_ID = "integracaocoi";
const SHEET_ID = "16yHSXMqbk27mZmFqsZ_-FHNCE_5ITF6EoTDKizxRGCc";

// Mapeamento de colunas (0-indexed)
const COLUMN_MAP = {
  setor: 1,
  linha: 2,
  responsavel: 3,
  turno: 4,
  dataInicio: 5,
  horaInicio: 6,
  codigoMotivo: 7,
  categoria: 8,
  descricao: 9,
  agrupamento: 10,
  descDetalhada: 11,
  paradaGeral: 12,
  tag: 13,
  os: 14,
  dataFinal: 15,
  horaFinal: 16,
  tempoParada: 17
};

// ============================================================================
// FUNÇÃO PRINCIPAL DE SINCRONIZAÇÃO
// ============================================================================
function sincronizarComFirestore() {
  try {
    Logger.log("⏳ Iniciando sincronização...");

    // Obter planilha (tenta abrir por ID, se falhar usa a planilha ativa)
    let spreadsheet = null;
    try {
      spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    } catch (e) {
      Logger.log("⚠️ Não foi possível abrir por ID: " + e.toString());
      spreadsheet = null;
    }

    if (!spreadsheet) {
      try {
        spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
        Logger.log("ℹ️ Usando planilha ativa: " + (spreadsheet ? spreadsheet.getName() : 'null'));
      } catch (e) {
        spreadsheet = null;
      }
    }

    if (!spreadsheet) {
      throw new Error("❌ Não foi possível obter a planilha (por ID nem ativa). ID: " + SHEET_ID);
    }

    // Pegar a primeira aba (mais seguro)
    const sheets = spreadsheet.getSheets();
    if (!sheets || sheets.length === 0) {
      throw new Error("❌ Nenhuma aba encontrada na planilha: " + spreadsheet.getName());
    }
    const sheet = sheets[0];
    Logger.log("✅ Aba encontrada: " + sheet.getName());

    // Obter dados
    let dados = [];
    try {
      const dataRange = sheet.getDataRange();
      if (!dataRange) {
        throw new Error("❌ getDataRange retornou null");
      }
      dados = dataRange.getValues();
    } catch (e) {
      Logger.log("❌ Erro ao obter dados da aba: " + e.toString());
      throw new Error("❌ Não foi possível ler dados da aba: " + e.toString());
    }

    if (!dados || dados.length === 0) {
      throw new Error("❌ Planilha vazia ou sem dados");
    }

    Logger.log(`✅ Lidos ${dados.length} registros`);

    // Processar dados
    const processedRows = [];
    
    // Cabeçalho
    processedRows.push([
      "Setor",
      "Linha", 
      "Responsável",
      "Turno",
      "Data Início",
      "Hora Início",
      "Código Motivo",
      "Categoria",
      "Descrição",
      "Agrupamento",
      "Desc Detalhada",
      "TAG",
      "O.S",
      "Tempo Parada"
    ].join("\t"));

    // Dados (pular cabeçalho - primeira linha)
    for (let i = 1; i < dados.length; i++) {
      const row = dados[i];
      if (!row || row.length === 0) continue;

      const processedRow = [
        row[COLUMN_MAP.setor] || "",
        row[COLUMN_MAP.linha] || "",
        row[COLUMN_MAP.responsavel] || "",
        row[COLUMN_MAP.turno] || "",
        row[COLUMN_MAP.dataInicio] || "",
        row[COLUMN_MAP.horaInicio] || "",
        row[COLUMN_MAP.codigoMotivo] || "",
        row[COLUMN_MAP.categoria] || "",
        row[COLUMN_MAP.descricao] || "",
        row[COLUMN_MAP.agrupamento] || "",
        row[COLUMN_MAP.descDetalhada] || "",
        row[COLUMN_MAP.tag] || "",
        row[COLUMN_MAP.os] || "",
        row[COLUMN_MAP.tempoParada] || ""
      ];

      processedRows.push(processedRow.join("\t"));
    }

    const tsvData = processedRows.join("\n");

    // Salvar no Firestore via REST API
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/paradas_industria/dados_atuais`;

    // Construir payload Firestore
    const payload = {
      fields: {
        csvContent: { stringValue: tsvData },
        lastUpdated: { timestampValue: new Date().toISOString() },
        updatedBy: { stringValue: "Google Apps Script (Automático)" },
        totalLinhas: { integerValue: processedRows.length }
      }
    };

    const options = {
      method: "patch",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken()
      }
    };

    Logger.log("📤 Enviando para Firestore...");
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log("Status Code: " + statusCode);
    Logger.log("Response: " + responseText);

    if (statusCode === 200) {
      Logger.log("✅ Dados sincronizados com sucesso!");
      adicionarNotificacao("✅ Sincronização concluída!", `${processedRows.length} linhas sincronizadas`);
    } else {
      Logger.log("❌ Erro ao sincronizar (status " + statusCode + ")");
      adicionarNotificacao("❌ Erro na sincronização", "Status: " + statusCode);
    }

  } catch (error) {
    Logger.log("❌ Erro geral: " + error.toString());
    Logger.log("Stack: " + error.stack);
    try {
      adicionarNotificacao("❌ Erro na sincronização", error.toString());
    } catch (e2) {
      Logger.log("Erro ao tentar adicionar notificação: " + e2.toString());
    }
  }
}

// ============================================================================
// FUNÇÃO PARA ADICIONAR NOTIFICAÇÃO
// ============================================================================
function adicionarNotificacao(titulo, mensagem) {
  try {
    Logger.log("📝 Tentando adicionar notificação: " + titulo);

    let spreadsheet = null;
    try {
      spreadsheet = SpreadsheetApp.openById(SHEET_ID);
    } catch (e) {
      spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    }

    if (!spreadsheet) {
      Logger.log("⚠️ Não foi possível obter spreadsheet para notificação");
      return;
    }

    const sheets = spreadsheet.getSheets();
    if (!sheets || sheets.length === 0) {
      Logger.log("⚠️ Nenhuma aba encontrada para notificação");
      return;
    }

    const sheet = sheets[0];
    if (!sheet) {
      Logger.log("⚠️ Aba retornou null");
      return;
    }

    let lastRow = 0;
    try {
      lastRow = sheet.getLastRow();
    } catch (e) {
      Logger.log("⚠️ Erro ao obter lastRow: " + e.toString());
      lastRow = 1;
    }

    const novaLinha = lastRow + 2;
    const notificacao = `[${new Date().toLocaleString('pt-BR')}] ${titulo}: ${mensagem}`;

    try {
      const range = sheet.getRange(novaLinha, 1);
      if (range) {
        range.setValue(notificacao);
        range.setFontColor("#666666").setFontSize(9);
        Logger.log("✅ Notificação adicionada à linha " + novaLinha);
      }
    } catch (e) {
      Logger.log("⚠️ Erro ao escrever notificação: " + e.toString());
    }
  } catch (error) {
    Logger.log("⚠️ Erro geral na notificação: " + error.toString());
  }
}

// ============================================================================
// FUNÇÃO PARA TESTAR CONEXÃO
// ============================================================================
function testarConexao() {
  try {
    Logger.log("🧪 Iniciando teste de conexão...");
    
    // Obter token
    let token;
    try {
      token = ScriptApp.getOAuthToken();
      Logger.log("✅ Token de acesso obtido com sucesso!");
      Logger.log("Token (primeiros 50 chars): " + token.substring(0, 50) + "...");
    } catch (err) {
      Logger.log("❌ Erro ao obter token: " + err.toString());
      return;
    }

    // Testar comunicação com Firestore
    const url = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
    Logger.log("📤 Testando acesso a: " + url);

    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log("📊 Status Code: " + statusCode);
    Logger.log("📊 Response: " + responseText.substring(0, 200));

    if (statusCode === 200) {
      Logger.log("✅ Conexão com Firestore funcionando!");
      adicionarNotificacao("✅ Teste OK", "Conexão com Firestore funcionando");
    } else {
      Logger.log("❌ Erro na conexão (status " + statusCode + ")");
      adicionarNotificacao("❌ Teste falhou", "Status: " + statusCode);
    }
  } catch (error) {
    Logger.log("❌ Erro ao testar conexão: " + error.toString());
  }
}

// ============================================================================
// FUNÇÃO PARA CRIAR GATILHOS AUTOMÁTICOS
// ============================================================================
function configurarGatilhos() {
  try {
    Logger.log("⚙️ Configurando gatilhos...");

    // Remover gatilhos anteriores
    const gatilhos = ScriptApp.getProjectTriggers();
    Logger.log("Removendo " + gatilhos.length + " gatilhos anteriores...");
    
    gatilhos.forEach(gatilho => {
      try {
        ScriptApp.deleteTrigger(gatilho);
      } catch (err) {
        Logger.log("Erro ao remover gatilho: " + err.toString());
      }
    });

    // Criar novo gatilho a cada 15 minutos
    ScriptApp.newTrigger('sincronizarComFirestore')
      .timeBased()
      .everyMinutes(15)
      .create();

    Logger.log("✅ Gatilho configurado para rodar a cada 15 minutos!");
    adicionarNotificacao("✅ Sincronização automática", "Configurada para a cada 15 minutos");
  } catch (error) {
    Logger.log("❌ Erro ao configurar gatilhos: " + error.toString());
  }
}

// ============================================================================
// MENU PERSONALIZADO
// ============================================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 Sincronização')
    .addItem('Sincronizar Agora', 'sincronizarComFirestore')
    .addItem('Testar Conexão', 'testarConexao')
    .addItem('Configurar Sincronização Automática', 'configurarGatilhos')
    .addToUi();
}
