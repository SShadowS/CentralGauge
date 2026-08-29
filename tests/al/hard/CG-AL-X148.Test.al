codeunit 89368 "CG-AL-X148 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure ClearAll()
    var
        Agreement: Record "CG X148 Volume Agreement";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        RebateRate: Record "CG X148 Rebate Rate";
    begin
        Agreement.DeleteAll();
        AgreementLine.DeleteAll();
        RebateRate.DeleteAll();
    end;

    local procedure SeedAgreement(No: Code[20]; CustomerNo: Code[20]; CurrencyCode: Code[10]; EffectiveDate: Date; Notes: Text[100]; RebateGroup: Code[10])
    var
        Agreement: Record "CG X148 Volume Agreement";
    begin
        Agreement.Init();
        Agreement."No." := No;
        Agreement."Customer No." := CustomerNo;
        Agreement."Currency Code" := CurrencyCode;
        Agreement."Effective Date" := EffectiveDate;
        Agreement.Notes := Notes;
        Agreement."Rebate Group" := RebateGroup;
        Agreement.Insert();
    end;

    local procedure SeedRebateRate(RebateGroup: Code[10]; RebatePct: Decimal)
    var
        RebateRate: Record "CG X148 Rebate Rate";
    begin
        RebateRate.Init();
        RebateRate."Rebate Group" := RebateGroup;
        RebateRate."Rebate %" := RebatePct;
        RebateRate.Insert();
    end;

    local procedure AssertLine(AgreementNo: Code[20]; ZoneCode: Code[10]; ExpectedCustomerNo: Code[20]; ExpectedCurrencyCode: Code[10]; ExpectedEffectiveDate: Date; ExpectedNotes: Text[100]; ExpectedRebateGroup: Code[10]; MessagePrefix: Text)
    var
        AgreementLine: Record "CG X148 Volume Agreement Line";
    begin
        Assert.IsTrue(AgreementLine.Get(AgreementNo, ZoneCode), MessagePrefix + ' - zone line exists');
        Assert.AreEqual(ExpectedCustomerNo, AgreementLine."Customer No.", MessagePrefix + ' - customer no');
        Assert.AreEqual(ExpectedCurrencyCode, AgreementLine."Currency Code", MessagePrefix + ' - currency code');
        Assert.AreEqual(ExpectedEffectiveDate, AgreementLine."Effective Date", MessagePrefix + ' - effective date');
        Assert.AreEqual(ExpectedNotes, AgreementLine.Notes, MessagePrefix + ' - notes');
        Assert.AreEqual(ExpectedRebateGroup, AgreementLine."Rebate Group", MessagePrefix + ' - rebate group');
    end;

    [Test]
    procedure DistributeCopiesEveryAgreementFieldOntoEachZoneLine()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Zones: List of [Code[10]];
    begin
        ClearAll();
        SeedAgreement('AGR1', 'CUST1', 'DKK', 20260115D, 'Key account, quarterly review', 'GRPA');
        Zones.Add('Z1');
        Zones.Add('Z2');

        Distributor.DistributeToZones('AGR1', Zones);

        AssertLine('AGR1', 'Z1', 'CUST1', 'DKK', 20260115D, 'Key account, quarterly review', 'GRPA', 'The first zone line');
        AssertLine('AGR1', 'Z2', 'CUST1', 'DKK', 20260115D, 'Key account, quarterly review', 'GRPA', 'The second zone line');
    end;

    [Test]
    procedure AgreementWithARebateGroupPricesEveryZoneAtTheGroupsRate()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Resolver: Codeunit "CG X148 Rebate Resolver";
        RebateRate: Record "CG X148 Rebate Rate";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        ClearAll();
        SeedRebateRate('GRPB', 12);
        SeedRebateRate('SENTINEL', 77);
        SeedAgreement('AGR2', 'CUST2', 'DKK', 20260201D, 'Spring campaign', 'GRPB');
        Zones.Add('Z1');
        Zones.Add('Z2');

        Distributor.DistributeToZones('AGR2', Zones);

        AgreementLine.Get('AGR2', 'Z1');
        Assert.AreEqual(12, Resolver.GetRebatePct(AgreementLine), 'The first zone of an agreement in a rebate group prices at the group''s own rate');
        AgreementLine.Get('AGR2', 'Z2');
        Assert.AreEqual(12, Resolver.GetRebatePct(AgreementLine), 'The second zone of an agreement in a rebate group prices at the group''s own rate');

        RebateRate.Get('SENTINEL');
        Assert.AreEqual(77, RebateRate."Rebate %", 'An unrelated rebate group''s own rate must not be touched by resolving a different group''s rate');
    end;

    [Test]
    procedure AgreementWithNoRebateGroupPricesEveryZoneAtTheStandardRate()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Resolver: Codeunit "CG X148 Rebate Resolver";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        ClearAll();
        SeedAgreement('AGR3', 'CUST3', 'DKK', 20260301D, 'No group, standard pricing', '');
        Zones.Add('Z1');

        Distributor.DistributeToZones('AGR3', Zones);

        AgreementLine.Get('AGR3', 'Z1');
        Assert.AreEqual(2.5, Resolver.GetRebatePct(AgreementLine), 'A zone of an agreement with no rebate group prices at the standard rebate');
    end;

    [Test]
    procedure RebateGroupRateChangesAfterDistributionStillFlowThroughToPricing()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Resolver: Codeunit "CG X148 Rebate Resolver";
        RebateRate: Record "CG X148 Rebate Rate";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        ClearAll();
        SeedRebateRate('GRPC', 8);
        SeedAgreement('AGR4', 'CUST4', 'DKK', 20260401D, 'Autumn renewal', 'GRPC');
        Zones.Add('Z1');

        Distributor.DistributeToZones('AGR4', Zones);

        RebateRate.Get('GRPC');
        RebateRate."Rebate %" := 19;
        RebateRate.Modify();

        AgreementLine.Get('AGR4', 'Z1');
        Assert.AreEqual(19, Resolver.GetRebatePct(AgreementLine), 'A zone line prices at its rebate group''s current rate, not the rate in effect when it was distributed');
    end;

    [Test]
    procedure DistributingOneAgreementDoesNotAffectAnotherAgreementsZoneLines()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Zones: List of [Code[10]];
    begin
        ClearAll();
        SeedAgreement('AGR5', 'CUST5', 'DKK', 20260501D, 'North region', 'GRPD');
        SeedAgreement('AGR6', 'CUST6', 'EUR', 20260601D, 'South region', 'GRPE');
        Zones.Add('ZX');

        Distributor.DistributeToZones('AGR5', Zones);
        Distributor.DistributeToZones('AGR6', Zones);

        AssertLine('AGR5', 'ZX', 'CUST5', 'DKK', 20260501D, 'North region', 'GRPD', 'AGR5''s zone line after a second, unrelated agreement is also distributed');
        AssertLine('AGR6', 'ZX', 'CUST6', 'EUR', 20260601D, 'South region', 'GRPE', 'AGR6''s own zone line');
    end;

    [Test]
    procedure DistributeCreatesExactlyOneZoneLinePerRequestedZoneAndNoOthers()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        ClearAll();
        SeedAgreement('AGR7', 'CUST7', 'DKK', 20260701D, 'Rollout wave 1', '');
        Zones.Add('A');
        Zones.Add('B');
        Zones.Add('C');

        Distributor.DistributeToZones('AGR7', Zones);

        AgreementLine.SetRange("Agreement No.", 'AGR7');
        Assert.AreEqual(3, AgreementLine.Count(), 'Distributing to three zones creates exactly three zone lines');
        Assert.IsTrue(AgreementLine.Get('AGR7', 'A'), 'The first requested zone has a line');
        Assert.IsTrue(AgreementLine.Get('AGR7', 'B'), 'The second requested zone has a line');
        Assert.IsTrue(AgreementLine.Get('AGR7', 'C'), 'The third requested zone has a line');
        Assert.IsFalse(AgreementLine.Get('AGR7', 'D'), 'A zone that was never requested has no line');
    end;
}
