const SUPABASE_URL = (window.APP_CONFIG?.supabaseUrl || "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = window.APP_CONFIG?.supabaseAnonKey || "";

const API_REPAROS = `${SUPABASE_URL}/rest/v1/reparos`;
const API_HISTORICO = `${SUPABASE_URL}/rest/v1/reparos_historico`;

let dadosCache = [];
let editandoId = null;
let dadosImportacao = [];
let registrosAusentesImportacao = [];
let carregandoDados = false;
let toastTimer = null;
let confirmacaoPendente = null;
const LIMITE_IMPORTACAO_BYTES = 10 * 1024 * 1024;
const LIMITE_LINHAS_IMPORTACAO = 5000;
const LIMITE_CELULA_IMPORTACAO = 2000;
const TEMA_STORAGE_KEY = "seduc-dashboard-tema";

const dadosIniciais = [];

function configurado() {
return (
/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) &&
SUPABASE_ANON_KEY.length > 20
);
}

function obterTokenAcesso() {
const tokenConfigurado = window.APP_CONFIG?.getAccessToken;
const token = typeof tokenConfigurado === "function"
  ? tokenConfigurado()
  : "";

return normalizarTexto(token) || SUPABASE_ANON_KEY;
}

function headers(extra = {}) {
const token = obterTokenAcesso();

return {
apikey: SUPABASE_ANON_KEY,
Authorization: `Bearer ${token}`,
"Content-Type": "application/json",
...extra
};
}

function $(id) {
return document.getElementById(id);
}

function mostrarToast(mensagem, tipo = "") {
const toast = $("toast");

if (!toast) return;

clearTimeout(toastTimer);
toast.textContent = mensagem;
toast.className = `toast show ${tipo}`.trim();
toastTimer = setTimeout(() => {
toast.className = "toast";
}, 4000);
}

function confirmarAcao(mensagem, titulo = "Confirmar ação") {
return new Promise(resolve => {
  const modal = $("modalConfirmacao");
  if (!modal) {
    resolve(false);
    return;
  }

  confirmacaoPendente = resolve;
  $("confirmacaoTitulo").textContent = titulo;
  $("confirmacaoMensagem").textContent = mensagem;
  modal.classList.add("active");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => $("btnConfirmarAcao")?.focus(), 0);
});
}

function fecharConfirmacao(resultado = false) {
const modal = $("modalConfirmacao");
if (modal) {
  modal.classList.remove("active");
  modal.setAttribute("aria-hidden", "true");
}

if (confirmacaoPendente) {
  const resolver = confirmacaoPendente;
  confirmacaoPendente = null;
  resolver(resultado);
}
}

function atualizarStatusSistema(texto, tipo = "") {
const status = $("systemStatus");
const ponto = document.querySelector(".system .dot");

if (status) status.textContent = texto;
if (ponto) ponto.className = `dot ${tipo}`.trim();
}

function dataLocalAtual(agora = new Date()) {
const ano = agora.getFullYear();
const mes = String(agora.getMonth() + 1).padStart(2, "0");
const dia = String(agora.getDate()).padStart(2, "0");

return `${ano}-${mes}-${dia}`;
}

function horaLocalAtual(agora = new Date()) {
const horas = String(agora.getHours()).padStart(2, "0");
const minutos = String(agora.getMinutes()).padStart(2, "0");

return `${horas}:${minutos}`;
}

function dataHoraPadraoAtual() {
const agora = new Date();

return {
  data: dataLocalAtual(agora),
  hora: horaLocalAtual(agora)
};
}

function normalizarTexto(valor) {
return String(valor || "").trim();
}

function mensagemErroPublica(erro, fallback = "Não foi possível concluir a operação.") {
const status = Number(erro?.status || 0);

if (status === 401 || status === 403) {
return "Sua sessão não está autorizada para esta operação.";
}

return fallback;
}

function bdValido(valor) {
return /^\d{5,20}$/.test(normalizarTexto(valor));
}

function aplicarTema(tema) {
const temaAtual = tema === "dark" ? "dark" : "light";
document.documentElement.dataset.theme = temaAtual;

const botao = $("btnTema");
if (botao) {
const escuro = temaAtual === "dark";
botao.setAttribute("aria-pressed", String(escuro));
botao.setAttribute("aria-label", escuro ? "Ativar modo claro" : "Ativar modo escuro");
botao.querySelector(".theme-label").textContent = escuro ? "Modo claro" : "Modo escuro";
botao.querySelector(".theme-icon").textContent = escuro ? "☀" : "☾";
}
}

function alternarTema() {
const temaAtual = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
const proximoTema = temaAtual === "dark" ? "light" : "dark";
localStorage.setItem(TEMA_STORAGE_KEY, proximoTema);
aplicarTema(proximoTema);
}

