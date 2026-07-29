# Product Catalog and MongoDB Seeding — Simple Explanation

## What the static catalog is

The supplied list contains 20 products. It is stored temporarily in:

```text
src/modules/metabolic-assistant/constants/products.ts
```

The product name is used as the current SKU because the supplied data did not
contain a separate SKU code.

Each product has:

- SKU and URL-friendly slug;
- name and category;
- full supplied composition;
- inferred test indication;
- candidate blood-report biomarkers;
- representative key ingredients;
- generic label-directed dosage wording;
- safety notes and contraindications;
- `recommendationStatus: "test_only"`;
- catalog version and active status.

The inferred fields are test data. They are not final clinical, regulatory, or
marketing approvals and can be tuned later.

## Why the static file remains useful

```text
Static catalog
    |
    +-- easy to review in Git
    +-- validated by Zod
    +-- used by tests
    +-- input to the MongoDB seed
```

MongoDB becomes the runtime data source later, while the static file remains the
repeatable seed source.

## Seed flow

```text
npm run seed:metabolic-products
    |
    v
Read and validate .env
    |
    v
Connect using METABOLIC_MONGODB_URI
    |
    v
Validate all 20 static products
    |
    v
bulkWrite with updateOne + upsert by SKU
    |
    v
Verify all 20 SKUs exist
    |
    v
Close MongoDB connection
```

The collection name is:

```text
metabolic_products
```

## Why rerunning is safe

The seed uses the exact SKU as its unique key:

- an existing SKU is updated;
- a missing SKU is inserted;
- running the seed again does not intentionally create duplicates.
- `seededAt` is written only when a product is first inserted, so an unchanged
  rerun is a database no-op.

This is called an idempotent seed.

## How to run

Add the MongoDB URI to `.env`:

```text
METABOLIC_MONGODB_URI=your-value
```

Then run:

```bash
npm run seed:metabolic-products
```

The command logs counts and the collection name. It never prints the MongoDB
URI.

## What to tune later

- replace product-name SKUs with official codes if separate codes exist;
- add approved product URLs;
- replace generic dosage text with approved label dosage;
- review biomarker mappings;
- review contraindications and safety notes;
- change `test_only` only after the appropriate approvals.
