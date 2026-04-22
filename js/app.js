

const AppState = {
  mode: "pdf",
  persona: "medium",
  unlocked: false,
  file: null,
  reportData: ""
};

const Elements = {};
const getElement = (id) => document.getElementById(id);

const escapeHtml = (text) => String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const formatText = (text) => escapeHtml(text).replace(/\n/g, "<br>");

const showToast = (message) => {
  Elements.toast.textContent = message;
  Elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => Elements.toast.classList.remove("show"), 2600);
};

const syncBodyScroll = () => {
  document.body.classList.toggle("modal-open", Elements.settingsModal.classList.contains("open"));
};

const openSettings = () => {
  Elements.settingsModal.classList.add("open");
  Elements.settingsModal.setAttribute("aria-hidden", "false");
  setTimeout(() => Elements.apiKey.focus(), 30);
  syncBodyScroll();
};

const closeSettings = () => {
  Elements.settingsModal.classList.remove("open");
  Elements.settingsModal.setAttribute("aria-hidden", "true");
  syncBodyScroll();
};

const setInputMode = (mode) => {
  AppState.mode = mode;
  const isPdf = mode === "pdf";
  Elements.modePdf.classList.toggle("active", isPdf);
  Elements.modeText.classList.toggle("active", !isPdf);
  Elements.pdfPanel.classList.toggle("hidden", !isPdf);
  Elements.textPanel.classList.toggle("hidden", isPdf);
};

const setView = (viewName) => {
  Elements.guideView.style.display = viewName === "guide" ? "block" : "none";
  Elements.loader.classList.toggle("show", viewName === "loader");
  Elements.report.classList.toggle("show", viewName === "report");
};

const unlockPersona = () => {
  AppState.unlocked = true;
  localStorage.setItem(APP_CONFIG.STORAGE_KEYS.UNLOCKED, "true");
  document.querySelectorAll('.secret-opt').forEach(el => el.removeAttribute('hidden'));
};

const persistSettings = () => {
  sessionStorage.setItem(APP_CONFIG.STORAGE_KEYS.API_KEY, Elements.apiKey.value.trim());
  localStorage.setItem(APP_CONFIG.STORAGE_KEYS.MODEL, Elements.model.value);
  AppState.persona = Elements.persona.value;
  localStorage.setItem(APP_CONFIG.STORAGE_KEYS.PERSONA, AppState.persona);
  localStorage.setItem(APP_CONFIG.STORAGE_KEYS.COMPANY, Elements.company.value.trim());
  localStorage.setItem(APP_CONFIG.STORAGE_KEYS.ROLE, Elements.role.value);
};

const restoreSettings = () => {
  Elements.apiKey.value = sessionStorage.getItem(APP_CONFIG.STORAGE_KEYS.API_KEY) || "";
  Elements.model.value = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.MODEL) || APP_CONFIG.DEFAULT_MODEL;
  
  AppState.unlocked = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.UNLOCKED) === "true";
  if (AppState.unlocked) unlockPersona();
  
  AppState.persona = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.PERSONA) || "medium";
  if (Elements.persona) Elements.persona.value = AppState.persona;
  
  Elements.company.value = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.COMPANY) || "";
  Elements.role.value = localStorage.getItem(APP_CONFIG.STORAGE_KEYS.ROLE) || Elements.role.value;
};

const updateStatusUI = () => {
  const hasKey = !!Elements.apiKey.value.trim();
  Elements.statusDot.style.background = hasKey ? "#34c759" : "#ff3b30";
  Elements.statusLabel.textContent = hasKey ? "Ready" : "API Required";
};

const validateSettings = () => {
  const apiKey = Elements.apiKey.value.trim();
  const model = Elements.model.value || APP_CONFIG.DEFAULT_MODEL;
  if (!apiKey) {
    openSettings();
    showToast("API 키를 먼저 입력해주세요.");
    return null;
  }
  return { apiKey, model };
};

const buildRequestBody = (text) => ({
  contents: [{ role: "user", parts: [{ text }] }],
  generationConfig: { temperature: 0.2, topP: 0.9, maxOutputTokens: 8192, responseMimeType: "application/json" }
});

async function callGeminiAPI(key, model, text) {
  const delays = [1000, 2000, 4000];
  for (let i = 0; ; i++) {
    const ctrl = new AbortController();
    const timerId = setTimeout(() => ctrl.abort(), APP_CONFIG.API_TIMEOUT_MS);
    
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(text)),
        signal: ctrl.signal
      });
      
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message || "API 오류가 발생했습니다.");
      
      clearTimeout(timerId);
      return data;
    } catch (error) {
      clearTimeout(timerId);
      if (i >= delays.length) {
        if (error.name === "AbortError") throw new Error("응답 시간이 초과되었어요. 내용이 너무 길거나 네트워크가 불안정할 수 있어요.");
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delays[i]));
    }
  }
}

