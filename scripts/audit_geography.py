
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

SAMPLE_SIZE = 60

# Common OWID aggregate codes.
AGGREGATE_CODES = {
    "OWID_WRL",
    "OWID_EUR",
    "OWID_NAM",
    "OWID_SAM",
    "OWID_AFR",
    "OWID_ASI",
    "OWID_OCE",
    "OWID_MEA",
    "OWID_EUN",
    "OWID_EUU",
    "OWID_NIR",
}

INCOME_TERMS = [
    "low income",
    "lower middle income",
    "upper middle income",
    "high income",
    "income group",
]

REGION_TERMS = [
    "sub-saharan africa",
    "north africa",
    "northern africa",
    "eastern africa",
    "western africa",
    "southern africa",
    "central africa",
    "europe and central asia",
    "east asia",
    "south asia",
    "southeast asia",
    "south-east asia",
    "latin america",
    "caribbean",
    "middle east",
    "north america",
    "northern america",
    "south america",
    "oceania",
    "world regions",
    "european union",
    "europe",
    "asia",
    "africa",
]

SPECIAL_TERMS = [
    "world",
    "international",
    "global",
    "developing countries",
    "developed countries",
    "least developed countries",
    "small island",
    "landlocked developing",
    "fragile and conflict",
]


def download(url):
    request = Request(
        url,
        headers={"User-Agent": "DailyMysteryMaps/1.0"}
    )

    with urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def classify_entity(entity, code):
    name = (entity or "").strip().lower()
    code = (code or "").strip().upper()

    if any(term in name for term in INCOME_TERMS):
        return "income-group"

    if any(term in name for term in REGION_TERMS):
        return "geographic-region"

    if (
        code in AGGREGATE_CODES
        or code.startswith("OWID_")
        or any(term in name for term in SPECIAL_TERMS)
    ):
        return "statistical-aggregate"

    if code and len(code) == 3 and code.isalpha():
        return "iso3-country-or-territory"

    if code:
        return "other-geographic-code"

    return "entity-without-code"


def inspect_chart(item):
    slug = item["slug"]

    print(f"Checking: {slug}")

    result = {
        "slug": slug,
        "title": item.get("title", slug),
        "url": item.get("url", ""),
        "status": "unknown",
        "columns": [],
        "entity_counts": {},
        "entity_examples": {},
        "has_latitude_longitude": False,
        "coordinate_examples": [],
        "notes": []
    }

    try:
        csv_text = download(BASE_URL + slug + ".csv")

        reader = csv.DictReader(io.StringIO(csv_text))
        columns = reader.fieldnames or []

        result["columns"] = columns

        lower_columns = {
            column.lower().strip(): column
            for column in columns
        }

        latitude_column = (
            lower_columns.get("latitude")
            or lower_columns.get("lat")
        )

        longitude_column = (
            lower_columns.get("longitude")
            or lower_columns.get("lon")
            or lower_columns.get("lng")
        )

        entity_column = lower_columns.get("entity")
        code_column = lower_columns.get("code")

        counts = {}
        examples = {}
        coordinate_examples = []

        has_valid_coordinates = False

        for row in reader:
            entity = (
                row.get(entity_column, "")
                if entity_column else ""
            )

            code = (
                row.get(code_column, "")
                if code_column else ""
            )

            category = classify_entity(entity, code)

            counts[category] = counts.get(category, 0) + 1

            if category not in examples:
                examples[category] = []

            example = {
                "entity": entity,
                "code": code
            }

            if (
                len(examples[category]) < 8
                and example not in examples[category]
            ):
                examples[category].append(example)

            if latitude_column and longitude_column:
                try:
                    latitude = float(row[latitude_column])
                    longitude = float(row[longitude_column])

                    if (
                        -90 <= latitude <= 90
                        and -180 <= longitude <= 180
                    ):
                        has_valid_coordinates = True

                        if len(coordinate_examples) < 5:
                            coordinate_examples.append({
                                "entity": entity,
                                "latitude": latitude,
                                "longitude": longitude
                            })

                except (ValueError, TypeError):
                    pass

        result["entity_counts"] = counts
        result["entity_examples"] = examples
        result["has_latitude_longitude"] = has_valid_coordinates
        result["coordinate_examples"] = coordinate_examples

        if has_valid_coordinates:
            result["notes"].append(
                "Contains valid latitude and longitude values."
            )

        if counts.get("geographic-region", 0):
            result["notes"].append(
                "Contains entities that appear to be geographic regions."
            )

        if counts.get("income-group", 0):
            result["notes"].append(
                "Contains income-group aggregates."
            )

        if counts.get("statistical-aggregate", 0):
            result["notes"].append(
                "Contains statistical aggregates or special entities."
            )

        if has_valid_coordinates:
            result["status"] = "coordinate-data"
        elif counts.get("geographic-region", 0):
            result["status"] = "contains-regional-entities"
        elif counts.get("iso3-country-or-territory", 0):
            result["status"] = "country-or-territory-data"
        elif counts.get("other-geographic-code", 0):
            result["status"] = "other-coded-geography"
        else:
            result["status"] = "aggregate-or-entity-data"

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

    statuses = {}

    for result in results:
        status = result["status"]
        statuses[status] = statuses.get(status, 0) + 1

    print()
    print("DATASET CATEGORIES:")

    for status, count in sorted(statuses.items()):
        print(f"{status}: {count}")

    coordinate_count = sum(
        result["has_latitude_longitude"]
        for result in results
    )

    print()
    print(f"Charts with valid coordinates: {coordinate_count}")
    print(f"Full report saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
