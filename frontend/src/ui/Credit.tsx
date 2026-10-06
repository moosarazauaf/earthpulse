/** Who built this, and where the source is. */
export const AUTHOR = "Muhammad Moosa Raza";
export const AUTHOR_URL = "https://moosarazauaf.github.io/";
export const REPOSITORY_URL = "https://github.com/moosarazauaf/earthpulse";

export function Credit() {
  return (
    <p className="credit-corner">
      Developed by <a href={AUTHOR_URL} target="_blank" rel="noreferrer">{AUTHOR}</a>
      <span aria-hidden="true"> · </span>
      <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">Source</a>
    </p>
  );
}