const parseApiResponse = (data) => {
  if (data?.promptFeedback?.blockReason) throw new Error("안전 필터에 의해 요청이 차단되었습니다.");
  
  const candidate = data?.candidates?.[0];
  if (!candidate) throw new Error("서버로부터 정상적인 응답을 받지 못했습니다.");
  if (["SAFETY", "RECITATION"].includes(candidate.finishReason)) throw new Error("안전 필터 정책에 의해 내용이 차단되었습니다.");
  if (candidate.finishReason === "MAX_TOKENS") throw new Error("분석 내용이 너무 길어서 응답이 중간에 끊겼습니다. 자료의 길이를 조금 줄여서 다시 시도해주세요.");
  
  const textContent = candidate.content?.parts?.map(part => part.text || "").join("").trim();
  if (!textContent) throw new Error("생성된 텍스트 데이터가 없습니다.");
  
  return textContent;
};

const parseJsonResult = (text) => {
  try {
    return JSON.parse(text.replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/i, "").trim());
  } catch (error) {
    console.error("JSON Parsing Error:", error, text);
    throw new Error("결과 형식을 분석하는 중 오류가 발생했습니다. 다시 시도해주세요.");
  }
};

async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error("PDF 분석 라이브러리를 불러오지 못했습니다.");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = APP_CONFIG.PDFJS_WORKER_URL;
  
  try {
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let extractedText = "";
    
    for (let i = 1; i <= Math.min(pdf.numPages, APP_CONFIG.MAX_PDF_PAGES); i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      extractedText += content.items.map(item => item.str).join(" ") + "\n";
    }
    return extractedText.trim();
  } catch (error) {
    throw new Error("PDF 파일에서 텍스트를 추출하는데 실패했습니다.");
  }
}

