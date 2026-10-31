import { site } from '@/config/site';

/** React 19 يرفع وسوم title/meta تلقائياً إلى <head> */
export function Seo({
  title,
  description,
  image,
  path = '',
  jsonLd,
  noindex,
}: {
  title?: string;
  description?: string;
  image?: string;
  path?: string;
  jsonLd?: Record<string, unknown>;
  noindex?: boolean;
}) {
  const fullTitle = title ? `${title} | ${site.nameAr}` : `${site.nameAr} | ${site.tagline}`;
  const desc =
    description ??
    'الماس — هواتف ذكية، أجهزة لوحية، إكسسوارات أصلية وصيانة احترافية في الناصرية، ذي قار. الأسعار بالدينار العراقي.';
  const url = `${site.siteUrl}${path}`;
  return (
    <>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:url" content={url} />
      {image && <meta property="og:image" content={image} />}
      {noindex && <meta name="robots" content="noindex,nofollow" />}
      {jsonLd && <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>}
    </>
  );
}
