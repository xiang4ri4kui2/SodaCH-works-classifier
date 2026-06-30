import fs from 'node:fs/promises';
import fsSync from 'node:fs';

const CHANNELS_PATH =
  'data/channels.json';

const WORKS_MASTER_PATH =
  'data/worksMaster.json';

const ISSUE_BODY_PATH =
  'issue-body.md';

const YOUTUBE_API_BASE =
  'https://www.googleapis.com/youtube/v3';

async function readJson(path, fallback) {
  try {
    const text = await fs.readFile(path, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await fs.writeFile(
    path,
    JSON.stringify(data, null, 2) + '\n',
    'utf8'
  );
}

// ============================
// 日付ユーティリティ（JST基準）
// ============================

function todayYYYYMMDD_JST() {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;

  return `${get('year')}${get('month')}${get('day')}`;
}

// yyyyMMdd（JSTの日付）→ その日0:00 JST に相当する UTC ISO文字列
function yyyymmddToUtcIso(yyyymmdd) {
  const m = String(yyyymmdd).match(/^(\d{4})(\d{2})(\d{2})$/);

  if (!m) {
    return null;
  }

  const [, y, mo, d] = m;

  const utcDate = new Date(
    Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      -9, // JST 0:00 = UTC前日15:00
      0
    )
  );

  return utcDate.toISOString();
}

// ============================
// YouTube API
// ============================

async function getUploadsPlaylistId(channelId, apiKey) {
  const url =
    `${YOUTUBE_API_BASE}/channels` +
    `?part=contentDetails` +
    `&id=${encodeURIComponent(channelId)}` +
    `&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `channels APIエラー: HTTP ${response.status} ${JSON.stringify(data)}`
    );
  }

  if (!data.items || data.items.length === 0) {
    throw new Error('チャンネルが見つかりません。channelIdを確認してください。');
  }

  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

// アップロード再生リストは「追加順＝新しい順」前提で、
// sinceIso より古い動画に到達した時点でページングを打ち切る。
async function getPlaylistVideosSince(playlistId, apiKey, sinceIso) {
  const videos = [];
  let pageToken = '';
  let reachedOld = false;

  do {
    let url =
      `${YOUTUBE_API_BASE}/playlistItems` +
      `?part=snippet` +
      `&playlistId=${encodeURIComponent(playlistId)}` +
      `&maxResults=50` +
      `&key=${encodeURIComponent(apiKey)}`;

    if (pageToken) {
      url += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `playlistItems APIエラー: HTTP ${response.status} ${JSON.stringify(data)}`
      );
    }

    for (const item of data.items || []) {
      const publishedAt = item.snippet?.publishedAt;
      const videoId = item.snippet?.resourceId?.videoId;

      if (!videoId || !publishedAt) {
        continue;
      }

      if (sinceIso && publishedAt < sinceIso) {
        reachedOld = true;
        break;
      }

      videos.push({ videoId, publishedAt });
    }

    pageToken = reachedOld ? '' : (data.nextPageToken || '');
  } while (pageToken);

  return videos;
}

async function getVideoDetails(videoIds, apiKey) {
  const result = {};
  const chunkSize = 50;

  for (let i = 0; i < videoIds.length; i += chunkSize) {
    const chunk = videoIds.slice(i, i + chunkSize);
    const ids = chunk.join(',');

    const url =
      `${YOUTUBE_API_BASE}/videos` +
      `?part=snippet` +
      `&id=${encodeURIComponent(ids)}` +
      `&fields=items(id,snippet(title,description,tags))` +
      `&key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `videos APIエラー: HTTP ${response.status} ${JSON.stringify(data)}`
      );
    }

    for (const item of data.items || []) {
      result[item.id] = {
        title: item.snippet?.title || '',
        description: item.snippet?.description || '',
        tags: item.snippet?.tags || []
      };
    }
  }

  return result;
}

// ============================
// 候補抽出・分類判定
// ============================

// title内の 【】（）() を抽出
function extractBracketStrings(title) {
  if (!title) {
    return [];
  }

  const matches = [
    ...title.matchAll(/[【(（]([^】)）]+)[】)）]/g)
  ];

  return matches
    .map(m => m[1].trim())
    .filter(s => s.length >= 2);
}

// 動画1件分の候補文字列（tags + title括弧内）を重複排除して返す
function buildCandidates(video) {
  const fromTags = video.tags || [];
  const fromTitle = extractBracketStrings(video.title);

  const merged = [...fromTags, ...fromTitle]
    .map(s => s.trim())
    .filter(s => s.length >= 2);

  return [...new Set(merged)];
}

// 既存 worksMaster.patterns のいずれかが
// title または tags 中に部分一致するか（= 分類済みか）
function isAlreadyClassified(video, worksMaster) {
  const works = worksMaster?.works || [];
  const caseSensitive =
    worksMaster?.defaultMatch?.caseSensitive ?? false;

  const haystack = (
    (video.title || '') + ' ' + (video.tags || []).join(' ')
  );

  const searchHaystack = caseSensitive
    ? haystack
    : haystack.toLowerCase();

  for (const work of works) {
    if (!work.patterns) {
      continue;
    }

    for (const pattern of work.patterns) {
      const searchPattern = caseSensitive
        ? pattern
        : pattern.toLowerCase();

      if (searchHaystack.includes(searchPattern)) {
        return true;
      }
    }
  }

  return false;
}

function getYouTubeVideoUrl(videoId) {
  return 'https://www.youtube.com/watch?v=' + videoId;
}

