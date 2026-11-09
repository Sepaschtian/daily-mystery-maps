
import csv
import io
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

BASE_URL = "https://ourworldindata.org/grapher/"
PROJECT_FOLDER = Path(__file__).resolve().parent.parent

CATALOGUE_FILE = PROJECT_FOLDER / "catalogue.json"
OUTPUT_FILE = PROJECT_FOLDER / "geography-audit.json"

# Inspect 60 charts spread throughout the catalogue.
SAMPLE_SIZE = 60


def download(url):
    request = Request(
        url,
        headers={"User-Agent": "DailyMysteryMaps/1.0"}
    )

    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def inspect_chart(item):
    slug = item["slug"]
    print(f"Checking: {slug}")

    result = {
        "slug": slug,
        "title": item.get("title", slug),
        "url": item.get("url", ""),
        "status": "unknown",
        "columns": [],
        "geography_clues": []
    }

    try:
        csv_text = download(BASE_URL + slug + ".csv")

        reader = csv.DictReader(io.StringIO(csv_text))
        columns = reader.fieldnames or []

        result["columns"] = columns

        lower_columns = {
            column.lower().strip()
            for column in columns
        }

        latitude_names = {"latitude", "lat"}
        longitude_names = {"longitude", "lon", "lng"}

        has_latitude = bool(lower_columns & latitude_names)
        has_longitude = bool(lower_columns & longitude_names)

        if has_latitude and has_longitude:
            result["geography_clues"].append("latitude-longitude")

        if "code" in lower_columns:
            result["geography_clues"].append("geographic-code")

        if "entity" in lower_columns:
            result["geography_clues"].append("entity-name")

        # Inspect a few rows for unusual geographic identifiers.
        unusual_codes = set()
        sample_rows = []

        for row in reader:
            code = (row.get("Code") or "").strip()

            if code and not (
                len(code) == 3 and code.isalpha()
            ):
                unusual_codes.add(code)

            if len(sample_rows) < 3:
                sample_rows.append(row)

        result["unusual_codes"] = sorted(unusual_codes)[:20]
        result["sample_rows"] = sample_rows

        if has_latitude and has_longitude:
            result["status"] = "possible-point-map"
        elif unusual_codes:
            result["status"] = "possible-non-country-geography"
        elif "Code" in columns:
            result["status"] = "country-code-data"
        else:
            result["status"] = "needs-review"

    except Exception as error:
        result["status"] = "download-failed"
        result["error"] = str(error)

    return result


def main():
    with open(CATALOGUE_FILE, encoding="utf-8") as file:
        catalogue = json.load(file)

    if len(catalogue) <= SAMPLE_SIZE:
        sample = catalogue
    else:
        # Select charts evenly across the catalogue.
        indexes = [
            round(i * (len(catalogue) - 1) / (SAMPLE_SIZE - 1))
            for i in range(SAMPLE_SIZE)
        ]
        sample = [catalogue[index] for index in indexes]

    results = []

    for item in sample:
        results.append(inspect_chart(item))
        time.sleep(0.2)

    OUTPUT_FILE.write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8"
    )

    print()
    print("GEOGRAPHY AUDIT COMPLETE")
    print(f"Charts inspected: {len(results)}")
    print(
        "Possible point maps:",
        sum(r["status"] == "possible-point-map" for r in results)
    )
    print(
        "Possible non-country geography:",
        sum(r["status"] == "possible-non-country-geography" for r in results)
    )
    print(
        "Country-code datasets:",
        sum(r["status"] == "country-code-data" for r in results)
    )
    print(f"Report saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