function renderReport(resultData, companyName, roleName, documentName) {
  const summary = resultData?.experience_summary || "요약을 생성하는 데 문제가 발생했습니다.";
  const stars = Array.isArray(resultData?.star_experiences) ? resultData.star_experiences : [];
  const critiques = Array.isArray(resultData?.critique?.comment_paragraphs) ? resultData.critique.comment_paragraphs : [];
  const missingPoints = Array.isArray(resultData?.critique?.missing_points) ? resultData.critique.missing_points : [];
  const keywords = Array.isArray(resultData?.critique?.recommended_keywords) ? resultData.critique.recommended_keywords : [];

  const critiqueHtml = critiques.map(p => `<p>${formatText(p)}</p>`).join("");
  let starHtml = '<div class="star"><p>데이터가 부족하여 구조화에 실패했습니다.</p></div>';
  
  if (stars.length > 0) {
    starHtml = stars.map((item, index) => `
      <div class="star">
        <h4>${escapeHtml(item.title || `Experience ${index + 1}`)}</h4>
        <div class="star-section">
          <span class="star-label">STAR Structure</span>
          <div class="star-block"><strong>Situation</strong><p>${formatText(item.situation)}</p></div>
          <div class="star-block"><strong>Task</strong><p>${formatText(item.task)}</p></div>
          <div class="star-block"><strong>Action</strong><p>${formatText(item.action)}</p></div>
          <div class="star-block"><strong>Result</strong><p>${formatText(item.result)}</p></div>
        </div>
        <div class="star-section">
          <span class="star-label prep">Interview PREP</span>
          <div class="star-block"><strong>Point</strong><p>${formatText(item.prep_point)}</p></div>
          <div class="star-block"><strong>Reason</strong><p>${formatText(item.prep_reason)}</p></div>
          <div class="star-block"><strong>Example</strong><p>${formatText(item.prep_example)}</p></div>
          <div class="star-block"><strong>Point</strong><p>${formatText(item.prep_point_conclusion)}</p></div>
        </div>
      </div>`).join("");
  }

  const defaultMissingPoints = [
    `${roleName} 직무와의 구체적인 연관성을 어필할 수 있는 데이터를 추가해주세요.`,
    "정량적인 성과나 구체적인 행동(Action) 과정이 드러나면 설득력이 높아집니다.",
    "본인의 명확한 역할과 기여도를 좀 더 강조해주세요."
  ];
  
  const displayMissingPoints = missingPoints.length > 0 ? missingPoints.slice(0, 3) : defaultMissingPoints;
  const missingHtml = displayMissingPoints.map(p => `<li>${formatText(p)}</li>`).join("");
  const keywordHtml = keywords.length > 0 ? `<div class="keyword-box">${keywords.map(k => `<span class="keyword-badge">${formatText(k)}</span>`).join("")}</div>` : "";

  const personaTitles = { 
    mild: "💬 멘토의 따뜻한 심층 조언", 
    medium: "💬 멘토의 객관적 심층 조언", 
    spicy_light: "💬 엄격한 사수의 보완점 지적", 
    spicy: "🔥 팩트 폭행 심층 조언", 
    spicy_fire: "🌋 극대노 팩트 폭격" 
  };
  
  const isSpicy = ["spicy_light", "spicy", "spicy_fire"].includes(AppState.persona);
  const warningHtml = isSpicy ? '<div style="background:#fff3cd;border:1px solid #ffe69c;color:#b45309;padding:14px 18px;border-radius:12px;font-size:14px;font-weight:600;margin-bottom:24px;line-height:1.5;">⚠️ [경고] 매운맛 코칭 스타일이 적용되었습니다. 다소 과장되고 직설적인 독설이 포함되어 있으니 상처받지 마시고 재미로만 참고해 주세요!</div>' : '';
  const warningText = isSpicy ? "[⚠️ 경고: 매운맛 코칭이 적용되었습니다. 다소 직설적이고 과장된 독설이 포함되어 있으니 재미로만 참고하세요!]\n\n" : "";

  Elements.report.innerHTML = `
    <section class="report-card">
      <div class="reporthead">
        <div>
          <span class="badge">분석 완료</span>
          <h2 class="reporttitle">✨ 맞춤형 자소서 코칭 리포트</h2>
          <p style="color:var(--text-secondary); margin-top:8px;">목표: ${escapeHtml(companyName)} | <strong>${escapeHtml(roleName)}</strong></p>
        </div>
        <div class="reportside">
          <span class="source">${escapeHtml(documentName)}</span>
          <button class="btn btn-secondary" id="copy-report">리포트 복사하기</button>
        </div>
      </div>
      ${warningHtml}
    </section>
    
    <section class="report-card highlight">
      <h3>🔍 ${escapeHtml(roleName)} 실무 면접관이 파악한 핵심 요약</h3>
      <p>${formatText(summary)}</p>
    </section>
    
    ${keywordHtml ? `
    <section class="report-card">
      <h3>💡 자소서에 이 단어들을 활용해 보세요</h3>
      <p>면접관의 시선을 단번에 사로잡을 수 있는 추천 실무 키워드입니다.</p>
      ${keywordHtml}
    </section>` : ""}
    
    <section class="report-card">
      <h3>⭐ 논리를 강화하는 STAR & PREP 구조</h3>
      <div class="stars">${starHtml}</div>
    </section>
    
    <section class="report-card dark">
      <h3>${personaTitles[AppState.persona] || "💬 심층 조언"}</h3>
      <div class="feedback-content">${critiqueHtml}</div>
      <h3 style="margin-top:32px;">🛠️ 당장 보완해야 할 3가지 아쉬운 점</h3>
      <ul class="list">${missingHtml}</ul>
    </section>`;

  const starsText = stars.map((item, index) => `\n[Experience ${index + 1}: ${item.title}]\n- S: ${item.situation}\n- T: ${item.task}\n- A: ${item.action}\n- R: ${item.result}\n\n[PREP]\n- P: ${item.prep_point}\n- R: ${item.prep_reason}\n- E: ${item.prep_example}\n- P: ${item.prep_point_conclusion}`).join("\n");
  
  AppState.reportData = `${warningText}[✨ 맞춤형 자소서 코칭 리포트]\n목표: ${companyName} | ${roleName}\n\n[${roleName} 실무 면접관이 파악한 핵심 요약]\n${summary}\n\n[추천 실무 키워드]\n${keywords.join(", ")}\n\n[경험 구조화 (STAR & PREP)]\n${starsText}\n\n[멘토의 심층 조언]\n${critiques.join("\n\n")}\n\n[당장 보완해야 할 3가지 아쉬운 점]\n${displayMissingPoints.map((v, i) => `${i + 1}. ${v}`).join("\n")}`;

  const copyBtn = getElement("copy-report");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(AppState.reportData);
        showToast("리포트 내용을 복사했어요! 원하는 곳에 붙여넣어 보세요.");
      } catch (error) {
        showToast("복사하는 데 실패했어요.");
      }
    });
  }
}

