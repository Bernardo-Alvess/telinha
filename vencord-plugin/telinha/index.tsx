import definePlugin from "@utils/types";
import { SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

const ACTIONS_BUTTON_ID = "telinha-actions-btn";
const STATUS_BUTTON_ID = "telinha-status-btn";
const BAR_GROUP_ID = "telinha-call-bar-btn";
const TELINHA_VERSION = "22";
const VOICE_ROW_ATTR = "data-telinha-row";
const STYLE_ID = "telinha-plugin-style";
const ROW_FIFTH_MIN = 240;

const ICON_SVG = `<svg data-telinha-icon="true" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" style="display:block;width:20px;height:20px"><path fill="#dbdee1" d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-4v2h2a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h2v-2H6a2 2 0 0 1-2-2V6zm2 0v9h12V6H6z"/></svg>`;

function discordRoomCode(): string | null {
    const voiceId = SelectedChannelStore.getVoiceChannelId?.();
    if (voiceId) return `D${voiceId}`;
    const channelId = SelectedChannelStore.getChannelId?.();
    if (channelId) return `D${channelId}`;
    return null;
}

async function openTelinhaFromDiscord() {
    const code = discordRoomCode();
    if (!code) {
        showToast("Entre numa call do Discord primeiro.", Toasts.Type.FAILURE);
        return;
    }

    const user = UserStore.getCurrentUser?.();
    const name = user?.globalName || user?.username || "";
    const params = new URLSearchParams();
    if (name) params.set("name", name);
    const query = params.toString();
    const url = `telinha://join/${code}${query ? `?${query}` : ""}`;

    try {
        await VencordNative.native.openExternal(url);
        showToast("Abrindo a Telinha desta sala…", Toasts.Type.SUCCESS);
        return;
    } catch {
    }

    try {
        window.open(url, "_blank", "noopener");
        showToast("Abrindo a Telinha desta sala…", Toasts.Type.SUCCESS);
    } catch {
        showToast("Não deu para abrir o Telinha. Deixe o app instalado.", Toasts.Type.FAILURE);
    }
}

function labelOf(el: Element): string {
    return [el.getAttribute("aria-label"), el.getAttribute("title")].filter(Boolean).join(" ");
}

function isHangup(el: Element): boolean {
    return /disconnect|desconectar|leave call|sair da chamada|hang up|encerrar|desligar/i.test(labelOf(el));
}

function isTelinha(el: Element): boolean {
    return Boolean(el.closest(`#${ACTIONS_BUTTON_ID}, #${STATUS_BUTTON_ID}, #${BAR_GROUP_ID}`));
}

function bindClick(el: HTMLElement) {
    el.setAttribute("aria-label", "Telinha");
    el.setAttribute("title", "Telinha desta sala");
    el.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        void openTelinhaFromDiscord();
    }, true);
}

function keepIfCurrent(id: string): HTMLElement | null {
    const el = document.getElementById(id);
    if (el?.dataset.telinhaV === TELINHA_VERSION) return el;
    el?.remove();
    return null;
}

function mark(el: HTMLElement) {
    el.dataset.telinhaV = TELINHA_VERSION;
}

function copyChrome(from: HTMLElement, to: HTMLElement) {
    const style = getComputedStyle(from);
    to.style.backgroundColor = style.backgroundColor;
    to.style.border = style.border;
    to.style.borderRadius = style.borderRadius;
    to.style.boxShadow = style.boxShadow;
    to.style.outline = style.outline;
}

function centerIconOnly(root: HTMLElement) {
    const host = root.matches("button, [role='button']")
        ? root
        : root.querySelector<HTMLElement>("button, [role='button']") ?? root;
    host.innerHTML = ICON_SVG;
    host.style.display = "flex";
    host.style.alignItems = "center";
    host.style.justifyContent = "center";
    host.style.padding = "0";
    host.style.margin = "0";
    host.style.lineHeight = "0";
}

function ensurePluginStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (existing?.dataset.telinhaV === TELINHA_VERSION) return;
    existing?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.dataset.telinhaV = TELINHA_VERSION;
    style.textContent = `
        #${ACTIONS_BUTTON_ID},
        #${STATUS_BUTTON_ID},
        #${BAR_GROUP_ID} {
            cursor: pointer;
        }
        #${ACTIONS_BUTTON_ID} [data-telinha-icon],
        #${STATUS_BUTTON_ID} [data-telinha-icon],
        #${BAR_GROUP_ID} [data-telinha-icon] {
            display: block;
            width: 20px;
            height: 20px;
        }
    `;
    document.head.appendChild(style);
}

function cloneVoiceTile(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.id = ACTIONS_BUTTON_ID;
    mark(clone);
    clone.removeAttribute("aria-checked");
    clone.removeAttribute("aria-pressed");
    copyChrome(source, clone);
    clone.style.height = getComputedStyle(source).height;
    centerIconOnly(clone);
    bindClick(clone);
    return clone;
}

