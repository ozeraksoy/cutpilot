/**
 * Talky - Premiere Pro ExtendScript Host
 * Premiere Pro API erişimi için tüm host tarafı fonksiyonlar burada.
 */

/**
 * Oynatma kafasının altındaki aktif klibi döndürür.
 * Birden fazla video track varsa en üstteki (en yüksek indeksli) klip seçilir.
 */
function getActiveClipInfo() {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return JSON.stringify({ error: 'Aktif sekans bulunamadı. Lütfen bir sekans açın.' });
    }

    var playerPos = sequence.getPlayerPosition();
    var videoTracks = sequence.videoTracks;
    var foundClip = null;
    var foundTrackIndex = -1;

    // En üstten (yüksek indeks) alta doğru tara - üstteki klip öncelikli
    for (var i = videoTracks.numTracks - 1; i >= 0; i--) {
      var track = videoTracks[i];
      var clips = track.clips;

      for (var j = 0; j < clips.numItems; j++) {
        var clip = clips[j];

        // Playhead bu klibin içinde mi?
        if (clip.start.seconds <= playerPos.seconds &&
            clip.end.seconds > playerPos.seconds) {

          var mediaPath = '';
          try {
            mediaPath = clip.projectItem.getMediaPath();
          } catch (e) {
            mediaPath = '';
          }

          // Sadece gerçek medya dosyaları (boş path = title/adjustment layer)
          if (mediaPath && mediaPath.length > 0) {
            foundClip = clip;
            foundTrackIndex = i;
            break;
          }
        }
      }
      if (foundClip) break;
    }

    if (!foundClip) {
      return JSON.stringify({
        error: 'Oynatma kafası konumunda video klip bulunamadı.\n\nLütfen:\n1. Sekansda bir video klibin üzerine gidin\n2. Veya klibi seçip butona basın'
      });
    }

    var result = {
      name: foundClip.name,
      mediaPath: foundClip.projectItem.getMediaPath(),
      inPoint: foundClip.inPoint.seconds,
      outPoint: foundClip.outPoint.seconds,
      startOnTimeline: foundClip.start.seconds,
      endOnTimeline: foundClip.end.seconds,
      duration: foundClip.duration.seconds,
      trackIndex: foundTrackIndex,
      sequenceName: sequence.name,
      projectPath: app.project.path
    };

    return JSON.stringify(result);

  } catch (e) {
    return JSON.stringify({ error: 'Hata: ' + e.toString() });
  }
}

/**
 * Seçili klibi döndürür (eğer timeline'da seçili bir klip varsa).
 */
function getSelectedClipInfo() {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return JSON.stringify({ error: 'Aktif sekans bulunamadı.' });
    }

    var videoTracks = sequence.videoTracks;
    for (var i = videoTracks.numTracks - 1; i >= 0; i--) {
      var track = videoTracks[i];
      var clips = track.clips;
      for (var j = 0; j < clips.numItems; j++) {
        var clip = clips[j];
        if (clip.isSelected()) {
          var mediaPath = '';
          try {
            mediaPath = clip.projectItem.getMediaPath();
          } catch (e) {}

          if (mediaPath) {
            return JSON.stringify({
              name: clip.name,
              mediaPath: mediaPath,
              inPoint: clip.inPoint.seconds,
              outPoint: clip.outPoint.seconds,
              startOnTimeline: clip.start.seconds,
              endOnTimeline: clip.end.seconds,
              duration: clip.duration.seconds,
              trackIndex: i,
              sequenceName: sequence.name,
              projectPath: app.project.path
            });
          }
        }
      }
    }

    return JSON.stringify({ error: 'Seçili klip bulunamadı.' });
  } catch (e) {
    return JSON.stringify({ error: 'Hata: ' + e.toString() });
  }
}

/**
 * Aktif sekandaki tüm video kliplerini döndürür (timeline sırasıyla).
 */
