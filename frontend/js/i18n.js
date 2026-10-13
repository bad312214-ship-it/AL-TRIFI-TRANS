/* i18n — Arabic (RTL) + English (LTR) */
const dict = {
  ar: {
    brand: "استوديو تريفي للأفلام الذكية",
    brandSub: "منصة إنتاج الأفلام بالذكاء الاصطناعي",
    navStudio: "الاستوديو",
    navProjects: "مشاريعي",
    navSettings: "الإعدادات",
    footerNote: "المحركات المحلية تعمل بدون إنترنت — اربط مفاتيح API في الإعدادات لتفعيل التوليد المتقدم",

    heroTitle: 'حوّل فكرتك إلى <span class="grad">فيلم سينمائي متكامل</span>',
    heroSub: "اكتب وصفًا بالعربية أو الإنجليزية، وسيتولى النظام كتابة السيناريو، وتقسيم المشاهد، وتصميم الشخصيات، وتوليد اللقطات، والصوت، والموسيقى، والترجمة، ثم ينتج فيلمًا جاهزًا للمعاينة والتنزيل.",
    ideaLabel: "فكرة الفيلم أو السيناريو",
    ideaPlaceholder: "مثال: أنشئ فيلم رسوم متحركة مدته 3 دقائق عن طفل يكتشف مدينة سحرية مخفية خلف الجبال، بأسلوب سينمائي عائلي، مع شخصيات ثلاثية الأبعاد وموسيقى مؤثرة ونهاية مفاجئة…",
    quickIdeas: "أفكار سريعة:",
    productionSettings: "إعدادات الإنتاج",
    genre: "نوع الفيلم",
    visualStyle: "الأسلوب البصري",
    duration: "المدة المستهدفة (ثانية)",
    resolution: "الدقة",
    aspect: "نسبة العرض",
    fps: "معدل الإطارات",
    language: "اللغة",
    voiceStyle: "الصوت واللهجة",
    musicMood: "طبيعة الموسيقى",
    engineSettings: "محركات التوليد",
    engineLLM: "محرك كتابة السيناريو",
    engineImage: "محرك توليد الصور",
    engineVideo: "محرك توليد الفيديو",
    engineTTS: "محرك الأصوات",
    subtitles: "إضافة ترجمة نصية",
    titleCards: "بطاقات افتتاحية وختامية",
    costEstimate: "تقدير التكلفة قبل التوليد",
    createFilm: "إنشاء فيلم بالذكاء الاصطناعي",
    creating: "جارٍ الإنشاء…",
    estimateFree: "المحركات المحلية مجانية",
    perProjectNote: "يمكنك مراجعة السيناريو والمشاهد قبل بدء التوليد المكلف.",

    projectsTitle: "مكتبة المشاريع",
    newProject: "مشروع جديد",
    open: "فتح",
    delete: "حذف",
    confirmDelete: "هل أنت متأكد من حذف هذا المشروع وكل ملفاته؟",
    noProjects: "لا توجد مشاريع بعد — ابدأ بإنشاء فيلمك الأول",
    status: "الحالة",
    progressLabel: "التقدم",

    tabScript: "السيناريو",
    tabStoryboard: "القصة المصوّرة",
    tabProduction: "الإنتاج",
    tabPreview: "المعاينة والتصدير",

    logline: "السطر التعريفي",
    synopsis: "الملخص",
    styleNotes: "ملاحظات الأسلوب",
    characters: "الشخصيات",
    scenes: "المشاهد",
    saveScript: "حفظ التعديلات",
    scriptSaved: "تم حفظ السيناريو",
    generateScript: "كتابة السيناريو بالذكاء الاصطناعي",
    scriptHint: "راجع السيناريو وعدّله قبل بدء التوليد — التوليد يستهلك موارد.",
    noScript: "لم يُكتب السيناريو بعد. اضغط الزر لتحويل فكرتك إلى خطة فيلم متكاملة.",

    sceneTitle: "عنوان المشهد",
    sceneEnv: "البيئة",
    sceneNarration: "التعليق الصوتي / السرد",
    sceneDuration: "المدة (ثانية)",
    sceneMood: "المزاج",
    regenerate: "إعادة توليد المشهد",
    regenerating: "جارٍ إعادة التوليد…",
    sceneShots: "اللقطات",
    camera: "الكاميرا",
    motion: "الحركة",
    durationSec: "ث",

    productionTitle: "خط الإنتاج",
    jobHistory: "سجل المهام",
    warnings: "تنبيهات",
    startProduction: "بدء توليد الفيلم",
    resuming: "جاري المعالجة…",
    resume: "استكمال الإنتاج",
    stages: {
      planning: "تحليل الفكرة والسيناريو",
      characters: "تثبيت هوية الشخصيات",
      environments: "بناء البيئات والإضاءة",
      shots: "توليد لقطات الفيديو",
      voice: "الصوت والحوار",
      music: "الموسيقى والمؤثرات",
      assembly: "المونتاج الذكي",
      qc: "المراجعة والتحسين",
      done: "التصدير النهائي",
    },
    stageSub: {
      planning: "فهم الموضوع والشخصيات وكتابة القصة",
      characters: "تصميم مظهر ثابت لكل شخصية",
      environments: "إنشاء المواقع والخلفيات والمشاهد",
      shots: "إنتاج المقاطع مع استمرارية الحركة",
      voice: "أصوات الشخصيات والتعليق الصوتي",
      music: "موسيقى خلفية ومؤثرات صوتية",
      assembly: "ترتيب المشاهد والانتقالات والترجمة",
      qc: "اكتشاف الأخطاء وإصلاحها",
      done: "الفيلم جاهز للمعاينة والتنزيل",
    },

    previewTitle: "الفيلم النهائي",
    downloadMP4: "تنزيل الفيلم (MP4)",
    downloadSRT: "تنزيل الترجمة (SRT)",
    downloadScript: "تنزيل السيناريو",
    manifest: "البطاقة الفنية",
    noFilm: "لم يُنتج الفيلم بعد — ابدأ الإنتاج من تبويب «الإنتاج».",
    filmReady: "الفيلم جاهز! يمكنك معاينته وتنزيله.",
    targetDuration: "المدة المستهدفة",
    realDuration: "المدة الفعلية",
    usedEngines: "المحركات المستخدمة",

    settingsTitle: "الإعدادات ومفاتيح المحركات",
    settingsNote: "تُحفظ المفاتيح على الخادم فقط ولا تُرسل إلى المتصفح (تظهر مُقنّعة). يمكنك استخدام المحركات المحلية المجانية دائمًا.",
    saveSettings: "حفظ الإعدادات",
    settingsSaved: "تم حفظ الإعدادات",
    test: "اختبار الاتصال",
    sample: "توليد عيّنة",
    testing: "جارٍ الاختبار…",
    connected: "متصل ✓",
    notConnected: "غير مُفعّل",
    apiKey: "مفتاح API",
    defaultEngine: "المحرك الافتراضي",
    prices: "الأسعار (USD)",
    priceImage: "لكل صورة",
    priceVideo: "لكل ثانية فيديو",
    priceTTS: "لكل 1000 حرف صوت",
    priceLLM: "لكل 1000 رمز سيناريو",

    toasts: {
      created: "تم إنشاء المشروع",
      planned: "اكتمل السيناريو",
      renderDone: "اكتمل إنتاج الفيلم ✓",
      jobFailed: "فشلت مهمة الإنتاج",
      saved: "تم الحفظ",
      deleted: "تم الحذف",
      error: "حدث خطأ",
      copied: "تم النسخ",
    },
    genres: { adventure: "مغامرات", fantasy: "فانتازيا", historical: "تاريخي", drama: "دراما", comedy: "كوميدي", family: "عائلي", documentary: "وثائقي", educational: "تعليمي", scifi: "خيال علمي", commercial: "إعلاني/تسويقي" },
    styles: { cinematic_3d: "رسوم ثلاثية الأبعاد سينمائية", realistic: "واقعي (كاميرا)", animation: "رسوم متحركة", pixar_like: "عائلي ثلاثي الأبعاد", anime: "أنمي", documentary: "وثائقي", noir: "نوار", vintage: "كلاسيكي" },
    voices: { warm_narrator: "راوي دافئ", epic_narrator: "راوي ملحمي", female_warm: "أنثوي دافئ", child: "طفولي", deep_male: "رجولي عميق", news: "إذاعي" },
    moods: { emotional: "مؤثر", epic: "مشوق", mysterious: "غموض", happy: "مرح", calm: "هادئ", tense: "توتر" },
    langs: { ar: "العربية", en: "الإنجليزية" },
  },
  en: {
    brand: "TRIFI AI Cinema Studio",
    brandSub: "AI-powered film production platform",
    navStudio: "Studio", navProjects: "My Projects", navSettings: "Settings",
    footerNote: "Local engines work offline — connect API keys in Settings for advanced generation",
    heroTitle: 'Turn your idea into a <span class="grad">complete cinematic film</span>',
    heroSub: "Write a prompt in Arabic or English. The system writes the screenplay, breaks it into scenes, designs characters, generates shots, voice, music and subtitles, then produces a film ready to preview and download.",
    ideaLabel: "Film idea or screenplay", ideaPlaceholder: "Example: Create a 3-minute animated film about a child discovering a hidden magic city behind the mountains, family cinematic style, 3D characters, moving music, surprise ending…",
    quickIdeas: "Quick ideas:", productionSettings: "Production settings",
    genre: "Genre", visualStyle: "Visual style", duration: "Target duration (sec)", resolution: "Resolution",
    aspect: "Aspect ratio", fps: "Frame rate", language: "Language", voiceStyle: "Voice & accent", musicMood: "Music mood",
    engineSettings: "Generation engines", engineLLM: "Screenplay engine", engineImage: "Image engine", engineVideo: "Video engine", engineTTS: "Voice engine",
    subtitles: "Add subtitles", titleCards: "Title & end cards", costEstimate: "Cost estimate before generation",
    createFilm: "Create film with AI", creating: "Creating…", estimateFree: "Local engines are free",
    perProjectNote: "You can review the screenplay and scenes before starting costly generation.",
    projectsTitle: "Project library", newProject: "New project", open: "Open", delete: "Delete",
    confirmDelete: "Delete this project and all its files?", noProjects: "No projects yet — create your first film",
    status: "Status", progressLabel: "Progress",
    tabScript: "Screenplay", tabStoryboard: "Storyboard", tabProduction: "Production", tabPreview: "Preview & Export",
    logline: "Logline", synopsis: "Synopsis", styleNotes: "Style notes", characters: "Characters", scenes: "Scenes",
    saveScript: "Save changes", scriptSaved: "Screenplay saved", generateScript: "Write screenplay with AI",
    scriptHint: "Review and edit the screenplay before generation — rendering consumes resources.",
    noScript: "No screenplay yet. Click the button to turn your idea into a full film plan.",
    sceneTitle: "Scene title", sceneEnv: "Environment", sceneNarration: "Narration / voice-over", sceneDuration: "Duration (sec)",
    sceneMood: "Mood", regenerate: "Regenerate scene", regenerating: "Regenerating…", sceneShots: "Shots",
    camera: "Camera", motion: "Motion", durationSec: "s",
    productionTitle: "Production pipeline", jobHistory: "Job log", warnings: "Warnings",
    startProduction: "Start film generation", resuming: "Processing…", resume: "Resume production",
    stages: {
      planning: "Idea analysis & screenplay", characters: "Character identity", environments: "Environments & lighting",
      shots: "Video shot generation", voice: "Voice & dialogue", music: "Music & effects",
      assembly: "Smart editing", qc: "Review & refine", done: "Final export",
    },
    stageSub: {
      planning: "Understand theme, characters, write the story", characters: "Consistent look per character",
      environments: "Create locations, backdrops, scenes", shots: "Produce clips with motion continuity",
      voice: "Character voices and narration", music: "Score and sound effects",
      assembly: "Order scenes, transitions, subtitles", qc: "Detect and fix issues", done: "Film ready to preview & download",
    },
    previewTitle: "Final film", downloadMP4: "Download film (MP4)", downloadSRT: "Download subtitles (SRT)",
    downloadScript: "Download screenplay", manifest: "Technical sheet", noFilm: "No film yet — start production from the Production tab.",
    filmReady: "Film is ready! Preview or download it.", targetDuration: "Target duration", realDuration: "Actual duration",
    usedEngines: "Engines used",
    settingsTitle: "Settings & engine keys", settingsNote: "Keys are stored on the server only and never sent to the browser (masked). Local engines are always free.",
    saveSettings: "Save settings", settingsSaved: "Settings saved", test: "Test connection", sample: "Generate sample",
    testing: "Testing…", connected: "Connected ✓", notConnected: "Not enabled", apiKey: "API key",
    defaultEngine: "Default engine", prices: "Prices (USD)", priceImage: "Per image", priceVideo: "Per video second",
    priceTTS: "Per 1k TTS chars", priceLLM: "Per 1k screenplay tokens",
    toasts: {
      created: "Project created", planned: "Screenplay ready", renderDone: "Film completed ✓",
      jobFailed: "Production job failed", saved: "Saved", deleted: "Deleted", error: "An error occurred", copied: "Copied",
    },
    genres: { adventure: "Adventure", fantasy: "Fantasy", historical: "Historical", drama: "Drama", comedy: "Comedy", family: "Family", documentary: "Documentary", educational: "Educational", scifi: "Sci-Fi", commercial: "Commercial" },
    styles: { cinematic_3d: "Cinematic 3D", realistic: "Realistic camera", animation: "Animation", pixar_like: "Family 3D", anime: "Anime", documentary: "Documentary", noir: "Noir", vintage: "Vintage" },
    voices: { warm_narrator: "Warm narrator", epic_narrator: "Epic narrator", female_warm: "Warm female", child: "Child", deep_male: "Deep male", news: "Broadcast" },
    moods: { emotional: "Emotional", epic: "Epic", mysterious: "Mysterious", happy: "Happy", calm: "Calm", tense: "Tense" },
    langs: { ar: "Arabic", en: "English" },
  },
};

let current = localStorage.getItem("trifi_lang") || "ar";

export function lang() {
  return current;
}

export function setLang(l) {
  current = l;
  localStorage.setItem("trifi_lang", l);
  document.documentElement.lang = l;
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
}

export function t(key) {
  const parts = key.split(".");
  let node = dict[current];
  for (const p of parts) {
    node = node?.[p];
    if (node === undefined) return key;
  }
  return node;
}

export function tOpt(group, value) {
  return dict[current]?.[group]?.[value] || value;
}
