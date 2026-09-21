/** Original Effect Latam lockup, cropped to its artwork without changing the asset. */
export function BrandLogo(props: { decorative?: boolean }) {
  return (
    <img
      class="brand-logo"
      src="/logo-header.svg"
      alt={props.decorative ? "" : "Effect Latam"}
      width={1930}
      height={580}
      decoding="async"
    />
  );
}
