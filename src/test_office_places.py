import unittest

from office_places import office_from_place


class OfficePlacesTest(unittest.TestCase):
    city = {"name": "Bengaluru", "lat": 12.9716, "lng": 77.5946}

    def place(self, **changes):
        return {"id": "example-feature", "names": {"primary": "Example Limited"}, "confidence": .9,
                "taxonomy": {"primary": "information_technology_company", "hierarchy": ["corporate_or_business_office"]},
                "addresses": [{"country": "IN", "freeform": "Example Campus", "locality": "Bengaluru", "postcode": "560001"}], **changes}

    def convert(self, place):
        return office_from_place(place, 77.6, 12.97, self.city, "2026-10-21.0")

    def test_corporate_office_keeps_identity_address_and_release_provenance(self):
        result = self.convert(self.place())
        self.assertEqual(result["company"], "Example Limited")
        self.assertEqual(result["id"], "overture:example-feature")
        self.assertEqual(result["address"], "Example Campus, 560001")
        self.assertTrue(result["approximate"])
        self.assertIn("2026-10-21.0/places/catalog.json", result["source"])

    def test_unrelated_low_confidence_closed_and_foreign_places_do_not_become_offices(self):
        for changes in [
            {"taxonomy": {"primary": "doctors_office", "hierarchy": ["health_care"]}},
            {"taxonomy": {"primary": "restaurant"}},
            {"confidence": .3}, {"confidence": float("nan")},
            {"operating_status": "permanently_closed"},
            {"addresses": [{"country": "US"}]},
        ]:
            with self.subTest(changes=changes):
                self.assertIsNone(self.convert(self.place(**changes)))

    def test_bad_id_or_coordinates_fail_instead_of_inventing_a_location(self):
        with self.assertRaises(ValueError):
            self.convert(self.place(id=""))
        for longitude, latitude in [(0, 0), (float("nan"), 12.97)]:
            with self.assertRaises(ValueError):
                office_from_place(self.place(), longitude, latitude, self.city, "2026-10-21.0")

    def test_financial_office_is_accepted_but_bank_retail_and_dealers_are_not(self):
        self.assertIsNotNone(self.convert(self.place(taxonomy={"primary": "financial_service", "hierarchy": ["services_and_business", "financial_service"]})))
        for primary in ["commercial_bank", "auto_dealer", "insurance_agency"]:
            self.assertIsNone(self.convert(self.place(taxonomy={"primary": primary, "hierarchy": ["services_and_business", "financial_service", primary]})))


if __name__ == "__main__":
    unittest.main()
