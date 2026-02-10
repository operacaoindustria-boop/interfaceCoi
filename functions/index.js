const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { google } = require("googleapis");

admin.initializeApp();
const db = admin.firestore();

// ID da sua planilha Google Sheets
const SPREADSHEET_ID = "16yHSXMqbk27mZmFqsZ_-FHNCE_5ITF6EoTDKizxRGCc";
const SHEET_NAME = "Página1";

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

    // Converter para TSV (compatível com o dashboard)
    const tsvData = rows.map(row => row.join("\t")).join("\n");

    // Salvar no Firestore
    await db.collection("paradas_industria").doc("dados_atuais").set({
      csvContent: tsvData,
      lastUpdated: new Date().toISOString(),
      updatedBy: "Firebase Functions (Automático)",
      totalLinhas: rows.length,
    });

    console.log(`✅ Dados salvos no Firestore com sucesso!`);
    return { 
      status: "sucesso", 
      linhas: rows.length,
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