async function handleApiTest() {
  persistSettings();
  const settings = validateSettings();
  if (!settings) return;
  
  try {
    const response = await callGeminiAPI(settings.apiKey, settings.model, '{"status":"ok"}만 출력');
    parseJsonResult(parseApiResponse(response));
    updateStatusUI();
    showToast("만나서 반가워요! 연결에 성공했습니다. 🎉");
  } catch (error) {
    showToast(error.message || "앗, 연결에 실패했어요. API 키를 다시 한 번 확인해 주시겠어요?");
  }
}

async function handleAnalyze() {
  persistSettings();
  closeSettings();
  
  const settings = validateSettings();
  if (!settings) return;
  
  const companyName = Elements.company.value.trim() || "게임회사";
  const roleName = Elements.role.value;
  let textToAnalyze = "";
  let fileName = "직접 입력하신 내용";

  if (AppState.mode === "pdf") {
    if (!AppState.file) return showToast("분석할 PDF 파일을 먼저 올려주세요!");
    setView("loader");
    Elements.loaderTitle.textContent = "PDF 문서에서 글자를 읽고 있어요 👀";
    Elements.loaderText.textContent = "문서가 잘 정리되어 있는지 꼼꼼히 살펴볼게요.";
    
    try {
      textToAnalyze = await extractPdfText(AppState.file);
      fileName = AppState.file.name;
      if (textToAnalyze.length < 20) throw new Error("글자를 거의 찾을 수 없어요. 텍스트를 드래그할 수 있는 PDF인지 확인해 주시겠어요?");
    } catch (error) {
      setView(Elements.report.innerHTML.trim() ? "report" : "guide");
      return showToast("PDF 추출 실패: " + error.message);
    }
  } else {
    textToAnalyze = Elements.text.value.trim();
    if (!textToAnalyze) return showToast("분석할 내용이 비어있어요! 나의 멋진 경험을 조금이라도 적어주세요.");
  }

  setView("loader");
  
  const personaTexts = {
    mild: { title: "코치가 경험을 꼼꼼히 분석하고 있어요... 😊", desc: "면접관이 좋아할 만한 긍정적 포인트를 찾고 있습니다." },
    medium: { title: "코치가 경험을 객관적으로 분석 중입니다... 🧐", desc: "실무 관점의 장단점을 명확히 파악하고 있습니다." },
    spicy_light: { title: "코치가 논리의 허점을 짚어보고 있어요... 🌶️", desc: "더 완벽한 글을 위해 아쉬운 점을 찾고 있습니다." },
    spicy: { title: "코치가 가차없이 팩트를 폭격하고 있어요... 🔥", desc: "치명적인 약점을 찾아내고 있습니다. 팩폭 주의!" },
    spicy_fire: { title: "코치가 글을 보고 극대노 중입니다... 🌋", desc: "뼈를 때리는 독설을 준비 중입니다. 각오 단단히 하세요!" }
  };
  
  Elements.loaderTitle.textContent = personaTexts[AppState.persona]?.title || personaTexts.medium.title;
  Elements.loaderText.textContent = personaTexts[AppState.persona]?.desc || personaTexts.medium.desc;
  Elements.analyze.disabled = true;
  
  try {
    const prompt = getPromptTemplate(companyName, roleName, textToAnalyze.substring(0, APP_CONFIG.MAX_TEXT_LENGTH), AppState.persona);
    const response = await callGeminiAPI(settings.apiKey, settings.model, prompt);
    const resultData = parseJsonResult(parseApiResponse(response));
    
    renderReport(resultData, companyName, roleName, fileName);
    setView("report");
  } catch (error) {
    setView(Elements.report.innerHTML.trim() ? "report" : "guide");
    showToast(error.message);
  } finally {
    Elements.analyze.disabled = false;
  }
}

function handleFileSelection(filesList) {
  const file = filesList?.[0];
  if (!file) return;
  
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return showToast("앗, PDF 형식의 파일만 읽을 수 있어요. 다른 파일은 내용을 복사해서 붙여넣어 볼까요?");
  }
  
  AppState.file = file;
  Elements.filename.textContent = file.name;
  Elements.chip.classList.add("show");
  showToast("파일을 잘 받았어요! 코칭을 시작해볼까요?");
}

function clearPdfSelection() {
  AppState.file = null;
  Elements.pdfInput.value = "";
  Elements.chip.classList.remove("show");
}

