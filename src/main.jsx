import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n/index.jsx";
import App from "./App.jsx";
import "./index.css";
import "./app-arena.css";
import { setProtocolProfileStore } from "./arena/protocol-profile.js";
import { loadData, saveData } from "./lib/dataClient.js";

// 协议画像存储注入（chayuan-game：IPC 桥 / localStorage 降级，与 harness 同款接口）
setProtocolProfileStore({ load: loadData, save: saveData });

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <App />
  </I18nProvider>,
);
