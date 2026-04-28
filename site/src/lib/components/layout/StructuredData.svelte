<script lang="ts">
  /**
   * Layout-level JSON-LD structured data injector. Renders WebSite +
   * Organization schemas in the page head. Mounted from +layout.svelte
   * so every page emits the same canonical metadata.
   *
   * Why two schemas, not one:
   *   - WebSite: Google sitelinks-search-box eligibility (cmd-K maps to /search)
   *   - Organization: brand-knowledge-panel signals (logo, name, URL)
   *
   * Why no per-page schema today: spec lists JSON-LD for SEO. Per-page
   * Article/Dataset/etc. schemas are richer but require deciding the right
   * type per route. Deferred to P6.
   *
   * pageUrl: the FULLY QUALIFIED canonical URL of the current page.
   * Computed in +layout.svelte from $page.url.href. Passed as a prop so
   * the test can inject deterministic values.
   */
  import { SITE_ROOT } from '$lib/shared/site';

  let { pageUrl }: { pageUrl: string } = $props();

  // JSON-LD XSS hardening helper. Even though today's schemas are static,
  // emitting a literal less-than-slash inside a script body can break out
  // of the tag. Standard Next.js / Remix idiom is to JSON.stringify then
  // replace less-than with its Unicode escape — the JSON parser still
  // accepts the escape, but no closing-script sequence can appear in the
  // output. Future schemas with dynamic data (run notes, model
  // descriptions) inherit the safeguard for free.
  function jsonLd(schema: unknown): string {
    const LT = String.fromCharCode(60);
    const safeJson = JSON.stringify(schema).split(LT).join('\\u003c');
    return LT + 'script type="application/ld+json">' + safeJson + LT + '/script>';
  }

  // Build WebSite schema. The `url` property is the SITE root (NOT the
  // current page) per https://schema.org/WebSite — the WebSite schema
  // describes the whole site; per-page canonical is the <link>.

  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'CentralGauge',
    description: 'Open-source benchmark for evaluating LLMs on AL code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central.',
    url: SITE_ROOT,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_ROOT}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'CentralGauge',
    url: SITE_ROOT,
    sameAs: [
      'https://github.com/SShadowS/CentralGauge',
    ],
  };
</script>

{@html jsonLd(websiteSchema)}
{@html jsonLd(organizationSchema)}
