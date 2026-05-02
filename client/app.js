/**
 * Talky - Premiere Pro Altyazı Oluşturucu
 * Ana uygulama mantığı
 */

'use strict';

// ── Node.js modülleri (CEP mixed-context ile erişim) ──────────────────────────
const _require = window.require || (typeof require !== 'undefined' ? require : null);
const fs   = _require ? _require('fs')             : null;
const path = _require ? _require('path')           : null;
const os   = _require ? _require('os')             : null;
const https = _require ? _require('https')         : null;
const cp   = _require ? _require('child_process')  : null;

// ── CSInterface ───────────────────────────────────────────────────────────────
let csInterface = null;
try { csInterface = new CSInterface(); } catch (e) {}

// ── Uygulama Durumu ───────────────────────────────────────────────────────────
const state = {
  apiKey:       '',
  clipInfo:     null,
  segments:     [],        // { start, end, text, translated? }
  words:        [],        // { word, start, end } — word-level timestamps for Jump Cut
  lastJumpCut:  null,      // { sequenceName, speechIntervals } — resync icin
  viralCandidates: [],    // AI'in tespit ettigi viral parcalar (Adim 6b'de kullanilacak)
  ffmpegPath:   'ffmpeg',
  ffmpegOK:     false,
  isProcessing: false,
  showTranslation: false,
  batchMode:    false,
  batchClips:   []
};

// ── AI Shorts Prompt ──────────────────────────────────────────────────────────
const VIRAL_ANALYSIS_PROMPT = `Sen bir sosyal medya editorisin ve YouTube/Instagram/TikTok icin viral kisa video parcalari secmekte uzmansin.

Sana asagida bir uzun videonun transkripti verilecek. Her satir bir konusma segmentidir, basinda zaman damgasi var.

GOREV: Bu transkriptten {COUNT} adet VIRAL POTANSIYELI YUKSEK parca sec.

Her parca su kriterleri saglamali:
- Sure: {MIN_DUR}-{MAX_DUR} saniye arasi
- Hook ile baslamali - ilk 3 saniyede izleyiciyi yakalamali
- Kendi basina anlamli olmali - onceki baglama ihtiyac duymamali
- Net bir payoff veya sonuc olmali
- Su unsurlardan en az birini icermeli: ilginc bilgi, mizah, surpriz, duygusal an, pratik tavsiye, kontroversiyel gorus

OZELLIKLE KACINMASI GEREKEN:
- Yarim kalan kisimlar
- Cok teknik veya niche kisimlar
- Sadece selamlasma veya kapanis kisimlari
- Ardisik filler kelimeler

CIKTI FORMATI (sadece JSON, baska aciklama yapma):
{"shorts": [{"startSec": 45.32, "endSec": 78.45, "title": "Baslik (max 60 karakter)", "hook": "Ilk cumle ozeti (max 100 karakter)", "reasoning": "Neden viral olabilir (max 200 karakter)", "tags": ["etiket1", "etiket2"]}]}

TRANSKRIPT:
{TRANSCRIPT}
`;

// ── Filler Word Detection ─────────────────────────────────────────────────────
const FILLER_WORDS = [
  'sey', 'ee', 'eee', 'ii', 'iii', 'aa', 'aaa', 'oo', 'ooo',
  'hmm', 'mmm', 'hah', 'eh', 'ah',
  'um', 'uh', 'umm', 'uhh', 'er', 'erm', 'mhm'
];

function isFillerWord(word) {
  if (!word || typeof word !== 'string') return false;
  const cleaned = word.toLowerCase().replace(/[^\w]/g, '');
  return FILLER_WORDS.indexOf(cleaned) !== -1;
}

// ── Başlatma ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

function init() {
  // API anahtarını yükle
  state.apiKey = localStorage.getItem('talky_api_key') || '';
  document.getElementById('apiKey').value = state.apiKey;
  if (state.apiKey) {
    setApiStatus('ok', 'API anahtarı yüklendi.');
  }

  // ffmpeg kontrol
  checkFFmpeg();

  // Event listeners
  document.getElementById('btnSettings').addEventListener('click', toggleSettings);
  document.getElementById('btnToggleKey').addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('apiKey').addEventListener('input', onApiKeyChange);
  document.getElementById('btnGetAllClips').addEventListener('click', getAllSequenceClips);
  document.getElementById('btnGetSelectedClip').addEventListener('click', getSelectedClip);
  document.getElementById('translateEnabled').addEventListener('change', onTranslateToggle);
  document.getElementById('btnTranscribe').addEventListener('click', startTranscription);
  document.getElementById('btnSaveSRT').addEventListener('click', saveSRT);
  document.getElementById('btnImportPP').addEventListener('click', importToPremiere);
  document.getElementById('btnDismissError').addEventListener('click', hideError);
  document.getElementById('btnShowOriginal').addEventListener('click', () => showView('original'));
  document.getElementById('btnShowTranslated').addEventListener('click', () => showView('translated'));
  document.getElementById('linkOpenAI').addEventListener('click', (e) => {
    e.preventDefault();
    if (csInterface) csInterface.openURLInDefaultBrowser('https://platform.openai.com/api-keys');
  });
}

// ── Ayarlar ───────────────────────────────────────────────────────────────────
function toggleSettings() {
  const panel = document.getElementById('settingsPanel');
  panel.classList.toggle('hidden');
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('apiKey');
  input.type = input.type === 'password' ? 'text' : 'password';
}

