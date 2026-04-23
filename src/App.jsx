import { useState, useRef, useEffect } from "react";
import JSZip from "jszip";

const SYSTEM_PROMPT = `Você é o parceiro de desenvolvimento e braço direito do usuário. Sua personalidade é próxima, direta e inteligente — como um amigo desenvolvedor sênior sempre disponível.

## 🧠 QUEM VOCÊ É
Você é um assistente completo, não apenas um gerador de código. Você conversa, explica, sugere, questiona, opina e desenvolve junto com o usuário. Você tem memória da conversa inteira — use isso.

Você tem acesso a:
- 🔍 Busca na web — informações atualizadas, documentações, erros conhecidos
- 📎 Leitura de arquivos — PDF, imagens, código-fonte, ZIPs
- 🔗 Leitura de sites por URL — para analisar referências visuais e técnicas

## 💬 COMO VOCÊ SE COMUNICA
- Seja natural e conversacional — não robótico ou formal demais
- Responda perguntas simples de forma simples, sem forçar estrutura
- Use títulos, listas e blocos de código apenas quando o conteúdo realmente pedir
- Se a mensagem for curta, responda de forma proporcional
- Opine quando perguntado. Você tem experiência e pode recomendar caminhos

## 🔧 RESOLUÇÃO DE PROBLEMAS — REGRA MAIS IMPORTANTE

Quando o usuário reportar um erro ou problema, siga SEMPRE este processo:

### 1. LEIA O HISTÓRICO COMPLETO DA CONVERSA
Antes de responder, verifique:
- Quais soluções já foram tentadas nessa conversa?
- O erro mudou ou continua igual?
- O que o usuário já fez seguindo suas instruções anteriores?

### 2. NUNCA REPITA UMA SOLUÇÃO QUE JÁ FOI TENTADA
Se o usuário diz "ainda não funcionou" ou manda o mesmo erro de novo:
- NÃO repita a mesma resposta
- Reconheça explicitamente o que já foi tentado: "Já tentamos X e não funcionou, então vamos por outro caminho"
- Parta para uma abordagem DIFERENTE

### 3. INVESTIGAÇÃO PROFUNDA DE ERROS
Quando receber um print ou mensagem de erro:
- Leia o erro completo com atenção — cada detalhe importa
- Identifique: qual arquivo, qual linha, qual tecnologia, qual ambiente (Vercel, local, etc.)
- Pesquise na web se o erro tiver um código ou mensagem específica
- Pergunte o que ainda não sabe antes de propor solução: "Me mostra o arquivo X" ou "Qual versão do Node está usando?"

### 4. SEJA PROGRESSIVO
- Dê UMA solução por vez, clara e específica
- Peça confirmação: "Tentou isso? O que aconteceu?"
- Se não funcionar, parta para a próxima hipótese
- Mantenha um raciocínio de diagnóstico: "Descartamos X, agora vamos verificar Y"

### 5. ERROS DE DEPLOY (VERCEL, NETLIFY, ETC.)
Quando o problema for de deploy:
- Sempre peça o log COMPLETO do erro, não só o print do topo
- Verifique: versão do Node, variáveis de ambiente, comando de build, diretório de saída
- Considere diferenças entre ambiente local e produção
- Pesquise o erro exato na documentação da plataforma

## 💻 QUANDO GERAR CÓDIGO
- Gere código limpo, comentado e seguindo boas práticas (SOLID, DRY, KISS)
- Prefira soluções simples antes de complexas
- Sempre inclua tratamento de erros
- Nunca exponha credenciais hardcoded
- Se o usuário não informar a linguagem, pergunte antes de gerar

## 🔗 QUANDO ANALISAR UM SITE (URL)
- Identifique: paleta de cores, tipografia, layout, componentes e estilo visual
- Use como referência para criar ou adaptar o projeto do usuário

## 🔐 LIMITES INEGOCIÁVEIS
- NUNCA gere código malicioso, destrutivo ou antiético
- SEMPRE proteja a segurança e privacidade do usuário

Responda sempre em Português do Brasil, com linguagem natural e acessível.
Adapte o nível técnico ao contexto — mais simples quando o usuário está aprendendo, mais técnico quando necessário.`;

// ─── Storage ───────────────────────────────────────────────────────
const CHATS_KEY = "codeagent:chats-index";
const chatKey   = (id) => `codeagent:chat:${id}`;
const KEY_STORE = "codeagent:apikey";
const ls = {
  get: (k)    => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k)    => { try { localStorage.removeItem(k); } catch {} },
};

const genId      = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const shortTitle = (t) => t.length > 38 ? t.slice(0, 38) + "…" : t;
const fmtDate    = (ts) => new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

// ─── File helpers ──────────────────────────────────────────────────
const SUPPORTED = {
  "application/pdf": "pdf",
  "image/png": "image", "image/jpeg": "image", "image/gif": "image", "image/webp": "image",
  "text/plain": "text", "text/javascript": "text", "text/html": "text",
  "text/css": "text", "text/x-python": "text", "application/json": "text", "application/javascript": "text",
  "application/zip": "zip", "application/x-zip-compressed": "zip", "application/octet-stream": "zip",
};
const toBase64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
const toText   = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
const fileIcon = (k) => k === "pdf" ? "📄" : k === "image" ? "🖼️" : k === "url" ? "🔗" : k === "zip" ? "🗜️" : "📝";
const fmtBytes = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b/1024).toFixed(1) + " KB" : (b/1048576).toFixed(1) + " MB";