function formatarData(data) {
if (!data) return "";

const partes = String(data).split("-");
if (partes.length !== 3) return data;

return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function formatarHora(hora) {
if (!hora) return "";
return String(hora).substring(0, 5);
}

function formatarDataHora(registro) {
const data = formatarData(registro.data_relatorio);
const hora = formatarHora(registro.hora_relatorio);

if (data && hora) return `${data} ${hora}`;
if (data) return data;
if (hora) return hora;

return "";
}

function atualizarDataAtual() {
const agora = new Date();

const data = agora.toLocaleDateString("pt-BR");

const hora = agora.toLocaleTimeString("pt-BR", {
hour: "2-digit",
minute: "2-digit"
});

if ($("currentDate")) $("currentDate").textContent = data;
if ($("lastUpdate")) $("lastUpdate").textContent = hora;
}

function calcularHoras(registro) {
if (!registro.data_relatorio) return null;

const hora = registro.hora_relatorio || "00:00";

const dataHora = new Date(
`${registro.data_relatorio}T${hora}`
);

if (Number.isNaN(dataHora.getTime())) return null;

return (Date.now() - dataHora.getTime()) / 3600000;
}

function calcularPrazoAutomatico(registro) {
const horas = calcularHoras(registro);

if (horas === null) return "";

if (horas <= 4) return "Até 04H";
if (horas <= 12) return "Até 12H";
if (horas <= 24) return "Até 24H";
if (horas <= 48) return "Mais de 1 Dia";

return "Mais de 2 Dias";
}

async function carregarDadosOnline() {
if (!configurado()) {
throw new Error(
"Supabase não configurado corretamente. Verifique o config.js."
);
}

const resposta = await fetch(
`${API_REPAROS}?select=*&order=id.desc`,
{
method: "GET",
headers: headers()
}
);

if (!resposta.ok) {
const erro = await resposta.text();
throw new Error(
erro || `Erro ao carregar dados. Código: ${resposta.status}`
);
}

return await resposta.json();
}

async function carregarDados(opcoes = {}) {
if (carregandoDados) return;

carregandoDados = true;
const botaoAtualizar = $("btnAtualizar");
if (botaoAtualizar) botaoAtualizar.disabled = true;
atualizarStatusSistema("Atualizando dados...", "loading");

try {
dadosCache = await carregarDadosOnline();

renderizarTudo();
atualizarStatusSistema("Sistema operacional", "online");
 if (opcoes.notificar !== false) {
   mostrarToast(`${dadosCache.length} registro(s) carregado(s).`, "success");
 }

} catch (erro) {
console.error(erro);

dadosCache = [];

renderizarTudo();
atualizarStatusSistema("Falha na conexão", "offline");
mostrarToast("Não foi possível carregar os dados. Verifique a conexão.", "error");

} finally {
carregandoDados = false;
if (botaoAtualizar) botaoAtualizar.disabled = false;
}
}

function renderizarTudo() {
renderizarTabela();
atualizarCards();
atualizarStatus();
atualizarAging();
atualizarDataAtual();
}

function atualizarCards() {
const total = dadosCache.length;

const omspi = dadosCache.filter(
item => normalizarTexto(item.grupo).toUpperCase() === "O&M SPI"
).length;

const swt = dadosCache.filter(
item => normalizarTexto(item.grupo).toUpperCase() === "SWT"
).length;

const gpon = dadosCache.filter(
item => normalizarTexto(item.grupo).toUpperCase() === "GPON"
).length;

const gtd = dadosCache.filter(
item => normalizarTexto(item.grupo).toUpperCase() === "GTD"
).length;

if ($("totalReparos")) $("totalReparos").textContent = total;
if ($("totalOMSPI")) $("totalOMSPI").textContent = omspi;
if ($("totalSWT")) $("totalSWT").textContent = swt;
if ($("totalGPON")) $("totalGPON").textContent = gpon;
if ($("totalGTD")) $("totalGTD").textContent = gtd;
}

function atualizarStatus() {
const atendimento = dadosCache.filter(
item => normalizarTexto(item.status).toLowerCase() === "em atendimento"
).length;

const aguardando = dadosCache.filter(
item => normalizarTexto(item.status).toLowerCase() === "aguardando"
).length;

const semPrevisao = dadosCache.filter(
item => normalizarTexto(item.status).toLowerCase() === "sem previsão"
).length;

if ($("statusAtendimento")) {
$("statusAtendimento").textContent = atendimento;
}

if ($("statusAguardando")) {
$("statusAguardando").textContent = aguardando;
}

if ($("statusSemPrevisao")) {
$("statusSemPrevisao").textContent = semPrevisao;
}
}

function atualizarAging() {
let ate04 = 0;
let ate12 = 0;
let ate24 = 0;
let mais1 = 0;
let mais2 = 0;

dadosCache.forEach(item => {
const horas = calcularHoras(item);

if (horas === null || horas < 0) return;

if (horas <= 4) {
  ate04++;
} else if (horas <= 12) {
  ate12++;
} else if (horas <= 24) {
  ate24++;
} else if (horas <= 48) {
  mais1++;
} else {
  mais2++;
}

});

const total = dadosCache.length || 1;

const valores = [
["aging04h", "bar04h", ate04],
["aging12h", "bar12h", ate12],
["aging24h", "bar24h", ate24],
["aging1d", "bar1d", mais1],
["aging2d", "bar2d", mais2]
];

valores.forEach(([valorId, barraId, quantidade]) => {
if ($(valorId)) {
$(valorId).textContent = quantidade;
}

if ($(barraId)) {
  $("" + barraId).style.width =
    `${Math.min((quantidade / total) * 100, 100)}%`;
}

});
}

function statusClasse(status) {
const valor = normalizarTexto(status).toLowerCase();

if (valor === "em atendimento") return "status-atendimento";
if (valor === "aguardando") return "status-aguardando";
if (valor === "sem previsão") return "status-sem-previsao";

return "";
}

function renderizarTabela() {
const corpo = $("tabelaBody");
const vazio = $("emptyState");
const resumo = $("tableSummary");

if (!corpo) return;

const pesquisa = normalizarTexto($("pesquisa")?.value).toLowerCase();
const filtroStatus = normalizarTexto($("filtroStatus")?.value).toLowerCase();

const filtrados = dadosCache.filter(item => {
const status = normalizarTexto(item.status).toLowerCase();

if (filtroStatus && status !== filtroStatus) return false;
if (!pesquisa) return true;

const texto = [
  item.grupo,
  item.produto,
  item.bd,
  item.cliente,
  item.prazo,
  item.cidade,
  item.status,
  item.atualizacao
]
  .join(" ")
  .toLowerCase();

return texto.includes(pesquisa);

});

if (resumo) {
resumo.textContent = filtrados.length === dadosCache.length
? `${dadosCache.length} registro(s) no total`
: `Exibindo ${filtrados.length} de ${dadosCache.length} registro(s)`;
}

corpo.replaceChildren();

if (filtrados.length === 0) {
if (vazio) {
vazio.textContent = dadosCache.length
? "Nenhum registro corresponde aos filtros."
: "Nenhum registro cadastrado.";
vazio.style.display = "block";
}
return;
}

if (vazio) vazio.style.display = "none";

filtrados.forEach(item => {
const prazo = calcularPrazoAutomatico(item) || item.prazo || "";

const linha = document.createElement("tr");

const valores = [
  item.grupo,
  item.produto,
  item.bd,
  item.cliente,
  prazo,
  item.cidade
];

valores.forEach(valor => {
  const celula = document.createElement("td");
  celula.textContent = normalizarTexto(valor);
  linha.appendChild(celula);
});

const celulaStatus = document.createElement("td");
const badge = document.createElement("span");
badge.className = `status-badge ${statusClasse(item.status)}`.trim();
badge.textContent = normalizarTexto(item.status) || "Sem status";
celulaStatus.appendChild(badge);
linha.appendChild(celulaStatus);

[formatarDataHora(item), item.atualizacao].forEach(valor => {
  const celula = document.createElement("td");
  celula.textContent = normalizarTexto(valor);
  linha.appendChild(celula);
});

const celulaAcoes = document.createElement("td");
celulaAcoes.className = "acoes";
[
  ["editar", "Editar", "button-small"],
  ["historico", "Histórico", "button-small"],
  ["excluir", "Excluir", "button-small button-danger"]
].forEach(([acao, texto, classe]) => {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = classe;
  botao.dataset.acao = acao;
  botao.dataset.id = String(item.id);
  botao.textContent = texto;
  celulaAcoes.appendChild(botao);
});
linha.appendChild(celulaAcoes);

corpo.appendChild(linha);

});

corpo.querySelectorAll("button[data-acao]").forEach(botao => {
botao.addEventListener("click", async () => {
const id = Number(botao.dataset.id);
const acao = botao.dataset.acao;

  if (acao === "editar") {
    abrirEdicao(id);
  }

  if (acao === "historico") {
    abrirHistorico(id);
  }

  if (acao === "excluir") {
    excluirRegistro(id);
  }
});

});
}

function abrirModal() {
const modal = $("modal");

if (!modal) return;

modal.classList.add("active");
modal.setAttribute("aria-hidden", "false");
setTimeout(() => $("grupo")?.focus(), 0);
}

function fecharModal() {
const modal = $("modal");

if (!modal) return;

modal.classList.remove("active");
modal.setAttribute("aria-hidden", "true");

limparFormulario();
}

function limparFormulario() {
editandoId = null;

if ($("modalTitle")) $("modalTitle").textContent = "Cadastrar reparo";

const { data, hora } = dataHoraPadraoAtual();

[
"grupo",
"produto",
"bd",
"status",
"cidade",
"atualizacao"
].forEach(id => {
if ($(id)) $(id).value = "";
});

if ($("data_relatorio")) $("data_relatorio").value = data;
if ($("hora_relatorio")) $("hora_relatorio").value = hora;

if ($("cliente")) {
$("cliente").value = "Secretaria da Educação";
}
}

function abrirNovo() {
limparFormulario();
abrirModal();
}

function obterCamposFormulario() {
return [
  $("grupo"),
  $("produto"),
  $("bd"),
  $("cliente"),
  $("status"),
  $("data_relatorio"),
  $("hora_relatorio"),
  $("cidade"),
  $("atualizacao"),
  $("btnCancelar"),
  $("btnSalvar")
].filter(Boolean);
}

function moverFocoFormulario(direcao = 1) {
const campos = obterCamposFormulario();
if (!campos.length) return;

const atual = document.activeElement;
const indiceAtual = campos.indexOf(atual);
const proximoIndice = indiceAtual >= 0
  ? (indiceAtual + direcao + campos.length) % campos.length
  : 0;

campos[proximoIndice].focus();
}

function abrirEdicao(id) {
const item = dadosCache.find(
registro => Number(registro.id) === Number(id)
);

if (!item) {
mostrarToast("Registro não encontrado.", "error");
return;
}

editandoId = item.id;

if ($("modalTitle")) {
$("modalTitle").textContent = "Editar reparo";
}

if ($("grupo")) $("grupo").value = item.grupo || "";
if ($("produto")) $("produto").value = item.produto || "";
if ($("bd")) $("bd").value = item.bd || "";
if ($("cliente")) $("cliente").value = item.cliente || "";
if ($("status")) $("status").value = item.status || "";
if ($("data_relatorio")) $("data_relatorio").value = item.data_relatorio || "";
if ($("hora_relatorio")) {
$("hora_relatorio").value = formatarHora(item.hora_relatorio);
}
if ($("cidade")) $("cidade").value = item.cidade || "";
if ($("atualizacao")) $("atualizacao").value = item.atualizacao || "";

abrirModal();
}

function obterFormulario() {
const data = normalizarTexto($("data_relatorio")?.value);
const hora = normalizarTexto($("hora_relatorio")?.value);

const registro = {
grupo: normalizarTexto($("grupo")?.value),
produto: normalizarTexto($("produto")?.value),
bd: normalizarTexto($("bd")?.value),
cliente: normalizarTexto($("cliente")?.value),
status: normalizarTexto($("status")?.value),
data_relatorio: data || null,
hora_relatorio: hora || null,
prazo: "",
cidade: normalizarTexto($("cidade")?.value),
atualizacao: normalizarTexto($("atualizacao")?.value)
};

registro.prazo = calcularPrazoAutomatico(registro);

return registro;
}

function validarRegistro(registro) {
if (!registro.bd) {
mostrarToast("Informe o número do reparo (BD).", "error");
return false;
}

if (!bdValido(registro.bd)) {
mostrarToast("O BD deve conter apenas números.", "error");
return false;
}

if (!registro.cliente) {
mostrarToast("Informe o cliente.", "error");
return false;
}

if (
registro.status &&
!["Aguardando", "Em atendimento", "Sem previsão"].includes(registro.status)
) {
mostrarToast("Status inválido.", "error");
return false;
}

return true;
}

async function registrarHistorico(reparoId, bd, acao, detalhes = "") {
if (!reparoId) return;

const resposta = await fetch(API_HISTORICO, {
method: "POST",
headers: headers({
Prefer: "return=minimal"
}),
body: JSON.stringify({
reparo_id: reparoId,
bd: String(bd || ""),
acao: String(acao || ""),
detalhes: String(detalhes || "")
})
});

if (!resposta.ok) {
console.warn(
"Não foi possível registrar o histórico:",
await resposta.text()
);
}
}

async function salvarRegistro() {
const registro = obterFormulario();

if (!validarRegistro(registro)) return;

const duplicado = dadosCache.find(
item =>
String(item.bd) === String(registro.bd) &&
Number(item.id) !== Number(editandoId)
);

if (duplicado) {
mostrarToast("Já existe um registro com este número de BD.", "error");
return;
}

const botao = $("btnSalvar");

if (botao) {
botao.disabled = true;
botao.textContent = "Salvando...";
}

try {
if (!editandoId) {
const resposta = await fetch(API_REPAROS, {
method: "POST",
headers: headers({
Prefer: "return=representation"
}),
body: JSON.stringify(registro)
});

  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(erro);
  }

  const criado = await resposta.json();

  const novoRegistro = Array.isArray(criado)
    ? criado[0]
    : criado;

  if (novoRegistro?.id) {
    await registrarHistorico(
      novoRegistro.id,
      novoRegistro.bd,
      "Cadastro",
      "Reparo cadastrado no sistema."
    );
  }

  mostrarToast("Registro cadastrado com sucesso!", "success");
} else {
  const resposta = await fetch(
    `${API_REPAROS}?id=eq.${encodeURIComponent(editandoId)}`,
    {
      method: "PATCH",
      headers: headers({
        Prefer: "return=representation"
      }),
      body: JSON.stringify(registro)
    }
  );

  if (!resposta.ok) {
    const erro = await resposta.text();
    throw new Error(erro);
  }

  await registrarHistorico(
    editandoId,
    registro.bd,
    "Atualização",
    "Informações do reparo atualizadas."
  );

  mostrarToast("Registro atualizado com sucesso!", "success");
}

fecharModal();

await carregarDados({ notificar: false });

} catch (erro) {
console.error(erro);

mostrarToast(mensagemErroPublica(erro, "Não foi possível salvar o registro."), "error");

} finally {
if (botao) {
botao.disabled = false;
botao.textContent = "Salvar reparo";
}
}
}

