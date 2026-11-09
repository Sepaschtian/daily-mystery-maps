
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_URL = "https://ourworldindata.org/api/search"
PAGE_SIZE = 100


def fetch_page(page):
    params = urlencode({
        "type": "charts",
        "page": page,
        "hitsPerPage": PAGE_SIZE,
    })

    request = Request(
        f"{API_URL}?{params}",
        headers={"User-Agent": "DailyMysteryMaps/1.0"},
    )

    with urlopen(request, timeout=30) as response:
        return json.load(response)


def main():
    first_page = fetch_page(0)
    total_pages = first_page.get("nbPages", 1)
    results = list(first_page.get("results", []))

    print(f"Search reports {total_pages} pages.")

    for page in range(1, total_pages):
        print(f"Reading page {page + 1} of {total_pages}...")
        data = fetch_page(page)
        results.extend(data.get("results", []))
        time.sleep(0.15)

    # Initially include OWID charts with a built-in world-map view.
    # We will broaden discovery to other geographic data formats later.
    maps_by_slug = {}

    for item in results:
        if item.get("type") != "chart":
            continue

        if "WorldMap" not in item.get("availableTabs", []):
            continue

        slug = item.get("slug")
        if not slug:
            continue

        maps_by_slug[slug] = {
            "slug": slug,
            "title": item.get("title", slug),
            "subtitle": item.get("subtitle", ""),
            "url": item.get("url", ""),
            "availableTabs": item.get("availableTabs", []),
        }

    catalogue = sorted(
        maps_by_slug.values(),
        key=lambda item: item["slug"],
    )

    output_path = Path(__file__).resolve().parent.parent / "catalogue.json"
    output_path.write_text(
        json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"\nFound {len(catalogue)} charts with a WorldMap tab.")
    print(f"Saved catalogue to: {output_path}")


if __name__ == "__main__":
    main()
