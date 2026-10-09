# Viola catalog upload

Put your files here, then tell Claude they are uploaded.

- `products-template.csv`: copy it, fill one row per product, save as `products.csv` (Excel or Google Sheets can export CSV; an .xlsx file is fine too). Delete the example row.
  - Separate several colours, sizes or photos with `|`.
  - `stock_per_size`: e.g. `S:2|M:0|L:1`, or write `made to order`.
  - Leave `fabric` and `care` empty if you are not certain. Nothing is invented.
  - Prices in Iraqi dinar, numbers only (85000, not 85,000 IQD).
- `photos/`: product photos named as in the `photos` column. Portrait 4:5, at least 2000px on the long side, 3–6 per product.
- `slideshow/`: 3–5 best images for the opening slideshow (wide 16:9, plus portrait 4:5 versions for phones if you have them).
- `logo.svg` or `logo.png` if you have a logo.
- `policies.txt`: delivery areas, prices and times; returns or exchange rules; your size chart; contact details to show (WhatsApp, email, Instagram handle).

Upload on GitHub: open this folder → Add file → Upload files → drag the files in → Commit changes.
