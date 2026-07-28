const APP_STATE_KEYS = [
  "profile-page-state-v1",
  "paper-search-state-v3",
  "paper-reading-state-v3",
  "paper-reading-pending-v3",
  "knowledge-page-state-v11",
  "knowledge-page-state-v10",
  "knowledge-page-pending-import-v1",
  "scholar-page-state-v1",
  "direction-page-state-v1",
  "hotspot-page-state-v3",
];

function clearAllWorkspaceState() {
  APP_STATE_KEYS.forEach((key) => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });

  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.location.replace(cleanUrl);
}

document.querySelectorAll("[data-clear-app-state]").forEach((button) => {
  button.addEventListener("click", clearAllWorkspaceState);
});
