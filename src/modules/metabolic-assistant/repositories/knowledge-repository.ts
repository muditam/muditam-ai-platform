import type { Model } from "mongoose";
import type { MetabolicKnowledgeEntryDocument } from "../database/models/metabolic-knowledge-entry.js";

export interface KnowledgeRecord {
  id: string;
  key: string;
  title: string;
  category: string;
  content: string;
  source: {
    name: string;
    url: string;
    reviewedAt: string;
  };
  version: string;
}

export interface KnowledgeRepositoryPort {
  search(question: string, limit: number): Promise<KnowledgeRecord[]>;
}

const queryAliases: Readonly<Record<string, string>> = {
  h1b: "hba1c",
  "hb a1c": "hba1c",
  a1c: "hba1c",
  fbs: "fasting glucose",
  ppbs: "post meal",
};

function searchTerms(question: string): string[] {
  const normalized = question.toLowerCase().replace(/[^a-z0-9%\s]/g, " ");
  const expanded = Object.entries(queryAliases).reduce(
    (value, [alias, replacement]) =>
      value.includes(alias) ? `${value} ${replacement}` : value,
    normalized,
  );
  return Array.from(
    new Set(
      expanded
        .split(/\s+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  );
}

function toRecord(value: Record<string, unknown>): KnowledgeRecord {
  return {
    id: String(value._id),
    key: String(value.key),
    title: String(value.title),
    category: String(value.category),
    content: String(value.content),
    source: value.source as KnowledgeRecord["source"],
    version: String(value.version),
  };
}

export class KnowledgeRepository implements KnowledgeRepositoryPort {
  constructor(
    private readonly model: Model<MetabolicKnowledgeEntryDocument>,
  ) {}

  async search(question: string, limit: number): Promise<KnowledgeRecord[]> {
    const terms = searchTerms(question);
    if (terms.length === 0) return [];
    const keywordMatches = await this.model
      .find({ active: true, keywords: { $in: terms } })
      .limit(limit)
      .lean()
      .exec();
    if (keywordMatches.length > 0) {
      return keywordMatches.map((entry) =>
        toRecord(entry as unknown as Record<string, unknown>),
      );
    }
    const textMatches = await this.model
      .find(
        { active: true, $text: { $search: terms.join(" ") } },
        { score: { $meta: "textScore" } },
      )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean()
      .exec();
    return textMatches.map((entry) =>
      toRecord(entry as unknown as Record<string, unknown>),
    );
  }
}
