import { useState, useRef, useEffect } from "react";

const SYSTEM_PROMPT = `Você é um parceiro de desenvolvimento e braço direito do usuário. Sua personalidade é próxima, direta e inteligente — como um amigo desenvolvedor sênior que está sempre disponível para ajudar.

## 🧠 QUEM VOCÊ É

Você é um assistente completo, não apenas um gerador de código. Você conversa, explica, sugere, questiona, opina e desenvolve junto com o usuário. Pense em si mesmo como o sócio técnico ideal: experiente, acessível e sempre disposto a ajudar — seja numa tarefa simples ou num projeto complexo.

Você tem acesso a:
- 🔍 Busca na web — para informações atualizadas, documentações e erros conhecidos
- 📎 Leitura de arquivos — PDF, imagens, código-fonte
- 🔗 Leitura de sites por URL — para analisar referências visuais e técnicas

## 💬 COMO VOCÊ SE COMUNICA

- Seja natural e conversacional — não robótico ou formal demais
- Responda perguntas simples de forma simples. Não force estrutura onde não é necessária
- Use estrutura (títulos, blocos de código, listas) apenas quando o conteúdo pedir
- Se o usuário mandar uma mensagem curta, responda de forma proporcional
- Opine quando perguntado. Você tem experiência e pode recomendar caminhos
- Pergunte quando estiver em dúvida sobre o que o usuário quer — mas não faça perguntas demais
- Pode usar humor leve quando apropriado

## 💻 QUANDO GERAR CÓDIGO

- Gere código limpo, comentado e seguindo boas práticas (SOLID, DRY, KISS)
- Prefira soluções simples antes de soluções complexas
- Sempre inclua tratamento de erros
- Nunca exponha credenciais hardcoded — use variáveis de ambiente
- Nunca gere código com vulnerabilidades conhecidas (SQL Injection, XSS, etc.)
- Informe sempre a linguagem/framework do código gerado
- Se o usuário não informar a linguagem, pergunte antes de gerar

## 🔗 QUANDO ANALISAR UM SITE (URL)

- Leia o HTML/CSS com atenção
- Identifique: paleta de cores, tipografia, layout, componentes, estilo visual geral
- Use como referência para criar ou adaptar o projeto do usuário
- Aponte melhorias ou adaptações relevantes

## 📄 QUANDO ANALISAR ARQUIVOS

- Leia o conteúdo com atenção antes de responder
- Identifique linguagem, padrões e estrutura
- Sugira melhorias ou corrija problemas encontrados

## 🔧 QUANDO RESOLVER PROBLEMAS

- Identifique a causa raiz, não apenas o sintoma
- Explique o problema em linguagem simples
- Apresente a solução de forma clara
- Se houver mais de uma solução, mostre as opções com prós e contras

## 🔐 LIMITES INEGOCIÁVEIS

- NUNCA gere código malicioso, destrutivo ou antiético
- NUNCA produza conteúdo prejudicial, mesmo se solicitado
- SEMPRE proteja a segurança e privacidade do usuário

## 🌍 IDIOMA

Responda sempre em Português do Brasil, com linguagem natural e acessível.
Adapte o nível técnico conforme o contexto — mais simples quando o usuário está aprendendo, mais técnico quando ele demonstra experiência.`;

// ─── Storage ───────────────────────────────────────────────────────
const CHATS_KEY  = "codeagent:chats-index";
const chatKey    = (id) => `codeagent:chat:${id}`;
const KEY_STORE  = "codeagent:apikey";

const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

// ─── Utils ─────────────────────────────────────────────────────────
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const shortTitle = (t) => t.length > 38 ? t.slice(0, 38) + "…" : t;
const fmtDate = (ts) => new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

