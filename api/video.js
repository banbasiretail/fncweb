// Landing page + link preview for a shared video: https://news.scoolg.com/video/<id>
//
// Two audiences hit this URL, and only one of them is a person:
//
//  1. Chat-app crawlers (WhatsApp, Telegram, iMessage, Twitter/X, Slack,
//     Facebook, Discord). They fetch the URL, read the <meta> tags below, and
//     draw the preview card — the thumbnail with a play button over it. They do
//     NOT run JavaScript, so every tag has to be in the HTML we return here.
//  2. A person who tapped the card without the app installed. They get the page
//     body: thumbnail, play button, and store buttons.
//
// A person *with* the app installed never reaches this function at all — the
// OS matches the URL against the App Links / Universal Links association and
// hands it straight to the app.

const APP_NAME = 'FREE NEWS CLUB';
const SITE_URL = 'https://news.scoolg.com';
const ANDROID_PACKAGE = 'com.news.fnc';
const IOS_APP_STORE_ID = '0000000000'; // Keep in sync with ShareService.iosAppStoreId.

const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
const APP_STORE_URL = `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`;

// YouTube ids are exactly 11 chars of [A-Za-z0-9_-]. Anything else is not one
// of ours, and letting it through would reflect attacker-controlled text into
// the page and into outbound requests.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const OEMBED_TIMEOUT_MS = 2500;

export default async function handler(request, response) {
  const id = readVideoId(request);

  if (!id) {
    response.setHeader('Location', '/videos');
    return response.status(307).end();
  }

  const meta = await fetchVideoMeta(id);

  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Crawlers re-fetch often and titles rarely change. Cache at the edge for an
  // hour, and keep serving the stale copy for a day while it revalidates, so a
  // slow YouTube response never delays a preview.
  response.setHeader(
    'Cache-Control',
    'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
  );
  return response.status(200).send(renderPage(id, meta));
}

/// The video id from `/video/<id>`, or from `?v=` / `?id=` for the older link
/// shape ShareService.videoIdFromLink still accepts. Null when it is not a
/// well-formed YouTube id.
function readVideoId(request) {
  const query = request.query ?? {};
  const fromQuery = query.id ?? query.v;

  // Vercel's rewrite passes the path segment as `id`; arrays happen when a
  // param is repeated in the query string.
  const raw = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  return VIDEO_ID.test(trimmed) ? trimmed : null;
}

/// Title and channel from YouTube's oEmbed endpoint, which needs no API key
/// and no quota. Falls back to a generic title — a preview card with the right
/// image and a plain title is far better than no card at all.
async function fetchVideoMeta(id) {
  const fallback = { title: `Watch this on ${APP_NAME}`, author: APP_NAME };

  try {
    const target =
      'https://www.youtube.com/oembed?format=json&url=' +
      encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);

    const result = await fetch(target, {
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
    });
    if (!result.ok) return fallback;

    const data = await result.json();
    return {
      title: typeof data.title === 'string' && data.title ? data.title : fallback.title,
      author:
        typeof data.author_name === 'string' && data.author_name
          ? data.author_name
          : fallback.author,
    };
  } catch {
    // Unlisted/removed video, oEmbed outage, or timeout.
    return fallback;
  }
}

/// Highest-resolution thumbnail YouTube publishes for every video.
///
/// `maxresdefault` is not generated for all uploads, so it is only used as the
/// in-page <img> (which can fall back client-side on error). The meta tag uses
/// `hqdefault`, which always exists — a crawler that 404s on og:image draws no
/// card at all, and it only gets one attempt.
const thumbnail = (id, name) => `https://i.ytimg.com/vi/${id}/${name}.jpg`;