function onApiKeyChange() {
  const val = document.getElementById('apiKey').value.trim();
  state.apiKey = val;
  if (val) {
    localStorage.setItem('talky_api_key', val);
    setApiStatus('ok', 'Kaydedildi.');
  } else {
    localStorage.removeItem('talky_api_key');
    setApiStatus('err', 'API anahtarı girilmedi.');
  }
  updateTranscribeButton();
}

function setApiStatus(type, msg) {
  const el = document.getElementById('apiStatus');
  el.className = 'api-status ' + type;
  el.textContent = msg;
}

function onTranslateToggle() {
  const enabled = document.getElementById('translateEnabled').checked;
  document.getElementById('targetLangRow').classList.toggle('hidden', !enabled);
}

// ── ffmpeg Kontrolü ────────────────────────────────────────────────────────────
function checkFFmpeg() {
  if (!cp) {
    setFFmpegStatus(false, 'Node.js erişimi yok — CEP --enable-nodejs gerekli');
    return;
  }

  const candidates = [
    'ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/bin/ffmpeg'
  ];

  // macOS için PATH'den ara
  function tryNext(i) {
    if (i >= candidates.length) {
      setFFmpegStatus(false, 'ffmpeg bulunamadı. Kurulum için README dosyasına bakın.');
      document.getElementById('ffmpegHint').style.display = 'block';
      return;
    }

    const candidate = candidates[i];
    cp.execFile(candidate, ['-version'], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        state.ffmpegPath = candidate;
        state.ffmpegOK   = true;
        const version = (stdout.match(/ffmpeg version ([^\s]+)/) || [])[1] || '';
        setFFmpegStatus(true, `ffmpeg ${version} hazır`);
        updateTranscribeButton();
      } else {
        tryNext(i + 1);
      }
    });
  }

  tryNext(0);
}

function setFFmpegStatus(ok, msg) {
  const el = document.getElementById('ffmpegStatus');
  el.className = 'ffmpeg-status ' + (ok ? 'ok' : 'err');
  el.textContent = (ok ? '✓ ' : '✗ ') + msg;
}

// ── Klip Bilgisi ───────────────────────────────────────────────────────────────
function getAllSequenceClips() {
  if (!csInterface) { showError('Premiere Pro bağlantısı kurulamadı.'); return; }
  csInterface.evalScript('getAllClipsInSequence()', handleAllClipsResult);
}

function handleAllClipsResult(result) {
  if (!result || result === 'EvalScript error.') {
    showError('Premiere Pro ile iletişim kurulamadı.\nLütfen bir sekansın açık olduğundan emin olun.');
    return;
  }

  let data;
  try { data = JSON.parse(result); } catch (e) {
    showError('Geçersiz yanıt: ' + result); return;
  }

  if (data.error) { showError(data.error); return; }

  state.batchMode = true;
  state.batchClips = data.clips;
  state.clipInfo = data.clips[0];

  setActiveSourceButton('btnGetAllClips');
  renderBatchClipInfo(data.clips);
  updateTranscribeButton();
}

function getSelectedClip() {
  if (!csInterface) { showError('Premiere Pro bağlantısı kurulamadı.'); return; }
  state.batchMode = false;
  state.batchClips = [];
  csInterface.evalScript('getSelectedClipInfo()', handleClipResult);
}

function handleClipResult(result) {
  if (!result || result === 'EvalScript error.') {
    showError('Premiere Pro ile iletişim kurulamadı.\nLütfen bir sekansın açık olduğundan emin olun.');
    return;
  }

  let data;
  try { data = JSON.parse(result); } catch (e) {
    showError('Geçersiz yanıt: ' + result); return;
  }

  if (data.error) {
    showError(data.error); return;
  }

  state.clipInfo = data;
  setActiveSourceButton('btnGetSelectedClip');
  renderClipInfo(data);
  updateTranscribeButton();
}

function setActiveSourceButton(activeId) {
  ['btnGetAllClips', 'btnGetSelectedClip'].forEach(id => {
    document.getElementById(id).classList.toggle('active', id === activeId);
  });
}

function renderBatchClipInfo(clips) {
  const box = document.getElementById('clipInfoBox');
  const totalDuration = clips.reduce((sum, c) => sum + c.duration, 0);
  const names = clips.map(c => c.mediaPath ? c.mediaPath.split('/').pop().split('\\').pop() : c.name);

  box.innerHTML = `
    <div class="clip-data">
      <div class="clip-name" title="Tüm Sekans">⏏ Tüm Sekans — ${clips.length} klip</div>
      <div class="clip-meta">
        <div class="clip-meta-item">
          <span class="clip-meta-label">Klip Sayısı</span>
          <span class="clip-meta-value">${clips.length} klip</span>
        </div>
        <div class="clip-meta-item">
          <span class="clip-meta-label">Toplam Süre</span>
          <span class="clip-meta-value">${secondsToHMS(totalDuration)}</span>
        </div>
      </div>
      <div class="clip-path" title="${names.join(', ')}">${names.join(' · ')}</div>
    </div>
  `;
}

