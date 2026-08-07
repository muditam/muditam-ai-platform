import styles from "./styles.css?inline";

interface Session {
  token: string;
  conversationId: string;
  visitorId: string;
  expiresAt: number;
}

interface CommerceResponse {
  decision: "ALLOW" | "HANDOFF" | "REFUSE" | "SAFETY";
  category: string;
  messages: Array<{ type: "text"; text: string }>;
  recommendedProducts: Array<{
    productSlug: string;
    name: string;
    productUrl: string;
    reason: string;
  }>;
  handoff: null | {
    queue: "support" | "dietitian" | "doctor";
    reason: string;
    phoneDisplay: string;
    phoneHref: string;
    whatsappUrl: string;
  };
}

interface RecentMessage { role: "user" | "assistant"; content: string }

interface ShopifyProductJson {
  featured_image?: string | { src?: string } | null;
  images?: Array<string | { src?: string }>;
}

const STORAGE_KEY = "muditam_ai_storefront_session_v1";

type WidgetLanguage = "auto" | "en" | "hi" | "hinglish";

function configuredLanguage(value: string | undefined): WidgetLanguage {
  return value === "en" || value === "hi" || value === "hinglish" ? value : "auto";
}

function scriptConfiguration(): { apiUrl: string; language: WidgetLanguage } {
  const script = document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : document.querySelector<HTMLScriptElement>("script[data-muditam-chat]");
  return {
    apiUrl: (script?.dataset.apiUrl ?? "https://api.aichat.muditam.com").replace(/\/$/, ""),
    language: configuredLanguage(script?.dataset.language),
  };
}

const initialConfiguration = scriptConfiguration();

class MuditamChat extends HTMLElement {
  readonly #root: ShadowRoot;
  readonly #apiUrl: string;
  readonly #language: WidgetLanguage;
  #session: Session | null = null;
  #recentMessages: RecentMessage[] = [];
  #pending = false;
  #productImageCache = new Map<string, Promise<string | null>>();

  constructor() {
    super();
    this.#apiUrl = this.dataset.apiUrl?.replace(/\/$/, "") || initialConfiguration.apiUrl;
    this.#language = this.dataset.language ? configuredLanguage(this.dataset.language) : initialConfiguration.language;
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `
      <style>${styles}</style>
      <button class="launcher" type="button" aria-label="Chat with Muditam" aria-expanded="false">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.48 8.8 8.8 0 0 1-3.35-.88L4 19.5l1.42-4.04A7.5 7.5 0 1 1 20 11.5Z"/></svg>
      </button>
      <section class="panel" role="dialog" aria-label="Muditam AI Expert" hidden>
        <header class="header">
          <div class="brand-mark" aria-hidden="true">m</div>
          <div class="brand"><strong>Muditam Expert</strong><span><i></i> Online · Typically replies instantly</span></div>
          <button class="close" type="button" aria-label="Close chat">×</button>
        </header>
        <div class="messages" role="log" aria-live="polite"></div>
        <form class="composer">
          <div class="composer-row">
            <input name="message" maxlength="2000" autocomplete="off" placeholder="Ask about a product…" aria-label="Message" />
            <button class="send" type="submit" aria-label="Send message">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 14-7-4.5 14-2.7-5.8L5 12Zm6.8 1.2L19 5"/></svg>
            </button>
          </div>
          <span class="ai-note">AI can make mistakes. Please verify important information.</span>
        </form>
      </section>`;
  }