function getAllClipsInSequence() {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return JSON.stringify({ error: 'Aktif sekans bulunamadı. Lütfen bir sekans açın.' });
    }

    var clips = [];
    var videoTracks = sequence.videoTracks;

    // Sadece en alt dolu track'i işle (V1 = ana konuşma içeriği).
    // B-roll, title ve overlay'ler üst track'lerde olduğundan onları atla.
    var primaryTrack = null;
    for (var i = 0; i < videoTracks.numTracks; i++) {
      var t = videoTracks[i];
      for (var k = 0; k < t.clips.numItems; k++) {
        var mp = '';
        try { mp = t.clips[k].projectItem.getMediaPath(); } catch (e) {}
        if (mp) { primaryTrack = t; break; }
      }
      if (primaryTrack) break;
    }

    if (!primaryTrack) {
      return JSON.stringify({ error: 'Sekansda video klip bulunamadı.' });
    }

    for (var j = 0; j < primaryTrack.clips.numItems; j++) {
      var clip = primaryTrack.clips[j];
      var mediaPath = '';
      try { mediaPath = clip.projectItem.getMediaPath(); } catch (e) {}
      if (!mediaPath) continue;

      clips.push({
        name: clip.name,
        mediaPath: mediaPath,
        inPoint: clip.inPoint.seconds,
        outPoint: clip.outPoint.seconds,
        startOnTimeline: clip.start.seconds,
        endOnTimeline: clip.end.seconds,
        duration: clip.duration.seconds,
        sequenceName: sequence.name,
        projectPath: app.project.path
      });
    }

    if (clips.length === 0) {
      return JSON.stringify({ error: 'Sekansda video klip bulunamadı.' });
    }

    // Timeline pozisyonuna göre sırala
    clips.sort(function (a, b) { return a.startOnTimeline - b.startOnTimeline; });

    return JSON.stringify({
      clips: clips,
      sequenceName: sequence.name
    });

  } catch (e) {
    return JSON.stringify({ error: 'Hata: ' + e.toString() });
  }
}

/**
 * SRT dosyasını Premiere Pro projesine içe aktarır.
 * @param {string} srtPath - SRT dosyasının tam yolu
 */
function importSRTToProject(srtPath) {
  try {
    var result = app.project.importFiles([srtPath], true, app.project.rootItem, false);
    if (result) {
      return JSON.stringify({ success: true, message: 'SRT dosyası projeye eklendi.' });
    } else {
      return JSON.stringify({ success: false, message: 'İçe aktarma başarısız oldu.' });
    }
  } catch (e) {
    return JSON.stringify({ success: false, message: 'Hata: ' + e.toString() });
  }
}

/**
 * Sekans ve proje bilgilerini döndürür.
 */