function initializeElements() {
  Elements.body = document.body;
  Elements.toast = getElement("toast");
  Elements.statusDot = getElement("status-dot");
  Elements.statusLabel = getElement("status-label");
  Elements.company = getElement("company");
  Elements.role = getElement("role");
  Elements.persona = getElement("persona");
  Elements.secret = getElement("secret-trigger");
  Elements.modePdf = getElement("mode-pdf");
  Elements.modeText = getElement("mode-text");
  Elements.pdfPanel = getElement("panel-pdf");
  Elements.textPanel = getElement("panel-text");
  Elements.drop = getElement("dropzone");
  Elements.pdfInput = getElement("pdf-input");
  Elements.chip = getElement("filechip");
  Elements.filename = getElement("filename");
  Elements.clearPdf = getElement("clear-pdf");
  Elements.text = getElement("text");
  Elements.analyze = getElement("analyze");
  Elements.guideView = getElement("guide-view");
  Elements.loader = getElement("loader-view");
  Elements.report = getElement("report-view");
  Elements.loaderTitle = getElement("loader-title");
  Elements.loaderText = getElement("loader-text");
  Elements.settingsModal = getElement("settings-modal");
  Elements.openSettings = getElement("open-settings");
  Elements.guideSettings = getElement("guide-settings");
  Elements.apiKey = getElement("api-key");
  Elements.model = getElement("model");
  Elements.testApi = getElement("test-api");
  Elements.saveSettings = getElement("save-settings");
}

function bindEvents() {
  if (Elements.guideSettings) Elements.guideSettings.addEventListener("click", openSettings);
  Elements.openSettings.addEventListener("click", openSettings);
  Elements.modePdf.addEventListener("click", () => setInputMode("pdf"));
  Elements.modeText.addEventListener("click", () => setInputMode("text"));
  
  // Easter Egg
  let clickCount = 0;
  let clickTimer;
  Elements.secret.addEventListener("click", () => {
    if (AppState.unlocked) return;
    clickCount++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => clickCount = 0, 2000);
    
    if (clickCount >= 10) {
      unlockPersona();
      showToast("특수 기능 해제! 🔥 매운맛은 상처받을 수 있으니 재미로만 사용하세요!");
    }
  });

  Elements.drop.addEventListener("click", () => Elements.pdfInput.click());
  Elements.pdfInput.addEventListener("change", (e) => handleFileSelection(e.target.files));
  Elements.clearPdf.addEventListener("click", clearPdfSelection);
  Elements.analyze.addEventListener("click", handleAnalyze);
  Elements.testApi.addEventListener("click", handleApiTest);
  
  Elements.saveSettings.addEventListener("click", () => {
    persistSettings();
    updateStatusUI();
    closeSettings();
    showToast("설정을 저장했습니다! 이제 든든한 코치가 함께합니다.");
  });
  
  ["dragenter", "dragover"].forEach(eventName => {
    Elements.drop.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      Elements.drop.classList.add("drag");
    });
  });
  
  ["dragleave", "drop"].forEach(eventName => {
    Elements.drop.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      Elements.drop.classList.remove("drag");
    });
  });
  
  Elements.drop.addEventListener("drop", (e) => handleFileSelection(e.dataTransfer.files));
  
  Elements.apiKey.addEventListener("input", () => {
    sessionStorage.setItem(APP_CONFIG.STORAGE_KEYS.API_KEY, Elements.apiKey.value.trim());
    updateStatusUI();
  });
  
  Elements.model.addEventListener("change", () => {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.MODEL, Elements.model.value);
    updateStatusUI();
  });
  
  Elements.company.addEventListener("input", () => {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.COMPANY, Elements.company.value.trim());
  });
  
  Elements.role.addEventListener("change", () => {
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.ROLE, Elements.role.value);
  });
  
  Elements.persona.addEventListener("change", () => {
    AppState.persona = Elements.persona.value;
    localStorage.setItem(APP_CONFIG.STORAGE_KEYS.PERSONA, AppState.persona);
    updateStatusUI();
    
    if (["spicy_light", "spicy", "spicy_fire"].includes(AppState.persona)) {
      showToast("⚠️ 매운맛 모드 적용 (재미용/상처주의)");
    }
  });
  
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeSettings();
  });
  
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });
}

// App Initialization
function initApp() {
  initializeElements();
  restoreSettings();
  updateStatusUI();
  setInputMode("pdf");
  setView("guide");
  bindEvents();
}

// Execute when DOM is fully loaded (if type="module" it is deferred automatically, but good practice)
document.addEventListener("DOMContentLoaded", initApp);