  connectedCallback(): void {
    const launcher = this.#required<HTMLButtonElement>(".launcher");
    const panel = this.#required<HTMLElement>(".panel");
    const close = this.#required<HTMLButtonElement>(".close");
    launcher.addEventListener("click", () => {
      panel.hidden = false;
      launcher.setAttribute("aria-expanded", "true");
      this.#required<HTMLInputElement>("input").focus();
    });
    close.addEventListener("click", () => {
      panel.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
    });
    this.#required<HTMLFormElement>("form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#submit();
    });
    this.#appendMessage("assistant", "Hey 👋 I’m your personal Muditam AI Expert. What can I help you with today?");
  }

  #required<T extends Element>(selector: string): T {
    const element = this.#root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing widget element: ${selector}`);
    return element;
  }

  #appendMessage(role: "user" | "assistant", text: string, highlightedNames: string[] = []): void {
    const element = document.createElement("div");
    element.className = `message ${role}`;
    if (role === "assistant" && highlightedNames.length) {
      const names = [...new Set(highlightedNames.filter(Boolean))]
        .sort((left, right) => right.length - left.length);
      const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const pattern = escaped.length ? new RegExp(`(${escaped.join("|")})`, "giu") : null;
      const canonicalNames = new Map(names.map((name) => [name.toLocaleLowerCase(), name]));
      if (pattern) {
        for (const part of text.split(pattern)) {
          if (!part) continue;
          if (canonicalNames.has(part.toLocaleLowerCase())) {
            const strong = document.createElement("strong");
            strong.textContent = part;
            element.append(strong);
          } else {
            element.append(document.createTextNode(part));
          }
        }
      } else {
        element.textContent = text;
      }
    } else {
      element.textContent = text;
    }
    const messages = this.#required<HTMLElement>(".messages");
    messages.append(element);
    messages.scrollTop = messages.scrollHeight;
  }

  #appendStatus(): HTMLElement {
    const element = document.createElement("div");
    element.className = "message assistant status";
    element.setAttribute("role", "status");
    element.setAttribute("aria-label", "Muditam AI is replying");
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement("span");
      dot.className = "typing-dot";
      dot.setAttribute("aria-hidden", "true");
      element.append(dot);
    }
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = "Muditam AI is replying";
    element.append(label);
    this.#required<HTMLElement>(".messages").append(element);
    return element;
  }

  #shopifyImage(productUrl: string): Promise<string | null> {
    const cached = this.#productImageCache.get(productUrl);
    if (cached) return cached;
    const request = (async () => {
      try {
        const url = new URL(productUrl, window.location.origin);
        url.pathname = `${url.pathname.replace(/\/$/u, "")}.js`;
        url.search = "";
        url.hash = "";
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) return null;
        const product = await response.json() as ShopifyProductJson;
        const featured = typeof product.featured_image === "string"
          ? product.featured_image
          : product.featured_image?.src;
        const firstImage = product.images?.map((image) => typeof image === "string" ? image : image.src).find(Boolean);
        const source = featured || firstImage;
        return source ? new URL(source, url.origin).href : null;
      } catch {
        return null;
      }
    })();
    this.#productImageCache.set(productUrl, request);
    return request;
  }

  #appendProducts(products: CommerceResponse["recommendedProducts"]): void {
    if (!products.length) return;
    const carousel = document.createElement("div");
    carousel.className = "product-carousel";
    const container = document.createElement("div");
    container.className = "products";
    container.setAttribute("aria-label", "Recommended products");
    for (const product of products) {
      const card = document.createElement("article");
      card.className = "product";
      const link = document.createElement("a");
      link.className = "product-link";
      link.href = product.productUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `View ${product.name}`);
      link.addEventListener("click", () => this.#emit("product_clicked", product.productSlug));
      const media = document.createElement("div");
      media.className = "product-media loading";
      const image = document.createElement("img");
      image.alt = product.name;
      image.loading = "lazy";
      image.decoding = "async";
      media.append(image);
      void this.#shopifyImage(product.productUrl).then((source) => {
        media.classList.remove("loading");
        if (source) {
          image.src = source;
          media.classList.add("loaded");
        } else {
          image.remove();
          media.classList.add("unavailable");
        }
      });
      const name = document.createElement("strong");
      name.textContent = product.name;
      const reason = document.createElement("span");
      reason.textContent = product.reason;
      link.append(media, name, reason);
      card.append(link);
      container.append(card);
    }
    const scroll = (direction: number): void => container.scrollBy({
      left: direction * Math.max(180, container.clientWidth * 0.72),
      behavior: "smooth",
    });
    const previous = document.createElement("button");
    previous.className = "product-nav previous";
    previous.type = "button";
    previous.setAttribute("aria-label", "Previous products");
    previous.textContent = "‹";
    previous.addEventListener("click", () => scroll(-1));
    const next = document.createElement("button");
    next.className = "product-nav next";
    next.type = "button";
    next.setAttribute("aria-label", "Next products");
    next.textContent = "›";
    next.addEventListener("click", () => scroll(1));
    carousel.append(container);
    if (products.length > 1) carousel.append(previous, next);
    this.#required<HTMLElement>(".messages").append(carousel);
  }

  #appendHandoff(handoff: NonNullable<CommerceResponse["handoff"]>): void {
    const container = document.createElement("div");
    container.className = "handoff-actions";
    container.setAttribute("aria-label", "Contact a Muditam expert");

    const call = document.createElement("a");
    call.className = "contact-action secondary";
    call.href = handoff.phoneHref;
    call.textContent = `Call ${handoff.phoneDisplay}`;
    call.addEventListener("click", () => this.#emit("expert_call_clicked"));

    const whatsapp = document.createElement("a");
    whatsapp.className = "contact-action whatsapp";
    whatsapp.href = handoff.whatsappUrl;
    whatsapp.target = "_blank";
    whatsapp.rel = "noopener noreferrer";
    whatsapp.innerHTML = `<svg class="whatsapp-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12.031 0h-.062C5.406 0 0 5.406 0 12.031c0 2.578.836 4.964 2.256 6.906L.79 23.156l4.32-1.386c1.867 1.24 4.096 1.964 6.907 1.964h.014c6.61 0 12.03-5.406 12.03-12.032a11.94 11.94 0 0 0-3.522-8.487A11.943 11.943 0 0 0 12.03 0zm7.032 17.05c-.297.836-1.72 1.612-2.375 1.71-.607.09-1.377.129-2.222-.14-1.037-.328-2.37-.735-4.09-1.816-3.02-1.887-4.987-4.987-5.144-5.216-.157-.228-1.294-1.72-1.294-3.286 0-1.564.822-2.335 1.113-2.657.297-.322.647-.402.863-.402.216 0 .432.002.62.011.198.01.463-.075.727.554.272.647.925 2.235 1.006 2.398.08.16.132.35.026.564-.107.213-.16.346-.318.532-.157.187-.332.418-.474.56-.157.157-.32.328-.137.643.183.315.815 1.343 1.75 2.176 1.202 1.07 2.216 1.404 2.531 1.564.315.16.5.132.685-.08.187-.213.792-.926 1.006-1.245.213-.318.427-.264.72-.16.294.107 1.86.877 2.178 1.037.318.16.53.24.61.372.08.132.08.766-.217 1.602z"/></svg><span>Chat here</span>`;
    whatsapp.addEventListener("click", () => this.#emit("expert_whatsapp_clicked"));

    container.append(call, whatsapp);
    this.#required<HTMLElement>(".messages").append(container);
  }

  #emit(event: string, productSlug?: string): void {
    this.dispatchEvent(new CustomEvent("muditam-chat-event", {
      bubbles: true,
      composed: true,
      detail: { event, productSlug, conversationId: this.#session?.conversationId ?? null },
    }));
    const token = this.#session?.token;
    if (!token) return;
    fetch(`${this.#apiUrl}/api/v1/commerce/events`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: event,
        ...(productSlug ? { productSlug } : {}),
        url: window.location.href,
      }),
    }).catch(() => {});
  }

  #storedSession(): Session | null {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Session | null;
      return value && value.expiresAt > Math.floor(Date.now() / 1000) + 30 ? value : null;
    } catch {
      return null;
    }
  }

  async #ensureSession(): Promise<Session> {
    if (this.#session?.expiresAt && this.#session.expiresAt > Math.floor(Date.now() / 1000) + 30) return this.#session;
    this.#session = this.#storedSession();
    if (this.#session) return this.#session;
    const response = await fetch(`${this.#apiUrl}/api/v1/commerce/sessions`, { method: "POST" });
    if (!response.ok) throw new Error("Could not start chat");
    this.#session = await response.json() as Session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#session));
    this.#emit("conversation_started");
    return this.#session;
  }

  async #submit(): Promise<void> {
    const input = this.#required<HTMLInputElement>("input");
    const message = input.value.trim();
    if (!message || this.#pending) return;
    this.#pending = true;
    input.value = "";
    input.disabled = true;
    this.#required<HTMLButtonElement>(".send").disabled = true;
    this.#appendMessage("user", message);
    const status = this.#appendStatus();
    try {
      const session = await this.#ensureSession();
      const response = await fetch(`${this.#apiUrl}/api/v1/commerce/messages`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${session.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          language: this.#languageFor(message),
          recentMessages: this.#recentMessages.slice(-20),
          pageContext: {
            url: window.location.href,
            pageType: this.#pageType(),
            productSlug: this.#productSlug(),
          },
        }),
      });
      if (!response.ok) {
        if (response.status === 401) localStorage.removeItem(STORAGE_KEY);
        throw new Error("Chat request failed");
      }
      const result = await response.json() as CommerceResponse;
      status.remove();
      const recommendedNames = result.recommendedProducts.map((product) => product.name);
      for (const item of result.messages) this.#appendMessage("assistant", item.text, recommendedNames);
      this.#appendProducts(result.recommendedProducts);
      if (result.handoff) this.#appendHandoff(result.handoff);
      this.#recentMessages.push({ role: "user", content: message });
      for (const item of result.messages) this.#recentMessages.push({ role: "assistant", content: item.text });
      this.#recentMessages = this.#recentMessages.slice(-20);
      this.#emit("message_completed");
    } catch {
      status.className = "message assistant";
      status.removeAttribute("role");
      status.removeAttribute("aria-label");
      status.textContent = "I’m having trouble connecting right now. Please try again in a moment.";
      this.#emit("message_failed");
    } finally {
      this.#pending = false;
      input.disabled = false;
      this.#required<HTMLButtonElement>(".send").disabled = false;
      input.focus();
    }
  }

  #pageType(): "home" | "collection" | "product" | "cart" | "other" {
    const path = window.location.pathname;
    if (path === "/") return "home";
    if (path.startsWith("/collections/")) return "collection";
    if (path.startsWith("/products/")) return "product";
    if (path.startsWith("/cart")) return "cart";
    return "other";
  }

  #languageFor(message: string): "en" | "hi" | "hinglish" {
    if (this.#language !== "auto") return this.#language;
    if (/\p{Script=Devanagari}/u.test(message)) return "hi";
    const hinglishSignals = /\b(?:kya|kyu|kyun|kaise|kaisa|kaunsi|kaun|hai|hain|hoon|hu|haan|nahi|nahin|mujhe|mera|meri|mere|aap|ap|batao|bataiye|chahiye|karna|karu|le sakta|le sakti|kitna|kitni|kab|mein|mai|aur|wala|wali)\b/giu;
    const matches = message.match(hinglishSignals) ?? [];
    return matches.length >= 1 ? "hinglish" : "en";
  }

  #productSlug(): string | null {
    const match = window.location.pathname.match(/^\/products\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
}

if (!customElements.get("muditam-chat")) customElements.define("muditam-chat", MuditamChat);
if (!document.querySelector("muditam-chat")) document.body.append(document.createElement("muditam-chat"));
