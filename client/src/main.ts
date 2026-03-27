/**
 * PRD：纯文字固定面板 UI — 阶段一为占位，后续对接等待式 API。
 */
const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.innerHTML = `
    <pre style="font-family: system-ui, sans-serif; padding: 1rem;">
智宠对决 · SmartPet Duel
─────────────────────
[ 文字 UI 占位 · 阶段五对接 API ]

后端健康检查（开发时可直连）：
  GET http://127.0.0.1:3000/health

本页经 Vite 代理可访问同源 /api/health → 后端 /health
    </pre>
  `;
}