function clickables(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>("button, [role='button']"))
        .filter(el => !isTelinha(el));
}

function squareTiles(region: (rect: DOMRect) => boolean): HTMLElement[] {
    const tiles: HTMLElement[] = [];
    for (const el of clickables()) {
        const rect = el.getBoundingClientRect();
        if (!region(rect)) continue;
        if (rect.width < 24 || rect.width > 110 || rect.height < 24 || rect.height > 64) continue;
        tiles.push(el);
    }
    return tiles;
}

function rowsOf(tiles: HTMLElement[]): HTMLElement[][] {
    const rows: { y: number; items: HTMLElement[] }[] = [];
    for (const tile of tiles) {
        const y = tile.getBoundingClientRect().top;
        const row = rows.find(item => Math.abs(item.y - y) <= 14);
        if (row) row.items.push(tile);
        else rows.push({ y, items: [tile] });
    }
    return rows
        .map(row => row.items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left))
        .filter(items => items.length >= 3);
}

function isSafeToolbar(el: HTMLElement): boolean {
    const rect = el.getBoundingClientRect();
    return rect.width >= 80
        && rect.width <= 520
        && rect.height >= 24
        && rect.height <= 220
        && el.childElementCount >= 3
        && el.childElementCount <= 10;
}

function tileInParent(parent: HTMLElement, control: HTMLElement): HTMLElement {
    let node: HTMLElement | null = control;
    while (node && node.parentElement !== parent) node = node.parentElement;
    return node ?? control;
}

function findVoiceActionParent(): HTMLElement | null {
    const classHits = Array.from(document.querySelectorAll<HTMLElement>('[class*="actionButtons"]'));
    for (const hit of classHits) {
        if (isSafeToolbar(hit)) return hit;
        const child = Array.from(hit.children).find(node => node instanceof HTMLElement && isSafeToolbar(node));
        if (child instanceof HTMLElement) return child;
    }

    const tiles = squareTiles(rect => (
        rect.left < 520
        && rect.bottom > window.innerHeight - 300
        && rect.top < window.innerHeight - 36
    ));
    const row = rowsOf(tiles).find(items => {
        const left = items[0].getBoundingClientRect().left;
        const right = items[items.length - 1].getBoundingClientRect().right;
        return items.length >= 3 && right - left > 120;
    });
    if (!row) return null;

    const shared = row[0].parentElement;
    if (shared && row.every(tile => tile.parentElement === shared) && isSafeToolbar(shared)) return shared;

    const wrapped = shared ? row.map(tile => tileInParent(shared, tile)) : [];
    if (shared && wrapped.length >= 3 && isSafeToolbar(shared)) return shared;
    return null;
}

function clearRowHacks() {
    for (const node of Array.from(document.querySelectorAll<HTMLElement>(`[${VOICE_ROW_ATTR}]`))) {
        node.removeAttribute(VOICE_ROW_ATTR);
        delete node.dataset.telinhaWheel;
        for (const prop of ["display", "flex-wrap", "overflow-x", "overflow-y"]) node.style.removeProperty(prop);
        for (const child of Array.from(node.children)) {
            if (!(child instanceof HTMLElement) || isTelinha(child)) continue;
            child.style.removeProperty("flex-shrink");
            child.style.removeProperty("min-width");
        }
    }
}

function findSidebarDisconnect(): HTMLElement | null {
    return clickables().find(el => {
        if (!isHangup(el)) return false;
        const rect = el.getBoundingClientRect();
        return rect.left < 420
            && rect.bottom > window.innerHeight - 280
            && rect.top > window.innerHeight - 230
            && rect.width <= 44
            && rect.height <= 44;
    }) ?? null;
}

function mountStatusButton() {
    const hangup = findSidebarDisconnect();
    if (!hangup?.parentElement) return;
    ensurePluginStyle();
    if (keepIfCurrent(STATUS_BUTTON_ID)?.parentElement === hangup.parentElement) return;

    document.getElementById(STATUS_BUTTON_ID)?.remove();
    const telinha = hangup.cloneNode(true) as HTMLElement;
    telinha.id = STATUS_BUTTON_ID;
    mark(telinha);
    copyChrome(hangup, telinha);
    centerIconOnly(telinha);
    bindClick(telinha);
    hangup.parentElement.insertBefore(telinha, hangup);
}

function mountVoiceActionButton() {
    const parent = findVoiceActionParent();
    const fitsFifth = Boolean(parent && parent.clientWidth >= ROW_FIFTH_MIN);

    if (!fitsFifth) {
        document.getElementById(ACTIONS_BUTTON_ID)?.remove();
        mountStatusButton();
        return;
    }

    document.getElementById(STATUS_BUTTON_ID)?.remove();
    if (!parent) return;
    ensurePluginStyle();
    if (keepIfCurrent(ACTIONS_BUTTON_ID)?.parentElement === parent) return;

    const source = Array.from(parent.children).find(child => !isTelinha(child)) as HTMLElement | undefined
        ?? parent.querySelector<HTMLElement>("button, [role='button']");
    if (!source) return;
    document.getElementById(ACTIONS_BUTTON_ID)?.remove();
    parent.appendChild(cloneVoiceTile(source));
}