function renderPage(id, meta) {
  const canonical = `${SITE_URL}/video/${id}`;
  const previewImage = thumbnail(id, 'hqdefault');
  const embedUrl = `https://www.youtube.com/embed/${id}`;

  const title = esc(meta.title);
  const description = esc(`${meta.author} · Watch free live news on ${APP_NAME}.`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ${APP_NAME}</title>
<link rel="canonical" href="${canonical}">

<!-- Open Graph. og:type=video.other plus the og:video:* tags are what make
     WhatsApp, Telegram and iMessage overlay a play button on the thumbnail
     rather than showing it as a flat image. Dropping them downgrades the card
     to a plain link. -->
<meta property="og:site_name" content="${APP_NAME}">
<meta property="og:type" content="video.other">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${previewImage}">
<meta property="og:image:secure_url" content="${previewImage}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="480">
<meta property="og:image:height" content="360">
<meta property="og:image:alt" content="${title}">
<meta property="og:video" content="${embedUrl}">
<meta property="og:video:secure_url" content="${embedUrl}">
<meta property="og:video:type" content="text/html">
<meta property="og:video:width" content="1280">
<meta property="og:video:height" content="720">

<!-- Twitter/X reads its own namespace. player cards render inline with a play
     button; without them X falls back to summary_large_image. -->
<meta name="twitter:card" content="player">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${previewImage}">
<meta name="twitter:player" content="${embedUrl}">
<meta name="twitter:player:width" content="1280">
<meta name="twitter:player:height" content="720">

<!-- Lets Android Chrome offer "open in app" for visitors who have it. -->
<meta name="google-play-app" content="app-id=${ANDROID_PACKAGE}">
<meta name="apple-itunes-app" content="app-id=${IOS_APP_STORE_ID}, app-argument=${canonical}">

<style>
  :root{
    --navy:#062565;
    --navy-deep:#04173f;
    --gold:#FFCA0A;
    --white:#ffffff;
    --muted:rgba(255,255,255,0.66);
    --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{
    font-family:var(--sans);
    background:var(--navy);
    color:var(--white);
    min-height:100svh;
    display:flex;
    align-items:center;
    justify-content:center;
    padding:24px;
  }
  .card{width:100%;max-width:460px;text-align:center;}
  .poster{
    position:relative;
    display:block;
    border-radius:14px;
    overflow:hidden;
    background:var(--navy-deep);
    aspect-ratio:16/9;
    text-decoration:none;
  }
  .poster img{width:100%;height:100%;object-fit:cover;display:block;}
  .play{
    position:absolute;
    inset:0;
    display:flex;
    align-items:center;
    justify-content:center;
    background:rgba(4,23,63,0.28);
  }
  .play span{
    width:66px;
    height:66px;
    border-radius:50%;
    background:var(--gold);
    display:flex;
    align-items:center;
    justify-content:center;
    box-shadow:0 6px 22px rgba(0,0,0,0.35);
  }
  .play svg{margin-left:4px;}
  h1{font-size:1.15rem;line-height:1.4;margin:20px 0 6px;}
  p.channel{color:var(--muted);font-size:0.86rem;margin:0 0 22px;}
  .actions{display:flex;flex-direction:column;gap:10px;}
  a.btn{
    display:block;
    padding:14px 18px;
    border-radius:11px;
    font-weight:600;
    font-size:0.95rem;
    text-decoration:none;
  }
  a.primary{background:var(--gold);color:var(--navy-deep);}
  a.secondary{
    background:transparent;
    color:var(--white);
    border:1px solid rgba(255,255,255,0.24);
  }
</style>
</head>
<body>
  <main class="card">
    <a class="poster" href="${canonical}" id="open">
      <img src="${thumbnail(id, 'maxresdefault')}" alt="${title}"
           onerror="this.onerror=null;this.src='${previewImage}';">
      <span class="play" aria-hidden="true">
        <span>
          <svg width="24" height="26" viewBox="0 0 24 26" fill="#04173f">
            <path d="M2 1.6a1.2 1.2 0 0 1 1.83-1.02l18.4 11.4a1.2 1.2 0 0 1 0 2.04L3.83 25.42A1.2 1.2 0 0 1 2 24.4V1.6Z"/>
          </svg>
        </span>
      </span>
    </a>

    <h1>${title}</h1>
    <p class="channel">${esc(meta.author)}</p>

    <div class="actions">
      <a class="btn primary" id="store" href="${PLAY_STORE_URL}">Open in ${APP_NAME}</a>
      <a class="btn secondary" href="https://www.youtube.com/watch?v=${id}">Watch on YouTube</a>
    </div>
  </main>

<script>
  // Point the button at the right store. Everyone reaching this page is, by
  // definition, without the app — the OS would have intercepted the URL
  // otherwise — so there is no deep-link attempt to make here.
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) document.getElementById('store').href = ${JSON.stringify(APP_STORE_URL)};
  document.getElementById('open').href = document.getElementById('store').href;
</script>
</body>
</html>`;
}

/// Escapes text for use in both element content and double-quoted attributes.
/// Video titles are third-party strings and routinely contain & " ' < >.
function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