async function excluirRegistro(id) {
const item = dadosCache.find(
registro => Number(registro.id) === Number(id)
);

if (!item) return;

const confirmar = await confirmarAcao(
`Deseja realmente excluir o BD ${item.bd}?`,
"Excluir registro"
);

if (!confirmar) return;

try {
await registrarHistorico(
item.id,
item.bd,
"Exclusão",
"Reparo excluído do sistema."
);

const resposta = await fetch(
  `${API_REPAROS}?id=eq.${encodeURIComponent(id)}`,
  {
    method: "DELETE",
    headers: headers()
  }
);

if (!resposta.ok) {
  const erro = await resposta.text();
  throw new Error(erro);
}

await carregarDados({ notificar: false });

mostrarToast("Registro excluído com sucesso!", "success");

} catch (erro) {
console.error(erro);

mostrarToast(mensagemErroPublica(erro, "Não foi possível excluir o registro."), "error");

}
}

async function excluirTodos() {
if (dadosCache.length === 0) {
mostrarToast("Não existem registros para excluir.", "error");
return;
}

const confirmar = await confirmarAcao(
"Deseja excluir todos os reparos cadastrados? Esta ação não pode ser desfeita.",
"Excluir todos os registros"
);

if (!confirmar) return;

try {
const resposta = await fetch(
`${API_REPAROS}?id=gt.0`,
{
method: "DELETE",
headers: headers()
}
);

if (!resposta.ok) {
  const erro = await resposta.text();
  throw new Error(erro);
}

await carregarDados({ notificar: false });

mostrarToast("Todos os registros foram excluídos.", "success");

} catch (erro) {
console.error(erro);

mostrarToast(mensagemErroPublica(erro, "Não foi possível excluir os registros."), "error");

}
}

