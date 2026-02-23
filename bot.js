const fs = require("fs");

const studioId = "51358686";
const LIMIT = 40;
const DAY = 24 * 60 * 60 * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function safeFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
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

    for (const c of comments) {
      if (now - new Date(c.datetime_created).getTime() > DAY) {
        stop = true;
        break;
      }

      totalComments++;
      const u = c.author.username;
      commentUsers.set(u, (commentUsers.get(u) || 0) + 1);

      if (c.reply_count > 0) {
        const replies = await safeFetch(
          `https://api.scratch.mit.edu/studios/${studioId}/comments/${c.id}/replies?offset=0&limit=40`
        );
        if (!replies) continue;

        for (const r of replies) {
          totalReplies++;
          const ru = r.author.username;
          replyUsers.set(ru, (replyUsers.get(ru) || 0) + 1);
        }
      }
    }

    offset += LIMIT;
    await sleep(200);
  }

  const users = new Set([...commentUsers.keys(), ...replyUsers.keys()]);
  const ranking = [...users]
    .map(name => {
      const c = commentUsers.get(name) || 0;
      const r = replyUsers.get(name) || 0;
      return { name, comments: c, replies: r, total: c + r };
    })
    .sort((a, b) => b.total - a.total);

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
  const namesOnly = ranking.map(u => u.name).join("\n");
  fs.writeFileSync("username.txt", namesOnly);
})();
