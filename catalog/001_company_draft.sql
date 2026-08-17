-- HireBeat new D1 schema
-- Module: catalog
-- Entity: company
-- Status: superseded reference draft
-- Do not execute this file together with 002_recruitment_catalog_draft.sql.
-- The authoritative current G02 draft is 002_recruitment_catalog_draft.sql.

CREATE TABLE company (
    id INTEGER PRIMARY KEY,
    company_uuid TEXT NOT NULL UNIQUE,

    company_name TEXT NOT NULL,
    normalized_company_name TEXT NOT NULL,
    company_website_url TEXT,
    company_linkedin_url TEXT,
    company_description TEXT,

    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),

    default_max_submission_attempts INTEGER NOT NULL DEFAULT 5
        CHECK (default_max_submission_attempts >= 1),

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    CHECK (length(trim(company_uuid)) > 0),
    CHECK (length(trim(company_name)) > 0),
    CHECK (length(trim(normalized_company_name)) > 0)
);

CREATE INDEX idx_company_normalized_name
    ON company (normalized_company_name);

CREATE INDEX idx_company_active_name
    ON company (is_active, company_name);