function abrirModalImportacao() {
const modal = $("modalPrint");

if (!modal) return;

dadosImportacao = [];
registrosAusentesImportacao = [];

if ($("arquivoPrint")) $("arquivoPrint").value = "";
if ($("ocrStatus")) $("ocrStatus").textContent = "";
if ($("ocrResultado")) {
$("ocrResultado").style.display = "none";
$("ocrResultado").textContent = "";
}
if ($("listaBDsDetectados")) {
$("listaBDsDetectados").style.display = "none";
  $("listaBDsDetectados").replaceChildren();
}
if ($("btnInserirTodos")) {
$("btnInserirTodos").style.display = "none";
}
if ($("btnProcessarPrint")) {
$("btnProcessarPrint").style.display = "inline-block";
}
if ($("registrosAusentes")) {
$("registrosAusentes").style.display = "none";
}
if ($("listaRegistrosAusentes")) {
  $("listaRegistrosAusentes").replaceChildren();
}

modal.classList.add("active");
modal.setAttribute("aria-hidden", "false");
setTimeout(() => $("arquivoPrint")?.focus(), 0);
}

function fecharModalImportacao() {
const modal = $("modalPrint");

if (!modal) return;

modal.classList.remove("active");
modal.setAttribute("aria-hidden", "true");
}