function getProjectInfo() {
  try {
    var sequence = app.project.activeSequence;
    if (!sequence) {
      return JSON.stringify({ error: 'Aktif sekans bulunamadı.' });
    }

    return JSON.stringify({
      sequenceName: sequence.name,
      projectName: app.project.name,
      projectPath: app.project.path,
      sequenceDuration: sequence.end.seconds
    });
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

/**
 * Premiere Pro tema bilgisini döndürür (aydınlık/karanlık mod).
 */
function getThemeInfo() {
  try {
    var skinInfo = app.document ? app.document.host : null;
    return JSON.stringify({ isDark: true }); // PP her zaman dark
  } catch (e) {
    return JSON.stringify({ isDark: true });
  }
}

function applyJumpCutsFromIntervalsV2(paramsJSON) {
  try {
    var params = JSON.parse(paramsJSON);
    var intervals = params.speechIntervals;

    if (!intervals || intervals.length === 0) {
      return JSON.stringify({ ok: false, message: 'Konusma araligi yok' });
    }

    var srcSeq = app.project.activeSequence;
    if (!srcSeq) {
      return JSON.stringify({ ok: false, message: 'Aktif sekans bulunamadi' });
    }

    if (srcSeq.videoTracks.numTracks === 0) {
      return JSON.stringify({ ok: false, message: 'Video track yok' });
    }

    var srcV1 = srcSeq.videoTracks[0];
    if (srcV1.clips.numItems === 0) {
      return JSON.stringify({ ok: false, message: 'V1 track bos' });
    }

    var srcClip = srcV1.clips[0];
    var srcProjItem = srcClip.projectItem;
    if (!srcProjItem) {
      return JSON.stringify({ ok: false, message: 'Kaynak klip projectItem yok' });
    }

    if (typeof srcProjItem.getMediaPath !== 'function') {
      return JSON.stringify({ ok: false, message: 'getMediaPath desteklenmiyor' });
    }
    var mediaPath = srcProjItem.getMediaPath();
    if (!mediaPath) {
      return JSON.stringify({ ok: false, message: 'Medya path bulunamadi' });
    }

    // Medyayi yeniden import et (orijinalden bagimsiz yeni projectItem)
    var importOk = app.project.importFiles([mediaPath], false, app.project.rootItem, false);
    if (!importOk) {
      return JSON.stringify({ ok: false, message: 'Medya yeniden import edilemedi' });
    }

    // Yeni eklenen projectItem'i bul
    var newProjItem = findMostRecentImport(mediaPath, srcProjItem);
    if (!newProjItem) {
      return JSON.stringify({ ok: false, message: 'Yeniden import edilen projectItem bulunamadi' });
    }

    // Guvenlik kapisi: ayni obje mi?
    if (newProjItem === srcProjItem) {
      return JSON.stringify({ ok: false, message: 'Re-import basarisiz - ayni projectItem dondu, orijinali bozmamak icin durduruluyor' });
    }

    // Yeni sekans olustur
    var srcSettings = srcSeq.getSettings();
    var timestamp = new Date().getTime();
    var newSeqName = 'TalkyClip_' + timestamp;

    var newSeq = app.project.createNewSequence(newSeqName, '');
    if (!newSeq) {
      return JSON.stringify({ ok: false, message: 'Yeni sekans olusturulamadi' });
    }

    try {
      newSeq.setSettings(srcSettings);
    } catch (settingsErr) {
      // Kritik degil, varsayilan ayarlarla devam
    }

    var newV1 = newSeq.videoTracks[0];
    if (!newV1) {
      return JSON.stringify({ ok: false, message: 'Yeni sekans V1 track yok' });
    }

    // Konusma araliklarini sirayla yapistir
    var TICKS_PER_SEC = 254016000000;
    var insertionTicks = 0;
    var inT = new Time();
    var outT = new Time();
    var insertionTime = new Time();
    var placed = 0;

    for (var i = 0; i < intervals.length; i++) {
      var startSec = intervals[i].start;
      var endSec = intervals[i].end;
      var durSec = endSec - startSec;

      if (durSec <= 0) continue;

      inT.ticks = Math.round(startSec * TICKS_PER_SEC).toString();
      outT.ticks = Math.round(endSec * TICKS_PER_SEC).toString();

      newProjItem.setInPoint(inT, 4);
      newProjItem.setOutPoint(outT, 4);

      insertionTime.ticks = insertionTicks.toString();
      newV1.overwriteClip(newProjItem, insertionTime);

      // Gercekte yapisan klibin end ticks'ini al — frame rounding gap'lerini onler
      var clipsCount = newV1.clips.numItems;
      if (clipsCount > 0) {
        var lastClip = newV1.clips[clipsCount - 1];
        if (lastClip && lastClip.end && lastClip.end.ticks) {
          insertionTicks = parseInt(lastClip.end.ticks, 10);
        } else {
          insertionTicks = insertionTicks + Math.round(durSec * TICKS_PER_SEC);
        }
      } else {
        insertionTicks = insertionTicks + Math.round(durSec * TICKS_PER_SEC);
      }

      placed = placed + 1;
    }

    // Yeni projectItem'in in/out'unu sifirla
    try {
      var resetIn = new Time();
      resetIn.ticks = '0';
      newProjItem.setInPoint(resetIn, 4);
      var resetOut = new Time();
      resetOut.ticks = (TICKS_PER_SEC * 99999).toString();
      newProjItem.setOutPoint(resetOut, 4);
    } catch (resetErr) {
      // Kritik degil
    }

    return JSON.stringify({
      ok: true,
      newSequenceName: newSeqName,
      segmentsPlaced: placed
    });

  } catch (e) {
    return JSON.stringify({ ok: false, message: 'Hata: ' + e.toString() });
  }
}

function countAllProjectItems(folder) {
  var count = 0;
  if (!folder || !folder.children) return 0;
  for (var i = 0; i < folder.children.numItems; i++) {
    var child = folder.children[i];
    count = count + 1;
    if (child.type === 2) {
      count = count + countAllProjectItems(child);
    }
  }
  return count;
}

function findMostRecentImport(mediaPath, excludeItem) {
  return findItemRecursive(app.project.rootItem, mediaPath, excludeItem);
}

function findItemRecursive(folder, mediaPath, excludeItem) {
  if (!folder || !folder.children) return null;
  // Sondan basa dogru ara — yeni eklenen sona ekleniyor
  for (var i = folder.children.numItems - 1; i >= 0; i--) {
    var child = folder.children[i];
    if (child === excludeItem) continue;
    if (typeof child.getMediaPath === 'function') {
      var p = child.getMediaPath();
      if (p === mediaPath) return child;
    }
    if (child.type === 2) {
      var found = findItemRecursive(child, mediaPath, excludeItem);
      if (found) return found;
    }
  }
  return null;
}

function jumpCutTest() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) {
      return JSON.stringify({ ok: false, message: 'Aktif sekans bulunamadi' });
    }

    var seqName = seq.name;

    if (seq.videoTracks.numTracks === 0) {
      return JSON.stringify({ ok: false, message: 'Hic video track yok' });
    }

    var v1 = seq.videoTracks[0];
    var clipCount = v1.clips.numItems;

    if (clipCount === 0) {
      return JSON.stringify({
        ok: true,
        sequenceName: seqName,
        clipCount: 0,
        firstClipName: null,
        message: 'V1 track bos'
      });
    }

    var firstClip = v1.clips[0];
    var firstName = firstClip.name;

    return JSON.stringify({
      ok: true,
      sequenceName: seqName,
      clipCount: clipCount,
      firstClipName: firstName,
      message: 'OK'
    });
  } catch (e) {
    return JSON.stringify({ ok: false, message: 'Hata: ' + e.toString() });
  }
}