function renderClipInfo(info) {
  const box = document.getElementById('clipInfoBox');
  const dur = info.duration;
  const inPt = secondsToHMS(info.inPoint);
  const outPt = secondsToHMS(info.outPoint);
  const timelineStart = secondsToHMS(info.startOnTimeline);

  const fileName = info.mediaPath ? info.mediaPath.split('/').pop().split('\\').pop() : info.name;

  box.innerHTML = `
    <div class="clip-data">
      <div class="clip-name" title="${fileName}">🎬 ${fileName}</div>
      <div class="clip-meta">
        <div class="clip-meta-item">
          <span class="clip-meta-label">Kaynak Giriş</span>
          <span class="clip-meta-value">${inPt}</span>
        </div>
        <div class="clip-meta-item">
          <span class="clip-meta-label">Kaynak Çıkış</span>
          <span class="clip-meta-value">${outPt}</span>
        </div>
        <div class="clip-meta-item">
          <span class="clip-meta-label">Süre</span>
          <span class="clip-meta-value">${secondsToHMS(dur)}</span>
        </div>
        <div class="clip-meta-item">
          <span class="clip-meta-label">Timeline Pozisyonu</span>
          <span class="clip-meta-value">${timelineStart}</span>
        </div>
      </div>
      <div class="clip-path" title="${info.mediaPath}">${info.mediaPath}</div>
    </div>
  `;
}

// ── Ana Transkripsiyon Akışı ───────────────────────────────────────────────────
async function startTranscription() {
  if (!state.clipInfo) { showError('Önce klip bilgisini alın.'); return; }
  if (!state.apiKey)   { showError('OpenAI API anahtarı girilmedi.\nAyarlar simgesine tıklayın.'); return; }

  if (!state.ffmpegOK) {
    showError(
      'ffmpeg bulunamadı. Ses çıkarma için ffmpeg gereklidir.\n\n' +
      'Kurulum:\n' +
      '  1. brew install ffmpeg\n\n' +
      'Homebrew yoksa önce:\n' +
      '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"\n\n' +
      'Kurduktan sonra Premiere Pro\'yu yeniden başlatın.'
    );
    return;
  }

  hideError();
  state.words = [];
  state.isProcessing = true;
  updateTranscribeButton();

  const translateEnabled = document.getElementById('translateEnabled').checked;
  const targetLang       = document.getElementById('targetLanguage').value;

  try {
    let allSegments;

    if (state.batchMode && state.batchClips.length > 1) {
      allSegments = await transcribeBatch(state.batchClips);
    } else {
      allSegments = await transcribeClip(state.clipInfo, 10, 90);
    }

    // Karakter sınırı uygula
    const maxChars = parseInt(document.getElementById('maxCharsPerLine').value, 10) || 0;
    if (maxChars > 0) {
      allSegments = splitSegmentsByCharLimit(allSegments, maxChars);
    }

    // Üst üste binen timestamp'ları düzelt
    allSegments = fixSegmentOverlaps(allSegments);

    state.segments = allSegments;

    // Çeviri (isteğe bağlı)
    if (translateEnabled) {
      setProgress(92, `Çeviri yapılıyor... (${targetLang.toUpperCase()})`);
      const translated = await translateSegments(state.segments, targetLang, state.apiKey);
      state.segments.forEach((seg, i) => { seg.translated = translated[i] || seg.text; });
    }

    setProgress(100, 'Tamamlandı!');

    state.showTranslation = false;
    renderResults(translateEnabled);

    document.getElementById('resultsSection').classList.remove('hidden');
    document.getElementById('exportSection').classList.remove('hidden');

    if (translateEnabled) {
      document.getElementById('btnShowTranslated').classList.remove('hidden');
      document.getElementById('radioTranslatedLabel').classList.remove('hidden');
    }

    setTimeout(() => hideProgress(), 800);

  } catch (err) {
    hideProgress();
    showError(err.message || String(err));
  } finally {
    state.isProcessing = false;
    updateTranscribeButton();
  }
}

// Tek bir klip transkribe et — normalize edilmiş segment dizisi döndürür (timeline offset yok)
async function transcribeClip(clip, progressStart, progressEnd) {
  const sourceLang = document.getElementById('sourceLanguage').value;

  const midPoint = progressStart + Math.round((progressEnd - progressStart) * 0.3);

  setProgress(progressStart, `Ses çıkarılıyor... (${clip.name ? clip.name.substring(0, 20) : ''})`);
  const audioPath = await extractAudio(clip.mediaPath, clip.inPoint, clip.outPoint - clip.inPoint);

  try {
    setProgress(midPoint, 'Transkripsiyon yapılıyor... (Whisper API)');
    const whisperResult = await whisperTranscribe(audioPath, state.apiKey, sourceLang);

    if (!whisperResult.segments || whisperResult.segments.length === 0) {
      throw new Error('Transkripsiyon boş döndü. Klipte ses olduğundan emin olun.');
    }

    if (whisperResult.words && Array.isArray(whisperResult.words) && whisperResult.words.length > 0) {
      const enrichedWords = whisperResult.words.map(w => ({
        word:      w.word,
        start:     w.start,
        end:       w.end,
        srcStart:  clip.inPoint + w.start,   // ham medyada gercek pozisyon
        srcEnd:    clip.inPoint + w.end,
        mediaPath: clip.mediaPath,
        seqStart:  w.start,                  // single-clip default (batch override eder)
        seqEnd:    w.end
      }));
      state.words = state.words.concat(enrichedWords);
    }

    return whisperResult.segments.map(seg => ({
      start: seg.start,
      end:   seg.end,
      text:  seg.text.trim()
    }));
  } finally {
    if (fs) { try { fs.unlinkSync(audioPath); } catch (e) {} }
  }
}

