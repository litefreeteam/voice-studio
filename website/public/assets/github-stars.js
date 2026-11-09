/* Shared by hydrated homepages and static guides; no React-owned DOM is changed. */
(() => {
  if (!window.customElements || customElements.get("github-star-count")) return;
  const repository = "litefreeteam/voice-studio";
  const cacheKey = "shengyue:github-stars:v1";
  const cacheAge = 60 * 60 * 1000;
  const validCount = value => Number.isSafeInteger(value) && value >= 0;
  let pending;

  function loadCount() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        const age = Date.now() - cached?.updatedAt;
        if (validCount(cached?.count) && age >= 0 && age < cacheAge) return cached.count;
      } catch { /* Storage may be disabled; the public link still works. */ }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch("https://api.github.com/repos/" + repository, {
          headers: { Accept: "application/vnd.github+json" },
          credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data.full_name !== repository || !validCount(data.stargazers_count)) return null;
        const count = data.stargazers_count;
        try { localStorage.setItem(cacheKey, JSON.stringify({ count, updatedAt: Date.now() })); } catch { /* Optional cache. */ }
        return count;
      } finally { clearTimeout(timer); }
    })().catch(() => null);
    return pending;
  }

  customElements.define("github-star-count", class extends HTMLElement {
    connectedCallback() {
      if (this.shadowRoot) return;
      const root = this.attachShadow({ mode: "open" });
      root.append(document.createElement("slot"));
      loadCount().then(count => {
        if (count === null) return;
        const number = document.createElement("span");
        number.textContent = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count);
        number.title = count.toLocaleString(this.getAttribute("locale") || "en") + " · " + this.getAttribute("label");
        root.replaceChildren(number);
      });
    }
  });
})();
