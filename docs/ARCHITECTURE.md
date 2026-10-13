# المعمارية التقنية — TRIFI Cinema Studio

## الفكرة العامة

منصة مستقلة (Self-hosted) تحوّل نصًا/فكرة إلى فيلم مترابط عبر سلسلة مراحل مُصرَّح بها،
مع طبقة مزودين قابلة للاستبدال (Provider Layer) لا تربط المنصة بشركة واحدة.

```
┌──────────────────────────┐        ┌─────────────────────────────────────┐
│  Frontend (SPA)          │  HTTP  │  FastAPI Backend                    │
│  RTL عربي / EN           │◄──────►│  /api/projects · /api/providers …   │
│  Studio·Library·Project  │  SSE   │  Token auth (optional)              │
└──────────────────────────┘        │  ┌───────────────────────────────┐  │
                                    │  │ Job Runner (asyncio)          │  │
                                    │  │ plan · render · scene · char  │  │
                                    │  │ retry + resume + SSE events   │  │
                                    │  └──────────────┬────────────────┘  │
                                    │                 ▼                   │
                                    │  Pipeline (idempotent stages)       │
                                    │  characters → environments →        │
                                    │  shots → voice → music → assembly   │
                                    │                 │                   │
                                    │  ┌──────────────┴────────────────┐  │
                                    │  │ Provider Registry             │  │
                                    │  │ llm · image · video · tts ·   │  │
                                    │  │ music (local | remote)        │  │
                                    │  └──────────────┬────────────────┘  │
                                    └─────────────────┼───────────────────┘
                                                      ▼
                                    SQLite (projects/scenes/jobs/settings)
                                    media/ (stills, clips, audio, final film)
                                    ffmpeg (assembly, subtitles, mixing)
```

## المراحل (كلها محفوظة وقابلة للاستئناف)

| المرحلة | المخرج | المزودون |
|---|---|---|
| planning | سيناريو JSON (مشاهد/لقطات/شخصيات) | LLM (OpenAI-compatible) أو المخطط المحلي |
| characters | بطاقات مرجعية ثابتة لكل شخصية | Image provider |
| environments | صورة لكل مشهد (نفس هوية الشخصيات) | Image provider |
| shots | مقطع لكل لقطة (حركة كاميرا) | Video provider (local animatic / Replicate / fal) |
| voice | تعليق صوتي + حوارات | TTS (OpenAI / ElevenLabs / espeak / صامت مُزامن) |
| music | موسيقى أجواء + مؤثرات | مولّد محلي (NumPy) |
| assembly | ترجمة مدمجة + انتقالات + مكساج | ffmpeg |
| qc + finalize | MP4 + SRT + ملصق + بطاقة فنية | فحص الملفات والأطوال |

## قرارات التصميم المهمة

1. **لا يوجد توليد وهمي.** كل زر يستدعي وظيفة حقيقية. المحركات المحلية تنتج ملفات
   فعلية (صور PNG، مقاطع MP4، صوت WAV) وتُصنَّف بوضوح في الواجهة والـmanifest.
2. **مقاطع متعددة ثم تجميع.** لا توجد خدمة تنتج 5 دقائق طلبًا واحدًا؛ كل لقطة تُولَّد
   (5–10 ثوانٍ للمحركات الخارجية) ثم يجمّعها ffmpeg مع ترجمة وصوت وموسيقى.
3. **المفاتيح على الخادم فقط.** الـAPI يعيد المفاتيح مُقنَّعة (آخر 4 أحرف)، ولا تصل
   إلى الواجهة أبدًا.
4. **Idempotency + Resume.** كل مشهد يُنتج كملفات مستقلة على القرص؛ توقف الخادم أو
   فشل مهمة يعيد الجدولة تلقائيًا دون إعادة توليد العمل المنجز.
5. **Fallback صريح.** فشل مزود خارجي (مفتاح منتهي/شبكة) يُسجَّل كتنبيه ويستخدم
   البديل المحلي ليبقى الفيلم مكتملًا — والتنبيه يبقى ظاهرًا في الواجهة والـmanifest.

## بنية الحالة (SQLite)

- `projects` — الإعدادات، الحالة، `screenplay`, `manifest`, `warnings`
- `scenes` — النص، البيئة، اللقطات، مسارات الوسائط، `variant_index` (كل إعادة توليد = نسخة جديدة)
- `characters` — الهوية البصرية والصوتية
- `jobs` — نوع/حالة/محاولات/خطأ — أساس نظام الاستئناف
- `settings` — مفاتيح المزودين والأسعار (تُقرأ مع env، env لها الأولوية عند البدء)

## واجهة الأحداث (SSE)

`GET /api/projects/{id}/events` يبثّ:
`stage` (تقدم المراحل) · `scene` (تحديث مشهد) · `job` (دورة حياة المهمة).
