export function createOrganizationStructuredData(company, origin = "https://solven.jp/") {
  const required = ["legal_name", "registered_postal_code", "registered_address", "business_email"];
  for (const field of required) {
    if (typeof company?.[field] !== "string" || !company[field].trim()) throw new Error(`organization_company_field_missing:${field}`);
  }
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}#organization`,
    name: company.legal_name,
    url: origin,
    email: company.business_email,
    address: {
      "@type": "PostalAddress",
      postalCode: company.registered_postal_code,
      streetAddress: company.registered_address,
      addressCountry: "JP"
    }
  };
}

export function serializeStructuredData(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
