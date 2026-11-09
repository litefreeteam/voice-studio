import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App.jsx";
import { GuidePage, DownloadPage } from "./GuidePage.jsx";
export { pages } from "./site-content.mjs";

export function renderPage(page) {
  const content = page.sourcePath === "/" ? <StrictMode><App locale={page.locale} /></StrictMode> : page.sourcePath === "/download/" ? <DownloadPage page={page} /> : <GuidePage page={page} />;
  return renderToString(content);
}
