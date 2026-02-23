(async () => {
  /* ===== 設定 ===== */
  const studioId = "51358686";
  const LIMIT = 40;
  const DAY = 360*24 * 60 * 60 * 1000;
  const PAGE_WAIT = 150;     // 速く
  const PARALLEL = 8;        // 並列増加
  const RETRY_WAIT = 1000;
  const MAX_429 = 5;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let err429 = 0;

  const safeFetch = async (url, opt = {}) => {
    try {
      const r = await fetch(url, opt);
      if (r.status === 429) {
        err429++;
        if (err429 >= MAX_429) {
          throw new Error("429連続");
        }
        await sleep(RETRY_WAIT);
        return safeFetch(url, opt);
      }
      err429 = 0;
      return r.json();
    } catch {
      return null;
    }
  };

  const parallelMap = async (arr, limit, fn) => {
    let i = 0;
    await Promise.all(
      Array(limit).fill(0).map(async () => {
        while (i < arr.length) {
          await fn(arr[i++]);
        }
      })
    );
  };

  /* ===== 集計 ===== */
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

    await parallelMap(replyTargets, PARALLEL, async id => {
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

  /* ===== ランキング生成 ===== */
  const users = new Set([...commentUsers.keys(), ...replyUsers.keys()]);
  const ranking = [...users].map(name => {
    const c = commentUsers.get(name) || 0;
    const r = replyUsers.get(name) || 0;
    return { name, comments: c, replies: r, total: c + r };
  }).sort((a, b) => b.total - a.total);

  /* ===== 出力まとめ（VM最小） ===== */
  let out = "";
  out += "==== 過去24時間の統計 ====\n";
  out += `コメント総数: ${totalComments}\n`;
  out += `返信総数: ${totalReplies}\n`;
  out += `コメントした人数: ${users.size}\n\n`;

  out += "==== 過去24時間 活動量ランキング（コメント＋返信） ====\n";
  ranking.forEach((u, i) => {
    out += `${i + 1}位 ${u.name} : 合計 ${u.total}（コメント ${u.comments} / 返信 ${u.replies}）\n`;
  });

  let namesOnly = ranking.map(u => u.name).join("\n");

  console.log(out);
  console.log("==== ユーザ名のみ（コピー用） ====\n" + namesOnly);
})();