function abrirModalHistorico() {
const modal = $("modalHistorico");

if (!modal) return;

modal.classList.add("active");
modal.setAttribute("aria-hidden", "false");
setTimeout(() => $("btnFecharHistorico")?.focus(), 0);
}

function fecharModalHistorico() {
const modal = $("modalHistorico");

if (!modal) return;

modal.classList.remove("active");
modal.setAttribute("aria-hidden", "true");
}

async function abrirHistorico(id) {
abrirModalHistorico();

const lista = $("historicoLista");

if (lista) {
lista.textContent = "Carregando...";
}

try {
const resposta = await fetch(
`${API_HISTORICO}?reparo_id=eq.${encodeURIComponent(id)}&select=*&order=created_at.desc`,
{
headers: headers()
}
);

if (!resposta.ok) {
  throw new Error(await resposta.text());
}

const historico = await resposta.json();

if (!lista) return;

if (!historico.length) {
const vazio = document.createElement("p");
vazio.textContent = "Nenhum histórico encontrado.";
lista.replaceChildren(vazio);
  return;
}

const fragmento = document.createDocumentFragment();
historico.forEach(item => {
  const data = item.created_at
    ? new Date(item.created_at).toLocaleString("pt-BR")
    : "";
  const bloco = document.createElement("div");
  bloco.className = "history-item";

  const acao = document.createElement("strong");
  acao.textContent = normalizarTexto(item.acao);
  bloco.appendChild(acao);

  const detalhes = document.createElement("div");
  detalhes.textContent = normalizarTexto(item.detalhes);
  bloco.appendChild(detalhes);

  const horario = document.createElement("small");
  horario.textContent = data;
  bloco.appendChild(horario);
  fragmento.appendChild(bloco);
});
lista.replaceChildren(fragmento);

} catch (erro) {
console.error(erro);

if (lista) {
  lista.textContent =
    "Não foi possível carregar o histórico.";
}

}
}

function csvParaMatriz(texto) {
const linhas = [];
let linha = [];
let valor = "";
let aspas = false;

for (let i = 0; i < texto.length; i++) {
const caractere = texto[i];
const proximo = texto[i + 1];

if (caractere === '"') {
  if (aspas && proximo === '"') {
    valor += '"';
    i++;
  } else {
    aspas = !aspas;
  }
  continue;
}

if (caractere === ";" && !aspas) {
  linha.push(valor.trim());
  valor = "";
  continue;
}

if (caractere === "," && !aspas) {
  linha.push(valor.trim());
  valor = "";
  continue;
}

if (
  (caractere === "\n" || caractere === "\r") &&
  !aspas
) {
  if (caractere === "\r" && proximo === "\n") {
    i++;
  }

  linha.push(valor.trim());

  if (linha.some(celula => celula !== "")) {
    linhas.push(linha);
  }

  linha = [];
  valor = "";

  continue;
}

valor += caractere;

}

linha.push(valor.trim());

if (linha.some(celula => celula !== "")) {
linhas.push(linha);
}

return linhas;
}

