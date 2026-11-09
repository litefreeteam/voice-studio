// Native disclosure works without JavaScript on every statically rendered page.
// These listeners add outside-click and Escape dismissal without a UI framework.
document.addEventListener("click", event => {
  for (const menu of document.querySelectorAll("details.language-switcher[open]")) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  for (const menu of document.querySelectorAll("details.language-switcher[open]")) {
    menu.open = false;
    menu.querySelector("summary").focus();
    event.preventDefault();
  }
});
