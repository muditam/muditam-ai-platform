import { MongoClient } from "mongodb";

function mongoUri(): string | undefined {
  return process.env.MUDITAM_MONGO_URI ?? process.env.MONGO_URI;
}

let client: MongoClient | null = null;

async function database() {
  const uri = mongoUri();
  if (!uri) return null;
  client ??= new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0, serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  return client.db(process.env.MUDITAM_KNOWLEDGE_DB || undefined);
}

// Single shared document — there is only ever one widget deployed today, so a
// per-storefront config table would be premature.
const CONFIG_ID = "default";

export interface WidgetConfig {
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

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
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

export async function getWidgetConfig(): Promise<WidgetConfig> {
  const db = await database();
  if (!db) return DEFAULT_WIDGET_CONFIG;
  const doc = await db.collection("commerce_widget_config").findOne({ _id: CONFIG_ID as unknown as never });
  if (!doc) return DEFAULT_WIDGET_CONFIG;
  const { _id: _discard, ...rest } = doc;
  return { ...DEFAULT_WIDGET_CONFIG, ...rest } as WidgetConfig;
}

export async function saveWidgetConfig(patch: { [K in keyof WidgetConfig]?: WidgetConfig[K] | undefined }): Promise<WidgetConfig> {
  const db = await database();
  if (!db) throw new Error("Database is not configured.");
  const current = await getWidgetConfig();
  const next: WidgetConfig = { ...current };
  for (const key of Object.keys(patch) as Array<keyof WidgetConfig>) {
    const value = patch[key];
    if (value !== undefined) (next[key] as unknown) = value;
  }
  await db.collection("commerce_widget_config").updateOne(
    { _id: CONFIG_ID as unknown as never },
    { $set: next },
    { upsert: true },
  );
  return next;
}