function findCallHangup(): HTMLElement | null {
    const hangups = clickables().filter(el => {
        if (!isHangup(el)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= 36 && rect.height >= 36 && rect.left > 360;
    });
    hangups.sort((a, b) => {
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return br.width * br.height - ar.width * ar.height;
    });
    return hangups[0] ?? null;
}

function findCallToolbar(hangup: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = hangup.parentElement;
    for (let i = 0; i < 10 && current; i++) {
        const rect = current.getBoundingClientRect();
        const style = getComputedStyle(current);
        const row = style.display.includes("flex") && style.flexDirection !== "column";
        if (rect.width > 220 && rect.height > 36 && rect.height < 140 && (row || current.childElementCount >= 2)) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

function mountCallBarButton() {
    const hangup = findCallHangup();
    if (!hangup) return;

    const toolbar = findCallToolbar(hangup);
    if (!toolbar) return;
    const groups = Array.from(toolbar.children).filter(child => !isHangup(child) && !isTelinha(child)) as HTMLElement[];
    const sectionSource = groups[1] ?? groups[0];
    if (!sectionSource) return;
    if (keepIfCurrent(BAR_GROUP_ID)?.parentElement === toolbar) return;

    document.getElementById(BAR_GROUP_ID)?.remove();

    ensurePluginStyle();
    const hangupSize = hangup.getBoundingClientRect();
    const chrome = getComputedStyle(groups[0] ?? sectionSource);
    const section = sectionSource.cloneNode(false) as HTMLElement;
    section.id = BAR_GROUP_ID;
    mark(section);
    section.style.backgroundColor = getComputedStyle(sectionSource).backgroundColor;
    section.style.borderRadius = chrome.borderTopLeftRadius || "8px";
    section.style.border = chrome.border;
    section.style.boxShadow = chrome.boxShadow;
    const buttonHeight = Math.round(hangupSize.height);
    const buttonWidth = Math.max(48, Math.round(hangupSize.width - 8));
    section.style.height = `${buttonHeight}px`;
    section.style.minHeight = `${buttonHeight}px`;
    section.style.maxHeight = `${buttonHeight}px`;
    section.style.width = `${buttonWidth}px`;
    section.style.minWidth = `${buttonWidth}px`;
    section.style.maxWidth = `${buttonWidth}px`;
    section.style.flex = "0 0 auto";
    section.style.display = "flex";
    section.style.alignItems = "center";
    section.style.justifyContent = "center";
    section.style.overflow = "hidden";
    section.style.padding = "0";
    section.innerHTML = ICON_SVG;
    bindClick(section);
    toolbar.insertBefore(section, toolbar.firstElementChild);
}

function mountButtons() {
    try {
        document.getElementById("telinha-account-btn")?.remove();
        mountVoiceActionButton();
        mountCallBarButton();
    } catch {
    }
}

let observer: MutationObserver | undefined;
let interval: number | undefined;
let mountScheduled = false;

function inVoice() {
    return Boolean(SelectedChannelStore.getVoiceChannelId?.());
}

function scheduleMount() {
    if (mountScheduled) return;
    mountScheduled = true;
    requestAnimationFrame(() => {
        mountScheduled = false;
        if (inVoice()) mountButtons();
    });
}

function startWatching() {
    if (observer) return;
    observer = new MutationObserver(() => scheduleMount());
    observer.observe(document.body, { childList: true, subtree: true });
    interval = window.setInterval(() => {
        if (inVoice()) mountButtons();
    }, 2500);
}

function stopWatching() {
    observer?.disconnect();
    observer = undefined;
    if (interval) window.clearInterval(interval);
    interval = undefined;
}

function unmountButtons() {
    document.getElementById("telinha-account-btn")?.remove();
    document.getElementById(ACTIONS_BUTTON_ID)?.remove();
    document.getElementById(STATUS_BUTTON_ID)?.remove();
    document.getElementById(BAR_GROUP_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
}

function syncCallUi() {
    if (!inVoice()) {
        stopWatching();
        unmountButtons();
        return;
    }
    startWatching();
    mountButtons();
}

export default definePlugin({
    name: "Telinha",
    description: "Botão na call do Discord. O primeiro clique cria a sala; os outros entram juntos.",
    authors: [{ name: "Telinha", id: 0n }],
    enabledByDefault: true,
    requiresRestart: false,
    start() {
        clearRowHacks();
        SelectedChannelStore.addChangeListener(syncCallUi);
        syncCallUi();
    },
    stop() {
        SelectedChannelStore.removeChangeListener(syncCallUi);
        stopWatching();
        unmountButtons();
        document.querySelector(`[${VOICE_ROW_ATTR}]`)?.removeAttribute(VOICE_ROW_ATTR);
    },
});
