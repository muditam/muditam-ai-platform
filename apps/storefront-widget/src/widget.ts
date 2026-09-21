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
  orderTracking?: null | {
    orderName: string;
    status: string;
    statusDetail: string;
    productNames: string[];
    placedAt: string | null;
    courier: string | null;
    trackingNumberMasked: string | null;
    currentLocation: string | null;
    expectedDeliveryDate: string | null;
    latestEventAt: string | null;
  };
  orderTrackings?: Array<NonNullable<CommerceResponse["orderTracking"]>>;
}

interface RecentMessage { role: "user" | "assistant"; content: string }

interface ShopifyProductJson {
  id: number;
  featured_image?: string | { src?: string } | null;
  images?: Array<string | { src?: string }>;
  variants?: Array<{ id: number; available?: boolean }>;
}

interface ProductRating {
  average: number;
  count: number;
}

// Authoritative storefront display values. These intentionally take precedence
// over Judge.me because reviews may still be attached to older Shopify product
// IDs after a product listing is recreated.
const FALLBACK_RATINGS: Record<string, ProductRating> = {
  "sugar-defend-pro": { average: 4.8, count: 2000 },
  "karela-jamun-fizz": { average: 4.8, count: 5000 },
  "berberine-pro": { average: 4.8, count: 800 },
  "heart-defend-pro": { average: 4.8, count: 600 },
  "liver-defend-pro": { average: 4.8, count: 600 },
  "liver-fix": { average: 4.8, count: 3500 },
  "bone-dense": { average: 4.8, count: 900 },
  "core-essentials": { average: 4.8, count: 900 },
  "thyroid-defend-pro": { average: 4.8, count: 400 },
  "snooze-well": { average: 4.8, count: 150 },
  "shilajit-with-gold": { average: 4.8, count: 1500 },
};

interface WidgetConfig {
  themeColor: string;
  botTitle: string;
  openingMessage: string;
  widgetSize: "small" | "medium" | "large";
  launcherSize: "small" | "medium" | "large";
  widgetPosition: "left" | "right";
  gapFromSide: number;
  gapFromBottom: number;
  pulseEffect: boolean;
  pulseColor: string;
  launcherImage: string | null;
  launcherRingColor: string | null;
  nudgeText: string;
  nudgeBackgroundColor: string;
}

// Mirrors DEFAULT_WIDGET_CONFIG in src/commerce/widget-config-store.ts — used
// whenever the config endpoint hasn't loaded yet or is unreachable, so the
// widget still renders with the same look it always has.
const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  themeColor: "#70408f",
  botTitle: "Muditam Expert",
  openingMessage: "Hey 👋 I’m your personal Muditam AI Expert. What can I help you with today?",
  widgetSize: "medium",
  launcherSize: "medium",
  widgetPosition: "right",
  gapFromSide: 22,
  gapFromBottom: 22,
  pulseEffect: false,
  pulseColor: "#22c55e",
  launcherImage: null,
  launcherRingColor: "#70408f",
  nudgeText: "Chat with live agent",
  nudgeBackgroundColor: "#70408f",
};

const WIDGET_SIZE_PRESETS: Record<WidgetConfig["widgetSize"], { panelWidth: number; panelHeight: number }> = {
  small: { panelWidth: 360, panelHeight: 560 },
  medium: { panelWidth: 400, panelHeight: 660 },
  large: { panelWidth: 440, panelHeight: 720 },
};

const LAUNCHER_SIZE_PRESETS: Record<WidgetConfig["launcherSize"], number> = {
  small: 48,
  medium: 56,
  large: 76,
};

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const num = Number.parseInt(value, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value)));
  return `#${[r, g, b].map((channel) => clamp(channel).toString(16).padStart(2, "0")).join("")}`;
}

function darkenHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function tintHex(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function contrastSafeAccent(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.78 ? DEFAULT_WIDGET_CONFIG.themeColor : hex;
}

const STORAGE_KEY = "muditam_ai_storefront_session_v1";

type WidgetLanguage = "auto" | "en" | "hi" | "hinglish";

function configuredLanguage(value: string | undefined): WidgetLanguage {
  return value === "en" || value === "hi" || value === "hinglish" ? value : "auto";
}

function scriptConfiguration(): {
  apiUrl: string;
  language: WidgetLanguage;
  reviewsShopDomain: string;
  reviewsPublicToken: string;
} {
  const script = document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : document.querySelector<HTMLScriptElement>("script[data-muditam-chat]");
  return {
    apiUrl: (script?.dataset.apiUrl ?? "https://api.aichat.muditam.com").replace(/\/$/, ""),
    language: configuredLanguage(script?.dataset.language),
    reviewsShopDomain: script?.dataset.reviewsShopDomain ?? "muditam.myshopify.com",
    reviewsPublicToken: script?.dataset.reviewsPublicToken ?? "iTi8cj-8vCPFfNyZt5UrVeQzbMM",
  };
}

const initialConfiguration = scriptConfiguration();

class MuditamChat extends HTMLElement {
  readonly #root: ShadowRoot;
  readonly #apiUrl: string;
  readonly #language: WidgetLanguage;
  readonly #reviewsShopDomain: string;
  readonly #reviewsPublicToken: string;
  #session: Session | null = null;
  #recentMessages: RecentMessage[] = [];
  #conversationLanguage: "en" | "hi" | "hinglish" | null = null;
  #pending = false;
  #productDataCache = new Map<string, Promise<ShopifyProductJson | null>>();
  #ratingCache = new Map<number, Promise<ProductRating | null>>();
  #nudgeShowTimer: number | null = null;
  #nudgeHideTimer: number | null = null;
  #nudgeTypingTimer: number | null = null;
  #nudgeText = DEFAULT_WIDGET_CONFIG.nudgeText;
  #hasTypedNudge = false;

  constructor() {
    super();
    this.#apiUrl = this.dataset.apiUrl?.replace(/\/$/, "") || initialConfiguration.apiUrl;
    this.#language = this.dataset.language ? configuredLanguage(this.dataset.language) : initialConfiguration.language;
    this.#reviewsShopDomain = this.dataset.reviewsShopDomain || initialConfiguration.reviewsShopDomain;
    this.#reviewsPublicToken = this.dataset.reviewsPublicToken || initialConfiguration.reviewsPublicToken;
    this.#root = this.attachShadow({ mode: "open" });
    this.#root.innerHTML = `
      <style>${styles}</style>
      <button class="launcher" type="button" aria-label="Chat with Muditam" aria-expanded="false">
        <span class="pulse-ring" aria-hidden="true"></span>
        <img class="launcher-image" alt="" hidden />
        <svg class="launcher-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.48 8.8 8.8 0 0 1-3.35-.88L4 19.5l1.42-4.04A7.5 7.5 0 1 1 20 11.5Z"/></svg>
        <span class="online-dot" aria-hidden="true"></span>
      </button>
      <div class="launcher-nudge" role="status" aria-hidden="true">
        <button class="nudge-copy" type="button">Chat with live agent</button>
        <button class="nudge-close" type="button" aria-label="Dismiss chat invitation">×</button>
      </div>
      <section class="panel" role="dialog" aria-label="Muditam AI Expert" hidden>
        <header class="header">
          <div class="brand-mark" aria-hidden="true"><img class="brand-image" alt="" hidden /><span>m</span></div>
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
    const openChat = (): void => {
      this.#hideNudge();
      panel.hidden = false;
      launcher.setAttribute("aria-expanded", "true");
      this.#required<HTMLInputElement>("input").focus();
    };
    launcher.addEventListener("click", openChat);
    launcher.addEventListener("mouseenter", () => { if (panel.hidden) this.#showNudge(false); });
    launcher.addEventListener("focus", () => { if (panel.hidden) this.#showNudge(false); });
    launcher.addEventListener("mouseleave", () => this.#scheduleNudgeHide(500));
    this.#required<HTMLButtonElement>(".nudge-copy").addEventListener("click", openChat);
    this.#required<HTMLButtonElement>(".nudge-close").addEventListener("click", () => this.#hideNudge());
    this.#required<HTMLElement>(".launcher-nudge").addEventListener("mouseenter", () => this.#clearNudgeHideTimer());
    this.#required<HTMLElement>(".launcher-nudge").addEventListener("mouseleave", () => this.#scheduleNudgeHide(300));
    close.addEventListener("click", () => {
      panel.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
    });
    this.#required<HTMLFormElement>("form").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#submit();
    });
    void this.#initializeConfig();
    // Fire-and-forget: lets the dashboard compute "Interaction %" (chat visitors
    // vs. all site visitors) without waiting on this or blocking widget render.
    void this.#ensureSession(true).then(() => this.#emit("pageview")).catch(() => {});
  }

  disconnectedCallback(): void {
    if (this.#nudgeShowTimer !== null) window.clearTimeout(this.#nudgeShowTimer);
    if (this.#nudgeTypingTimer !== null) window.clearInterval(this.#nudgeTypingTimer);
    this.#clearNudgeHideTimer();
  }

  #clearNudgeHideTimer(): void {
    if (this.#nudgeHideTimer !== null) window.clearTimeout(this.#nudgeHideTimer);
    this.#nudgeHideTimer = null;
  }

  #scheduleNudgeHide(delay: number): void {
    this.#clearNudgeHideTimer();
    this.#nudgeHideTimer = window.setTimeout(() => this.#hideNudge(), delay);
  }

  #showNudge(autoHide: boolean): void {
    const nudge = this.#required<HTMLElement>(".launcher-nudge");
    this.#clearNudgeHideTimer();
    nudge.classList.add("visible");
    nudge.setAttribute("aria-hidden", "false");
    const copy = this.#required<HTMLButtonElement>(".nudge-copy");
    copy.setAttribute("aria-label", this.#nudgeText);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (autoHide && !this.#hasTypedNudge && !reduceMotion) {
      this.#hasTypedNudge = true;
      copy.textContent = "";
      let index = 0;
      this.#nudgeTypingTimer = window.setInterval(() => {
        index += 1;
        copy.textContent = this.#nudgeText.slice(0, index);
        if (index >= this.#nudgeText.length) {
          if (this.#nudgeTypingTimer !== null) window.clearInterval(this.#nudgeTypingTimer);
          this.#nudgeTypingTimer = null;
          this.#scheduleNudgeHide(5_000);
        }
      }, 45);
      return;
    }
    copy.textContent = this.#nudgeText;
    if (autoHide) this.#scheduleNudgeHide(5_000);
  }

  #hideNudge(): void {
    const nudge = this.#required<HTMLElement>(".launcher-nudge");
    this.#clearNudgeHideTimer();
    nudge.classList.remove("visible");
    nudge.setAttribute("aria-hidden", "true");
    if (this.#nudgeTypingTimer !== null) window.clearInterval(this.#nudgeTypingTimer);
    this.#nudgeTypingTimer = null;
  }

  async #initializeConfig(): Promise<void> {
    const config = await this.#fetchWidgetConfig();
    this.#applyWidgetConfig(config);
    this.#appendMessage("assistant", config.openingMessage);
    const launcherImage = this.#required<HTMLImageElement>(".launcher-image");
    if (config.launcherImage) {
      // `complete` can become true for a data URL before the browser has decoded
      // and painted it. Revealing at that point causes a one-frame flash of the
      // colored fallback launcher. `decode()` resolves only when the portrait is
      // ready to render; the timeout prevents a corrupt image blocking the widget.
      await Promise.race([
        launcherImage.decode().catch(() => undefined),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1_500)),
      ]);
    }
    this.setAttribute("data-ready", "true");
    const panel = this.#required<HTMLElement>(".panel");
    this.#nudgeShowTimer = window.setTimeout(() => { if (panel.hidden) this.#showNudge(true); }, 3_000);
  }

  async #fetchWidgetConfig(): Promise<WidgetConfig> {
    try {
      const response = await fetch(`${this.#apiUrl}/api/v1/commerce/widget-config`, { cache: "no-store" });
      if (!response.ok) return DEFAULT_WIDGET_CONFIG;
      return { ...DEFAULT_WIDGET_CONFIG, ...(await response.json() as Partial<WidgetConfig>) };
    } catch {
      return DEFAULT_WIDGET_CONFIG;
    }
  }

  #applyWidgetConfig(config: WidgetConfig): void {
    const accent = contrastSafeAccent(config.themeColor);
    this.style.setProperty("--muditam-purple", accent);
    this.style.setProperty("--muditam-purple-dark", darkenHex(accent, 0.18));
    this.style.setProperty("--muditam-purple-soft", tintHex(accent, 0.92));
    this.style.setProperty("--muditam-gap-side", `${config.gapFromSide}px`);
    this.style.setProperty("--muditam-gap-bottom", `${config.gapFromBottom}px`);
    const size = WIDGET_SIZE_PRESETS[config.widgetSize];
    const launcherSize = LAUNCHER_SIZE_PRESETS[config.launcherSize];
    this.style.setProperty("--muditam-launcher-size", `${launcherSize}px`);
    this.style.setProperty("--muditam-panel-width", `${size.panelWidth}px`);
    this.style.setProperty("--muditam-panel-height", `${size.panelHeight}px`);
    this.style.setProperty("--muditam-pulse-color", config.pulseColor);
    const whiteNudge = config.nudgeBackgroundColor.toLowerCase() === "#ffffff";
    this.style.setProperty("--muditam-nudge-background", config.nudgeBackgroundColor);
    this.style.setProperty("--muditam-nudge-text", "#ffffff");
    this.style.setProperty("--muditam-nudge-border", whiteNudge ? "#17131a" : "transparent");
    const nudge = this.#required<HTMLElement>(".launcher-nudge");
    nudge.style.backgroundColor = config.nudgeBackgroundColor;
    nudge.style.borderColor = whiteNudge ? "#17131a" : "transparent";
    this.setAttribute("data-position", config.widgetPosition);
    if (config.pulseEffect) this.setAttribute("data-pulse", "true");
    else this.removeAttribute("data-pulse");
    const brandName = this.#root.querySelector(".brand strong");
    if (brandName) brandName.textContent = config.botTitle;
    const image = this.#required<HTMLImageElement>(".launcher-image");
    const brandImage = this.#required<HTMLImageElement>(".brand-image");
    const brandFallback = this.#required<HTMLElement>(".brand-mark span");
    const icon = this.#required<SVGElement>(".launcher-icon");
    if (config.launcherImage) {
      image.src = config.launcherImage;
      image.hidden = false;
      brandImage.src = config.launcherImage;
      brandImage.hidden = false;
      brandFallback.hidden = true;
      icon.setAttribute("hidden", "");
      this.setAttribute("data-launcher-image", "true");
      if (config.launcherRingColor) {
        this.style.setProperty("--muditam-launcher-ring", config.launcherRingColor);
        this.setAttribute("data-launcher-ring", "true");
      } else {
        this.removeAttribute("data-launcher-ring");
      }
    } else {
      image.removeAttribute("src");
      image.hidden = true;
      brandImage.removeAttribute("src");
      brandImage.hidden = true;
      brandFallback.hidden = false;
      icon.removeAttribute("hidden");
      this.removeAttribute("data-launcher-image");
      this.removeAttribute("data-launcher-ring");
    }
    this.#nudgeText = config.nudgeText?.trim() || DEFAULT_WIDGET_CONFIG.nudgeText;
    this.#required<HTMLButtonElement>(".nudge-copy").textContent = this.#nudgeText;
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

  #shopifyProduct(productUrl: string): Promise<ShopifyProductJson | null> {
    const cached = this.#productDataCache.get(productUrl);
    if (cached) return cached;
    const request = (async () => {
      try {
        const url = new URL(productUrl, window.location.origin);
        url.pathname = `${url.pathname.replace(/\/$/u, "")}.js`;
        url.search = "";
        url.hash = "";
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) return null;
        return await response.json() as ShopifyProductJson;
      } catch {
        return null;
      }
    })();
    this.#productDataCache.set(productUrl, request);
    return request;
  }

  async #shopifyImage(productUrl: string): Promise<string | null> {
    const product = await this.#shopifyProduct(productUrl);
    if (!product) return null;
    const featured = typeof product.featured_image === "string"
      ? product.featured_image
      : product.featured_image?.src;
    const firstImage = product.images?.map((image) => typeof image === "string" ? image : image.src).find(Boolean);
    const source = featured || firstImage;
    return source ? new URL(source, new URL(productUrl, window.location.origin).origin).href : null;
  }

  async #addToCart(product: CommerceResponse["recommendedProducts"][number], button: HTMLButtonElement): Promise<void> {
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Adding…";
    button.classList.remove("error");
    try {
      const shopifyProduct = await this.#shopifyProduct(product.productUrl);
      const variant = shopifyProduct?.variants?.find((item) => item.available !== false) ?? shopifyProduct?.variants?.[0];
      if (!variant) throw new Error("No purchasable variant found");
      const response = await fetch(new URL("/cart/add.js", window.location.origin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{
            id: variant.id,
            quantity: 1,
            properties: { _muditam_conversation_id: this.#session?.conversationId ?? "" },
          }],
        }),
      });
      if (!response.ok) throw new Error("Add to cart failed");
      button.textContent = "Added ✓";
      this.#emit("add_to_cart_clicked", product.productSlug);
      window.setTimeout(() => {
        button.disabled = false;
        button.textContent = originalLabel;
      }, 2500);
    } catch {
      button.classList.add("error");
      button.textContent = "Try again";
      button.disabled = false;
    }
  }

  #judgeMeRating(productExternalId: number): Promise<ProductRating | null> {
    const cached = this.#ratingCache.get(productExternalId);
    if (cached) return cached;
    const request = (async () => {
      try {
        const url = new URL("https://judge.me/api/v1/widgets/product_review");
        url.searchParams.set("shop_domain", this.#reviewsShopDomain);
        url.searchParams.set("api_token", this.#reviewsPublicToken);
        url.searchParams.set("external_id", String(productExternalId));
        url.searchParams.set("platform", "shopify");
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (!response.ok) return null;
        const data = await response.json() as { widget?: string };
        const average = data.widget?.match(/data-average-rating=['"]([^'"]+)['"]/)?.[1];
        const count = data.widget?.match(/data-number-of-reviews=['"]([^'"]+)['"]/)?.[1];
        const averageNumber = average ? Number.parseFloat(average) : NaN;
        const countNumber = count ? Number.parseInt(count, 10) : NaN;
        if (!Number.isFinite(averageNumber) || !Number.isFinite(countNumber) || countNumber <= 0) return null;
        return { average: averageNumber, count: countNumber };
      } catch {
        return null;
      }
    })();
    this.#ratingCache.set(productExternalId, request);
    return request;
  }

  #renderStars(average: number): string {
    const rounded = Math.round(average * 2) / 2;
    return Array.from({ length: 5 }, (_, index) => {
      const position = index + 1;
      if (rounded >= position) return "★";
      if (rounded + 0.5 === position) return "⯨";
      return "☆";
    }).join("");
  }

  #appendProducts(products: CommerceResponse["recommendedProducts"]): void {
    if (!products.length) return;
    const carousel = document.createElement("div");
    carousel.className = "product-carousel";
    const container = document.createElement("div");
    container.className = "products";
    container.classList.add(`product-count-${Math.min(products.length, 3)}`);
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
      const rating = document.createElement("span");
      rating.className = "product-rating";
      link.append(media, name, rating);
      const storefrontRating = FALLBACK_RATINGS[product.productSlug];
      const ratingRequest = storefrontRating
        ? Promise.resolve(storefrontRating)
        : this.#shopifyProduct(product.productUrl).then((shopifyProduct) => {
          if (!shopifyProduct) return null;
          return this.#judgeMeRating(shopifyProduct.id);
        });
      void ratingRequest.then((rated) => {
        if (!rated) return;
        const stars = document.createElement("span");
        stars.className = "product-rating-stars";
        stars.textContent = this.#renderStars(rated.average);
        stars.setAttribute("aria-hidden", "true");
        const count = document.createElement("span");
        count.textContent = `${rated.average.toFixed(1)} (${rated.count})`;
        rating.setAttribute("aria-label", `Rated ${rated.average.toFixed(1)} out of 5 from ${rated.count} reviews`);
        rating.append(stars, count);
      });
      const addToCart = document.createElement("button");
      addToCart.type = "button";
      addToCart.className = "product-add-to-cart";
      addToCart.textContent = "Add to Cart";
      addToCart.setAttribute("aria-label", `Add ${product.name} to cart`);
      addToCart.addEventListener("click", () => void this.#addToCart(product, addToCart));
      card.append(link, addToCart);
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
    if (products.length > 2) {
      previous.hidden = true;
      next.hidden = true;
      carousel.append(previous, next);
      const updateNavigation = (): void => {
        const overflow = container.scrollWidth > container.clientWidth + 2;
        previous.hidden = !overflow;
        next.hidden = !overflow;
      };
      requestAnimationFrame(updateNavigation);
      new ResizeObserver(updateNavigation).observe(container);
    }
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

  #appendOrderTracking(tracking: NonNullable<CommerceResponse["orderTracking"]>): void {
    const card = document.createElement("section");
    card.className = "order-tracking-card";
    card.setAttribute("aria-label", `Tracking details for ${tracking.orderName}`);
    const heading = document.createElement("div");
    heading.className = "order-tracking-heading";
    const orderName = document.createElement("strong");
    orderName.textContent = tracking.orderName;
    const badge = document.createElement("span");
    badge.textContent = tracking.status;
    heading.append(orderName, badge);
    card.append(heading);
    const details = [
      tracking.productNames.length ? ["Products", tracking.productNames.join(", ")] : null,
      tracking.placedAt ? ["Placed on", new Date(tracking.placedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })] : null,
      tracking.courier ? ["Courier", tracking.courier] : null,
      tracking.trackingNumberMasked ? ["Tracking", tracking.trackingNumberMasked] : null,
      tracking.currentLocation ? ["Current location", tracking.currentLocation] : null,
      tracking.expectedDeliveryDate ? ["Expected delivery", new Date(tracking.expectedDeliveryDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })] : null,
      tracking.latestEventAt ? ["Last updated", new Date(tracking.latestEventAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })] : null,
    ].filter((item): item is [string, string] => Boolean(item));
    for (const [label, value] of details) {
      const row = document.createElement("div");
      row.className = "order-tracking-row";
      const key = document.createElement("span");
      key.textContent = label;
      const text = document.createElement("strong");
      text.textContent = value;
      row.append(key, text);
      card.append(row);
    }
    this.#required<HTMLElement>(".messages").append(card);
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

  // `silent` is used by the background pageview beacon: it still needs a session
  // (visitorId) to attribute the pageview to, but merely loading a page with the
  // widget installed isn't a real "conversation started" — only an actual chat
  // submission should count as one.
  async #ensureSession(silent = false): Promise<Session> {
    if (this.#session?.expiresAt && this.#session.expiresAt > Math.floor(Date.now() / 1000) + 30) return this.#session;
    this.#session = this.#storedSession();
    if (this.#session) return this.#session;
    const response = await fetch(`${this.#apiUrl}/api/v1/commerce/sessions`, { method: "POST" });
    if (!response.ok) throw new Error("Could not start chat");
    this.#session = await response.json() as Session;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#session));
    if (!silent) this.#emit("conversation_started");
    return this.#session;
  }

  async #submit(): Promise<void> {
    const input = this.#required<HTMLInputElement>("input");
    const message = input.value.trim();
    if (!message || this.#pending) return;
    this.#pending = true;
    input.value = "";
    // Only the send button is blocked while a reply is in flight — `#pending`
    // already stops a duplicate submit, so there's no need to freeze the input
    // itself and make the chat feel locked up while the user waits.
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
      if (result.orderTrackings?.length) {
        for (const tracking of result.orderTrackings) this.#appendOrderTracking(tracking);
      } else if (result.orderTracking) {
        this.#appendOrderTracking(result.orderTracking);
      }
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
    if (/\p{Script=Devanagari}/u.test(message)) {
      this.#conversationLanguage = "hi";
      return "hi";
    }
    const hinglishPhrase = /\b(?:le raha|le rahi|le rahe|kha raha|kha rahi|kha rahe|use kar|start kar|order kar|cart mein|ke liye|isliye|iske liye|uske liye|kya karu|kya lena|kaise lena|kitni baar|safe hai|theek hai|sahi hai|diabetes hai|sugar hai|insulin le|medicine le|dawai le|dawa le)\b/iu;
    if (hinglishPhrase.test(message)) {
      this.#conversationLanguage = "hinglish";
      return "hinglish";
    }
    const hinglishSignals = /\b(?:kya|kyu|kyun|kaise|kaisa|kaisi|kaunsi|kaun|hai|hain|hoon|hun|hu|haan|nahi|nahin|mujhe|mera|meri|mere|aap|ap|batao|bataiye|chahiye|karna|karu|karo|lena|leta|leti|sakta|sakti|kitna|kitni|ka|ki|ke|kab|mein|mai|aur|raha|rahi|rahe|wala|wali|liye|abhi|thoda|zyada|jaankari)\b/giu;
    const matches = message.match(hinglishSignals) ?? [];
    const uniqueMatches = new Set(matches.map((item) => item.toLocaleLowerCase("en-IN")));
    const romanHindiPronoun = /\b(?:mai|mein|mujhe|mera|meri|mere|aap|ap|ham|hum)\b/iu.test(message);
    const romanHindiVerb = /\b(?:hu|hoon|hun|hai|hain|raha|rahi|rahe|karna|karu|karo|lena|leta|leti|chahiye|sakta|sakti|batao|bataiye)\b/iu.test(message);
    const englishIntent = /\b(?:what|which|how|can|could|would|please|tell|need|want|should|does|is|are|do|have|taking|product|order|price|support|doctor|dietitian)\b/iu.test(message);
    if ((romanHindiPronoun && romanHindiVerb) || uniqueMatches.size >= 2 || (uniqueMatches.size === 1 && englishIntent)) {
      this.#conversationLanguage = "hinglish";
      return "hinglish";
    }
    const words = message.toLocaleLowerCase("en-IN").match(/[a-z]+/gu) ?? [];
    const clearlyEnglish = words.length >= 4
      && /\b(?:what|which|how|can|could|would|please|tell|need|want|should|does|is|are)\b/iu.test(message);
    if (clearlyEnglish) {
      this.#conversationLanguage = "en";
      return "en";
    }
    return this.#conversationLanguage ?? "en";
  }

  #productSlug(): string | null {
    const match = window.location.pathname.match(/^\/products\/([^/?#]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
}

if (!customElements.get("muditam-chat")) customElements.define("muditam-chat", MuditamChat);
if (!document.querySelector("muditam-chat")) document.body.append(document.createElement("muditam-chat"));
