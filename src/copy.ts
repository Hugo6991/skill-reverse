export const uiCopy = {
  nav: {
    newReverse: "New reverse",
    history: "Public archive",
    pilot: "Example brief"
  },
  home: {
    eyebrow: "Read the thinking before installing",
    title: "先別收藏 Skill，先取走它的思考",
    description:
      "貼上一個公開 skill、repo 或方法來源；先看創作者在解什麼問題、哪些規則值得帶走，再用任何聊天 AI 試一次，只有反覆需要時才封裝",
    urlLabel: "Skill or framework URL",
    urlPlaceholder: "https://github.com/owner/repo/tree/main/skills/example",
    continue: "Continue",
    changeUrl: "Change URL",
    occupationLabel: "你想把這套思維帶進哪類工作？",
    occupationHelp: "這只決定應用視角，不用來替作者打分，也不代表你需要某種 agent",
    occupationPlaceholder: "Search a work context",
    checkingPrevious: "Checking the public archive…",
    previousTitle: "This source has earlier reports",
    previousBody: "Open a previous result for context or continue below to create a fresh run",
    publicNotice:
      "Submitted URLs completed reports and captured evidence enter the permanent public archive",
    start: "Reverse the thinking",
    starting: "Reading the thinking…",
    lockedTitle: "Research is not available yet",
    lockedBody: "You can explore the pilot report while the service is being prepared",
    openPilot: "Open example brief"
  },
  output: {
    eyebrow: "What you leave with",
    title: "不是下載清單，而是一個採用決定",
    description: "先把一個 skill 降維成能讀、能問、能試的文字，再決定它是否值得進入你的長期系統",
    baseline: "30 秒初篩",
    baselineDetail: "它在解什麼問題，和你有沒有關係",
    framework: "可攜帶的框架",
    frameworkDetail: "抽掉作者與工具後，仍然成立的判斷規則",
    delta: "Chat-first 試跑",
    deltaDetail: "先在任何聊天 AI 用一次，反覆有效才封裝"
  },
  sources: {
    eyebrow: "Optional context",
    title: "Add supporting sources",
    description: "主頁研究已開始，可選擇補充 GitHub、文章、文件或 X 貼文",
    queuedDescription: "研究仍在排隊；你可以先補充 GitHub、文章、文件或 X 貼文，啟動時會直接使用",
    add: "Add source",
    placeholder: "https://github.com/owner/repo",
    finish: "Use sources and continue",
    skip: "Continue without sources",
    saved: "Supporting sources submitted",
    saving: "Continuing research…"
  },
  history: {
    eyebrow: "Shared evidence library",
    title: "Public research archive",
    description: "所有訪客完成的研究都保存在這裡；同一來源的不同批次會並列呈現",
    publicNote: "Public, permanent and shared across browsers",
    emptyTitle: "The public archive is ready",
    emptyBody: "Complete the first research run and its report will appear here",
    emptyAction: "Start a reverse",
    loadError: "The public archive could not be loaded",
    retry: "Try again",
    loadMore: "Load older reports",
    loadingMore: "Loading older reports…"
  }
} as const;
