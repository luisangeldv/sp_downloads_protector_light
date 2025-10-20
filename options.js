
const $ = (sel) => document.querySelector(sel);

async function load() {
  const { cloudSettings } = await chrome.storage.local.get({ cloudSettings: {} });
  $("#serviceBaseUrl").value = cloudSettings.serviceBaseUrl || "";
  $("#apiKey").value = cloudSettings.apiKey || "";
}

async function save() {
  const newSettings = {
    serviceBaseUrl: $("#serviceBaseUrl").value.trim(),
    apiKey: $("#apiKey").value.trim()
  };
  await chrome.storage.local.set({ cloudSettings: newSettings });
  $("#status").textContent = "Guardado ✓";
  setTimeout(()=> $("#status").textContent = "", 2000);
}

function openDashboard() {
  const base = $("#serviceBaseUrl").value.trim();
  if (!base) { alert("Indica la URL del servicio"); return; }
  chrome.tabs.create({ url: `${base}/dashboard` });
}

async function test() {
  const { cloudSettings } = await chrome.storage.local.get({ cloudSettings: {} });
  if (!cloudSettings.serviceBaseUrl) {
    $("#status").textContent = "Configura la URL del servicio primero.";
    return;
  }
  try {
    const r = await fetch(`${cloudSettings.serviceBaseUrl}/api/ping`, {
      headers: {
        ...(cloudSettings.apiKey ? { "x-api-key": cloudSettings.apiKey } : {})
      }
    });
    $("#status").textContent = r.ok ? "Conexión OK ✓" : "Fallo de conexión";
  } catch {
    $("#status").textContent = "Fallo de conexión";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#save").addEventListener("click", save);
  $("#openDashboard").addEventListener("click", openDashboard);
  $("#test").addEventListener("click", test);
  load();
});