// Tüm klipleri sırayla transkribe et, timestamp'ları kümülatif süreye göre offset'le
async function transcribeBatch(clips) {
  const allSegments = [];
  let cumulativeOffset = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const pStart = Math.round((i / clips.length) * 85);
    const pEnd   = Math.round(((i + 1) / clips.length) * 85);

    setProgress(pStart, `Klip ${i + 1}/${clips.length}: ${clip.name ? clip.name.substring(0, 25) : ''}`);

    const wordsBefore = state.words.length;

    try {
      const segments = await transcribeClip(clip, pStart, pEnd);
      segments.forEach(seg => {
        allSegments.push({
          start: seg.start + cumulativeOffset,
          end:   seg.end   + cumulativeOffset,
          text:  seg.text
        });
      });

      // Bu klipten gelen word'lere sequence pozisyonunu yaz (transcribeClip default'unu override et)
      for (let wi = wordsBefore; wi < state.words.length; wi++) {
        state.words[wi].seqStart = state.words[wi].start + cumulativeOffset;
        state.words[wi].seqEnd   = state.words[wi].end   + cumulativeOffset;
      }

      cumulativeOffset += clip.duration;
    } catch (err) {
      // Hatalı klibi atla, devam et — süreyi yine de say
      console.warn('Klip transkripsiyon hatası (' + clip.name + '):', err.message);
      cumulativeOffset += clip.duration;
    }
  }

  if (allSegments.length === 0) {
    throw new Error('Hiçbir klipten transkripsiyon alınamadı.');
  }

  return allSegments;
}

// Segment bitiş zamanlarını bir sonraki segment'in başlangıcıyla kırp — üst üste binmeyi engelle
function fixSegmentOverlaps(segments) {
  if (segments.length <= 1) return segments;
  return segments.map((seg, i) => {
    if (i < segments.length - 1 && seg.end > segments[i + 1].start) {
      return Object.assign({}, seg, { end: segments[i + 1].start });
    }
    return seg;
  }).filter(seg => seg.end > seg.start); // sıfır veya negatif süreli segmentleri at
}

// Segmentleri karakter sınırına göre böl (kelime sınırlarında, timestamp orantılı dağıtılır)
function splitSegmentsByCharLimit(segments, maxChars) {
  const result = [];

  for (const seg of segments) {
    if (seg.text.length <= maxChars) {
      result.push(seg);
      continue;
    }

    const words = seg.text.split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? current + ' ' + word : word;
      if (candidate.length <= maxChars) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // Kelime tek başına sınırı aşıyorsa olduğu gibi ekle
        current = word;
      }
    }
    if (current) lines.push(current);

    if (lines.length === 1) {
      result.push(seg);
      continue;
    }

    // Zaman damgalarını satır başına orantılı dağıt
    const segDur = seg.end - seg.start;
    const perLine = segDur / lines.length;
    lines.forEach((line, i) => {
      result.push({
        start: seg.start + i * perLine,
        end:   seg.start + (i + 1) * perLine,
        text:  line
      });
    });
  }

  return result;
}

// ── Ses Çıkarma (ffmpeg) ──────────────────────────────────────────────────────
function extractAudio(videoPath, startSec, durationSec) {
  return new Promise((resolve, reject) => {
    if (!cp || !fs || !os || !path) {
      reject(new Error('Node.js modülleri erişilemez.')); return;
    }

    const tmpDir    = os.tmpdir();
    const outFile   = path.join(tmpDir, 'talky_audio_' + Date.now() + '.mp3');

    const args = [
      '-ss', startSec.toFixed(3),
      '-i', videoPath,
      '-t', durationSec.toFixed(3),
      '-vn',            // video yok
      '-ar', '16000',   // 16kHz — Whisper için optimal
      '-ac', '1',       // mono
      '-b:a', '96k',    // bitrate
      '-f', 'mp3',
      '-y',             // üzerine yaz
      outFile
    ];

    cp.execFile(state.ffmpegPath, args, { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error('ffmpeg hatası: ' + (stderr || err.message)));
        return;
      }
      if (!fs.existsSync(outFile)) {
        reject(new Error('ffmpeg ses dosyası oluşturamadı.'));
        return;
      }
      resolve(outFile);
    });
  });
}

// ── Whisper API Transkripsiyon ────────────────────────────────────────────────
function whisperTranscribe(audioFilePath, apiKey, language) {
  return new Promise((resolve, reject) => {
    if (!fs || !https || !path) {
      reject(new Error('Node.js modülleri erişilemez.')); return;
    }

    const boundary = 'TalkyBoundary' + Date.now();
    const fileName  = path.basename(audioFilePath);

    let fileBuffer;
    try {
      fileBuffer = fs.readFileSync(audioFilePath);
    } catch (e) {
      reject(new Error('Ses dosyası okunamadı: ' + e.message)); return;
    }

    // Multipart form-data gövdesi oluştur
    const parts = [];

    // Dosya alanı
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: audio/mpeg\r\n\r\n`
    ));
    parts.push(fileBuffer);
    parts.push(Buffer.from('\r\n'));

    // Model
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `whisper-1\r\n`
    ));

    // Dil (isteğe bağlı — boşsa Whisper otomatik tespit eder)
    if (language) {
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n` +
        `${language}\r\n`
      ));
    }

    // Yanıt formatı
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `verbose_json\r\n`
    ));

    // Zaman damgası hassasiyeti
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
      `segment\r\n`
    ));

    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
      `word\r\n`
    ));

    // Kapanış
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/audio/transcriptions',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      },
      timeout: 120000
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          let errMsg = `Whisper API Hatası (${res.statusCode})`;
          try {
            const errObj = JSON.parse(raw);
            errMsg += ': ' + (errObj.error && errObj.error.message || raw);
          } catch (e) { errMsg += ': ' + raw; }
          reject(new Error(errMsg)); return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error('API yanıtı ayrıştırılamadı: ' + raw));
        }
      });
    });

    req.on('error', (e) => reject(new Error('Ağ hatası: ' + e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('API isteği zaman aşımına uğradı.')); });

    req.write(body);
    req.end();
  });
}