function localizarColuna(cabecalhos, nomes) {
return cabecalhos.findIndex(cabecalho => {
const texto = normalizarTexto(cabecalho)
.toLowerCase()
.normalize("NFD")
.replace(/[\u0300-\u036f]/g, "");

return nomes.some(nome => texto.includes(nome));

});
}

async function lerArquivoImportacao(arquivo) {
const nome = normalizarTexto(arquivo.name).toLowerCase();
const extensaoValida = /\.(xlsx|csv)$/.test(nome);
const tipoValido = [
  "",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
].includes(arquivo.type);

if (!extensaoValida || !tipoValido) {
  throw new Error("Selecione um arquivo CSV ou Excel válido.");
}

if (!arquivo.size || arquivo.size > LIMITE_IMPORTACAO_BYTES) {
  throw new Error("O arquivo deve ter no máximo 10 MB.");
}

if (nome.endsWith(".csv")) {
const texto = await arquivo.text();
return csvParaMatriz(texto);
}

if (nome.endsWith(".xlsx")) {
if (typeof JSZip === "undefined") {
throw new Error(
"A biblioteca JSZip não foi carregada."
);
}

const buffer = await arquivo.arrayBuffer();

const zip = await JSZip.loadAsync(buffer);

const workbook = await zip.file("xl/workbook.xml").async("text");

const relacoes = await zip
  .file("xl/_rels/workbook.xml.rels")
  .async("text");

const sharedStringsFile = zip.file("xl/sharedStrings.xml");

let sharedStrings = [];

if (sharedStringsFile) {
  const xml = await sharedStringsFile.async("text");

  const documento = new DOMParser().parseFromString(
    xml,
    "application/xml"
  );

  sharedStrings = [...documento.getElementsByTagName("si")].map(
    item => item.textContent || ""
  );
}

const workbookDoc = new DOMParser().parseFromString(
  workbook,
  "application/xml"
);

const primeiraPlanilha = workbookDoc.getElementsByTagName("sheet")[0];

if (!primeiraPlanilha) {
  throw new Error("Nenhuma planilha encontrada.");
}

const relationId = primeiraPlanilha.getAttribute("r:id");

const relacoesDoc = new DOMParser().parseFromString(
  relacoes,
  "application/xml"
);

const relacao = [...relacoesDoc.getElementsByTagName("Relationship")]
  .find(item => item.getAttribute("Id") === relationId);

if (!relacao) {
  throw new Error("Não foi possível localizar a planilha.");
}

let destino = relacao.getAttribute("Target");

if (!destino.startsWith("/")) {
  destino = `xl/${destino.replace(/^\/+/, "")}`;
} else {
  destino = destino.replace(/^\/+/, "");
}

destino = destino.replace(/\\/g, "/");

const sheetFile = zip.file(destino);

if (!sheetFile) {
  throw new Error("Não foi possível abrir a primeira planilha.");
}

const sheetXml = await sheetFile.async("text");

const documento = new DOMParser().parseFromString(
  sheetXml,
  "application/xml"
);

const linhas = [];

[...documento.getElementsByTagName("row")].forEach(row => {
  const valores = [];

  [...row.getElementsByTagName("c")].forEach(celula => {
    const tipo = celula.getAttribute("t");
    const valorNode = celula.getElementsByTagName("v")[0];

    let valor = valorNode?.textContent || "";

    if (tipo === "s") {
      valor = sharedStrings[Number(valor)] || "";
    }

    valores.push(valor);
  });

  linhas.push(valores);

  if (linhas.length > LIMITE_LINHAS_IMPORTACAO) {
    throw new Error("A planilha excede o limite de 5.000 linhas.");
  }
});

return linhas;

}

throw new Error(
"Formato inválido. Use um arquivo .xlsx ou .csv."
);
}

