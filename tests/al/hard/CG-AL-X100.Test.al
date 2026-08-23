codeunit 89196 "CG-AL-X100 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears its own
    // tables before seeding its own rows. Out-of-scope rows are seeded with
    // nonzero sentinel values so "untouched" and "zeroed"/"overwritten" stay
    // distinguishable.

    local procedure Seed(EntryNo: Integer; Category: Code[10]; Qty: Integer; InitialTotal: Integer)
    var
        Line: Record "CG X065 Order Line";
    begin
        Line.Init();
        Line."Entry No." := EntryNo;
        Line.Category := Category;
        Line.Quantity := Qty;
        Line."Line Total" := InitialTotal;
        Line.Insert();
    end;

    local procedure TotalOf(EntryNo: Integer): Integer
    var
        Line: Record "CG X065 Order Line";
    begin
        Line.Get(EntryNo);
        exit(Line."Line Total");
    end;

    [Test]
    procedure EveryLineInTheCategoryIsRepriced()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(1, 'ALPHA', 2, 0);
        Seed(2, 'ALPHA', 3, 0);
        Seed(3, 'ALPHA', 4, 0);
        Seed(4, 'BETA', 6, 999);

        Repricer.RepriceCategory('ALPHA');

        Assert.AreEqual(20, TotalOf(1), 'Line 1 must be repriced');
        Assert.AreEqual(30, TotalOf(2), 'Line 2 must be repriced');
        Assert.AreEqual(40, TotalOf(3), 'Line 3 must be repriced');
        Assert.AreEqual(999, TotalOf(4), 'Line 4 is in another category and must not change');
    end;

    [Test]
    procedure VolumeDiscountAppliesAtTwentyUnits()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(10, 'ALPHA', 12, 0);
        Seed(11, 'ALPHA', 8, 0);
        Seed(12, 'BETA', 30, 999);

        Repricer.RepriceCategory('ALPHA');

        Assert.AreEqual(96, TotalOf(10), 'Line 10 must use the discounted price');
        Assert.AreEqual(64, TotalOf(11), 'Line 11 must use the discounted price');
        Assert.AreEqual(999, TotalOf(12), 'Line 12 is in another category and must not change');
    end;

    [Test]
    procedure BelowThresholdKeepsBasePrice()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(20, 'BETA', 19, 0);

        Repricer.RepriceCategory('BETA');

        Assert.AreEqual(133, TotalOf(20), 'A 19-unit category keeps its base price');
    end;

    [Test]
    procedure OtherCategoriesVolumeDoesNotChangeThePrice()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(40, 'GAMMA', 3, 0);
        Seed(41, 'BETA', 30, 999);

        Repricer.RepriceCategory('GAMMA');

        Assert.AreEqual(15, TotalOf(40), 'A 3-unit category keeps its base price whatever other categories hold');
        Assert.AreEqual(999, TotalOf(41), 'Line 41 is in another category and must not change');
    end;

    [Test]
    procedure RepricingIsRepeatable()
    var
        Line: Record "CG X065 Order Line";
        Repricer: Codeunit "CG X065 Repricer";
    begin
        Line.DeleteAll();
        Seed(30, 'ALPHA', 5, 0);
        Seed(31, 'ALPHA', 6, 0);

        Repricer.RepriceCategory('ALPHA');
        Repricer.RepriceCategory('ALPHA');

        Assert.AreEqual(50, TotalOf(30), 'Line 30 must be stable across repeated repricing');
        Assert.AreEqual(60, TotalOf(31), 'Line 31 must be stable across repeated repricing');
    end;

    [Test]
    procedure PriceServiceContractSurvives()
    var
        Line: Record "CG X065 Order Line";
        PriceSvc: Codeunit "CG X065 Price Svc";
    begin
        Line.DeleteAll();
        Seed(50, 'ALPHA', 4, 0);
        Line.Get(50);

        Assert.AreEqual(10, PriceSvc.UnitPriceFor(Line), 'A 4-unit ALPHA line prices at 10');
    end;

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

    local procedure SeedPerformance(EntryNo: Integer; AgreementNo: Code[20]; PlayName: Text[50]; Category: Code[20]; Audience: Integer)
    var
        Performance: Record "CG X078 Performance";
    begin
        Performance.Init();
        Performance."Entry No." := EntryNo;
        Performance."Agreement No." := AgreementNo;
        Performance."Play Name" := PlayName;
        Performance.Category := Category;
        Performance.Audience := Audience;
        Performance.Insert();
    end;

    local procedure VerifyLine(var StatementLine: Record "CG X078 Statement Line" temporary; LineNo: Integer; PlayName: Text[50]; Category: Code[20]; Audience: Integer; Amount: Decimal; Credits: Integer)
    begin
        Assert.IsTrue(StatementLine.Get(LineNo), StrSubstNo('Expected the statement to contain line %1', LineNo));
        Assert.AreEqual(PlayName, StatementLine."Play Name", StrSubstNo('Expected the play name copied onto line %1', LineNo));
        Assert.AreEqual(Category, StatementLine.Category, StrSubstNo('Expected the category copied onto line %1', LineNo));
        Assert.AreEqual(Audience, StatementLine.Audience, StrSubstNo('Expected the audience copied onto line %1', LineNo));
        Assert.AreEqual(Amount, StatementLine.Amount, StrSubstNo('Expected the fee for line %1 (%2, audience %3)', LineNo, Category, Audience));
        Assert.AreEqual(Credits, StatementLine.Credits, StrSubstNo('Expected the loyalty credits for line %1 (%2, audience %3)', LineNo, Category, Audience));
    end;

    [Test]
    procedure TragedyChargesFlatFeeAtExactlyThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(400.0, Statement.LineAmount('TRAGEDY', 30), 'Expected the flat tragedy base fee at exactly 30 attendees, the surcharge starts only above 30');
    end;

    [Test]
    procedure TragedyAddsSurchargeJustAboveThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(410.0, Statement.LineAmount('TRAGEDY', 31), 'Expected the tragedy base fee plus one surcharge step at 31 attendees');
    end;

    [Test]
    procedure ComedyEarnsNoBonusAtExactlyTwentyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(360.0, Statement.LineAmount('COMEDY', 20), 'Expected the comedy fee with no bonus at exactly 20 attendees, the bonus starts only above 20');
    end;

    [Test]
    procedure ComedyAddsBonusJustAboveTwentyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(468.0, Statement.LineAmount('COMEDY', 21), 'Expected the comedy fee with its bonus and one bonus step at 21 attendees');
    end;

    [Test]
    procedure NoCreditsAtExactlyThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(0, Statement.LineCredits('TRAGEDY', 30), 'Expected zero credits at exactly 30 attendees, credits start only above 30');
    end;

    [Test]
    procedure OneCreditAtThirtyOneAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(1, Statement.LineCredits('TRAGEDY', 31), 'Expected exactly one credit at 31 attendees');
    end;

    [Test]
    procedure ComedyAddsCreditPerFullGroupOfFiveAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(10, Statement.LineCredits('COMEDY', 34), 'Expected 4 threshold credits plus 6 group-of-five credits for a comedy audience of 34');
    end;

    [Test]
    procedure ComedyCreditsDropPartialGroupOfFive()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(1, Statement.LineCredits('COMEDY', 9), 'Expected exactly one group-of-five credit for a comedy audience of 9, the remaining four attendees earn nothing');
    end;

    [Test]
    procedure UnknownCategoryFailsLineAmount()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        asserterror Statement.LineAmount('HISTORY', 25);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure UnknownCategoryFailsLineCredits()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        asserterror Statement.LineCredits('HISTORY', 25);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure BuildStatementListsAgreementPerformancesInOrderWithCorrectTotals()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A single build with freshly declared totals produces the right lines and sums.
        Performance.DeleteAll();
        SeedPerformance(1701, 'TRYAL-RS17', 'Hamlet', 'TRAGEDY', 55);
        SeedPerformance(1702, 'TRYAL-RS17', 'As You Like It', 'COMEDY', 35);
        SeedPerformance(1703, 'TRYAL-RS17', 'Othello', 'TRAGEDY', 15);
        SeedPerformance(1704, 'TRYAL-RS17X', 'The Tempest', 'COMEDY', 40);

        Statement.BuildStatement('TRYAL-RS17', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(), 'Expected one statement line per performance of the agreement, performances of another agreement are excluded');
        VerifyLine(StatementLine, 1, 'Hamlet', 'TRAGEDY', 55, 650.0, 25);
        VerifyLine(StatementLine, 2, 'As You Like It', 'COMEDY', 35, 580.0, 12);
        VerifyLine(StatementLine, 3, 'Othello', 'TRAGEDY', 15, 400.0, 0);
        Assert.AreEqual(1630.0, TotalAmount, 'Expected TotalAmount to be the sum of the three line amounts');
        Assert.AreEqual(37, TotalCredits, 'Expected TotalCredits to be the sum of the three line credits');
    end;

    [Test]
    procedure BuildStatementDoesNotCarryOverThePriorAgreementsTotalsWhenReused()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] Building statements for two agreements back-to-back with the same output variables: the second agreement's totals must be its own, not layered onto the first's.
        Performance.DeleteAll();
        SeedPerformance(3001, 'TRYAL-A', 'Hamlet', 'TRAGEDY', 55);
        SeedPerformance(3002, 'TRYAL-B', 'Othello', 'TRAGEDY', 15);

        Statement.BuildStatement('TRYAL-A', StatementLine, TotalAmount, TotalCredits);
        Assert.AreEqual(650.0, TotalAmount, 'Expected the first agreement''s own total');
        Assert.AreEqual(25, TotalCredits, 'Expected the first agreement''s own credits');

        Statement.BuildStatement('TRYAL-B', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected only the second agreement''s own line in the buffer');
        Assert.AreEqual(400.0, TotalAmount, 'Expected the second agreement''s TotalAmount to reflect only its own performance, not the first agreement''s total on top');
        Assert.AreEqual(0, TotalCredits, 'Expected the second agreement''s TotalCredits to reflect only its own performance, not the first agreement''s credits on top');
    end;

    [Test]
    procedure BuildStatementClearsPreSetTotalsAndStaleBufferLine()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A caller that pre-sets its totals (or passes in dirty output variables) still gets a clean recomputation.
        Performance.DeleteAll();
        SeedPerformance(1801, 'TRYAL-RS18', 'King Lear', 'TRAGEDY', 40);
        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine.Insert();
        TotalAmount := 123.45;
        TotalCredits := 77;

        Statement.BuildStatement('TRYAL-RS18', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected the buffer to hold only the fresh statement, a line from before the build must be removed first');
        Assert.IsFalse(StatementLine.Get(999), 'Expected the stale line 999 from before the build to be gone');
        VerifyLine(StatementLine, 1, 'King Lear', 'TRAGEDY', 40, 500.0, 10);
        Assert.AreEqual(500.0, TotalAmount, 'Expected TotalAmount to be recomputed from scratch, not added onto the pre-set value');
        Assert.AreEqual(10, TotalCredits, 'Expected TotalCredits to be recomputed from scratch, not added onto the pre-set value');
    end;

    [Test]
    procedure BuildStatementYieldsZeroTotalsForAgreementWithNoPerformancesEvenWithDirtyInputs()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] An agreement with no performances yields an empty buffer and zero totals even when the outputs start dirty.
        Performance.DeleteAll();
        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine.Insert();
        TotalAmount := 999.99;
        TotalCredits := 99;

        Statement.BuildStatement('TRYAL-RS19', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(0, StatementLine.Count(), 'Expected an empty statement for an agreement with no performances');
        Assert.AreEqual(0.0, TotalAmount, 'Expected TotalAmount to come back at zero for an agreement with no performances, whatever it held on entry');
        Assert.AreEqual(0, TotalCredits, 'Expected TotalCredits to come back at zero for an agreement with no performances, whatever it held on entry');
    end;

    [Test]
    procedure BuildStatementFailsWhenAPerformanceHasUnknownCategory()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        Performance.DeleteAll();
        SeedPerformance(2001, 'TRYAL-RS20', 'Hamlet', 'TRAGEDY', 30);
        SeedPerformance(2002, 'TRYAL-RS20', 'Henry V', 'HISTORY', 25);

        asserterror Statement.BuildStatement('TRYAL-RS20', StatementLine, TotalAmount, TotalCredits);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure RandomAgreementTotalsMatchIndependentComputation()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        Any: Codeunit Any;
        Category: Code[20];
        Audience: Integer;
        i: Integer;
        ExpectedAmount: Decimal;
        ExpectedCredits: Integer;
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A generated agreement totals exactly what the fee and credit rules say, computed independently of BuildStatement's own internals.
        Performance.DeleteAll();
        for i := 1 to 5 do begin
            if i mod 2 = 1 then
                Category := 'TRAGEDY'
            else
                Category := 'COMEDY';
            Audience := Any.IntegerInRange(1, 150);
            SeedPerformance(2100 + i, 'TRYAL-RS21', StrSubstNo('Play %1', i), Category, Audience);
            ExpectedAmount += IndependentAmount(Category, Audience);
            ExpectedCredits += IndependentCredits(Category, Audience);
        end;

        Statement.BuildStatement('TRYAL-RS21', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(5, StatementLine.Count(), 'Expected one statement line per generated performance');
        Assert.AreEqual(ExpectedAmount, TotalAmount, 'Expected TotalAmount to match the independently computed sum of the generated fees');
        Assert.AreEqual(ExpectedCredits, TotalCredits, 'Expected TotalCredits to match the independently computed sum of the generated credits');
    end;

    local procedure IndependentAmount(Category: Code[20]; Audience: Integer): Decimal
    begin
        if Category = 'TRAGEDY' then begin
            if Audience > 30 then
                exit(400.0 + 10 * (Audience - 30));
            exit(400.0);
        end;
        if Audience > 20 then
            exit(300.0 + 3 * Audience + 100 + 5 * (Audience - 20));
        exit(300.0 + 3 * Audience);
    end;

    local procedure IndependentCredits(Category: Code[20]; Audience: Integer): Integer
    var
        Credits: Integer;
    begin
        if Audience > 30 then
            Credits := Audience - 30;
        if Category = 'COMEDY' then
            Credits += Audience div 5;
        exit(Credits);
    end;

    // The X086 helper below is named SeedSyncContact (not SeedContact) to
    // avoid colliding with the X075 section's local SeedContact procedure
    // above - AL does not support procedure overloading by signature.
    local procedure SeedSyncContact(ContactId: Code[20]; CompanyName: Text[100]; VATRegistrationNo: Text[20]; Address: Text[100]; Status: Text[20]; LastSynced: DateTime)
    var
        Contact: Record "CG X086 Contact";
    begin
        Contact.Init();
        Contact."Contact Id" := ContactId;
        Contact."Company Name" := CompanyName;
        Contact."VAT Registration No." := VATRegistrationNo;
        Contact."Address" := Address;
        Contact."Status" := Status;
        Contact."Last Synced" := LastSynced;
        Contact.Insert();
    end;

    local procedure SeedFeedLine(LineNo: Integer; ExternalContactId: Code[20]; NewExternalContactId: Code[20]; CompanyName: Text[100]; VATRegistrationNo: Text[20]; Address: Text[100]; Status: Text[20])
    var
        FeedLine: Record "CG X086 Feed Line";
    begin
        FeedLine.Init();
        FeedLine."Line No." := LineNo;
        FeedLine."External Contact Id" := ExternalContactId;
        FeedLine."New External Contact Id" := NewExternalContactId;
        FeedLine."Company Name" := CompanyName;
        FeedLine."VAT Registration No." := VATRegistrationNo;
        FeedLine."Address" := Address;
        FeedLine."Status" := Status;
        FeedLine.Insert();
    end;

    [Test]
    procedure NewContactIsInsertedFromFeedWithNoRenameRequested()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedSyncContact('UNTOUCH1', 'Untouched Co', 'UNTOUCHVAT', 'Untouched Addr', 'UntouchedStat', CreateDateTime(20250101D, 080000T));
        SeedFeedLine(1, 'NEWCUST1', '', 'Brand New Co', 'NEWVAT01', 'New Addr', 'Active');

        FeedImport.ImportFeed(FeedLine);

        Contact.Get('NEWCUST1');
        Assert.AreEqual('Brand New Co', Contact."Company Name", 'A first-time feed contact must be created with the feed''s company name');
        Assert.AreEqual('NEWVAT01', Contact."VAT Registration No.", 'A first-time feed contact must be created with the feed''s VAT registration number');
        Assert.AreEqual('New Addr', Contact."Address", 'A first-time feed contact must be created with the feed''s address');
        Assert.AreEqual('Active', Contact."Status", 'A first-time feed contact must be created with the feed''s status');

        Contact.Get('UNTOUCH1');
        Assert.AreEqual('Untouched Co', Contact."Company Name", 'An unrelated contact must not be affected by importing a different feed line');
    end;

    [Test]
    procedure CleanRenameMovesContactAndRefreshesFieldsUnderTheNewId()
    var
        Contact: Record "CG X086 Contact";
        ContactSync: Codeunit "CG X086 Contact Sync";
    begin
        Contact.DeleteAll();
        SeedSyncContact('OLDID1', 'Old Name', 'OLDVAT01', 'Old Addr', 'OldStat', CreateDateTime(20250101D, 080000T));

        ContactSync.SyncContact('OLDID1', 'NEWID1', 'Renamed Co', 'NEWVAT01', 'New Addr', 'Active');

        Assert.IsTrue(Contact.Get('NEWID1'), 'The contact must be found under the feed''s new id after a non-colliding rename');
        Assert.AreEqual('Renamed Co', Contact."Company Name", 'The renamed contact''s company name must come from the feed');
        Assert.AreEqual('NEWVAT01', Contact."VAT Registration No.", 'The renamed contact''s VAT registration number must come from the feed');
        Assert.AreEqual('New Addr', Contact."Address", 'The renamed contact''s address must come from the feed');
        Assert.AreEqual('Active', Contact."Status", 'The renamed contact''s status must come from the feed');
        Assert.IsFalse(Contact.Get('OLDID1'), 'The contact must no longer be found under its old id once the rename has been applied');
    end;

    [Test]
    procedure CleanMergeViaImportFeedMovesContactAndRefreshesFieldsUnderTheNewId()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedSyncContact('OLDID2', 'Old Name Two', 'OLDVAT02', 'Old Addr Two', 'OldStat2', CreateDateTime(20250101D, 080000T));
        SeedFeedLine(1, 'OLDID2', 'NEWID2', 'Merged Co', 'MERGEVAT2', 'Merged Addr', 'Active');

        FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('NEWID2'), 'The contact must be found under the feed''s merged id after ImportFeed applies a non-colliding merge');
        Assert.AreEqual('Merged Co', Contact."Company Name", 'The merged contact''s company name must come from the feed');
        Assert.AreEqual('MERGEVAT2', Contact."VAT Registration No.", 'The merged contact''s VAT registration number must come from the feed');
        Assert.AreEqual('Merged Addr', Contact."Address", 'The merged contact''s address must come from the feed');
        Assert.AreEqual('Active', Contact."Status", 'The merged contact''s status must come from the feed');
        Assert.IsFalse(Contact.Get('OLDID2'), 'The contact must no longer be found under its old id once ImportFeed has applied the merge');
    end;

    [Test]
    procedure CollisionSkipLeavesTheLosingContactUnderItsOldIdWithStaleFields()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedSyncContact('TARGET1', 'Target Co', 'TARGVAT01', 'Target Addr', 'TargetStat', CreateDateTime(20250101D, 080000T));
        SeedSyncContact('LOSING1', 'Losing Co', 'LOSEVAT01', 'Losing Addr', 'LosingStat', CreateDateTime(20250102D, 080000T));
        SeedFeedLine(1, 'LOSING1', 'TARGET1', 'Feed Update Co', 'FEEDVAT1', 'Feed Addr', 'FeedStat');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('LOSING1'), 'The losing contact must still be found under its old id after a colliding sync is attempted');
        Assert.AreEqual('Losing Co', Contact."Company Name", 'A colliding sync must not refresh the losing contact''s company name');
        Assert.AreEqual('LOSEVAT01', Contact."VAT Registration No.", 'A colliding sync must not refresh the losing contact''s VAT registration number');
        Assert.AreEqual('Losing Addr', Contact."Address", 'A colliding sync must not refresh the losing contact''s address');
        Assert.AreEqual('LosingStat', Contact."Status", 'A colliding sync must not refresh the losing contact''s status');
        Assert.AreEqual(CreateDateTime(20250102D, 080000T), Contact."Last Synced", 'A colliding sync must not refresh the losing contact''s last-synced time');
    end;

    [Test]
    procedure CollisionSkipLeavesTheCollidingContactUntouched()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedSyncContact('TARGET2', 'Target Co Two', 'TARGVAT02', 'Target Addr Two', 'TargetStatTwo', CreateDateTime(20250101D, 080000T));
        SeedSyncContact('LOSING2', 'Losing Co Two', 'LOSEVAT02', 'Losing Addr Two', 'LosingStatTwo', CreateDateTime(20250102D, 080000T));
        SeedFeedLine(1, 'LOSING2', 'TARGET2', 'Feed Update Co Two', 'FEEDVAT2', 'Feed Addr Two', 'FeedStatTwo');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('TARGET2'), 'The already-correct target contact must still exist after a colliding sync is attempted');
        Assert.AreEqual('Target Co Two', Contact."Company Name", 'A colliding sync must not overwrite the target contact''s company name with the losing contact''s feed data');
        Assert.AreEqual('TARGVAT02', Contact."VAT Registration No.", 'A colliding sync must not overwrite the target contact''s VAT registration number with the losing contact''s feed data');
        Assert.AreEqual('Target Addr Two', Contact."Address", 'A colliding sync must not overwrite the target contact''s address with the losing contact''s feed data');
        Assert.AreEqual('TargetStatTwo', Contact."Status", 'A colliding sync must not overwrite the target contact''s status with the losing contact''s feed data');
        Assert.AreEqual(CreateDateTime(20250101D, 080000T), Contact."Last Synced", 'A colliding sync must not overwrite the target contact''s last-synced time with the losing contact''s feed data');
    end;

    [Test]
    procedure CollisionSkipStaysInEffectOnEveryRepeatedSync()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedSyncContact('TARGET3', 'Target Co Three', 'TARGVAT03', 'Target Addr Three', 'TargetStat3', CreateDateTime(20250101D, 080000T));
        SeedSyncContact('LOSING3', 'Losing Co Three', 'LOSEVAT03', 'Losing Addr Three', 'LosingStat3', CreateDateTime(20250102D, 080000T));
        SeedFeedLine(1, 'LOSING3', 'TARGET3', 'First Feed Update', 'FEEDVAT3A', 'Feed Addr 3A', 'FeedStat3A');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);
        Commit();

        FeedLine.Get(1);
        FeedLine."Company Name" := 'Second Feed Update';
        FeedLine."VAT Registration No." := 'FEEDVAT3B';
        FeedLine."Address" := 'Feed Addr 3B';
        FeedLine."Status" := 'FeedStat3B';
        FeedLine.Modify();
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('LOSING3'), 'The losing contact must still be found under its old id after repeated colliding syncs');
        Assert.AreEqual('Losing Co Three', Contact."Company Name", 'Repeated colliding syncs must not eventually refresh the losing contact''s company name');
        Assert.AreEqual('LOSEVAT03', Contact."VAT Registration No.", 'Repeated colliding syncs must not eventually refresh the losing contact''s VAT registration number');
    end;
}