// ── GPT Çeviri ────────────────────────────────────────────────────────────────
function translateSegments(segments, targetLang, apiKey) {
  return new Promise((resolve, reject) => {
    if (!https) { reject(new Error('Node.js https modülü erişilemez.')); return; }

    const langNames = {
      tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', fr: 'Fransızca',
      es: 'İspanyolca', it: 'İtalyanca', ru: 'Rusça', ar: 'Arapça',
      ja: 'Japonca', ko: 'Korece', zh: 'Çince (Basitleştirilmiş)',
      pt: 'Portekizce', nl: 'Hollandaca', pl: 'Lehçe', uk: 'Ukraynaca'
    };
    const langName = langNames[targetLang] || targetLang;

    // Tüm segmentleri tek istekte çevir (maliyet ve hız için optimal)
    const textBlock = segments.map(s => s.text).join('\n---\n');

    const bodyObj = {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Sen profesyonel bir altyazı çevirmensisin. Verilen metni ${langName} diline çevir.\n` +
                   `Kurallar:\n` +
                   `- Her satırı "---" ayıraçlarıyla ayrılmış şekilde aynı sırayla döndür\n` +
                   `- Ayıraçların sayısını ve sırasını koru\n` +
                   `- Altyazı doğallığını koru, kısa ve anlaşılır çevir\n` +
                   `- Sadece çeviriyi döndür, açıklama ekleme`
        },
        {
          role: 'user',
          content: textBlock
        }
      ],
      temperature: 0.2,
      max_tokens: Math.min(segments.length * 80, 4096)
    };

    const bodyStr = JSON.stringify(bodyObj);

    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          let errMsg = `GPT API Hatası (${res.statusCode})`;
          try {
            const e = JSON.parse(raw);
            errMsg += ': ' + (e.error && e.error.message || raw);
          } catch (ex) { errMsg += ': ' + raw; }
          reject(new Error(errMsg)); return;
        }
        try {
          const resp = JSON.parse(raw);
          const content = resp.choices[0].message.content;
          const lines = content.split('\n---\n').map(l => l.trim());
          resolve(lines);
        } catch (e) {
          reject(new Error('Çeviri yanıtı ayrıştırılamadı: ' + e.message));
        }
      });
    });

    req.on('error', (e) => reject(new Error('Çeviri ağ hatası: ' + e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Çeviri isteği zaman aşımına uğradı.')); });

    req.write(bodyStr);
    req.end();
  });
}

// ── OpenAI Chat Helper ────────────────────────────────────────────────────────
function callOpenAIChat(prompt, model, apiKey) {
  return new Promise((resolve, reject) => {
    if (!https) { reject(new Error('Node.js https modulu erisemiyor.')); return; }

    const requestBody = JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 4096,
      response_format: { type: 'json_object' }
    });

    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(requestBody)
      },
      timeout: 60000
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = JSON.parse(raw);
          if (parsed.error) {
            reject(new Error('OpenAI API: ' + parsed.error.message)); return;
          }
          if (!parsed.choices || !parsed.choices[0] || !parsed.choices[0].message) {
            reject(new Error('OpenAI API: gecersiz cevap formati')); return;
          }
          resolve(parsed.choices[0].message.content);
        } catch (e) {
          reject(new Error('OpenAI API parse hatasi: ' + e.message));
        }
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('OpenAI API zaman asimina ugradi.')); });
    req.write(requestBody);
    req.end();
  });
}

// ── SRT Üretimi ────────────────────────────────────────────────────────────────
async function getActiveSequenceName() {
  return new Promise((resolve) => {
    if (!csInterface) { resolve(''); return; }
    csInterface.evalScript(
      "(function(){ try { var s = app.project.activeSequence; return s ? s.name : ''; } catch(e) { return ''; } })()",
      function(result) { resolve(result || ''); }
    );
  });
}

function remapSegmentsForJumpCut(segments, speechIntervals) {
  let cumulative = 0;
  const enrichedIntervals = speechIntervals.map(iv => {
    const newStart = cumulative;
    const newEnd = cumulative + (iv.end - iv.start);
    cumulative = newEnd;
    return { start: iv.start, end: iv.end, newStart, newEnd };
  });

  function remapTime(originalSec) {
    for (const iv of enrichedIntervals) {
      if (originalSec >= iv.start && originalSec <= iv.end) {
        return iv.newStart + (originalSec - iv.start);
      }
    }
    for (const iv of enrichedIntervals) {
      if (originalSec < iv.start) return iv.newStart;
    }
    return cumulative;
  }

  return segments.map(seg => ({
    ...seg,
    start: remapTime(seg.start),
    end: remapTime(seg.end)
  }));
}

async function generateSRT(useTranslation) {
  let segments = state.segments;

  if (state.lastJumpCut && state.lastJumpCut.speechIntervals && state.lastJumpCut.speechIntervals.length > 0) {
    const activeName = await getActiveSequenceName();
    if (activeName === state.lastJumpCut.sequenceName) {
      console.log('Resyncing segments for Jump Cut sequence:', activeName);
      segments = remapSegmentsForJumpCut(state.segments, state.lastJumpCut.speechIntervals);
    } else {
      console.log('Active sequence is original, using original timing');
    }
  }

  return segments.map((seg, idx) => {
    const text = useTranslation && seg.translated ? seg.translated : seg.text;
    return `${idx + 1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${text.trim()}\n`;
  }).join('\n');
}

function srtTime(seconds) {
  const h  = Math.floor(seconds / 3600);
  const m  = Math.floor((seconds % 3600) / 60);
  const s  = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

// ── SRT Kaydet ────────────────────────────────────────────────────────────────
async function saveSRT() {
  if (!state.segments.length) { showError('Kaydedilecek transkripsiyon yok.'); return; }
  if (!fs || !path)           { showError('Dosya sistemi erişimi yok.'); return; }

  const useTranslation = document.querySelector('input[name="exportContent"]:checked').value === 'translated';
  const srtContent = await generateSRT(useTranslation);

  // Çıktı yolu: kaynak video ile aynı klasör (batch'de ilk klibin klasörü)
  const refClip = state.batchMode && state.batchClips.length > 0 ? state.batchClips[0] : state.clipInfo;
  const videoPath = refClip.mediaPath;
  const videoDir  = path.dirname(videoPath);
  const baseName  = state.batchMode
    ? (refClip.sequenceName || 'sekans')
    : path.basename(videoPath, path.extname(videoPath));
  const langSuffix = useTranslation
    ? '_' + document.getElementById('targetLanguage').value
    : '_' + (document.getElementById('sourceLanguage').value || 'tr');

  const srtPath = path.join(videoDir, baseName + langSuffix + '.srt');

  try {
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    showExportStatus('ok',
      `✓ SRT kaydedildi:\n${srtPath}\n\n` +
      `${state.segments.length} segment | ${secondsToHMS(state.segments[state.segments.length - 1].end)} süre`
    );
  } catch (e) {
    showExportStatus('err', 'Dosya kaydedilemedi: ' + e.message);
  }
}

// ── Premiere Pro'ya İçe Aktar ─────────────────────────────────────────────────
async function importToPremiere() {
  if (!state.segments.length)  { showError('İçe aktarılacak transkripsiyon yok.'); return; }
  if (!csInterface)            { showError('Premiere Pro bağlantısı yok.'); return; }
  if (!fs || !path || !os)     { showError('Dosya sistemi erişimi yok.'); return; }

  const useTranslation = document.querySelector('input[name="exportContent"]:checked').value === 'translated';
  const srtContent = await generateSRT(useTranslation);

  // Geçici SRT dosyası oluştur
  const tmpPath = path.join(os.tmpdir(), 'talky_import_' + Date.now() + '.srt');

  try {
    fs.writeFileSync(tmpPath, srtContent, 'utf8');
  } catch (e) {
    showExportStatus('err', 'Geçici dosya oluşturulamadı: ' + e.message);
    return;
  }

  // Platform'a göre yol formatını ayarla
  const ppPath = tmpPath.replace(/\\/g, '/');

  csInterface.evalScript(`importSRTToProject("${ppPath}")`, (result) => {
    try {
      const r = JSON.parse(result);
      if (r.success) {
        showExportStatus('ok',
          `✓ SRT Premiere Pro projesine eklendi!\n` +
          `Proje panelinde "${path.basename(tmpPath)}" dosyasını bulun.\n` +
          `Timeline'a sürükleyip altyazı olarak kullanabilirsiniz.`
        );
      } else {
        showExportStatus('err', 'İçe aktarma başarısız: ' + (r.message || 'Bilinmeyen hata'));
      }
    } catch (e) {
      showExportStatus('err', 'Yanıt ayrıştırılamadı: ' + result);
    }
  });
}

