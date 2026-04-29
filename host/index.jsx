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
