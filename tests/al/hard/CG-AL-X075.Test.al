codeunit 88828 "CG-AL-X075 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own rows.

    local procedure SeedContact(ContactNo: Code[20]; CityName: Text[30]; ContactCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Contact.Init();
        Contact."No." := ContactNo;
        Contact.City := CityName;
        Contact."Credit Limit" := ContactCreditLimit;
        Contact.Insert();
    end;

    // Walks the view the submission left on the record; called repeatedly per
    // test, which also proves the list survives being iterated more than once.
    local procedure CountVisits(var Contact: Record "CG X075 Contact"; ContactNo: Code[20]): Integer
    var
        Visits: Integer;
    begin
        if Contact.FindSet() then
            repeat
                if Contact."No." = ContactNo then
                    Visits += 1;
            until Contact.Next() = 0;
        exit(Visits);
    end;

    local procedure AssertContactUnchanged(ContactNo: Code[20]; ExpectedCity: Text[30]; ExpectedCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Assert.IsTrue(Contact.Get(ContactNo),
            StrSubstNo('Expected contact %1 to still exist under its original number after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCity, Contact.City,
            StrSubstNo('Expected contact %1''s city to be unchanged after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCreditLimit, Contact."Credit Limit",
            StrSubstNo('Expected contact %1''s credit limit to be unchanged after building the call list', ContactNo));
    end;

    [Test]
    procedure CityOnlyQualifiersAppearOnTheList()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        SeedContact('C001', 'RIVERTON', 0);
        SeedContact('C002', 'RIVERTON', 0);
        SeedContact('C003', 'LAKESIDE', 0);

        CampaignCallList.BuildCallList(Contact, 'RIVERTON', 100000);

        Assert.AreEqual(1, CountVisits(Contact, 'C001'),
            'Expected a contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(1, CountVisits(Contact, 'C002'),
            'Expected a second contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(0, CountVisits(Contact, 'C003'),
            'Expected a contact outside the target city, below the credit limit, to stay off the call list');
    end;

    [Test]
    procedure CreditLimitQualifiersAppearRegardlessOfCity()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        SeedContact('C010', 'FARAWAY', 3200);
        SeedContact('C011', 'FARAWAY', 1800);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 2500);

        Assert.AreEqual(1, CountVisits(Contact, 'C010'),
            'Expected a contact whose credit limit clears the threshold to be on the call list even though they live outside the target city');
        Assert.AreEqual(0, CountVisits(Contact, 'C011'),
            'Expected a contact below the credit-limit threshold and outside the target city to stay off the call list');
    end;

    [Test]
    procedure ContactMatchingBothRulesIsVisitedOnceAlongsideCityOnlyContact()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        SeedContact('C020', 'HARBORVIEW', 5200);
        SeedContact('C021', 'HARBORVIEW', 0);
        SeedContact('C022', 'MILLBROOK', 5200);

        CampaignCallList.BuildCallList(Contact, 'HARBORVIEW', 4000);

        Assert.AreEqual(1, CountVisits(Contact, 'C020'),
            'Expected a contact matching both rules to be visited exactly once, nobody gets called twice');
        Assert.AreEqual(1, CountVisits(Contact, 'C021'),
            'Expected a contact matching only the target-city rule to be on the same list as a contact matching both rules');
        Assert.AreEqual(1, CountVisits(Contact, 'C022'),
            'Expected a contact matching only the credit-limit rule to be on the same list as a contact matching both rules');
    end;

    [Test]
    procedure CreditLimitThresholdBoundaryQualifiesAtExactValue()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        SeedContact('C030', 'RIVERSIDE', 4000);
        SeedContact('C031', 'RIVERSIDE', 3999.99);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 4000);

        Assert.AreEqual(1, CountVisits(Contact, 'C030'),
            'Expected a credit limit exactly at the threshold to qualify, the rule is at or above the threshold, not strictly above it');
        Assert.AreEqual(0, CountVisits(Contact, 'C031'),
            'Expected a credit limit just below the threshold to stay off the call list');
    end;

    [Test]
    procedure TargetCityMatchesTheWholeValueOnly()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        SeedContact('C040', 'NORTH', 0);
        SeedContact('C041', 'NORTHPORT', 0);

        CampaignCallList.BuildCallList(Contact, 'NORTH', 100000);

        Assert.AreEqual(1, CountVisits(Contact, 'C040'),
            'Expected a contact whose city exactly matches the target city to be on the call list');
        Assert.AreEqual(0, CountVisits(Contact, 'C041'),
            'Expected a contact whose city merely starts with the target city to stay off the list, the match is on the whole value');
    end;

    [Test]
    procedure BuildingTheListWritesNoContacts()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        SeedContact('C050', 'CAMPAIGNTOWN', 900);
        SeedContact('C051', 'QUIETSIDE', 900);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 5000);

        Assert.AreEqual(0, CountVisits(Contact, 'C051'),
            'Expected a contact matching neither rule to stay off the call list');
        AssertContactUnchanged('C050', 'CAMPAIGNTOWN', 900);
        AssertContactUnchanged('C051', 'QUIETSIDE', 900);
    end;

    [Test]
    procedure CampaignLookupBuildsTheSameCallListThroughTheWrapper()
    var
        Contact: Record "CG X075 Contact";
        Campaign: Record "CG X075 Campaign";
        CampaignCallListMgt: Codeunit "CG X075 Campaign Call List Mgt";
    begin
        Contact.DeleteAll();
        Campaign.DeleteAll();
        SeedContact('C060', 'ELM STREET', 0);
        SeedContact('C061', 'MAPLE STREET', 0);

        Campaign.Init();
        Campaign."Code" := 'SPRING26';
        Campaign."Target City" := 'ELM STREET';
        Campaign."Minimum Credit Limit" := 100000;
        Campaign.Insert();

        CampaignCallListMgt.BuildCallListForCampaign(Contact, 'SPRING26');

        Assert.AreEqual(1, CountVisits(Contact, 'C060'),
            'Expected the campaign lookup to include a contact in the campaign''s target city on the call list');
        Assert.AreEqual(0, CountVisits(Contact, 'C061'),
            'Expected the campaign lookup to leave a contact in a different city off the call list');
    end;
}
