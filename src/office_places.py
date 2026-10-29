"""Bulk corporate-office acquisition from Overture's current public release."""

import json
import math
import sys


def office_from_place(place, longitude, latitude, city, release):
    taxonomy = place.get("taxonomy") or {}
    categories = set(taxonomy.get("hierarchy") or [])
    categories.add(taxonomy.get("primary"))
    confidence = place.get("confidence")
    if not categories.intersection({"corporate_or_business_office", "software_development", "information_technology_company", "engineering_service", "research_institute"}) and taxonomy.get("primary") != "financial_service":
        return None
    if not isinstance(confidence, (int, float)) or not math.isfinite(confidence) or not .8 <= confidence <= 1:
        return None
    if place.get("operating_status") in {"closed", "permanently_closed"}:
        return None
    name = (place.get("names") or {}).get("primary")
    feature_id = place.get("id")
    if not isinstance(name, str) or not name.strip() or not isinstance(feature_id, str) or not feature_id:
        raise ValueError("Malformed Overture office identity")
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in (latitude, longitude)):
        raise ValueError("Malformed Overture office coordinates")
    if abs(latitude - city["lat"]) > .32 or abs(longitude - city["lng"]) > .4:
        raise ValueError("Overture office outside requested city bounds")
    addresses = place.get("addresses") or []
    address = next((value for value in addresses if value.get("country") == "IN"), {})
    if addresses and not address:
        return None
    return {
        "id": "overture:" + feature_id, "company": name, "city": city["name"],
        "latitude": latitude, "longitude": longitude, "officeName": name,
        "locality": address.get("locality") or "",
        "address": ", ".join(value for value in [address.get("freeform"), address.get("postcode")] if value),
        # A source-listed place point does not verify a building or a role's worksite.
        "approximate": True,
        "source": f"https://stac.overturemaps.org/{release}/places/catalog.json",
    }


def main():
    from overturemaps import record_batch_reader
    from overturemaps.core import get_latest_release
    from shapely import from_wkb

    cities = json.load(sys.stdin)
    if not isinstance(cities, list) or not cities:
        raise ValueError("City definitions required")
    release = get_latest_release()
    offices = []
    for city in cities:
        reader = record_batch_reader("place", bbox=(city["lng"] - .4, city["lat"] - .32, city["lng"] + .4, city["lat"] + .32),
                                     release=release, connect_timeout=20, request_timeout=60, stac=True)
        if reader is None:
            raise ValueError(f"{city['name']}: Overture returned no dataset")
        found = []
        for batch in reader:
            for place in batch.to_pylist():
                geometry = from_wkb(place["geometry"])
                if geometry.geom_type != "Point":
                    continue
                office = office_from_place(place, geometry.x, geometry.y, city, release)
                if office:
                    found.append((place["confidence"], office))
        if not found:
            raise ValueError(f"{city['name']}: no qualified corporate offices in Overture response")
        found.sort(key=lambda value: value[0], reverse=True)
        offices.extend(office for _, office in found)
        print(f"{city['name']}: {len(found)} Overture office places ({release})", file=sys.stderr, flush=True)
    json.dump({"version": 1, "release": release, "offices": offices}, sys.stdout, ensure_ascii=True, allow_nan=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Overture acquisition failed: {error}", file=sys.stderr)
        sys.exit(1)