// ── Sonuçları Göster ──────────────────────────────────────────────────────────
function renderResults(hasTranslation) {
  const list = document.getElementById('segmentsList');
  list.innerHTML = '';

  state.segments.forEach((seg, idx) => {
    const div = document.createElement('div');
    div.className = 'segment-item';
    div.dataset.idx = idx;

    const text = state.showTranslation && seg.translated ? seg.translated : seg.text;

    div.innerHTML = `
      <div class="segment-time">${srtTime(seg.start)} → ${srtTime(seg.end)}</div>
      <div class="segment-text" contenteditable="true" spellcheck="false">${escapeHtml(text)}</div>
    `;

    // Düzenleme olayı: kullanıcı metni değiştirebilir
    div.querySelector('.segment-text').addEventListener('blur', (e) => {
      const newText = e.target.innerText.trim();
      if (state.showTranslation && seg.translated !== undefined) {
        state.segments[idx].translated = newText;
      } else {
        state.segments[idx].text = newText;
      }
    });

    list.appendChild(div);
  });

  // İstatistikler
  document.getElementById('segmentsCount').textContent =
    state.segments.length + ' segment';
  const lastEnd = state.segments[state.segments.length - 1].end;
  document.getElementById('totalDuration').textContent =
    'Toplam: ' + secondsToHMS(lastEnd);
}

