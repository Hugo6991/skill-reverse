export const uiCopy = {
  nav: {
    newReverse: "New reverse",
    history: "History",
    pilot: "Pilot report"
  },
  home: {
    eyebrow: "Evidence-first reverse research",
    title: "Reverse a public result",
    description: "從公開成果提取可遷移的方法，再用來源、作者脈絡與職業基準驗證",
    urlLabel: "Public result URL",
    urlPlaceholder: "https://example.com",
    continue: "Continue",
    changeUrl: "Change URL",
    occupationLabel: "Choose a professional baseline",
    occupationHelp: "用職業共通知識作比較基準，不用來評分作者能力",
    occupationPlaceholder: "Search O*NET occupations",
    start: "Start research",
    starting: "Starting research…",
    lockedTitle: "Research is not available yet",
    lockedBody: "You can explore the pilot report while the service is being prepared",
    openPilot: "Open pilot report"
  },
  output: {
    eyebrow: "What you get",
    title: "One framework with evidence attached",
    description: "把共同基準、成果方法與作者增量分開，讓每個結論都能回到來源",
    baseline: "Professional baseline",
    baselineDetail: "這個職業通常需要什麼",
    framework: "Reverse framework",
    frameworkDetail: "成果實際呈現了什麼",
    delta: "Author delta",
    deltaDetail: "哪些做法真正值得提煉"
  },
  sources: {
    eyebrow: "Optional context",
    title: "Add supporting sources",
    description: "主頁研究已開始，可選擇補充 GitHub、文章、文件或 X 貼文",
    add: "Add source",
    placeholder: "https://github.com/owner/repo",
    finish: "Use sources and continue",
    skip: "Continue without sources",
    saved: "Supporting sources submitted",
    saving: "Continuing research…"
  },
  history: {
    eyebrow: "Your browser",
    title: "Research history",
    description: "最近 30 天從這個瀏覽器建立的研究",
    emptyTitle: "No research yet",
    emptyBody: "Start with a public result and completed reports will appear here",
    emptyAction: "Start a reverse",
    delete: "Remove",
    loadError: "History could not be loaded",
    retry: "Try again"
  }
} as const;
