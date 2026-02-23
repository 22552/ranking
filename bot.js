// bot.js
const fs = require("fs");

const studioId = "51358686";
const LIMIT = 40;
const DAY = 24 * 60 * 60 * 1000;
const PAGE_WAIT = 120;     // ページ間ウェイト
const REPLY_PARALLEL = 6;  // 返信取得の並列上限
const RETRY_WAIT = 1000;
const MAX_429 = 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let err429 = 0;

async function safeFetch(url) {
  try {
    const r = await fetch(url);
    if (r.status === 429) {
      err429++;
      if (err429 >= MAX_429) throw new Error("429連続");
      await sleep(RETRY_WAIT);
      return safeFetch(url);
    }
    err429 = 0;
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
}

// 並列上限付き map
async function parallelMap(arr, limit, fn) {
  let i = 0;
  await Promise.all(
    Array(limit).fill(0).map(async () => {
      while (i < arr.length) {
        await fn(arr[i++]);
      }
    })
  );
}

(async () => {
  const commentUsers = new Map();
  const replyUsers = new Map();
  let totalComments = 0;
  let totalReplies = 0;

  let offset = 0;
  let stop = false;
  const now = Date.now();

  while (!stop) {
    const comments = await safeFetch(
      `https://api.scratch.mit.edu/studios/${studioId}/comments?offset=${offset}&limit=${LIMIT}`
    );

    if (!comments || comments.length === 0) break;

    const replyTargets = [];

    for (const c of comments) {
      if (now - new Date(c.datetime_created).getTime() > DAY) {
        stop = true;
        break;
      }

      totalComments++;
      const u = c.author.username;
      commentUsers.set(u, (commentUsers.get(u) || 0) + 1);

      if (c.reply_count > 0) replyTargets.push(c.id);
    }

    // 返信を並列取得
    await parallelMap(replyTargets, REPLY_PARALLEL, async (id) => {
      const replies = await safeFetch(
        `https://api.scratch.mit.edu/studios/${studioId}/comments/${id}/replies?offset=0&limit=40`
      );
      if (!replies) return;

      for (const r of replies) {
        totalReplies++;
        const ru = r.author.username;
        replyUsers.set(ru, (replyUsers.get(ru) || 0) + 1);
      }
    });

    offset += LIMIT;
    await sleep(PAGE_WAIT);
  }

  // ランキング生成
  const users = new Set([...commentUsers.keys(), ...replyUsers.keys()]);
  const ranking = [...users]
    .map(name => {
      const c = commentUsers.get(name) || 0;
      const r = replyUsers.get(name) || 0;
      return { name, comments: c, replies: r, total: c + r };
    })
    .sort((a, b) => b.total - a.total);

  // Markdown生成
  let md = `# 📊 スタジオ活動ランキング\n\n`;
  md += `対象: 過去24時間\n\n`;
  md += `- コメント総数: ${totalComments}\n`;
  md += `- 返信総数: ${totalReplies}\n`;
  md += `- 参加人数: ${users.size}\n\n`;
  md += `---\n\n`;

  ranking.forEach((u, i) => {
    md += `**${i + 1}位 ${u.name}**  \n`;
    md += `合計: ${u.total}（コメント ${u.comments} / 返信 ${u.replies}）\n\n`;
  });

  fs.writeFileSync("ranking.md", md);

  // username.txt
  const namesOnly = ranking.map(u => u.name).join("\n");
  fs.writeFileSync("username.txt", namesOnly);

  console.log("ranking.md / username.txt 更新完了");
})();