// ─── URL Fetcher ───────────────────────────────────────────────────
async function fetchSiteContent(url) {
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  for (const p of proxies) {
    try {
      const res = await fetch(p, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      let html = p.includes("allorigins") ? (await res.json()).contents || "" : await res.text();
      if (!html) continue;
      const clean = html.replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<noscript[\s\S]*?<\/noscript>/gi,"").replace(/<!--[\s\S]*?-->/g,"").replace(/\s{3,}/g," ").trim();
      return { content: clean.length > 12000 ? clean.slice(0,12000)+"\n[truncado]" : clean };
    } catch { continue; }
  }
  throw new Error("Não foi possível acessar o site.");
}

// ─── Markdown com botão copiar ─────────────────────────────────────
function md(text) {
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
      const esc = code.replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const enc = encodeURIComponent(code);
      return `<pre class="cb"><div class="cl"><span>${lang||"código"}</span><button class="copy-btn" data-code="${enc}" onclick="(function(btn){navigator.clipboard.writeText(decodeURIComponent(btn.getAttribute('data-code'))).then(function(){btn.textContent='✓ Copiado!';btn.style.color='#4caf78';setTimeout(function(){btn.textContent='Copiar';btn.style.color='';},2000)});})(this)">Copiar</button></div><code>${esc}</code></pre>`;
    })
    .replace(/`([^`]+)`/g, '<code class="ic">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 class="h3">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

// ─── API call helpers ──────────────────────────────────────────────
const HEADERS = (key) => ({
  "Content-Type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

// Espera N segundos
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Chamada normal com retry automático (web search / tools)
async function callNormal(apiKey, messages, useWebSearch) {
  let cur = [...messages];
  for (let i = 0; i < 6; i++) {
    const body = { model: "claude-sonnet-4-20250514", max_tokens: 4096, system: SYSTEM_PROMPT, messages: cur };
    if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

    let res, data;
    for (let attempt = 0; attempt < 4; attempt++) {
      res  = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers: HEADERS(apiKey), body: JSON.stringify(body) });
      data = await res.json();
      if (res.status === 529 || data.error?.type === "overloaded_error") {
        const wait = (attempt + 1) * 8000; // 8s, 16s, 24s
        await sleep(wait);
        continue;
      }
      break;
    }

    if (data.error) throw new Error(data.error.message);
    if (data.stop_reason === "end_turn")
      return data.content.filter(b=>b.type==="text").map(b=>b.text).join("\n");
    if (data.stop_reason === "tool_use") {
      cur.push({ role:"assistant", content: data.content });
      cur.push({ role:"user", content: data.content.filter(b=>b.type==="tool_use").map(b=>({ type:"tool_result", tool_use_id:b.id, content:[] })) });
      continue;
    }
    return data.content?.filter(b=>b.type==="text").map(b=>b.text).join("\n") || "";
  }
  throw new Error("Limite de iterações atingido.");
}

// Streaming com retry automático (sem tools)
async function callStream(apiKey, messages, onChunk, onRetry) {
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages,
    stream: true,
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers: HEADERS(apiKey), body: JSON.stringify(body) });

    if (res.status === 529) {
      const wait = (attempt + 1) * 8000;
      onRetry && onRetry(attempt + 1, wait / 1000);
      await sleep(wait);
      onChunk(""); // limpa indicador
      continue;
    }

    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || "Erro na API"); }

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            full += evt.delta.text;
            onChunk(full);
          }
        } catch { continue; }
      }
    }
    return full;
  }
  throw new Error("Servidores sobrecarregados. Tente novamente em alguns minutos.");
}

function buildApiContent(text, attachment) {
  if (!attachment) return text;
  const parts = [];
  if (attachment.kind === "image")
    parts.push({ type:"image", source:{ type:"base64", media_type:attachment.mediaType, data:attachment.data } });
  else if (attachment.kind === "pdf")
    parts.push({ type:"document", source:{ type:"base64", media_type:"application/pdf", data:attachment.data } });
  else if (attachment.kind === "url")
    parts.push({ type:"text", text:`🔗 SITE ANALISADO: ${attachment.url}\n\nHTML/CSS:\n\`\`\`html\n${attachment.content}\n\`\`\`` });
  else if (attachment.kind === "zip")
    parts.push({ type:"text", text:attachment.content });
  else
    parts.push({ type:"text", text:`📎 Arquivo: ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\`` });
  if (text) parts.push({ type:"text", text });
  return parts;
}