// ─── File helpers ──────────────────────────────────────────────────
const SUPPORTED = {
  "application/pdf": "pdf",
  "image/png": "image", "image/jpeg": "image", "image/gif": "image", "image/webp": "image",
  "text/plain": "text", "text/javascript": "text", "text/html": "text",
  "text/css": "text", "text/x-python": "text", "application/json": "text", "application/javascript": "text",
};
const toBase64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
const toText   = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
const fileIcon = (k) => k === "pdf" ? "📄" : k === "image" ? "🖼️" : k === "url" ? "🔗" : "📝";
const fmtBytes = (b) => b < 1024 ? b + " B" : b < 1048576 ? (b/1024).toFixed(1) + " KB" : (b/1048576).toFixed(1) + " MB";

// ─── URL Fetcher via CORS proxy ────────────────────────────────────
async function fetchSiteContent(url) {
  // Try allorigins first, fallback to corsproxy
  const proxies = [
    `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];

  for (const proxyUrl of proxies) {
    try {
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;

      let html = "";
      if (proxyUrl.includes("allorigins")) {
        const json = await res.json();
        html = json.contents || "";
      } else {
        html = await res.text();
      }

      if (!html) continue;

      // Extract useful parts: strip scripts, keep structure + styles
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\s{3,}/g, " ")
        .trim();

      // Limit to 12000 chars to avoid token overflow
      const truncated = cleaned.length > 12000
        ? cleaned.slice(0, 12000) + "\n\n[... conteúdo truncado para caber no contexto ...]"
        : cleaned;

      return { ok: true, content: truncated, url };
    } catch { continue; }
  }
  throw new Error("Não foi possível acessar o site. Verifique se a URL está correta e o site é público.");
}

// ─── Markdown parser ───────────────────────────────────────────────
function md(text) {
  return text
    .replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="cb"><div class="cl">${lang||"code"}</div><code>${code.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code class="ic">$1</code>')
    .replace(/^### (.+)$/gm, '<h3 class="h3">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 class="h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

// ─── Agentic loop ──────────────────────────────────────────────────
async function runAgent(apiKey, messages, useWebSearch) {
  let cur = [...messages];
  for (let i = 0; i < 6; i++) {
    const body = { model: "claude-sonnet-4-20250514", max_tokens: 4096, system: SYSTEM_PROMPT, messages: cur };
    if (useWebSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

    const res  = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    if (data.stop_reason === "end_turn")
      return { text: data.content.filter(b=>b.type==="text").map(b=>b.text).join("\n"), searched: i > 0 };

    if (data.stop_reason === "tool_use") {
      cur.push({ role: "assistant", content: data.content });
      cur.push({ role: "user", content: data.content.filter(b=>b.type==="tool_use").map(b=>({ type:"tool_result", tool_use_id:b.id, content:[] })) });
      continue;
    }
    return { text: data.content?.filter(b=>b.type==="text").map(b=>b.text).join("\n")||"", searched: false };
  }
  throw new Error("Limite de iterações atingido.");
}

function buildApiContent(text, attachment) {
  if (!attachment) return text;
  const parts = [];
  if (attachment.kind === "image")
    parts.push({ type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.data } });
  else if (attachment.kind === "pdf")
    parts.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.data } });
  else if (attachment.kind === "url")
    parts.push({ type: "text", text: `🔗 SITE ANALISADO: ${attachment.url}\n\nCONTEÚDO HTML/CSS DO SITE:\n\`\`\`html\n${attachment.content}\n\`\`\`` });
  else
    parts.push({ type: "text", text: `📎 Arquivo: ${attachment.name}\n\`\`\`\n${attachment.content}\n\`\`\`` });
  if (text) parts.push({ type: "text", text });
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
  const bottomRef = useRef(null);
  const fileRef   = useRef(null);
  const urlRef    = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [uiMessages, loading]);
  useEffect(() => { if (showUrlBox) urlRef.current?.focus(); }, [showUrlBox]);

  const handleSetKey = () => {
    if (apiKey.trim().startsWith("sk-ant-")) {
      if (rememberKey) ls.set(KEY_STORE, apiKey.trim()); else ls.del(KEY_STORE);
      setApiKeySet(true); setKeyError("");
    } else setKeyError("Chave inválida. Deve começar com sk-ant-");
  };

  const handleLogout = () => { ls.del(KEY_STORE); setApiKey(""); setApiKeySet(false); setMessages([]); setUiMessages([]); setActiveChatId(null); };
  const startNewChat = () => { setActiveChatId(null); setMessages([]); setUiMessages([]); setError(""); setInput(""); setAttachment(null); setUrlInput(""); setShowUrlBox(false); };

  const openChat = (id) => {
    const data = ls.get(chatKey(id));
    if (data) { setMessages(data.messages); setUiMessages(data.uiMessages||[]); setActiveChatId(id); setError(""); setAttachment(null); }
  };

  const removeChat = (e, id) => {
    e.stopPropagation(); ls.del(chatKey(id));
    const ni = chatsIndex.filter(c=>c.id!==id); setChatsIndex(ni); ls.set(CHATS_KEY, ni);
    if (activeChatId===id) startNewChat();
  };

  // ── File pick ──
  const handleFilePick = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value="";
    const kind = SUPPORTED[file.type];
    if (!kind) { setError("Tipo não suportado. Use PDF, imagem ou arquivo de texto/código."); return; }
    if (file.size > 4*1024*1024) { setError("Arquivo muito grande. Limite: 4 MB."); return; }
    setError("");
    try {
      if (kind==="text") { const content = await toText(file); setAttachment({ kind, name:file.name, size:file.size, content }); }
      else               { const data    = await toBase64(file); setAttachment({ kind, name:file.name, size:file.size, data, mediaType:file.type }); }
    } catch(err) { setError("Erro ao ler arquivo: "+err.message); }
  };

  // ── URL fetch ──
  const handleFetchUrl = async () => {
    let url = urlInput.trim();
    if (!url) return;
    if (!url.startsWith("http")) url = "https://" + url;
    setFetchingUrl(true); setError("");
    try {
      const { content } = await fetchSiteContent(url);
      setAttachment({ kind:"url", url, content, name: new URL(url).hostname });
      setShowUrlBox(false); setUrlInput("");
    } catch(err) { setError("Erro ao carregar URL: " + err.message); }
    finally { setFetchingUrl(false); }
  };

  // ── Send ──
  const handleSend = async () => {
    if ((!input.trim() && !attachment) || loading) return;
    const userText   = input.trim() || (attachment?.kind==="url" ? `Analise este site como referência: ${attachment.url}` : `Analise este arquivo: ${attachment?.name}`);
    const userApiMsg = { role:"user", content: buildApiContent(userText, attachment) };
    const userUiMsg  = { role:"user", content:userText, attachment: attachment ? { name:attachment.name||attachment.url, kind:attachment.kind, url:attachment.url } : null };
    const newUi  = [...uiMessages, userUiMsg];
    const newApi = [...messages, userApiMsg];
    setUiMessages(newUi); setMessages(newApi);
    setInput(""); setAttachment(null); setLoading(true); setError(""); setSearching(false);

    let chatId = activeChatId;
    if (!chatId) {
      chatId = genId(); setActiveChatId(chatId);
      const ni = [{ id:chatId, title:shortTitle(userText), updatedAt:Date.now() }, ...chatsIndex];
      setChatsIndex(ni); ls.set(CHATS_KEY, ni);
    }

    try {
      let t; if (webSearch) t = setTimeout(()=>setSearching(true), 800);
      const { text, searched } = await runAgent(apiKey, newApi, webSearch);
      clearTimeout(t); setSearching(false);
      const finalUi  = [...newUi,  { role:"assistant", content:text, searched }];
      const finalApi = [...newApi, { role:"assistant", content:text }];
      setUiMessages(finalUi); setMessages(finalApi);
      ls.set(chatKey(chatId), { messages:finalApi, uiMessages:finalUi });
      const updated = [...chatsIndex].map(c=>c.id===chatId?{...c,updatedAt:Date.now()}:c).sort((a,b)=>b.updatedAt-a.updatedAt);
      if (!updated.find(c=>c.id===chatId)) updated.unshift({ id:chatId, title:shortTitle(userText), updatedAt:Date.now() });
      setChatsIndex(updated); ls.set(CHATS_KEY, updated);
    } catch(err) { setSearching(false); setError("Erro: "+err.message); }
    finally { setLoading(false); }
  };

  const onKey = (e) => { if (e.key==="Enter"&&!e.shiftKey) { e.preventDefault(); handleSend(); } };
  const onUrlKey = (e) => { if (e.key==="Enter") handleFetchUrl(); if (e.key==="Escape") setShowUrlBox(false); };

  // ── Key screen ──
  if (!apiKeySet) return (
    <div style={s.root}><style>{css}</style>
      <div style={s.setupWrap}>
        <div style={s.setupCard}>
          <div style={s.logoBox}>{"</>"}</div>
          <h2 style={s.setupTitle}>Code Agent</h2>
          <p style={s.setupDesc}>Cole sua API Key da Anthropic.<br/><span style={{color:"#555",fontSize:11}}>Salva apenas no seu navegador.</span></p>
          <div style={s.keyRow}>
            <input type={showKey?"text":"password"} value={apiKey} onChange={e=>setApiKey(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleSetKey()} placeholder="sk-ant-api03-..." style={s.keyInput}/>
            <button onClick={()=>setShowKey(!showKey)} style={s.eyeBtn}>{showKey?"🙈":"👁️"}</button>
          </div>
          <label style={s.rememberRow}>
            <input type="checkbox" checked={rememberKey} onChange={e=>setRememberKey(e.target.checked)} style={{accentColor:"#00ff87"}}/>
            <span style={{fontSize:12,color:"#666"}}>Lembrar minha chave neste navegador</span>
          </label>
          {keyError&&<div style={s.errBox}>{keyError}</div>}
          <button onClick={handleSetKey} style={s.confirmBtn}>Entrar →</button>
          <a href="https://console.anthropic.com/api-keys" target="_blank" rel="noopener noreferrer" style={s.link}>Criar API Key ↗</a>
        </div>
      </div>
    </div>
  );

  // ── Main ──
  return (
    <div style={s.root}><style>{css}</style>
      <div style={s.layout}>

        {/* Sidebar */}
        <div style={{...s.sidebar, width:sidebarOpen?242:0, minWidth:sidebarOpen?242:0}}>
          {sidebarOpen&&<>
            <div style={s.sidebarHeader}><div style={s.logoSmall}>{"</>"}</div><span style={s.sidebarBrand}>Code Agent</span></div>
            <button onClick={startNewChat} style={s.newChatBtn}>+ Novo Chat</button>
            <div style={s.toggleRow}>
              <span style={s.toggleLabel}>🔍 Busca na Web</span>
              <div onClick={()=>setWebSearch(!webSearch)} style={{...s.toggle, background:webSearch?"#00ff87":"#222"}}>
                <div style={{...s.toggleKnob, transform:webSearch?"translateX(16px)":"translateX(0)"}}/>
              </div>
            </div>
            <div style={s.featuresBox}>
              {[["📄","Upload PDF"],["🖼️","Upload Imagem"],["📝","Upload Código"],["🔗","Leitor de URL"],["💾","Histórico local"]].map(([i,l])=>(
                <div key={l} style={s.featRow}><span>{i}</span><span>{l}</span><span style={s.featOk}>✓</span></div>
              ))}
            </div>
            <div style={s.histLabel}>HISTÓRICO</div>
            <div style={s.chatList}>
              {chatsIndex.length===0
                ? <div style={s.emptyHist}>Nenhuma conversa ainda</div>
                : chatsIndex.map(chat=>(
                  <div key={chat.id} onClick={()=>openChat(chat.id)} className="chat-item"
                    style={{...s.chatItem, background:activeChatId===chat.id?"#1a2a1a":"transparent", borderLeft:activeChatId===chat.id?"2px solid #00ff87":"2px solid transparent"}}>
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
              {webSearch&&<div style={s.badge}>🔍 Web</div>}
              <div style={s.badge}>📎 Files</div>
              <div style={s.badge}>🔗 URL</div>
              <div style={s.statusDot}/>
            </div>
          </div>

          <div style={s.chatArea}>
            {uiMessages.length===0&&(
              <div style={s.welcome}>
                <div style={s.wIcon}>⚡</div>
                <h3 style={s.wTitle}>Pronto para codar!</h3>
                <p style={s.wSub}>Descreva, envie arquivo ou cole um link de referência.</p>
                <div style={s.featureCards}>
                  {[{icon:"📝",label:"Código",desc:"Crie, edite ou corrija qualquer código"},{icon:"🔗",label:"URL",desc:"Analisa sites como referência visual"},{icon:"📄",label:"PDF",desc:"Lê documentos e extrai código"},{icon:"🖼️",label:"Imagem",desc:"Interpreta prints e diagramas"}].map(f=>(
                    <div key={f.label} style={s.fCard}><div style={s.fCardIcon}>{f.icon}</div><div style={s.fCardLabel}>{f.label}</div><div style={s.fCardDesc}>{f.desc}</div></div>
                  ))}
                </div>
                <div style={s.exGrid}>
                  {["Analise esse site e recrie no meu estilo","Crie uma landing page baseada nessa referência","Quero um menu igual ao desse site","Copie o layout desse site e adapte minhas cores"].map(ex=>(
                    <button key={ex} style={s.exBtn} onClick={()=>setInput(ex)} className="ex-btn">{ex}</button>
                  ))}
                </div>
              </div>
            )}

            {uiMessages.map((msg,i)=>(
              <div key={i} style={{...s.msgRow, justifyContent:msg.role==="user"?"flex-end":"flex-start"}}>
                {msg.role==="assistant"&&<div style={s.avatar}>{"</>"}</div>}
                <div style={msg.role==="user"?s.userBubble:s.agentBubble}>
                  {msg.attachment&&(
                    <div style={s.attachChip}>
                      <span>{fileIcon(msg.attachment.kind)}</span>
                      <span style={s.attachName}>{msg.attachment.kind==="url" ? msg.attachment.url : msg.attachment.name}</span>
                    </div>
                  )}
                  {msg.searched&&<div style={s.searchedTag}>🔍 Pesquisado na web</div>}
                  <div className="msg-content" dangerouslySetInnerHTML={{__html:msg.role==="assistant"?md(msg.content):msg.content.replace(/</g,"&lt;")}}/>
                </div>
              </div>
            ))}

            {loading&&(
              <div style={{...s.msgRow,justifyContent:"flex-start"}}>
                <div style={s.avatar}>{"</>"}</div>
                <div style={s.agentBubble}>
                  {searching
                    ? <div style={s.searchingRow}><div style={s.searchPulse}/><span style={s.searchingText}>Pesquisando na web…</span></div>
                    : <div style={s.typing}><span className="dot"/><span className="dot"/><span className="dot"/></div>}
                </div>
              </div>
            )}
            {error&&<div style={{...s.errBox,margin:"0 0 8px"}}>{error}</div>}
            <div ref={bottomRef}/>
          </div>

          {/* URL box */}
          {showUrlBox&&(
            <div style={s.urlBox}>
              <span style={s.urlIcon}>🔗</span>
              <input ref={urlRef} value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={onUrlKey}
                placeholder="https://site-referencia.com" style={s.urlInput}/>
              <button onClick={handleFetchUrl} disabled={fetchingUrl||!urlInput.trim()} style={{...s.urlBtn, opacity:fetchingUrl||!urlInput.trim()?0.5:1}}>
                {fetchingUrl?"…":"Carregar"}
              </button>
              <button onClick={()=>{setShowUrlBox(false);setUrlInput("");}} style={s.urlClose}>×</button>
            </div>
          )}

          {/* Attachment preview */}
          {attachment&&(
            <div style={s.attachPreview}>
              <span>{fileIcon(attachment.kind)}</span>
              <span style={s.attachName}>{attachment.kind==="url" ? attachment.url : attachment.name}</span>
              {attachment.kind!=="url"&&<span style={s.attachSz}>{fmtBytes(attachment.size)}</span>}
              <button onClick={()=>setAttachment(null)} style={s.removeAttach}>×</button>
            </div>
          )}

          {/* Input bar */}
          <div style={s.inputArea}>
            <input ref={fileRef} type="file" style={{display:"none"}}
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.js,.ts,.jsx,.tsx,.py,.html,.css,.json,.md,.csv"
              onChange={handleFilePick}/>
            <button onClick={()=>fileRef.current?.click()} style={s.toolBtn} title="Anexar arquivo">📎</button>
            <button onClick={()=>setShowUrlBox(!showUrlBox)} style={{...s.toolBtn, background:showUrlBox?"#1a2a1a":"#1a1a1a", borderColor:showUrlBox?"#00ff8744":"#252525"}} title="Colar link de referência">🔗</button>
            <textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={onKey} rows={3} style={s.textarea}
              placeholder={attachment?.kind==="url" ? `Instrução sobre "${attachment.name}"… (ex: recrie esse layout)` : "Descreva, cole código, anexe arquivo ou cole um link…"}/>
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
const s = {
  root:{display:"flex",flexDirection:"column",height:"100vh",background:"#0a0a0a",color:"#e0e0e0",fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace",overflow:"hidden"},
  layout:{display:"flex",flex:1,overflow:"hidden"},
  sidebar:{background:"#0f0f0f",borderRight:"1px solid #1a1a1a",display:"flex",flexDirection:"column",transition:"width .25s ease,min-width .25s ease",overflow:"hidden",flexShrink:0},
  sidebarHeader:{display:"flex",alignItems:"center",gap:10,padding:"16px 14px 12px",borderBottom:"1px solid #1a1a1a"},
  logoSmall:{width:28,height:28,background:"linear-gradient(135deg,#00ff87,#00bfff)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#000",flexShrink:0},
  sidebarBrand:{fontSize:13,fontWeight:700,color:"#fff",whiteSpace:"nowrap"},
  newChatBtn:{margin:"10px 10px 4px",background:"linear-gradient(135deg,#00ff87,#00bfff)",border:"none",borderRadius:8,padding:"8px 12px",fontWeight:700,fontSize:12,color:"#000",cursor:"pointer",fontFamily:"inherit"},
  toggleRow:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:"1px solid #141414"},
  toggleLabel:{fontSize:11,color:"#888"},
  toggle:{width:34,height:18,borderRadius:9,cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0},
  toggleKnob:{position:"absolute",top:2,left:2,width:14,height:14,borderRadius:"50%",background:"#000",transition:"transform .2s"},
  featuresBox:{padding:"10px 14px",borderBottom:"1px solid #141414",display:"flex",flexDirection:"column",gap:5},
  featRow:{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#555"},
  featOk:{marginLeft:"auto",color:"#00ff87",fontSize:10},
  histLabel:{fontSize:9,color:"#333",letterSpacing:2,padding:"10px 14px 4px",textTransform:"uppercase"},
  chatList:{flex:1,overflowY:"auto",padding:"2px 0"},
  emptyHist:{fontSize:11,color:"#333",textAlign:"center",padding:"24px 14px"},
  chatItem:{display:"flex",alignItems:"center",padding:"8px 8px 8px 12px",cursor:"pointer",gap:6,transition:"background .15s"},
  chatInfo:{flex:1,minWidth:0},
  chatTitle:{fontSize:11,color:"#bbb",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  chatDate:{fontSize:10,color:"#444",marginTop:2},
  delBtn:{background:"transparent",border:"none",color:"#333",cursor:"pointer",fontSize:16,padding:"0 2px",lineHeight:1,flexShrink:0,display:"none"},
  logoutBtn:{margin:"8px 10px 14px",background:"transparent",border:"1px solid #1e1e1e",borderRadius:8,padding:"7px 12px",fontSize:11,color:"#555",cursor:"pointer",fontFamily:"inherit",textAlign:"left"},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
  header:{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:"1px solid #1a1a1a",background:"#0f0f0f",flexShrink:0},
  menuBtn:{background:"#1a1a1a",border:"1px solid #252525",borderRadius:6,color:"#555",cursor:"pointer",padding:"4px 8px",fontSize:12,fontFamily:"inherit"},
  headerTitle:{flex:1,fontSize:11,color:"#555",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"},
  badges:{display:"flex",alignItems:"center",gap:6,flexShrink:0},
  badge:{fontSize:10,color:"#00ff87",border:"1px solid #00ff8733",borderRadius:20,padding:"2px 8px"},
  statusDot:{width:8,height:8,borderRadius:"50%",background:"#00ff87",flexShrink:0},
  chatArea:{flex:1,overflowY:"auto",padding:20,display:"flex",flexDirection:"column",gap:16},
  welcome:{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",gap:14,padding:20},
  wIcon:{fontSize:44},wTitle:{margin:0,fontSize:20,color:"#fff",fontWeight:700},wSub:{margin:0,fontSize:13,color:"#555"},
  featureCards:{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center",maxWidth:500},
  fCard:{background:"#111",border:"1px solid #1a1a1a",borderRadius:10,padding:"12px 14px",width:108,textAlign:"center",display:"flex",flexDirection:"column",gap:4},
  fCardIcon:{fontSize:22},fCardLabel:{fontSize:12,color:"#fff",fontWeight:700},fCardDesc:{fontSize:10,color:"#555",lineHeight:1.4},
  exGrid:{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",maxWidth:560},
  exBtn:{background:"#111",border:"1px solid #1e1e1e",borderRadius:20,padding:"7px 14px",color:"#666",fontSize:11,cursor:"pointer",fontFamily:"inherit"},
  msgRow:{display:"flex",gap:10,alignItems:"flex-start"},
  avatar:{width:30,height:30,flexShrink:0,background:"linear-gradient(135deg,#00ff87,#00bfff)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:900,color:"#000"},
  userBubble:{background:"#162016",border:"1px solid #1e2e1e",borderRadius:"12px 12px 2px 12px",padding:"10px 14px",maxWidth:"75%",fontSize:13,lineHeight:1.6,color:"#b8e8b8",whiteSpace:"pre-wrap"},
  agentBubble:{background:"#111",border:"1px solid #1c1c1c",borderRadius:"2px 12px 12px 12px",padding:"12px 16px",maxWidth:"85%",fontSize:13,lineHeight:1.7,color:"#ddd"},
  attachChip:{display:"flex",alignItems:"center",gap:6,background:"#0a1a0a",border:"1px solid #1a2a1a",borderRadius:8,padding:"5px 10px",marginBottom:8,fontSize:11},
  attachName:{color:"#a8e6cf",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
  attachSz:{color:"#446644",flexShrink:0,fontSize:10},
  searchedTag:{fontSize:10,color:"#00ff87aa",marginBottom:8},
  searchingRow:{display:"flex",alignItems:"center",gap:10,padding:"4px 0"},
  searchPulse:{width:10,height:10,borderRadius:"50%",background:"#00ff87",animation:"pulse 1s infinite"},
  searchingText:{fontSize:12,color:"#00ff87aa"},
  typing:{display:"flex",gap:6,alignItems:"center",padding:"4px 0"},
  urlBox:{display:"flex",alignItems:"center",gap:8,padding:"10px 16px",background:"#0a1a0a",borderTop:"1px solid #1a2a1a",flexShrink:0},
  urlIcon:{fontSize:16,flexShrink:0},
  urlInput:{flex:1,background:"#0a0a0a",border:"1px solid #1e2e1e",borderRadius:8,padding:"8px 12px",color:"#e0e0e0",fontSize:12,fontFamily:"inherit",outline:"none"},
  urlBtn:{background:"linear-gradient(135deg,#00ff87,#00bfff)",border:"none",borderRadius:8,padding:"8px 14px",fontWeight:700,fontSize:12,color:"#000",cursor:"pointer",fontFamily:"inherit",flexShrink:0},
  urlClose:{background:"transparent",border:"none",color:"#446644",cursor:"pointer",fontSize:20,lineHeight:1,flexShrink:0},
  attachPreview:{display:"flex",alignItems:"center",gap:8,padding:"8px 16px",background:"#0f1a0f",borderTop:"1px solid #1a2a1a",fontSize:12,flexShrink:0},
  removeAttach:{background:"transparent",border:"none",color:"#446644",cursor:"pointer",fontSize:18,lineHeight:1,marginLeft:"auto",padding:"0 4px"},
  inputArea:{display:"flex",gap:8,padding:"12px 16px",borderTop:"1px solid #1a1a1a",background:"#0f0f0f",flexShrink:0,alignItems:"flex-end"},
  toolBtn:{width:40,height:40,flexShrink:0,background:"#1a1a1a",border:"1px solid #252525",borderRadius:10,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"},
  textarea:{flex:1,background:"#0a0a0a",border:"1px solid #1e1e1e",borderRadius:10,padding:"10px 14px",color:"#e0e0e0",fontSize:13,fontFamily:"inherit",resize:"none",outline:"none",lineHeight:1.6},
  sendBtn:{width:44,height:44,flexShrink:0,background:"linear-gradient(135deg,#00ff87,#00bfff)",border:"none",borderRadius:10,fontWeight:900,fontSize:20,color:"#000",cursor:"pointer"},
  setupWrap:{flex:1,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  setupCard:{background:"#111",border:"1px solid #1e1e1e",borderRadius:16,padding:40,maxWidth:440,width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:16,textAlign:"center"},
  logoBox:{width:52,height:52,background:"linear-gradient(135deg,#00ff87,#00bfff)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:18,color:"#000"},
  setupTitle:{margin:0,fontSize:24,color:"#fff",fontWeight:700},
  setupDesc:{margin:0,fontSize:13,color:"#666",lineHeight:1.7},
  keyRow:{display:"flex",gap:8,width:"100%"},
  keyInput:{flex:1,background:"#0a0a0a",border:"1px solid #252525",borderRadius:8,padding:"10px 14px",color:"#e0e0e0",fontSize:13,fontFamily:"inherit",outline:"none"},
  eyeBtn:{background:"#1a1a1a",border:"1px solid #252525",borderRadius:8,cursor:"pointer",fontSize:16,padding:"0 12px"},
  rememberRow:{display:"flex",alignItems:"center",gap:8,cursor:"pointer",alignSelf:"flex-start"},
  confirmBtn:{width:"100%",background:"linear-gradient(135deg,#00ff87,#00bfff)",border:"none",borderRadius:8,padding:12,fontWeight:700,fontSize:14,color:"#000",cursor:"pointer",fontFamily:"inherit"},
  errBox:{background:"#1a0000",border:"1px solid #ff4444",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#ff8888",width:"100%"},
  link:{fontSize:12,color:"#00bfff",textDecoration:"none"},
};

const css=`
*{box-sizing:border-box}body{margin:0;padding:0}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0a0a0a}::-webkit-scrollbar-thumb{background:#1e1e1e;border-radius:4px}
.chat-item:hover{background:#141414!important}.chat-item:hover .del-btn{display:block!important}
.ex-btn:hover{background:#161616!important;color:#aaa!important;border-color:#2a2a2a!important}
.msg-content h2.h2{font-size:13px;color:#00ff87;margin:12px 0 6px}
.msg-content h3.h3{font-size:12px;color:#00bfff;margin:10px 0 4px}
.msg-content strong{color:#fff}
.msg-content .ic{background:#161616;border:1px solid #252525;border-radius:4px;padding:1px 6px;font-family:'JetBrains Mono',monospace;font-size:11px;color:#00ff87}
.msg-content .cb{background:#080808;border:1px solid #1e1e1e;border-radius:8px;margin:10px 0;overflow:auto}
.msg-content .cl{padding:4px 12px;font-size:10px;color:#444;border-bottom:1px solid #161616;text-transform:uppercase;letter-spacing:1px}
.msg-content .cb code{display:block;padding:12px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#a8e6cf;line-height:1.7;white-space:pre}
@keyframes blink{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
.dot{width:7px;height:7px;background:#00ff87;border-radius:50%;display:inline-block;animation:blink 1.2s infinite}
.dot:nth-child(2){animation-delay:.2s;background:#00d4ff}.dot:nth-child(3){animation-delay:.4s;background:#00ff87}
@keyframes pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
`;
