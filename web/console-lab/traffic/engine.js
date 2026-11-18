/* Browser and Node tests share exactly the same dependency-free task engine. */
  const DAY = 86400000, MAX_BYTES = 2_000_000, MAX_ROWS = 20_000;
  const COLUMNS = ["date", "page", "channel", "sessions", "pageviews"];
  const TASKS = {
    summary: "Traffic brief", trend: "Compare weeks", pages: "Top landing pages",
    channels: "Acquisition channels", anomalies: "Find traffic spikes or dips"
  };
  const EXAMPLES = {
    summary: ["summarize traffic", "write a traffic brief", "give me an overview", "make an executive report", "what are the key metrics", "show overall totals", "produce a summary", "give me highlights"],
    trend: ["compare weeks", "how did traffic change", "what is the growth rate", "did sessions increase", "show trends over time", "week over week comparison", "did traffic decline", "compare this period"],
    pages: ["top landing pages", "which pages are most popular", "rank landing paths", "show page breakdown", "best performing pages", "where did visitors land", "which sections attract traffic", "show top urls"],
    channels: ["show acquisition channels", "break down traffic sources", "which referrals drove sessions", "compare organic and paid", "is traffic direct or social", "where did traffic come from", "rank acquisition channels", "show the marketing mix"],
    anomalies: ["find traffic spikes or dips", "detect unusual days", "were there anomalies", "flag outliers", "find a sudden drop", "spot abnormal traffic", "which days surged", "look for unexpected changes"]
  };
  const STOP = new Set("a an the me i were there what which this is and or of did has in for show find traffic give make how most was can you please".split(" "));
  const aliases = { summary:"summarize", summaries:"summarize", summarise:"summarize", report:"brief", reports:"brief",
    compare:"comparison", comparing:"comparison", trends:"trend", changes:"change", weeks:"week",
    landing:"land", landed:"land", pages:"page", paths:"path", urls:"url", channels:"channel", sources:"source", referrals:"referral",
    spikes:"spike", spiking:"spike", anomaly:"anomalies", dips:"dip", dropped:"drop", drops:"drop", outliers:"outlier", surges:"surge", surged:"surge" };
  const tokens = text => (String(text).slice(0, 240).toLowerCase().match(/[a-z]+/g) || []).filter(word => !STOP.has(word)).map(word => Object.hasOwn(aliases, word) ? aliases[word] : word);
  const profiles = Object.entries(EXAMPLES).map(([id, examples]) => {
    const counts = new Map();
    for (const phrase of examples) for (const word of new Set(tokens(phrase))) counts.set(word, (counts.get(word) || 0) + 1);
    return [id, counts];
  });
  function suggest(question) {
    const words = [...new Set(tokens(question))];
    const scores = profiles.map(([id, counts]) => [id, words.reduce((score, word) => {
      const count = counts.get(word);
      if (!count) return score;
      const shared = profiles.filter(([, table]) => table.has(word)).length;
      return score + (1 + Math.log1p(count)) / shared;
    }, 0)]).sort((a, b) => b[1] - a[1]);
    return scores[0][1] >= 1.6 && scores[0][1] - scores[1][1] >= 0.9 ? scores[0][0] : null;
  }

  function csvRows(value) {
    if (typeof value !== "string" || value.length > MAX_BYTES) throw new Error("Use a CSV smaller than 2 MB.");
    const text = value.replace(/^\ufeff/, "");
    const rows = []; let row = [], field = "", inside = false, closed = false;
    const finishField = () => {
      row.push(field); field = ""; closed = false;
      if (row.length > COLUMNS.length) throw new Error("Use exactly the five template columns.");
    };
    const finishRow = () => {
      finishField();
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error("Use at most 20,000 data rows.");
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inside) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { inside = false; closed = true; }
        else field += ch;
      } else if (ch === ",") finishField();
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; finishRow(); }
      else if (closed) throw new Error("A quoted CSV field is followed by an unexpected character.");
      else if (ch === '"') {
        if (field) throw new Error("A CSV quote appears inside an unquoted field.");
        inside = true;
      } else field += ch;
      if (field.length > 256) throw new Error("A field exceeds 256 characters. Use aggregate labels only.");
    }
    if (inside) throw new Error("A quoted CSV field was not closed.");
    if (field || row.length || closed) finishRow();
    return rows;
  }
  const dateLabel = stamp => new Date(stamp).toISOString().slice(0, 10);
  function metric(value) { return /^\d{1,9}$/.test(value) ? Number(value) : null; }
  function parse(value) {
    const rows = csvRows(value), columns = (rows.shift() || []).map(x => x.trim().toLowerCase());
    if (columns.length !== COLUMNS.length || !COLUMNS.every(col => columns.includes(col))) {
      throw new Error("Required columns: date, page, channel, sessions, pageviews. Use the CSV template.");
    }
    if (!rows.length) throw new Error("The CSV has no data rows.");
    const indexes = COLUMNS.map(col => columns.indexOf(col));
    const seen = new Set(), days = new Map(), pages = new Map(), channels = new Map();
    const add = (map, key, sessions, pageviews) => {
      const total = map.get(key) || { sessions: 0, pageviews: 0 };
      total.sessions += sessions; total.pageviews += pageviews; map.set(key, total);
    };
    let sessions = 0, pageviews = 0;
    rows.forEach((row, i) => {
      const error = message => { throw new Error(`Data row ${i + 1}: ${message}`); };
      if (row.length !== COLUMNS.length) error("Each row needs five columns.");
      const [date, rawPage, rawChannel, sess, views] = indexes.map(index => row[index].trim());
      const stamp = Date.parse(`${date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(stamp) || dateLabel(stamp) !== date) error("Use a valid date in YYYY-MM-DD format.");
      if (!/^\/(?!\/)[^?#\\\s<>\u0000-\u001f]{0,179}$/.test(rawPage)) error("Use a landing path like /pricing, with no host, query, or fragment.");
      if (!/^[\p{L}\p{N} .&+_/-]{1,64}$/u.test(rawChannel)) error("Use a short aggregate channel label like Organic Search.");
      const n = metric(sess), v = metric(views);
      if (n === null || v === null) error("Sessions and pageviews must be whole numbers from 0 to 999,999,999.");
      const identity = JSON.stringify([date, rawPage, rawChannel.toLowerCase()]);
      if (seen.has(identity)) error("This date, page, and channel already appear in the CSV.");
      seen.add(identity);
      add(days, stamp, n, v); add(pages, rawPage, n, v); add(channels, rawChannel.toLowerCase(), n, v);
      sessions += n; pageviews += v;
    });
    const dates = [...days.keys()].sort((a, b) => a - b), first = dates[0], last = dates.at(-1);
    const span = (last - first) / DAY + 1;
    if (span > 366) throw new Error("Use a CSV covering at most 366 calendar days.");
    const timeline = Array.from({ length: span }, (_, i) => {
      const stamp = first + i * DAY;
      return { date: dateLabel(stamp), sessions: days.get(stamp)?.sessions ?? null, pageviews: days.get(stamp)?.pageviews ?? null };
    });
    const order = map => [...map].map(([label, values]) => ({ label, ...values })).sort((a, b) => b.sessions - a.sessions || b.pageviews - a.pageviews || a.label.localeCompare(b.label));
    return { rows: rows.length, sessions, pageviews, reportedDays: days.size, missingDays: span - days.size,
      start: dateLabel(first), end: dateLabel(last), timeline, pages: order(pages), channels: order(channels) };
  }

  const number = n => n.toLocaleString("en-GB");
  const pct = n => `${n > 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
  const sum = list => list.reduce((total, item) => total + item.sessions, 0);
  function comparison(data) {
    const periods = data.timeline.slice(-14);
    if (periods.length !== 14 || periods.some(p => p.sessions === null)) return null;
    const before = sum(periods.slice(0, 7)), after = sum(periods.slice(7));
    return { before, after, delta: before ? (after - before) / before : null, afterStart: periods[7].date, beforeStart: periods[0].date };
  }
  function anomalies(data) {
    if (data.reportedDays < 7) return null;
    const list = data.timeline.filter(x => x.sessions !== null), sorted = list.map(x => x.sessions).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { median, rows: list.filter(row => Math.abs(row.sessions - median) >= Math.max(5, median * 0.5))
      .map(x => ({ ...x, direction: x.sessions > median ? "Spike" : "Dip", magnitude: Math.abs(x.sessions - median) }))
      .sort((a, b) => b.magnitude - a.magnitude || a.date.localeCompare(b.date)) };
  }
  function run(task, data) {
    if (!Object.hasOwn(TASKS, task) || !data) throw new Error("Load a dataset and choose a supported task.");
    const desc = [];
    let headers = [], rows = [];
    const period = comparison(data);
    if (task === "summary") {
      desc.push(`${number(data.sessions)} sessions and ${number(data.pageviews)} pageviews across ${data.reportedDays} reported days (${data.start} to ${data.end}).`);
      if (data.sessions > 0) desc.push(`Top landing page: ${data.pages[0].label} (${number(data.pages[0].sessions)} sessions). Top channel: ${data.channels[0].label} (${number(data.channels[0].sessions)} sessions).`);
      if (period?.delta != null) desc.push(`The last 7 days changed ${pct(period.delta)} versus the preceding 7 days.`);
      if (data.missingDays) desc.push(`${data.missingDays} calendar days are missing, not zero.`);
    } else if (task === "trend") {
      if (!period) desc.push("A week-over-week comparison needs 14 consecutive calendar days. Missing days are not counted as zero.");
      else {
        desc.push(`${number(period.after)} sessions in the week starting ${period.afterStart}, versus ${number(period.before)} in the week starting ${period.beforeStart}.`);
        desc.push(period.delta === null ? "Percentage change is undefined because the preceding week had zero sessions." : `Week-over-week change: ${pct(period.delta)}.`);
      }
    } else if (task === "pages" || task === "channels") {
      const list = data[task];
      desc.push(`Top ${Math.min(10, list.length)} of ${list.length} ${task === "pages" ? "landing pages" : "channels"}, ranked by sessions.`);
      headers = [task === "pages" ? "Landing page" : "Channel", "Sessions", "Pageviews", "Session share"];
      rows = list.slice(0, 10).map(item => [item.label, number(item.sessions), number(item.pageviews), data.sessions ? `${(100 * item.sessions / data.sessions).toFixed(1)}%` : "Not defined"]);
    } else if (task === "anomalies") {
      const result = anomalies(data);
      if (!result) desc.push("Anomaly screening requires at least 7 reported days.");
      else {
        desc.push(`${result.rows.length} flagged days. Median: ${number(result.median)} sessions. A flag requires a change of at least 50% from the median and at least 5 sessions.`);
        desc.push("Flags are descriptive, not statistical significance. Check campaign, release, and tracking logs before attributing causes.");
        headers = ["Date", "Sessions", "Signal"];
        rows = result.rows.slice(0, 20).map(row => [row.date, number(row.sessions), row.direction]);
      }
    }
    return { task, title: TASKS[task], desc, headers, rows };
  }

  function demoCsv() {
    const rows = Array.from({ length: 14 }, (_, i) => {
      const date = `2026-10-${String(i + 1).padStart(2, "0")}`;
      const organic = i === 11 ? 142 : 36 + (i % 7) * 2 + (i > 6 ? 9 : 0);
      const direct = 16 + (i % 3) * 2;
      return `${date},/guides,Organic Search,${organic},${organic * 2}\n${date},/pricing,Direct,${direct},${direct + 8}`;
    });
    return [...["date,page,channel,sessions,pageviews"], ...rows].join("\n");
  }

export { MAX_BYTES, TASKS, parse, suggest, run, demoCsv };