// ─── Main Component ────────────────────────────────────────────────
export default function App() {
  const savedKey = ls.get(KEY_STORE) || "";
  const [apiKey, setApiKey]             = useState(savedKey);
  const [apiKeySet, setApiKeySet]       = useState(!!savedKey);
  const [showKey, setShowKey]           = useState(false);
  const [keyError, setKeyError]         = useState("");
  const [rememberKey, setRememberKey]   = useState(!!savedKey);
  const [chatsIndex, setChatsIndex]     = useState(() => ls.get(CHATS_KEY) || []);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages]         = useState([]);
  const [uiMessages, setUiMessages]     = useState([]);
  const [streamText, setStreamText]     = useState("");
  const [input, setInput]               = useState("");
  const [urlInput, setUrlInput]         = useState("");
  const [showUrlBox, setShowUrlBox]     = useState(false);
  const [attachment, setAttachment]     = useState(null);
  const [fetchingUrl, setFetchingUrl]   = useState(false);
  const [loading, setLoading]           = useState(false);
  const [searching, setSearching]       = useState(false);
  const [error, setError]               = useState("");
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const [webSearch, setWebSearch]       = useState(true);
  const bottomRef  = useRef(null);
  const lastMsgRef = useRef(null); // aponta pro INÍCIO da última resposta
  const fileRef    = useRef(null);
  const urlRef     = useRef(null);

  // Durante loading/streaming: acompanha o fim pra ver o indicador
  useEffect(() => {
    if (loading) bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [streamText, loading]);

  // Quando resposta chega: vai pro INÍCIO da mensagem do agente
  useEffect(() => {
    if (!loading && uiMessages.length > 0) {
      const last = uiMessages[uiMessages.length - 1];
      if (last?.role === "assistant") {
        setTimeout(() => lastMsgRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }), 50);
      } else {
        bottomRef.current?.scrollIntoView({ behavior:"smooth" });
      }
    }
  }, [uiMessages]);
  useEffect(() => { if (showUrlBox) urlRef.current?.focus(); }, [showUrlBox]);

  const handleSetKey = () => {
    if (apiKey.trim().startsWith("sk-ant-")) {
      if (rememberKey) ls.set(KEY_STORE, apiKey.trim()); else ls.del(KEY_STORE);
      setApiKeySet(true); setKeyError("");
    } else setKeyError("Chave inválida. Deve começar com sk-ant-");
  };

  const handleLogout = () => { ls.del(KEY_STORE); setApiKey(""); setApiKeySet(false); setMessages([]); setUiMessages([]); setActiveChatId(null); };
  const startNewChat = () => { setActiveChatId(null); setMessages([]); setUiMessages([]); setError(""); setInput(""); setAttachment(null); setStreamText(""); };
  const openChat     = (id) => { const d = ls.get(chatKey(id)); if (d) { setMessages(d.messages); setUiMessages(d.uiMessages||[]); setActiveChatId(id); setError(""); setAttachment(null); setStreamText(""); } };
  const removeChat   = (e, id) => { e.stopPropagation(); ls.del(chatKey(id)); const ni=chatsIndex.filter(c=>c.id!==id); setChatsIndex(ni); ls.set(CHATS_KEY,ni); if(activeChatId===id) startNewChat(); };

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value="";

    // Detecta ZIP pelo nome também (alguns browsers enviam tipo genérico)
    const isZip = file.name.endsWith(".zip") || file.type.includes("zip");
    if (isZip) {
      if (file.size > 20*1024*1024) { setError("ZIP muito grande. Limite: 20 MB."); return; }
      setError(""); setLoading(true); setStreamText("📦 Extraindo arquivos do ZIP…");
      try {
        const zip     = await JSZip.loadAsync(file);
        const TEXT_EXT = /\.(js|ts|jsx|tsx|py|html|css|json|md|txt|csv|env|yaml|yml|xml|sh|sql|php|rb|rs|go|java|c|cpp|h|cs)$/i;
        const entries = Object.values(zip.files).filter(f => !f.dir && TEXT_EXT.test(f.name) && !f.name.includes("node_modules") && !f.name.includes(".git"));

        if (entries.length === 0) { setError("Nenhum arquivo de texto/código encontrado no ZIP."); setLoading(false); setStreamText(""); return; }

        // Lê até 30 arquivos, máx 300kb total
        let combined = `📦 ZIP: ${file.name}\nArquivos encontrados: ${entries.length}\n\n`;
        let totalSize = 0;
        const MAX_TOTAL = 300000;
        let fileCount = 0;

        for (const entry of entries.slice(0, 30)) {
          try {
            const text = await entry.async("string");
            const preview = text.length > 8000 ? text.slice(0, 8000) + "\n[... truncado]" : text;
            combined += `--- ${entry.name} ---\n\`\`\`\n${preview}\n\`\`\`\n\n`;
            totalSize += preview.length;
            fileCount++;
            if (totalSize > MAX_TOTAL) { combined += "\n[Demais arquivos omitidos por limite de tamanho]"; break; }
          } catch { continue; }
        }

        setAttachment({ kind:"zip", name:file.name, size:file.size, content:combined, fileCount });
      } catch(err) { setError("Erro ao extrair ZIP: "+err.message); }
      finally { setLoading(false); setStreamText(""); }
      return;
    }

    const kind = SUPPORTED[file.type];
    if (!kind) { setError("Tipo não suportado. Use PDF, imagem, código ou ZIP."); return; }
    if (file.size > 4*1024*1024) { setError("Arquivo muito grande. Limite: 4 MB."); return; }
    setError("");
    try {
      if (kind==="text") setAttachment({ kind, name:file.name, size:file.size, content: await toText(file) });
      else               setAttachment({ kind, name:file.name, size:file.size, data: await toBase64(file), mediaType:file.type });
    } catch(err) { setError("Erro: "+err.message); }
  };

  const handleFetchUrl = async () => {
    let url = urlInput.trim(); if (!url) return;
    if (!url.startsWith("http")) url = "https://" + url;
    setFetchingUrl(true); setError("");
    try {
      const { content } = await fetchSiteContent(url);
      setAttachment({ kind:"url", url, content, name: new URL(url).hostname });
      setShowUrlBox(false); setUrlInput("");
    } catch(err) { setError("Erro ao carregar URL: "+err.message); }
    finally { setFetchingUrl(false); }
  };

  const handleSend = async () => {
    if ((!input.trim() && !attachment) || loading) return;

    const userText   = input.trim() || (attachment?.kind==="url" ? `Analise este site: ${attachment.url}` : `Analise este arquivo: ${attachment?.name}`);
    const userApiMsg = { role:"user", content: buildApiContent(userText, attachment) };
    const userUiMsg  = { role:"user", content:userText, attachment: attachment ? { name:attachment.name||attachment.url, kind:attachment.kind, url:attachment.url } : null };
    const newUi  = [...uiMessages, userUiMsg];
    const newApi = [...messages, userApiMsg];

    setUiMessages(newUi); setMessages(newApi);
    setInput(""); setAttachment(null); setLoading(true); setError(""); setSearching(false); setStreamText("");

    let chatId = activeChatId;
    if (!chatId) {
      chatId = genId(); setActiveChatId(chatId);
      const ni = [{ id:chatId, title:shortTitle(userText), updatedAt:Date.now() }, ...chatsIndex];
      setChatsIndex(ni); ls.set(CHATS_KEY, ni);
    }

    try {
      let finalText = "";

      if (webSearch) {
        setSearching(true);
        finalText = await callNormal(apiKey, newApi, true);
        setSearching(false);
      } else {
        finalText = await callStream(
          apiKey, newApi,
          (chunk) => setStreamText(chunk),
          (attempt, secs) => setStreamText(`⏳ Servidores ocupados, tentando novamente em ${secs}s… (tentativa ${attempt}/3)`)
        );
        setStreamText("");
      }

      const finalUi  = [...newUi,  { role:"assistant", content:finalText }];
      const finalApi = [...newApi, { role:"assistant", content:finalText }];
      setUiMessages(finalUi); setMessages(finalApi);
      ls.set(chatKey(chatId), { messages:finalApi, uiMessages:finalUi });

      const updated = [...chatsIndex]
        .map(c => c.id===chatId ? {...c, updatedAt:Date.now()} : c)
        .sort((a,b) => b.updatedAt-a.updatedAt);
      if (!updated.find(c=>c.id===chatId)) updated.unshift({ id:chatId, title:shortTitle(userText), updatedAt:Date.now() });
      setChatsIndex(updated); ls.set(CHATS_KEY, updated);

    } catch(err) {
      setStreamText(""); setSearching(false);
      setError("Erro: "+err.message);
    } finally {
      setLoading(false);
    }
  };

  const onKey    = (e) => { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleSend();} };
  const onUrlKey = (e) => { if(e.key==="Enter") handleFetchUrl(); if(e.key==="Escape") setShowUrlBox(false); };

  // ── API Key Screen ──
  if (!apiKeySet) return (
    <div style={s.root}><style>{css}</style>
      <div style={s.setupWrap}>
        <div style={s.setupCard}>
          <div style={s.logoBox}>CA</div>
          <h2 style={s.setupTitle}>Code Agent</h2>
          <p style={s.setupDesc}>Cole sua API Key da Anthropic.<br/><span style={{color:"#6b6762",fontSize:12}}>Salva apenas no seu navegador.</span></p>
          <div style={s.keyRow}>
            <input type={showKey?"text":"password"} value={apiKey} onChange={e=>setApiKey(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSetKey()} placeholder="sk-ant-api03-..." style={s.keyInput}/>
            <button onClick={()=>setShowKey(!showKey)} style={s.eyeBtn}>{showKey?"🙈":"👁️"}</button>
          </div>
          <label style={s.rememberRow}>
            <input type="checkbox" checked={rememberKey} onChange={e=>setRememberKey(e.target.checked)} style={{accentColor:"#cc785c"}}/>
            <span style={{fontSize:13,color:"#8c8984"}}>Lembrar minha chave neste navegador</span>
          </label>
          {keyError&&<div style={s.errBox}>{keyError}</div>}
          <button onClick={handleSetKey} style={s.confirmBtn}>Entrar →</button>
          <a href="https://console.anthropic.com/api-keys" target="_blank" rel="noopener noreferrer" style={s.link}>Criar API Key ↗</a>
        </div>
      </div>
    </div>
  );

  // ── Main UI ──
  return (
    <div style={s.root}><style>{css}</style>
      <div style={s.layout}>

        {/* Sidebar */}
        <div style={{...s.sidebar, width:sidebarOpen?248:0, minWidth:sidebarOpen?248:0}}>
          {sidebarOpen&&<>
            <div style={s.sidebarHeader}>
              <div style={s.logoSmall}>CA</div>
              <span style={s.sidebarBrand}>Code Agent</span>
            </div>
            <button onClick={startNewChat} style={s.newChatBtn}>+ Novo Chat</button>
            <div style={s.toggleRow}>
              <span style={s.toggleLabel}>🔍 Busca na Web</span>
              <div onClick={()=>setWebSearch(!webSearch)} style={{...s.toggle, background:webSearch?"#cc785c":"#2c2c2a"}}>
                <div style={{...s.toggleKnob, transform:webSearch?"translateX(16px)":"translateX(0)"}}/>
              </div>
            </div>
            <div style={s.featuresBox}>
              {[["📄","Upload PDF"],["🖼️","Upload Imagem"],["📝","Upload Código"],["🗜️","Upload ZIP"],["🔗","Leitor de URL"],["💾","Histórico"],["⚡","Streaming"]].map(([i,l])=>(
                <div key={l} style={s.featRow}><span>{i}</span><span>{l}</span><span style={s.featOk}>✓</span></div>
              ))}
            </div>
            <div style={s.histLabel}>HISTÓRICO</div>
            <div style={s.chatList}>
              {chatsIndex.length===0
                ? <div style={s.emptyHist}>Nenhuma conversa ainda</div>
                : chatsIndex.map(chat=>(
                  <div key={chat.id} onClick={()=>openChat(chat.id)} className="chat-item"
                    style={{...s.chatItem, background:activeChatId===chat.id?"#252320":"transparent", borderLeft:activeChatId===chat.id?"2px solid #cc785c":"2px solid transparent"}}>
                    <div style={s.chatInfo}><div style={s.chatTitle}>{chat.title}</div><div style={s.chatDate}>{fmtDate(chat.updatedAt)}</div></div>
                    <button onClick={e=>removeChat(e,chat.id)} style={s.delBtn} className="del-btn">×</button>
                  </div>
                ))
              }
            </div>
            <button onClick={handleLogout} style={s.logoutBtn}>⎋ Trocar API Key</button>
          </>}
        </div>

        {/* Main */}
        <div style={s.main}>
          <div style={s.header}>
            <button onClick={()=>setSidebarOpen(!sidebarOpen)} style={s.menuBtn}>{sidebarOpen?"◀":"▶"}</button>
            <span style={s.headerTitle}>{activeChatId ? chatsIndex.find(c=>c.id===activeChatId)?.title||"Chat" : "Novo Chat"}</span>
            <div style={s.badges}>
              {webSearch ? <div style={s.badge}>🔍 Web On</div> : <div style={{...s.badge, color:"#6b6762", borderColor:"#2c2c2a"}}>🔍 Web Off</div>}
              <div style={s.statusDot}/>
            </div>
          </div>

          <div style={s.chatArea}>
            {uiMessages.length===0&&!loading&&(
              <div style={s.welcome}>
                <div style={s.wIcon}>⚡</div>
                <h3 style={s.wTitle}>Olá! Sou seu Code Agent.</h3>
                <p style={s.wSub}>Me diga o que precisa — código, dúvida, arquivo ou link.</p>
                <div style={s.featureCards}>
                  {[{icon:"📝",label:"Código",desc:"Crie, edite ou corrija"},{icon:"🔗",label:"URL",desc:"Analisa sites de referência"},{icon:"📄",label:"PDF",desc:"Lê documentos e specs"},{icon:"🖼️",label:"Imagem",desc:"Interpreta prints e erros"}].map(f=>(
                    <div key={f.label} style={s.fCard}><div style={s.fCardIcon}>{f.icon}</div><div style={s.fCardLabel}>{f.label}</div><div style={s.fCardDesc}>{f.desc}</div></div>
                  ))}
                </div>
                <div style={s.exGrid}>
                  {["Me ajuda a criar uma landing page","Crie uma função de validação de CPF","Analise esse site como referência","Meu código está com erro, me ajuda?"].map(ex=>(
                    <button key={ex} style={s.exBtn} onClick={()=>setInput(ex)} className="ex-btn">{ex}</button>
                  ))}
                </div>
              </div>
            )}

            {uiMessages.map((msg,i)=>(
              <div key={i} ref={msg.role==="assistant" && i===uiMessages.length-1 ? lastMsgRef : null} style={{...s.msgRow, flexDirection:msg.role==="user"?"row-reverse":"row"}}>
                {msg.role==="assistant"&&<div style={s.avatar}>CA</div>}
                <div style={msg.role==="user"?s.userBubble:s.agentBubble}>
                  {msg.attachment&&(
                    <div style={s.attachChip}>
                      <span>{fileIcon(msg.attachment.kind)}</span>
                      <span style={s.attachName}>{msg.attachment.kind==="url"?msg.attachment.url:msg.attachment.name}</span>
                    </div>
                  )}
                  <div className="msg-content" dangerouslySetInnerHTML={{__html:msg.role==="assistant"?md(msg.content):msg.content.replace(/</g,"&lt;")}}/>
                </div>
              </div>
            ))}

            {/* Loading / streaming bubble */}
            {loading&&(
              <div style={{...s.msgRow, flexDirection:"row"}}>
                <div style={s.avatar}>CA</div>
                <div style={s.agentBubble}>
                  {searching ? (
                    <div style={s.searchingRow}>
                      <div style={s.searchPulse}/>
                      <span style={s.searchingText}>Pesquisando na web…</span>
                    </div>
                  ) : streamText ? (
                    <div className="msg-content streaming" dangerouslySetInnerHTML={{__html:md(streamText)}}/>
                  ) : (
                    <div style={s.typing}><span className="dot"/><span className="dot"/><span className="dot"/></div>
                  )}
                </div>
              </div>
            )}

            {error&&<div style={{...s.errBox, margin:"0 24px"}}>{error}</div>}
            <div ref={bottomRef}/>
          </div>

          {/* URL box */}
          {showUrlBox&&(
            <div style={s.urlBox}>
              <span>🔗</span>
              <input ref={urlRef} value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={onUrlKey}
                placeholder="https://site-de-referencia.com" style={s.urlInput}/>
              <button onClick={handleFetchUrl} disabled={fetchingUrl||!urlInput.trim()}
                style={{...s.urlBtn, opacity:fetchingUrl||!urlInput.trim()?0.5:1}}>
                {fetchingUrl?"Carregando…":"Carregar"}
              </button>
              <button onClick={()=>{setShowUrlBox(false);setUrlInput("");}} style={s.urlClose}>×</button>
            </div>
          )}

          {/* Attachment preview */}
          {attachment&&(
            <div style={s.attachPreview}>
              <span>{fileIcon(attachment.kind)}</span>
              <span style={s.attachName}>{attachment.kind==="url"?attachment.url:attachment.name}</span>
              {attachment.kind!=="url"&&<span style={{color:"#6b6762",fontSize:12}}>{fmtBytes(attachment.size)}</span>}
              <button onClick={()=>setAttachment(null)} style={s.removeAttach}>×</button>
            </div>
          )}

          {/* Input bar */}
          <div style={s.inputArea}>
            <input ref={fileRef} type="file" style={{display:"none"}}
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.js,.ts,.jsx,.tsx,.py,.html,.css,.json,.md,.csv,.zip"
              onChange={handleFilePick}/>
            <button onClick={()=>fileRef.current?.click()} style={s.toolBtn} title="Anexar arquivo">📎</button>
            <button onClick={()=>setShowUrlBox(!showUrlBox)}
              style={{...s.toolBtn, background:showUrlBox?"#252320":"#1e1e1c", borderColor:showUrlBox?"#cc785c":"#2c2c2a"}}
              title="Link de referência">🔗</button>
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey} rows={3} style={s.textarea}
              placeholder={attachment?.kind==="url" ? `Instrução para "${attachment.name}"…` : "Me diga o que precisa… (Enter envia, Shift+Enter quebra linha)"}/>
            <button onClick={handleSend} disabled={loading||(!input.trim()&&!attachment)}
              style={{...s.sendBtn, opacity:loading||(!input.trim()&&!attachment)?0.4:1}}>
              {loading?"…":"→"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Helvetica,Arial,sans-serif";

const s = {
  root:{display:"flex",flexDirection:"column",height:"100vh",background:"#1c1917",color:"#e8e3dc",fontFamily:FONT,overflow:"hidden",fontSize:15},
  layout:{display:"flex",flex:1,overflow:"hidden"},
  sidebar:{background:"#111110",borderRight:"1px solid #2c2c2a",display:"flex",flexDirection:"column",transition:"width .25s ease,min-width .25s ease",overflow:"hidden",flexShrink:0},
  sidebarHeader:{display:"flex",alignItems:"center",gap:10,padding:"18px 16px 14px",borderBottom:"1px solid #252523"},
  logoSmall:{width:30,height:30,background:"linear-gradient(135deg,#cc785c,#d4a574)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",flexShrink:0},
  sidebarBrand:{fontSize:14,fontWeight:600,color:"#e8e3dc",whiteSpace:"nowrap"},
  newChatBtn:{margin:"12px 12px 6px",background:"#cc785c",border:"none",borderRadius:8,padding:"9px 14px",fontWeight:600,fontSize:13,color:"#fff",cursor:"pointer",fontFamily:FONT},
  toggleRow:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"1px solid #1e1e1c"},
  toggleLabel:{fontSize:12,color:"#8c8984"},
  toggle:{width:36,height:20,borderRadius:10,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0},
  toggleKnob:{position:"absolute",top:3,left:3,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"transform .2s",boxShadow:"0 1px 3px rgba(0,0,0,.4)"},
  featuresBox:{padding:"10px 16px",borderBottom:"1px solid #1e1e1c",display:"flex",flexDirection:"column",gap:6},
  featRow:{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"#6b6762"},
  featOk:{marginLeft:"auto",color:"#cc785c",fontSize:11},
  histLabel:{fontSize:10,color:"#4a4845",letterSpacing:1.5,padding:"12px 16px 4px",textTransform:"uppercase",fontWeight:600},
  chatList:{flex:1,overflowY:"auto",padding:"2px 0"},
  emptyHist:{fontSize:12,color:"#4a4845",textAlign:"center",padding:"28px 16px",lineHeight:1.6},
  chatItem:{display:"flex",alignItems:"center",padding:"9px 10px 9px 14px",cursor:"pointer",gap:6,transition:"background .15s"},
  chatInfo:{flex:1,minWidth:0},
  chatTitle:{fontSize:12,color:"#b8b2ac",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  chatDate:{fontSize:11,color:"#4a4845",marginTop:2},
  delBtn:{background:"transparent",border:"none",color:"#4a4845",cursor:"pointer",fontSize:17,padding:"0 3px",lineHeight:1,flexShrink:0,display:"none"},
  logoutBtn:{margin:"8px 12px 16px",background:"transparent",border:"1px solid #2c2c2a",borderRadius:8,padding:"8px 14px",fontSize:12,color:"#6b6762",cursor:"pointer",fontFamily:FONT,textAlign:"left"},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
  header:{display:"flex",alignItems:"center",gap:10,padding:"13px 20px",borderBottom:"1px solid #2c2c2a",background:"#111110",flexShrink:0},
  menuBtn:{background:"transparent",border:"1px solid #2c2c2a",borderRadius:6,color:"#6b6762",cursor:"pointer",padding:"5px 9px",fontSize:13,fontFamily:FONT},
  headerTitle:{flex:1,fontSize:13,color:"#6b6762",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  badges:{display:"flex",alignItems:"center",gap:6,flexShrink:0},
  badge:{fontSize:11,color:"#cc785c",border:"1px solid #cc785c44",borderRadius:20,padding:"2px 9px",fontWeight:500},
  statusDot:{width:8,height:8,borderRadius:"50%",background:"#4caf78",flexShrink:0,boxShadow:"0 0 6px #4caf7888"},
  chatArea:{flex:1,overflowY:"auto",padding:"28px 0",display:"flex",flexDirection:"column",gap:24},
  welcome:{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",gap:16,padding:"20px 40px"},
  wIcon:{fontSize:48},
  wTitle:{margin:0,fontSize:22,color:"#e8e3dc",fontWeight:600,letterSpacing:-0.3},
  wSub:{margin:0,fontSize:15,color:"#8c8984",lineHeight:1.6},
  featureCards:{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center",maxWidth:520},
  fCard:{background:"#1e1e1c",border:"1px solid #2c2c2a",borderRadius:12,padding:"14px 16px",width:112,textAlign:"center",display:"flex",flexDirection:"column",gap:5},
  fCardIcon:{fontSize:24},fCardLabel:{fontSize:13,color:"#e8e3dc",fontWeight:600},fCardDesc:{fontSize:11,color:"#6b6762",lineHeight:1.5},
  exGrid:{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",maxWidth:580},
  exBtn:{background:"#1e1e1c",border:"1px solid #2c2c2a",borderRadius:20,padding:"8px 16px",color:"#8c8984",fontSize:13,cursor:"pointer",fontFamily:FONT,lineHeight:1.4},
  msgRow:{display:"flex",gap:14,alignItems:"flex-start",padding:"0 24px",maxWidth:860,width:"100%",margin:"0 auto",boxSizing:"border-box"},
  avatar:{width:32,height:32,flexShrink:0,background:"linear-gradient(135deg,#cc785c,#d4a574)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff"},
  userBubble:{background:"#2a2826",border:"1px solid #38352f",borderRadius:"18px 18px 4px 18px",padding:"12px 18px",maxWidth:"78%",fontSize:15,lineHeight:1.65,color:"#e8e3dc",marginLeft:"auto",whiteSpace:"pre-wrap",wordBreak:"break-word"},
  agentBubble:{flex:1,fontSize:15,lineHeight:1.75,color:"#e8e3dc",wordBreak:"break-word",minWidth:0,paddingTop:4},
  attachChip:{display:"inline-flex",alignItems:"center",gap:6,background:"#2a2826",border:"1px solid #38352f",borderRadius:8,padding:"5px 12px",marginBottom:10,fontSize:13,color:"#b8b2ac"},
  attachName:{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#cc785c"},
  searchingRow:{display:"flex",alignItems:"center",gap:10,padding:"6px 0"},
  searchPulse:{width:10,height:10,borderRadius:"50%",background:"#cc785c",animation:"pulse 1s infinite",flexShrink:0},
  searchingText:{fontSize:13,color:"#8c8984",fontStyle:"italic"},
  typing:{display:"flex",gap:5,alignItems:"center",padding:"6px 0"},
  urlBox:{display:"flex",alignItems:"center",gap:8,padding:"12px 20px",background:"#161614",borderTop:"1px solid #2c2c2a",flexShrink:0},
  urlInput:{flex:1,background:"#1e1e1c",border:"1px solid #38352f",borderRadius:8,padding:"9px 14px",color:"#e8e3dc",fontSize:14,fontFamily:FONT,outline:"none"},
  urlBtn:{background:"#cc785c",border:"none",borderRadius:8,padding:"9px 16px",fontWeight:600,fontSize:13,color:"#fff",cursor:"pointer",fontFamily:FONT,flexShrink:0},
  urlClose:{background:"transparent",border:"none",color:"#6b6762",cursor:"pointer",fontSize:22,lineHeight:1,flexShrink:0},
  attachPreview:{display:"flex",alignItems:"center",gap:8,padding:"10px 20px",background:"#161614",borderTop:"1px solid #2c2c2a",fontSize:13,flexShrink:0,color:"#b8b2ac"},
  removeAttach:{background:"transparent",border:"none",color:"#6b6762",cursor:"pointer",fontSize:20,lineHeight:1,marginLeft:"auto"},
  inputArea:{display:"flex",gap:8,padding:"14px 20px",borderTop:"1px solid #2c2c2a",background:"#161614",flexShrink:0,alignItems:"flex-end"},
  toolBtn:{width:42,height:42,flexShrink:0,background:"#1e1e1c",border:"1px solid #2c2c2a",borderRadius:10,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  textarea:{flex:1,background:"#1e1e1c",border:"1px solid #2c2c2a",borderRadius:12,padding:"11px 16px",color:"#e8e3dc",fontSize:15,fontFamily:FONT,resize:"none",outline:"none",lineHeight:1.6},
  sendBtn:{width:42,height:42,flexShrink:0,background:"#cc785c",border:"none",borderRadius:10,fontWeight:800,fontSize:22,color:"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  setupWrap:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  setupCard:{background:"#111110",border:"1px solid #2c2c2a",borderRadius:18,padding:44,maxWidth:440,width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:18,textAlign:"center"},
  logoBox:{width:56,height:56,background:"linear-gradient(135deg,#cc785c,#d4a574)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:18,color:"#fff"},
  setupTitle:{margin:0,fontSize:26,color:"#e8e3dc",fontWeight:600,letterSpacing:-0.5},
  setupDesc:{margin:0,fontSize:14,color:"#6b6762",lineHeight:1.7},
  keyRow:{display:"flex",gap:8,width:"100%"},
  keyInput:{flex:1,background:"#1e1e1c",border:"1px solid #2c2c2a",borderRadius:9,padding:"11px 16px",color:"#e8e3dc",fontSize:14,fontFamily:FONT,outline:"none"},
  eyeBtn:{background:"#1e1e1c",border:"1px solid #2c2c2a",borderRadius:9,cursor:"pointer",fontSize:17,padding:"0 14px",color:"#8c8984"},
  rememberRow:{display:"flex",alignItems:"center",gap:8,cursor:"pointer",alignSelf:"flex-start"},
  confirmBtn:{width:"100%",background:"#cc785c",border:"none",borderRadius:9,padding:13,fontWeight:600,fontSize:15,color:"#fff",cursor:"pointer",fontFamily:FONT},
  errBox:{background:"#2a1414",border:"1px solid #7f3535",borderRadius:9,padding:"11px 16px",fontSize:13,color:"#f08080",lineHeight:1.5},
  link:{fontSize:13,color:"#cc785c",textDecoration:"none"},
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}
body{margin:0;padding:0}
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:#2c2c2a;border-radius:5px}
.chat-item:hover{background:#1a1917!important}
.chat-item:hover .del-btn{display:block!important}
.ex-btn:hover{background:#252523!important;color:#b8b2ac!important}
.msg-content{font-size:15px;line-height:1.75;color:#e8e3dc}
.msg-content h2.h2{font-size:17px;font-weight:600;color:#e8e3dc;margin:20px 0 8px}
.msg-content h3.h3{font-size:15px;font-weight:600;color:#e8e3dc;margin:16px 0 6px}
.msg-content strong{font-weight:600;color:#e8e3dc}
.msg-content em{font-style:italic;color:#b8b2ac}
.msg-content .ic{background:#2a2826;border:1px solid #38352f;border-radius:5px;padding:2px 7px;font-family:'JetBrains Mono','Fira Code',Consolas,monospace;font-size:13px;color:#cc785c;white-space:nowrap}
.msg-content .cb{background:#111110;border:1px solid #2c2c2a;border-radius:10px;margin:14px 0;overflow:hidden}
.msg-content .cl{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;font-size:11px;color:#6b6762;border-bottom:1px solid #2c2c2a;text-transform:uppercase;letter-spacing:1px;font-weight:600;background:#161614}
.msg-content .cb code{display:block;padding:16px 20px;font-family:'JetBrains Mono','Fira Code',Consolas,monospace;font-size:13.5px;color:#d4c5b0;line-height:1.7;white-space:pre;overflow-x:auto}
.copy-btn{background:#2a2826;border:1px solid #38352f;border-radius:6px;padding:3px 10px;font-size:11px;color:#8c8984;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;transition:all .15s;font-weight:500}
.copy-btn:hover{background:#38352f;color:#e8e3dc}
.streaming::after{content:'▋';animation:blink-cursor .7s infinite;color:#cc785c}
@keyframes blink-cursor{0%,100%{opacity:1}50%{opacity:0}}
@keyframes blink{0%,80%,100%{opacity:.15;transform:scale(.75)}40%{opacity:1;transform:scale(1)}}
.dot{width:8px;height:8px;background:#cc785c;border-radius:50%;display:inline-block;animation:blink 1.3s infinite}
.dot:nth-child(2){animation-delay:.22s;background:#d4a574}
.dot:nth-child(3){animation-delay:.44s;background:#cc785c}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
`;
