#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(appRoot, "public", "data", "owned-site.json");
const source = JSON.parse(fs.readFileSync(target, "utf8"));

const hplp = source.pricing?.hplp?.map((plan) => ({
  plan_id: plan.plan_id,
  name: plan.name,
  technology: plan.technology,
  production_consideration_ex_tax: plan.production_consideration_ex_tax,
  production_consideration_in_tax_at_10pct: plan.production_consideration_in_tax_at_10pct,
  production_payment_schedule: plan.production_payment_schedule?.map((item) => ({
    label: item.label,
    percentage: item.percentage,
    amount_ex_tax: item.amount_ex_tax
  })) ?? null,
  maintenance: plan.maintenance ? {
    minimum_months: plan.maintenance.minimum_months,
    monthly_fee_ex_tax: plan.maintenance.monthly_fee_ex_tax
  } : null,
  minimum_contract_total_ex_tax: plan.minimum_contract_total_ex_tax,
  minimum_contract_total_in_tax_at_10pct: plan.minimum_contract_total_in_tax_at_10pct,
  maintenance_monthly_from_ex_tax: plan.maintenance_monthly_from_ex_tax ?? null,
  maintenance_minimum_months: plan.maintenance_minimum_months ?? null,
  public_fixed_price: plan.public_fixed_price,
  quote_range_ex_tax: plan.quote_range_ex_tax,
  standard_scope: plan.standard_scope,
  standard_delivery_business_days: plan.standard_delivery_business_days ?? null
})) ?? [];

const webapp = source.pricing?.webapp?.map((plan) => ({
  plan_id: plan.plan_id,
  name: plan.name,
  starting_price: plan.starting_price,
  screens_guide: plan.screens_guide,
  roles_guide: plan.roles_guide
})) ?? [];

if (source.canonical?.version !== "1.2.0" || source.canonical?.as_of !== "2026-07-20") throw new Error("owned_site_canonical_version_invalid");
if (hplp.filter((plan) => plan.public_fixed_price).some((plan) => plan.production_payment_schedule?.map((item) => item.percentage).join(",") !== "0.4,0.3,0.3")) {
  throw new Error("owned_site_payment_schedule_invalid");
}

const projected = {
  canonical: {
    id: source.canonical.id,
    version: source.canonical.version,
    as_of: source.canonical.as_of
  },
  brand: {
    message: source.brand.message,
    catchcopy: source.brand.catchcopy
  },
  company: {
    legal_name: source.company.legal_name,
    representative_role: source.company.representative_role,
    representative_name: source.company.representative_name,
    registered_postal_code: source.company.registered_postal_code,
    registered_address: source.company.registered_address,
    business_email: source.company.business_email
  },
  pricing: {
    tax_display: source.pricing.tax_display,
    hplp,
    webapp,
    requirements_services: source.pricing.requirements_services,
    webapp_maintenance: source.pricing.webapp_maintenance,
    additional_work: source.pricing.additional_work
  }
};

fs.writeFileSync(target, `${JSON.stringify(projected, null, 2)}\n`, "utf8");
process.stdout.write("Projected owned-site canonical data for public delivery.\n");
