// Electron work areas already use DIP and account for display scaling and taskbars.
function windowBounds(workArea) {
  const width = Math.min(1420, Math.floor(workArea.width * 0.94));
  const height = Math.min(920, Math.floor(workArea.height * 0.94));
  return {
    width, height,
    minWidth: Math.min(960, width), minHeight: Math.min(600, height),
    x: workArea.x + Math.floor((workArea.width - width) / 2),
    y: workArea.y + Math.floor((workArea.height - height) / 2)
  };
}

module.exports = { windowBounds };