async function processarImportacao() {
const arquivo = $("arquivoPrint")?.files?.[0];

if (!arquivo) {
mostrarToast("Selecione uma planilha Excel ou CSV.", "error");
return;
}

if ($("ocrStatus")) {
$("ocrStatus").textContent = "Lendo arquivo...";
}

dadosImportacao = [];
registrosAusentesImportacao = [];

try {
const matriz = await lerArquivoImportacao(arquivo);

if (!matriz.length) {
  throw new Error("A planilha está vazia.");
}

const cabecalhos = matriz[0];

const colunaCliente = localizarColuna(
  cabecalhos,
  ["cliente", "cliente afetado"]
);

const colunaBD = localizarColuna(
  cabecalhos,
  ["numero do reparo", "número do reparo", "bd", "reparo"]
);

const colunaProduto = localizarColuna(
  cabecalhos,
  ["produto"]
);

const colunaCidade = localizarColuna(
  cabecalhos,
  ["cidade"]
);

if (colunaBD === -1) {
  throw new Error(
    "Não encontrei a coluna Número do reparo ou BD."
  );
}

if (matriz.length > LIMITE_LINHAS_IMPORTACAO + 1) {
  throw new Error("A planilha excede o limite de 5.000 linhas.");
}

const linhasImportacao = matriz.slice(1).map(linha => ({
  cliente:
    colunaCliente >= 0
      ? normalizarTexto(linha[colunaCliente])
      : "Secretaria da Educação",
  bd: normalizarTexto(linha[colunaBD]),
  produto:
    colunaProduto >= 0
      ? normalizarTexto(linha[colunaProduto])
      : "",
  cidade:
    colunaCidade >= 0
      ? normalizarTexto(linha[colunaCidade])
      : ""
}));

if (matriz.some(linha => linha.some(celula => String(celula || "").length > LIMITE_CELULA_IMPORTACAO))) {
  throw new Error("A planilha contém uma célula maior que 2.000 caracteres.");
}

const linhaInvalida = linhasImportacao.find(
  item => item.bd && !bdValido(item.bd)
);

if (linhaInvalida) {
  throw new Error(`O BD ${linhaInvalida.bd} é inválido. Use apenas 5 a 20 números.`);
}

dadosImportacao = linhasImportacao
  .filter(item => item.bd)
  .filter(
    (item, index, array) =>
      array.findIndex(outro => outro.bd === item.bd) === index
  );

const bdsDaPlanilha = new Set(
  dadosImportacao.map(item => String(item.bd))
);

registrosAusentesImportacao = dadosCache.filter(
  item => !bdsDaPlanilha.has(String(item.bd))
);

if ($("ocrStatus")) {
  $("ocrStatus").textContent =
    `${dadosImportacao.length} reparo(s) identificado(s).`;
}

if ($("ocrResultado")) {
  $("ocrResultado").style.display = "block";
  $("ocrResultado").textContent =
    `${dadosImportacao.length} reparo(s) encontrado(s) para importação.`;
}

if ($("listaBDsDetectados")) {
  $("listaBDsDetectados").style.display = "block";
  const fragmento = document.createDocumentFragment();
  dadosImportacao.slice(0, 100).forEach(item => {
    const linha = document.createElement("div");
    linha.textContent = `${item.bd} — ${item.cliente}`;
    fragmento.appendChild(linha);
  });
  $("listaBDsDetectados").replaceChildren(fragmento);
}

if ($("btnInserirTodos")) {
  $("btnInserirTodos").style.display = registrosAusentesImportacao.length
    ? "none"
    : "inline-block";
}

if ($("btnProcessarPrint")) {
  $("btnProcessarPrint").style.display = "none";
}

if ($("registrosAusentes")) {
  $("registrosAusentes").style.display = registrosAusentesImportacao.length
    ? "block"
    : "none";
}

if ($("listaRegistrosAusentes")) {
  const fragmento = document.createDocumentFragment();
  registrosAusentesImportacao.forEach(item => {
    const linha = document.createElement("div");
    linha.textContent = `${item.bd} — ${item.cliente || "Sem cliente"}`;
    fragmento.appendChild(linha);
  });
  $("listaRegistrosAusentes").replaceChildren(fragmento);
}

} catch (erro) {
console.error(erro);

if ($("ocrStatus")) {
  $("ocrStatus").textContent =
    "Não foi possível processar o arquivo.";
}

}
}

async function inserirTodosImportados(excluirAusentes = false) {
if (!dadosImportacao.length) {
mostrarToast("Primeiro processe o arquivo.", "error");
return;
}

const existentes = new Set(
dadosCache.map(item => String(item.bd))
);

const novos = dadosImportacao.filter(
item => !existentes.has(String(item.bd))
);

if (!novos.length && !excluirAusentes) {
mostrarToast("Todos os BDs identificados já existem no sistema.", "error");
return;
}

const { data, hora } = dataHoraPadraoAtual();

const registros = novos.map(item => ({
grupo: "",
produto: item.produto || "",
bd: item.bd,
cliente: item.cliente || "Secretaria da Educação",
status: "",
data_relatorio: data,
hora_relatorio: hora,
prazo: "Até 04H",
cidade: item.cidade || "",
atualizacao: ""
}));

const botao = $("btnInserirTodos");
const botaoExcluir = $("btnExcluirAusentes");
const botaoManter = $("btnManterAusentes");

try {
if (botao) {
botao.disabled = true;
botao.textContent = "Cadastrando...";
}
if (botaoExcluir) botaoExcluir.disabled = true;
if (botaoManter) botaoManter.disabled = true;

if (excluirAusentes) {
  for (const registro of registrosAusentesImportacao) {
    await registrarHistorico(
      registro.id,
      registro.bd,
      "Exclusão",
      "Reparo ausente da planilha importada."
    );

    const respostaExclusao = await fetch(
      `${API_REPAROS}?id=eq.${encodeURIComponent(registro.id)}`,
      {
        method: "DELETE",
        headers: headers()
      }
    );

    if (!respostaExclusao.ok) {
      throw new Error(await respostaExclusao.text());
    }
  }

  if (!novos.length) {
    fecharModalImportacao();
    await carregarDados({ notificar: false });
    mostrarToast("Os registros ausentes foram excluídos com sucesso!", "success");
    return;
  }
}

const resposta = await fetch(API_REPAROS, {
  method: "POST",
  headers: headers({
    Prefer: "return=representation"
  }),
  body: JSON.stringify(registros)
});

if (!resposta.ok) {
  throw new Error(await resposta.text());
}

const criados = await resposta.json();

for (const registro of criados) {
  await registrarHistorico(
    registro.id,
    registro.bd,
    "Importação",
    "Reparo importado através de planilha Excel/CSV."
  );
}

fecharModalImportacao();

await carregarDados({ notificar: false });

mostrarToast(`${criados.length} reparo(s) cadastrado(s) com sucesso.`, "success");

} catch (erro) {
console.error(erro);

mostrarToast(mensagemErroPublica(erro, "Não foi possível importar os reparos."), "error");

} finally {
if (botao) {
botao.disabled = false;
botao.textContent = "Cadastrar itens identificados";
}
if (botaoExcluir) botaoExcluir.disabled = false;
if (botaoManter) botaoManter.disabled = false;
}
}