// 未分類動画を「候補文字列」単位でグルーピングする
function groupUnclassifiedVideos(unclassifiedVideos) {
  const groupMap = new Map();

  for (const video of unclassifiedVideos) {
    const candidates = buildCandidates(video);

    if (candidates.length === 0) {
      // 候補が一切無い動画は別枠で「候補なし」としてまとめる
      const key = '（候補抽出なし）';

      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }

      groupMap.get(key).push(video);
      continue;
    }

    for (const candidate of candidates) {
      if (!groupMap.has(candidate)) {
        groupMap.set(candidate, []);
      }

      groupMap.get(candidate).push(video);
    }
  }

  return [...groupMap.entries()]
    .map(([candidate, videos]) => ({ candidate, videos }))
    .sort((a, b) => b.videos.length - a.videos.length);
}

// ============================
// Issue本文生成
// ============================

function buildIssueBody(groups, periodStartLabel, periodEndLabel, totalCount) {
  const lines = [];

  lines.push(`## 未分類動画検出レポート（${periodEndLabel}）`);
  lines.push('');
  lines.push(`対象期間: ${periodStartLabel} 〜 ${periodEndLabel}`);
  lines.push(`未分類動画: ${totalCount}件 / 候補グループ: ${groups.length}件`);
  lines.push('');
  lines.push('---');

  for (const group of groups) {
    lines.push('');
    lines.push(`### 候補グループ: "${group.candidate}"`);
    lines.push('');
    lines.push(`該当動画 (${group.videos.length}件):`);

    for (const video of group.videos) {
      lines.push(`- ${video.title}`);
      lines.push(`  ${getYouTubeVideoUrl(video.videoId)}`);
    }

    lines.push('');
    lines.push('worksMaster.json への追記用JSON（id/name/category/urlは要確認・修正）:');
    lines.push('');
    lines.push('```json');

    const allCandidatesForGroup = [
      ...new Set(
        group.videos.flatMap(v => buildCandidates(v))
      )
    ];

    lines.push(
      JSON.stringify(
        {
          id: 'TODO_id_を入力',
          name: group.candidate,
          category: 'TODO',
          url: 'TODO',
          patterns: allCandidatesForGroup
        },
        null,
        2
      )
    );

    lines.push('```');
    lines.push('');
    lines.push('---');
  }

  return lines.join('\n');
}

// ============================
// GitHub Actions Output
// ============================

function setGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  fsSync.appendFileSync(outputPath, `${name}=${value}\n`);
}

// ============================
// main
// ============================

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY が設定されていません。');
  }

  const channels = await readJson(CHANNELS_PATH, []);

  if (channels.length === 0) {
    throw new Error('channels.json が空です。');
  }

  const channelId = channels[0].channelId;

  const worksMaster = await readJson(WORKS_MASTER_PATH, null);

  if (!worksMaster) {
    throw new Error('worksMaster.json が読み込めません。');
  }

  const today = todayYYYYMMDD_JST();

  const lastCheckedAt = worksMaster.lastCheckedAt || null;

  let sinceIso = null;

  if (lastCheckedAt) {
    sinceIso = yyyymmddToUtcIso(lastCheckedAt);
  } else {
    // 初回実行時：直近1日分のみを対象にする（全件スキャン回避）
    console.warn('lastCheckedAt が未設定のため、直近1日分のみを対象とします。');

    const fallback = new Date();
    fallback.setUTCDate(fallback.getUTCDate() - 1);
    sinceIso = fallback.toISOString();
  }

  console.log(`対象チャンネル: ${channelId}`);
  console.log(`チェック対象期間: ${sinceIso} 以降`);

  const uploadsPlaylistId = await getUploadsPlaylistId(channelId, apiKey);

  const baseVideos = await getPlaylistVideosSince(
    uploadsPlaylistId,
    apiKey,
    sinceIso
  );

  console.log(`差分動画件数: ${baseVideos.length}`);

  let unclassifiedVideos = [];

  if (baseVideos.length > 0) {
    const details = await getVideoDetails(
      baseVideos.map(v => v.videoId),
      apiKey
    );

    const enriched = baseVideos
      .map(v => ({
        videoId: v.videoId,
        publishedAt: v.publishedAt,
        title: details[v.videoId]?.title || '',
        description: details[v.videoId]?.description || '',
        tags: details[v.videoId]?.tags || []
      }))
      .filter(v => v.title); // 削除済み等で詳細取得できなかったものは除外

    unclassifiedVideos = enriched.filter(
      v => !isAlreadyClassified(v, worksMaster)
    );
  }

  console.log(`未分類動画件数: ${unclassifiedVideos.length}`);

  if (unclassifiedVideos.length > 0) {
    const groups = groupUnclassifiedVideos(unclassifiedVideos);

    const periodStartLabel = lastCheckedAt || '(初回)';

    const body = buildIssueBody(
      groups,
      periodStartLabel,
      today,
      unclassifiedVideos.length
    );

    await fs.writeFile(ISSUE_BODY_PATH, body, 'utf8');

    setGithubOutput('has_unclassified', 'true');
    setGithubOutput('issue_title', `未分類動画検出レポート（${today}）`);
  } else {
    setGithubOutput('has_unclassified', 'false');
  }

  // lastCheckedAt のみ更新（version・patterns等は一切変更しない）
  worksMaster.lastCheckedAt = today;

  await writeJson(WORKS_MASTER_PATH, worksMaster);

  console.log('worksMaster.json の lastCheckedAt を更新しました。');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