function showView(view) {
  state.showTranslation = (view === 'translated');

  document.getElementById('btnShowOriginal').classList.toggle('active', !state.showTranslation);
  document.getElementById('btnShowTranslated').classList.toggle('active', state.showTranslation);

  renderResults(document.getElementById('translateEnabled').checked);
}

// ── Progress ──────────────────────────────────────────────────────────────────
function setProgress(percent, text) {
  document.getElementById('progressArea').classList.remove('hidden');
  document.getElementById('progressBar').style.width = percent + '%';
  document.getElementById('progressText').textContent = text;
}

function hideProgress() {
  document.getElementById('progressArea').classList.add('hidden');
}

// ── Hata Yönetimi ─────────────────────────────────────────────────────────────
function showError(msg) {
  const box = document.getElementById('errorBox');
  box.classList.remove('hidden');
  document.getElementById('errorText').textContent = msg;
}

function hideError() {
  document.getElementById('errorBox').classList.add('hidden');
}

// ── Export Durumu ──────────────────────────────────────────────────────────────
function showExportStatus(type, msg) {
  const el = document.getElementById('exportStatus');
  el.className = 'export-status ' + type;
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Buton Durumu ──────────────────────────────────────────────────────────────
function updateTranscribeButton() {
  const btn = document.getElementById('btnTranscribe');
  // ffmpegOK gerektirmiyoruz — ffmpeg yoksa dosyayı direkt Whisper'a göndeririz
  const ready = state.clipInfo && state.apiKey && !state.isProcessing;

  btn.disabled = !ready;
  document.getElementById('btnTranscribeText').textContent =
    state.isProcessing ? 'İşleniyor...' : 'Transkripsiyon Başlat';
}

// ── Yardımcı Fonksiyonlar ─────────────────────────────────────────────────────
function secondsToHMS(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Jump Cut handler
document.getElementById('jumpCutTestBtn').addEventListener('click', function() {
  if (!state.words || state.words.length === 0) {
    alert('Once transkripsiyon yapin. Word-level timestamps olmadan Jump Cut yapilamaz.');
    return;
  }

  const minSilenceSec = 0.3;
  const fillerCount = { count: 0 };

  // Sessizlikleri sequence pozisyonlarina gore tespit et
  const rawSilences = [];

  if (state.words[0].seqStart > minSilenceSec) {
    rawSilences.push({
      seqStart: 0,
      seqEnd: state.words[0].seqStart,
      duration: state.words[0].seqStart,
      type: 'silence'
    });
  }

  for (let i = 0; i < state.words.length - 1; i++) {
    const gap = state.words[i + 1].seqStart - state.words[i].seqEnd;
    if (gap > minSilenceSec) {
      rawSilences.push({
        seqStart: state.words[i].seqEnd,
        seqEnd:   state.words[i + 1].seqStart,
        duration: gap,
        type: 'silence'
      });
    }
  }

  // Filler kelimeleri tespit et — sessizlik gibi cikar
  for (let i = 0; i < state.words.length; i++) {
    const w = state.words[i];
    if (isFillerWord(w.word)) {
      rawSilences.push({
        seqStart: w.seqStart,
        seqEnd:   w.seqEnd,
        duration: w.seqEnd - w.seqStart,
        type: 'filler',
        text: w.word
      });
      fillerCount.count++;
    }
  }

  // Kronolojik siraya koy, ust uste binenleri birlestir
  rawSilences.sort((a, b) => a.seqStart - b.seqStart);

  const finalSilences = [];
  for (let i = 0; i < rawSilences.length; i++) {
    const last = finalSilences[finalSilences.length - 1];
    const curr = rawSilences[i];
    if (last && curr.seqStart <= last.seqEnd + 0.05) {
      last.seqEnd = Math.max(last.seqEnd, curr.seqEnd);
      last.duration = last.seqEnd - last.seqStart;
      last.type = 'merged';
    } else {
      finalSilences.push({ seqStart: curr.seqStart, seqEnd: curr.seqEnd, duration: curr.duration, type: curr.type, text: curr.text });
    }
  }

  console.log('Jump Cut:', rawSilences.length, 'sorunlu aralik (', fillerCount.count, 'filler dahil)');
  console.log('Birlestirilmis:', finalSilences.length, 'aralik');

  if (finalSilences.length === 0) {
    alert('Hic kesilecek aralik tespit edilmedi.');
    return;
  }

  const totalCut = finalSilences.reduce((sum, s) => sum + s.duration, 0);

  // Speech interval'lari seq pozisyonlarinda hesapla
  const speechIntervals = [];
  let cursor = 0;
  for (let i = 0; i < finalSilences.length; i++) {
    if (finalSilences[i].seqStart > cursor) {
      speechIntervals.push({ seqStart: cursor, seqEnd: finalSilences[i].seqStart });
    }
    cursor = finalSilences[i].seqEnd;
  }
  const lastWordSeqEnd = state.words[state.words.length - 1].seqEnd;
  if (cursor < lastWordSeqEnd) {
    speechIntervals.push({ seqStart: cursor, seqEnd: lastWordSeqEnd });
  }

  // Her speech interval'i ham medya pozisyonlarina cevir
  const enrichedIntervals = speechIntervals.map(iv => {
    const wordsInInterval = state.words.filter(w =>
      w.seqEnd >= iv.seqStart && w.seqStart <= iv.seqEnd
    );

    if (wordsInInterval.length === 0) return null;

    const firstMediaPath = wordsInInterval[0].mediaPath;
    const allSameMedia = wordsInInterval.every(w => w.mediaPath === firstMediaPath);
    if (!allSameMedia) {
      console.warn('Speech interval birden fazla medya kapsayor — desteklenmiyor', iv);
      return null;
    }

    const firstWord = wordsInInterval[0];
    const lastWord  = wordsInInterval[wordsInInterval.length - 1];
    const srcStart  = firstWord.srcStart - (firstWord.seqStart - iv.seqStart);
    const srcEnd    = lastWord.srcEnd    + (iv.seqEnd - lastWord.seqEnd);

    return { mediaPath: firstMediaPath, srcStart, srcEnd, duration: srcEnd - srcStart };
  }).filter(iv => iv !== null);

  console.log('Jump Cut: Enriched intervals (src-relative)', enrichedIntervals);

  if (enrichedIntervals.length === 0) {
    alert('Hicbir gecerli konusma araligi olusturulamadi.');
    return;
  }

  const confirmMsg = finalSilences.length + ' aralik tespit edildi (' +
                     fillerCount.count + ' filler + ' +
                     (finalSilences.length - fillerCount.count) + ' sessizlik)\n' +
                     'Toplam kesilecek: ' + totalCut.toFixed(2) + 'sn\n\n' +
                     enrichedIntervals.length + ' konusma araligi yapistirilacak.\n\n' +
                     'Yeni sekans olusturulsun mu?';

  if (!confirm(confirmMsg)) return;

  const paramsJSON = JSON.stringify({ enrichedIntervals: enrichedIntervals });
  const escapedJSON = paramsJSON.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  csInterface.evalScript("applyJumpCutsFromIntervalsV3('" + escapedJSON + "')", function(result) {
    console.log('Host returned:', result);
    try {
      const data = JSON.parse(result);
      if (data.ok) {
        state.lastJumpCut = {
          sequenceName: data.newSequenceName,
          speechIntervals: speechIntervals.map(iv => ({ start: iv.seqStart, end: iv.seqEnd }))
        };
        console.log('Saved lastJumpCut for resync:', state.lastJumpCut);
        alert('Yeni sekans olusturuldu: ' + data.newSequenceName + '\n' +
              'Yapistirilan segment sayisi: ' + data.segmentsPlaced);
      } else {
        alert('Hata: ' + data.message);
      }
    } catch (e) {
      alert('Parse hatasi: ' + result);
    }
  });
});

// ── AI Viral Analiz Handler ───────────────────────────────────────────────────
document.getElementById('viralAnalyzeBtn').addEventListener('click', async function() {
  if (!state.segments || state.segments.length === 0) {
    alert('Once transkripsiyon yapin.');
    return;
  }
  if (!state.apiKey) {
    alert('OpenAI API anahtari girilmedi. Ayarlardan ekleyin.');
    return;
  }

  const targetCount = 5;
  const minDuration = 20;
  const maxDuration = 60;
  const model = 'gpt-4o-mini';

  const transcriptText = state.segments.map(seg => {
    return '[' + seg.start.toFixed(2) + 's-' + seg.end.toFixed(2) + 's] ' + seg.text;
  }).join('\n');

  console.log('Viral Analysis: ' + state.segments.length + ' segment, ' +
              transcriptText.length + ' karakter');

  const prompt = VIRAL_ANALYSIS_PROMPT
    .replace('{COUNT}', targetCount)
    .replace('{MIN_DUR}', minDuration)
    .replace('{MAX_DUR}', maxDuration)
    .replace('{TRANSCRIPT}', transcriptText);

  const btn = document.getElementById('viralAnalyzeBtn');
  const originalText = btn.textContent;
  btn.textContent = 'AI dusunuyor... (10-30sn)';
  btn.disabled = true;

  try {
    const startTime = Date.now();
    const response = await callOpenAIChat(prompt, model, state.apiKey);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('Viral Analysis: Cevap alindi (' + elapsed + 'sn)');
    console.log('Raw response:', response);

    let parsed;
    try {
      const cleaned = response.replace(/^```(json)?\s*/i, '').replace(/\s*```$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse hatasi:', parseErr);
      alert('AI cevabi JSON formatinda degil. Console kontrol edin.\n\n' + response.substring(0, 200));
      return;
    }

    if (!parsed.shorts || !Array.isArray(parsed.shorts) || parsed.shorts.length === 0) {
      alert('AI gecerli viral aday bulamadi. Console kontrol edin.');
      console.log('Parsed but no shorts:', parsed);
      return;
    }

    state.viralCandidates = parsed.shorts;

    console.log('=== VIRAL CANDIDATES ===');
    parsed.shorts.forEach((s, i) => {
      console.log((i + 1) + '. [' + s.startSec + '-' + s.endSec + 's] ' + s.title);
      console.log('   Hook: ' + s.hook);
      console.log('   Reason: ' + s.reasoning);
      if (s.tags) console.log('   Tags: ' + s.tags.join(', '));
    });

    let summary = parsed.shorts.length + ' viral aday tespit edildi (' + elapsed + 'sn)\n\n';
    parsed.shorts.forEach((s, i) => {
      const dur = (s.endSec - s.startSec).toFixed(1);
      summary += (i + 1) + '. ' + s.title + ' (' + dur + 'sn)\n';
    });
    summary += '\nDetaylar console\'da.';
    alert(summary);

  } catch (err) {
    console.error('Viral Analysis hatasi:', err);
    alert('Hata: ' + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});
