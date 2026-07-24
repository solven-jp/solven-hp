const allowedServices = new Set(["HP", "LP", "Webアプリ", "保守", "未定"]);

export function cleanString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function validateLead(input = {}) {
  const lead = {
    company: cleanString(input.company, 120),
    name: cleanString(input.name, 80),
    email: cleanString(input.email, 254).toLowerCase(),
    phone: cleanString(input.phone, 40),
    service: cleanString(input.service, 40),
    timing: cleanString(input.timing, 80),
    message: cleanString(input.message, 4000),
    website: cleanString(input.website, 200),
    privacy_consent: input.privacy_consent === true,
    utm_source: cleanString(input.utm_source, 120),
    utm_medium: cleanString(input.utm_medium, 120),
    utm_campaign: cleanString(input.utm_campaign, 120),
    utm_content: cleanString(input.utm_content, 120),
    landing_page: cleanString(input.landing_page, 500),
    referrer: cleanString(input.referrer, 500)
  };

  if (lead.website) return { error: "spam_rejected", status: 400 };
  if (!lead.name || !lead.email || !lead.service || lead.message.length < 10 || !lead.privacy_consent) {
    return { error: "required_fields_missing", status: 400 };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return { error: "invalid_email", status: 400 };
  if (!allowedServices.has(lead.service)) return { error: "invalid_service", status: 400 };
  return { lead };
}
