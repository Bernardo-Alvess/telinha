import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    roomCode: {
        type: OptionType.STRING,
        description: "Código da sala (usado no botão Entrar)",
        default: "",
    },
});

function openTelinha(path: string) {
    window.location.href = `telinha://${path}`;
}

export default definePlugin({
    name: "Telinha",
    description: "Abre o Telinha para compartilhar ou assistir tela fora do Discord.",
    authors: [{ name: "Telinha", id: 0n }],
    settings,
    start() {
        if (document.getElementById("telinha-vencord-btn")) {
            return;
        }
        const button = document.createElement("button");
        button.id = "telinha-vencord-btn";
        button.type = "button";
        button.textContent = "Telinha";
        button.title = "Abrir o Telinha";
        button.style.cssText = [
            "position:fixed",
            "right:16px",
            "bottom:72px",
            "z-index:1000",
            "height:32px",
            "padding:0 12px",
            "border:0",
            "border-radius:16px",
            "background:#5865f2",
            "color:#fff",
            "font:600 13px/32px gg sans, Whitney, sans-serif",
            "cursor:pointer",
        ].join(";");
        button.addEventListener("click", () => {
            const code = settings.store.roomCode.trim().toUpperCase();
            openTelinha(code ? `join/${code}` : "open");
        });
        document.body.appendChild(button);
    },
    stop() {
        document.getElementById("telinha-vencord-btn")?.remove();
    },
});