function configurarEventos() {
$('btnTema')?.addEventListener("click", alternarTema);

$("btnNovo")?.addEventListener("click", abrirNovo);

$("btnAtualizar")?.addEventListener("click", carregarDados);

$("filtroStatus")?.addEventListener("change", renderizarTabela);

$("btnLimparPesquisa")?.addEventListener("click", () => {
if ($("pesquisa")) $("pesquisa").value = "";
if ($("filtroStatus")) $("filtroStatus").value = "";
renderizarTabela();
$("pesquisa")?.focus();
});

$("btnCancelar")?.addEventListener("click", fecharModal);

$("btnSalvar")?.addEventListener("click", salvarRegistro);

$("btnExcluirTodos")?.addEventListener("click", excluirTodos);

$("pesquisa")?.addEventListener("input", renderizarTabela);

$("btnAnalisarPrint")?.addEventListener(
"click",
abrirModalImportacao
);

$("btnCancelarPrint")?.addEventListener(
"click",
fecharModalImportacao
);

$("btnProcessarPrint")?.addEventListener(
"click",
processarImportacao
);

$("btnInserirTodos")?.addEventListener(
"click",
inserirTodosImportados
);

$("btnExcluirAusentes")?.addEventListener(
"click",
() => inserirTodosImportados(true)
);

$("btnManterAusentes")?.addEventListener(
"click",
() => inserirTodosImportados(false)
);

$("btnFecharHistorico")?.addEventListener(
"click",
fecharModalHistorico
);

$("btnCancelarConfirmacao")?.addEventListener(
"click",
() => fecharConfirmacao(false)
);

$("btnConfirmarAcao")?.addEventListener(
"click",
() => fecharConfirmacao(true)
);

$("modal")?.addEventListener("click", evento => {
if (evento.target === $("modal")) {
fecharModal();
}
});

$("modalPrint")?.addEventListener("click", evento => {
if (evento.target === $("modalPrint")) {
fecharModalImportacao();
}
});

$("modalHistorico")?.addEventListener("click", evento => {
if (evento.target === $("modalHistorico")) {
fecharModalHistorico();
}
});

$("modalConfirmacao")?.addEventListener("click", evento => {
if (evento.target === $("modalConfirmacao")) {
  fecharConfirmacao(false);
}
});

$("modal")?.addEventListener("keydown", evento => {
if (!$("modal")?.classList.contains("active")) return;

if (evento.key === "Enter") {
  const alvo = evento.target;
  const camposTexto = ["TEXTAREA", "INPUT", "SELECT"];

  if (alvo && camposTexto.includes(alvo.tagName) && alvo !== $("atualizacao")) {
    evento.preventDefault();
    salvarRegistro();
  }

  return;
}

if (evento.key === "Tab") {
  evento.preventDefault();
  moverFocoFormulario(evento.shiftKey ? -1 : 1);
}

if (evento.key === "Escape") {
  fecharModal();
}
});

$("data_relatorio")?.addEventListener("change", () => {
renderizarTabela();
});

$("hora_relatorio")?.addEventListener("change", () => {
renderizarTabela();
});

document.addEventListener("keydown", evento => {
if (evento.key !== "Escape") return;

if ($("modal")?.classList.contains("active")) fecharModal();
if ($("modalPrint")?.classList.contains("active")) fecharModalImportacao();
if ($("modalHistorico")?.classList.contains("active")) fecharModalHistorico();
if ($("modalConfirmacao")?.classList.contains("active")) fecharConfirmacao(false);
});
}

document.addEventListener("DOMContentLoaded", async () => {
configurarEventos();

const temaSalvo = localStorage.getItem(TEMA_STORAGE_KEY);
aplicarTema(temaSalvo === "dark" ? "dark" : "light");

atualizarDataAtual();

setInterval(() => {
atualizarDataAtual();
atualizarAging();
renderizarTabela();
}, 60000);

if (!configurado()) {
console.error(
"Supabase não configurado. Verifique assets/js/config.js"
);

mostrarToast("Erro de configuração. Verifique a URL e a chave pública do Supabase.", "error");

return;

}

await carregarDados();
});
