const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();
const db = admin.firestore();

// ID da sua planilha Google Sheets
const SPREADSHEET_ID = "16yHSXMqbk27mZmFqsZ_-FHNCE_5ITF6EoTDKizxRGCc";
const SHEET_NAME = "UBS ATTO";

// --- FUNÇÃO PRINCIPAL DE SINCRONIZAÇÃO ---
async function syncLogic() {
  try {
    console.log(`[${new Date().toISOString()}] ⏳ Iniciando sincronização...`);

    // Autenticação com Google Sheets API
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    // Ler dados da planilha
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Z`,
    });

    const rows = res.data.values;

    if (!rows || rows.length === 0) {
      console.log("⚠️ Nenhum dado encontrado na planilha.");
      return { status: "vazio", linhas: 0 };
    }

    console.log(`✅ Lidos ${rows.length} registros da planilha.`);

    // --- MAPEAMENTO DINÂMICO DE COLUNAS ---
    // Identifica os índices das colunas pelo nome no cabeçalho (linha 0) para evitar erros se a ordem mudar
    const headers = rows[0].map(h => h ? h.toLowerCase().trim() : "");

    const getIdx = (patterns) => {
      if (!Array.isArray(patterns)) patterns = [patterns];
      return headers.findIndex(h => patterns.some(p => h.includes(p)));
    };

    const MAP = {
      setor: getIdx(["setor"]),
      linha: getIdx(["linha"]),
      responsavel: getIdx(["responsável", "responsavel"]),
      turno: getIdx(["turno"]),
      dataInicio: getIdx(["data inicio", "data início"]),
      horaInicio: getIdx(["hora início", "hora inicio"]),
      codigoMotivo: getIdx(["código motivo", "codigo motivo"]),
      categoria: getIdx(["categoria"]),
      descricao: getIdx(["descrição", "descricao"]),
      agrupamento: getIdx(["agrupamento"]),
      descDetalhada: getIdx(["desc detalhada", "descrição detalhada"]),
      tag: getIdx(["tag"]),
      os: getIdx(["o.s", "os"]),
      tempoParada: getIdx(["tempo parada", "tempo"])
    };

    console.log("Mapeamento de Colunas:", MAP);

    // Processar dados mantendo apenas colunas relevantes
    const processedRows = [];

    // Manter cabeçalho
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

    // Processar linhas de dados (pular cabeçalho)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      // Extrair apenas colunas necessárias, ignorando o resto
      const processedRow = [
        row[MAP.setor] || "",
        row[MAP.linha] || "",
        row[MAP.responsavel] || "",
        row[MAP.turno] || "",
        (row[MAP.dataInicio] || "").split(" ")[0].trim(),
        row[MAP.horaInicio] || "",
        row[MAP.codigoMotivo] || "",
        row[MAP.categoria] || "",
        row[MAP.descricao] || "",
        row[MAP.agrupamento] || "",
        row[MAP.descDetalhada] || "",
        row[MAP.tag] || "",
        row[MAP.os] || "",
        row[MAP.tempoParada] || ""
      ];

      processedRows.push(processedRow.join("\t"));
    }

    const tsvData = processedRows.join("\n");

    // --- CHUNKING LOGIC ---
    // Dividir os dados em pedaços (chunks) para não exceder o limite de 1MB do Firestore.
    const MAX_CHUNK_SIZE = 900 * 1024; // 900KB, margem de segurança.
    const chunks = [];
    let currentChunk = "";

    for (const row of processedRows) {
      const line = row + "\n";
      if (currentChunk.length > 0 && (currentChunk.length + line.length > MAX_CHUNK_SIZE)) {
        chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk += line;
      }
    }
    // Adiciona o último chunk se houver algo nele
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    console.log(`📦 Dados divididos em ${chunks.length} chunks.`);

    // Salvar no Firestore usando batch write para garantir atomicidade
    let batch = db.batch();
    let opCount = 0;

    // 1. Salvar metadados que informam ao frontend como remontar os dados
    const metadataRef = db.collection("paradas_industria").doc("metadata");
    batch.set(metadataRef, {
      totalChunks: chunks.length,
      lastUpdated: new Date().toISOString(),
      updatedBy: "Firebase Functions (Automático)",
      totalLinhas: processedRows.length,
      totalBytes: tsvData.length,
    });
    opCount++;

    // 2. Salvar cada chunk como um documento separado
    for (let index = 0; index < chunks.length; index++) {
      const chunkContent = chunks[index];
      const chunkRef = db.collection("paradas_industria").doc(`chunk_${index}`);
      batch.set(chunkRef, {
        data: chunkContent,
        index: index,
        size: chunkContent.length,
      });
      opCount++;

      // Limite de segurança do batch (Firestore aceita máx 500 ops por batch)
      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }

    // 3. Deletar o documento antigo 'dados_atuais' para evitar inconsistência
    const oldDocRef = db.collection("paradas_industria").doc("dados_atuais");
    batch.delete(oldDocRef);

    // 4. Executar todas as operações do batch
    await batch.commit();


    console.log(`✅ Dados salvos no Firestore com sucesso! (${chunks.length} chunks)`);
    return {
      status: "sucesso",
      linhas: rows.length,
      chunks: chunks.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error("❌ Erro na sincronização:", error.message);
    throw error;
  }
}

// --- TRIGGER 1: Agendado (a cada 15 minutos) ---
exports.sincronizarPlanilhaAgendada = functions.pubsub
  .schedule("every 15 minutes")
  .timeZone("America/Sao_Paulo")
  .onRun(async (context) => {
    try {
      const result = await syncLogic();
      console.log(`🔄 Sincronização agendada concluída:`, result);
    } catch (error) {
      console.error("❌ Erro na sincronização agendada:", error);
    }
  });

// --- TRIGGER 2: HTTP (forçar sincronização manual) ---
exports.forcarSincronizacao = functions.https.onRequest(
  { cors: true },
  async (req, res) => {
    try {
      const result = await syncLogic();
      res.status(200).json({
        sucesso: true,
        mensagem: "Sincronização forçada concluída com sucesso!",
        detalhes: result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error("❌ Erro ao forçar sincronização:", error);
      res.status(500).json({
        sucesso: false,
        erro: error.message
      });
    }
  }
);

// --- TRIGGER 3: Teste de Conexão ---
exports.testarConexao = functions.https.onRequest(
  { cors: true },
  async (req, res) => {
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });
      const client = await auth.getClient();
      const sheets = google.sheets({ version: "v4", auth: client });

      const testRes = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });

      res.status(200).json({
        sucesso: true,
        mensagem: "✅ Conexão com Google Sheets funcionando!",
        planilha: testRes.data.properties.title,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        sucesso: false,
        erro: error.message
      });
    }
  }
);